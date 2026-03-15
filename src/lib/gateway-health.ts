/**
 * @module gateway-health
 * @description
 * Gateway health monitoring, reconnection, and action queue replay (US-503).
 *
 * When the OpenClaw gateway disconnects:
 *   1. MC shows a banner with retry countdown (via status endpoint)
 *   2. Pending actions are queued in-memory
 *   3. On reconnect, queued actions are replayed in order
 *   4. If disconnected > 5 minutes → escalate to P0
 *
 * Health check is a lightweight ping to the gateway /health endpoint.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const HEALTH_CHECK_TIMEOUT_MS = 5000;

export interface GatewayStatus {
  connected: boolean;
  lastCheckedAt: Date;
  disconnectedSince: Date | null;
  disconnectedForMs: number;
  queuedActions: number;
  escalated: boolean;
}

interface QueuedAction {
  id: string;
  payload: Record<string, unknown>;
  queuedAt: Date;
}

// In-memory action queue — survives across ticks but not process restarts.
// TODO: For production reliability, persist queue + connection state to Redis or DB
// so that queued actions survive restarts during gateway outages.
let actionQueue: QueuedAction[] = [];
let disconnectedSince: Date | null = null;
let escalated = false;

/**
 * Check gateway health and manage reconnection state.
 */
export async function checkGatewayHealth(
  db: PrismaClient = defaultPrisma,
): Promise<GatewayStatus> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;

  // No gateway configured — skip health check (native mode fleet)
  if (!gatewayUrl) {
    return {
      connected: true,
      lastCheckedAt: new Date(),
      disconnectedSince: null,
      disconnectedForMs: 0,
      queuedActions: 0,
      escalated: false,
    };
  }

  let connected = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(`${gatewayUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    connected = response.ok;
  } catch {
    connected = false;
  }

  const now = new Date();

  if (connected) {
    // Reconnected — replay queued actions
    if (disconnectedSince) {
      const downtime = now.getTime() - disconnectedSince.getTime();
      console.log(
        `[GatewayHealth] Reconnected after ${Math.round(downtime / 1000)}s. Replaying ${actionQueue.length} queued actions.`,
      );

      await replayQueue(gatewayUrl, db);
      disconnectedSince = null;
      escalated = false;
    }

    return {
      connected: true,
      lastCheckedAt: now,
      disconnectedSince: null,
      disconnectedForMs: 0,
      queuedActions: 0,
      escalated: false,
    };
  }

  // Disconnected
  if (!disconnectedSince) {
    disconnectedSince = now;
    console.warn('[GatewayHealth] Gateway disconnected');
  }

  const disconnectedForMs = now.getTime() - disconnectedSince.getTime();

  // Escalate if disconnected > 5 minutes
  if (disconnectedForMs > FIVE_MINUTES_MS && !escalated) {
    try {
      await db.escalation.create({
        data: {
          fromAgentId: 'orchestrator',
          severity: 'blocker',
          category: 'production',
          title: 'Gateway disconnected > 5 minutes',
          description: `OpenClaw gateway at ${gatewayUrl} has been unreachable for ${Math.round(disconnectedForMs / 60000)} minutes. ${actionQueue.length} actions are queued. Fleet operations are degraded.`,
        },
      });
      escalated = true;
    } catch (err) {
      console.warn('[GatewayHealth] Failed to create escalation:', err);
    }
  }

  return {
    connected: false,
    lastCheckedAt: now,
    disconnectedSince,
    disconnectedForMs,
    queuedActions: actionQueue.length,
    escalated,
  };
}

/**
 * Queue an action for replay when the gateway reconnects.
 */
export function queueAction(payload: Record<string, unknown>): string {
  const id = crypto.randomUUID();
  actionQueue.push({ id, payload, queuedAt: new Date() });
  return id;
}

/**
 * Get current queue size.
 */
export function getQueueSize(): number {
  return actionQueue.length;
}

/**
 * Replay all queued actions in order.
 */
async function replayQueue(gatewayUrl: string, db: PrismaClient): Promise<void> {
  const hooksToken = process.env.OPENCLAW_HOOKS_TOKEN;
  const toReplay = [...actionQueue];
  actionQueue = [];

  let replayed = 0;
  let failed = 0;

  for (const action of toReplay) {
    try {
      const response = await fetch(`${gatewayUrl}/hooks/agent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hooksToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(action.payload),
      });

      if (response.ok) {
        replayed++;
      } else {
        failed++;
        console.warn(`[GatewayHealth] Replay failed for action ${action.id}: ${response.status}`);
      }
    } catch (err) {
      failed++;
      console.warn(`[GatewayHealth] Replay error for action ${action.id}:`, err);
    }
  }

  // Log the replay result
  try {
    await db.recoveryLog.create({
      data: {
        agentId: 'orchestrator',
        trigger: 'gateway_disconnect',
        action: 'queue_replay',
        outcome: failed === 0 ? 'success' : 'failed',
        details: { totalQueued: toReplay.length, replayed, failed },
      },
    });
  } catch {
    // Best-effort logging
  }
}

/**
 * Reset gateway state (for testing).
 */
export function resetGatewayState(): void {
  actionQueue = [];
  disconnectedSince = null;
  escalated = false;
}
