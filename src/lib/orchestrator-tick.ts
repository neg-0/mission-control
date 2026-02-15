/**
 * @module orchestrator-tick
 * @description
 * Core tick execution logic extracted from the API route so it can be called
 * by both the POST endpoint and the internal setInterval timer.
 *
 * The tick:
 * 1. Loads OrchestratorConfig
 * 2. Queries due schedules (enabled + nextRunAt <= now)
 * 3. Enforces maxWakesPerTick — only processes top-N by priority
 * 4. Wakes agents via OpenClaw /hooks/agent with stagger delay between each
 * 5. Logs wakes to MessageLog for audit trail
 * 6. Recalculates nextRunAt for each processed schedule
 */

import { getNextCronRun } from '@/lib/orchestrator';
import { prisma } from '@/lib/prisma';

export interface TickResult {
  scheduleId: string;
  scheduleName: string;
  agentId: string;
  status: 'ok' | 'error' | 'dry-run';
  error?: string;
}

export interface TickSummary {
  status: 'disabled' | 'idle' | 'completed';
  timestamp: string;
  processed: number;
  errored: number;
  queued: number;
  skipped: number;
  results: TickResult[];
  message?: string;
}

/**
 * Execute one tick of the scheduling loop.
 *
 * This is the heart of the orchestrator — called every 60s by the internal timer
 * or on-demand via POST /api/orchestrator/tick.
 */
export async function executeTick(): Promise<TickSummary> {
  // 1. Load orchestrator config
  const config = await prisma.orchestratorConfig.findUnique({
    where: { id: 'singleton' },
  });

  if (!config || !config.enabled) {
    return {
      status: 'disabled',
      message: 'Orchestrator is disabled',
      timestamp: new Date().toISOString(),
      processed: 0,
      errored: 0,
      queued: 0,
      skipped: 0,
      results: [],
    };
  }

  const now = new Date();

  // 2. Query due HEARTBEAT schedules (enabled + nextRunAt in the past)
  const dueSchedules = await prisma.schedule.findMany({
    where: {
      type: 'heartbeat',
      enabled: true,
      nextRunAt: { lte: now },
    },
    orderBy: { priority: 'desc' },
    include: {
      agent: { select: { id: true, role: true, workspacePath: true } },
    },
  });

  if (dueSchedules.length === 0) {
    return {
      status: 'idle',
      message: 'No schedules due',
      timestamp: now.toISOString(),
      processed: 0,
      errored: 0,
      queued: 0,
      skipped: 0,
      results: [],
    };
  }

  // 3. Enforce maxWakesPerTick — excess schedules wait for next tick
  const toProcess = dueSchedules.slice(0, config.maxWakesPerTick);
  const queued = dueSchedules.length - toProcess.length;

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const hooksToken = process.env.OPENCLAW_HOOKS_TOKEN;

  const results: TickResult[] = [];

  // 4. Use staggerDelayMs from config (falls back to calculated value)
  const staggerMs = toProcess.length > 1
    ? Math.max(config.staggerDelayMs || 30000, Math.floor(config.minIntervalMs / toProcess.length))
    : 0;

  for (let i = 0; i < toProcess.length; i++) {
    const schedule = toProcess[i];

    // Stagger: wait between wakes (skip for first)
    if (i > 0 && staggerMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, staggerMs));
    }

    let wakeStatus: 'ok' | 'error' | 'dry-run' = 'dry-run';
    let wakeError: string | undefined;

    // 5. Wake the agent via OpenClaw hooks endpoint
    if (gatewayUrl && hooksToken) {
      try {
        const response = await fetch(`${gatewayUrl}/hooks/agent`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${hooksToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: schedule.payload || `⏰ Scheduled: ${schedule.name}`,
            name: `MC Heartbeat: ${schedule.name}`,
            agentId: schedule.agent.id,
            wakeMode: 'now',
            deliver: schedule.channel !== 'none',
            channel: schedule.channel || 'discord',
            to: schedule.deliverTo || undefined,
          }),
        });

        if (response.ok) {
          wakeStatus = 'ok';
        } else {
          wakeStatus = 'error';
          wakeError = `Gateway returned ${response.status}: ${await response.text()}`;
        }
      } catch (e) {
        wakeStatus = 'error';
        wakeError = e instanceof Error ? e.message : String(e);
      }
    } else {
      console.log(`[Orchestrator] Dry-run wake: ${schedule.agentId} — ${schedule.name}`);
    }

    // 6. Log to MessageLog for audit trail
    await prisma.messageLog.create({
      data: {
        fromId: 'orchestrator',
        toId: schedule.agentId,
        channel: 'schedule',
        subject: schedule.name,
        body: schedule.payload || `Scheduled: ${schedule.name}`,
        status: wakeStatus === 'ok' ? 'delivered' : wakeStatus === 'error' ? 'failed' : 'sent',
        metadata: {
          scheduleId: schedule.id,
          cronExpr: schedule.cronExpr,
          intervalMs: schedule.intervalMs,
          priority: schedule.priority,
          error: wakeError,
        },
      },
    });

    // 7. Update schedule timing for next run
    let nextRunAt: Date | null = null;

    if (schedule.intervalMs) {
      nextRunAt = new Date(now.getTime() + schedule.intervalMs);
    } else if (schedule.cronExpr) {
      nextRunAt = getNextCronRun(schedule.cronExpr, now);
    }

    await prisma.schedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        nextRunAt,
      },
    });

    results.push({
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      agentId: schedule.agentId,
      status: wakeStatus,
      error: wakeError,
    });
  }

  const processed = results.filter((r) => r.status === 'ok' || r.status === 'dry-run').length;
  const errored = results.filter((r) => r.status === 'error').length;

  return {
    status: 'completed',
    timestamp: now.toISOString(),
    processed,
    errored,
    queued,
    skipped: 0,
    results,
  };
}
