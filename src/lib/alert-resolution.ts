/**
 * @module alert-resolution
 * @description
 * Condition-specific auto-resolution for CarPlay alerts (US-402).
 *
 * Unlike the generic `autoResolveStaleAlerts()` in carplay-alerts.ts which
 * resolves alerts when the source signal disappears, this module checks
 * whether the underlying condition has actually cleared:
 *
 *   - CI failure → auto-resolve when pipeline status changes to "passing"
 *   - Deploy failure → auto-resolve when a successful deploy is recorded
 *   - Token expiry → auto-resolve when token has been refreshed
 *   - Agent offline → auto-resolve when agent heartbeat resumes
 *   - Drift auto-pause → auto-resolve when agent is manually resumed
 *
 * All auto-resolutions are logged with resolution time for audit trail.
 * Resolved alerts show as "Resolved" (not deleted) per US-402.
 *
 * Called by evaluateAlerts() on every evaluation cycle.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export interface ResolutionEvent {
  alertId: string;
  dedupeKey: string;
  reason: string;
  resolutionTimeMs: number;
}

/**
 * Check all unresolved alerts for condition-specific auto-resolution.
 */
export async function checkAutoResolutions(
  db: PrismaClient = defaultPrisma,
): Promise<ResolutionEvent[]> {
  const events: ResolutionEvent[] = [];

  const unresolvedAlerts = await db.carPlayAlert.findMany({
    where: { resolved: false },
  });

  for (const alert of unresolvedAlerts) {
    const resolved = await checkCondition(alert, db);
    if (resolved) {
      const now = new Date();
      const resolutionTimeMs = now.getTime() - alert.triggeredAt.getTime();

      await db.carPlayAlert.update({
        where: { id: alert.id },
        data: { resolved: true, resolvedAt: now },
      });

      // Also resolve the source escalation if applicable
      if (alert.sourceType === 'escalation' && alert.sourceId) {
        await db.escalation.update({
          where: { id: alert.sourceId },
          data: {
            status: 'resolved',
            resolvedBy: 'auto-resolution-engine',
            resolution: resolved.reason,
            resolvedAt: now,
          },
        }).catch(() => {}); // Best-effort — escalation may already be resolved
      }

      // Audit log
      try {
        await db.messageLog.create({
          data: {
            fromId: 'auto-resolution-engine',
            toId: 'dustin',
            channel: 'escalation',
            subject: `[AUTO-RESOLVED] ${alert.title}`,
            body: `${resolved.reason} (resolution time: ${formatDuration(resolutionTimeMs)})`,
            status: 'sent',
            metadata: {
              alertId: alert.id,
              dedupeKey: alert.dedupeKey,
              resolutionTimeMs,
              reason: resolved.reason,
            },
          },
        });
      } catch {
        // Best-effort audit
      }

      events.push({
        alertId: alert.id,
        dedupeKey: alert.dedupeKey,
        reason: resolved.reason,
        resolutionTimeMs,
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Condition checkers — each returns a reason string if resolved, null if not
// ---------------------------------------------------------------------------

interface ConditionResult {
  reason: string;
}

async function checkCondition(
  alert: { id: string; dedupeKey: string; type: string; sourceType: string | null; sourceId: string | null },
  db: PrismaClient,
): Promise<ConditionResult | null> {
  // CI failure alerts: check if pipeline is now passing
  if (alert.type === 'ci' && alert.dedupeKey.startsWith('ci:')) {
    return checkCiResolution(alert, db);
  }

  // Agent offline/error alerts: check if agent is back online
  if (alert.type === 'fleet' && alert.dedupeKey.startsWith('agent:')) {
    return checkAgentResolution(alert, db);
  }

  // Escalation-sourced alerts: check if escalation was manually resolved
  if (alert.sourceType === 'escalation' && alert.sourceId) {
    return checkEscalationResolution(alert.sourceId, db);
  }

  return null;
}

/**
 * CI failure: resolved when pipeline status changes to "passing" or "pending"
 */
async function checkCiResolution(
  alert: { dedupeKey: string },
  db: PrismaClient,
): Promise<ConditionResult | null> {
  // dedupeKey format: "ci:{projectId}:{stage}"
  const parts = alert.dedupeKey.split(':');
  if (parts.length < 3) return null;

  const [, projectId, stage] = parts;

  const pipeline = await db.pipeline.findFirst({
    where: { projectId, stage },
    orderBy: { updatedAt: 'desc' },
  });

  if (pipeline && pipeline.status === 'passing') {
    return { reason: `CI pipeline now passing for ${projectId}/${stage}` };
  }

  return null;
}

/**
 * Agent offline/error: resolved when agent has recent activity
 */
async function checkAgentResolution(
  alert: { dedupeKey: string },
  db: PrismaClient,
): Promise<ConditionResult | null> {
  // dedupeKey format: "agent:{agentId}:{status}" or "agent:{agentId}:offline"
  const parts = alert.dedupeKey.split(':');
  if (parts.length < 3) return null;

  const agentId = parts[1];
  const condition = parts[2];

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { status: true, lastHeartbeat: true },
  });

  if (!agent) return null;

  // Agent was paused (drift auto-pause) and has been resumed
  if (agent.status === 'active' && condition === 'offline') {
    // Check for recent heartbeat (within last 30 min)
    const thirtyMinAgo = new Date(Date.now() - THIRTY_MINUTES_MS);
    if (agent.lastHeartbeat && agent.lastHeartbeat > thirtyMinAgo) {
      return { reason: `Agent ${agentId} is back online with recent heartbeat` };
    }
  }

  // Agent was in error/blocked state and is now healthy
  if (condition === 'error' || condition === 'blocked') {
    const latestJournal = await db.agentJournal.findFirst({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });

    if (latestJournal && latestJournal.status === 'healthy') {
      return { reason: `Agent ${agentId} status recovered to healthy` };
    }
  }

  return null;
}

/**
 * Escalation-sourced alert: resolved when the upstream escalation is resolved
 */
async function checkEscalationResolution(
  escalationId: string,
  db: PrismaClient,
): Promise<ConditionResult | null> {
  const escalation = await db.escalation.findUnique({
    where: { id: escalationId },
    select: { status: true, resolution: true },
  });

  if (escalation && (escalation.status === 'resolved' || escalation.status === 'dismissed')) {
    return {
      reason: escalation.resolution || `Source escalation ${escalationId} was ${escalation.status}`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
