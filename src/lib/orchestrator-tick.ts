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


import { buildHeartbeatContext } from '@/lib/build-heartbeat-context';
import { checkAgentBudget } from '@/lib/budget-breaker';
import { calculateDriftScore } from '@/lib/drift-score';
import {
  recoverMissedHeartbeats,
  recoverFailedSessions,
  recoverExpiredTokens,
  recoverFailedDeploys,
  recoverStalledCI,
} from '@/lib/drift-recovery';
import { checkGatewayHealth, queueAction } from '@/lib/gateway-health';
import { detectMissedTicks } from '@/lib/missed-tick';
import { resolveProviderConfigs, scheduleTypeToTier } from '@/lib/model-tiers';
import type { ModelTierMap } from '@/lib/model-tiers';
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

  // 1b. Missed tick detection — check if we're behind and need catch-up
  try {
    const missedTick = await detectMissedTicks();
    if (missedTick.missedCount > 0) {
      console.warn(`[Orchestrator] Missed ${missedTick.missedCount} tick(s), catch-up: ${missedTick.catchUpNeeded}`);
    }
  } catch (err) {
    console.warn('[Orchestrator] Missed tick detection failed:', err);
  }

  // 1c. Gateway health check
  let gatewayConnected = true;
  try {
    const gwStatus = await checkGatewayHealth();
    gatewayConnected = gwStatus.connected;
    if (!gwStatus.connected) {
      console.warn(`[Orchestrator] Gateway disconnected for ${Math.round(gwStatus.disconnectedForMs / 1000)}s, ${gwStatus.queuedActions} actions queued`);
    }
  } catch (err) {
    console.warn('[Orchestrator] Gateway health check failed:', err);
  }

  // 2. Query due HEARTBEAT schedules (enabled + nextRunAt in the past + agent not paused)
  const dueSchedules = await prisma.schedule.findMany({
    where: {
      type: 'heartbeat',
      enabled: true,
      nextRunAt: { lte: now },
      agent: { status: { not: 'paused' } },
    },
    orderBy: { priority: 'desc' },
    include: {
      agent: {
        select: {
          id: true,
          role: true,
          workspacePath: true,
          runtimeMode: true,
          providerPrimary: true,
          modelPrimary: true,
          providerFallback: true,
          modelFallback: true,
        },
      },
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

    // 4a. Drift check — auto-pause agents with score > 80
    try {
      const drift = await calculateDriftScore(schedule.agent.id);
      if (drift.score > 80) {
        await prisma.agent.update({
          where: { id: schedule.agent.id },
          data: { status: 'paused' },
        });
        await prisma.escalation.create({
          data: {
            fromAgentId: schedule.agent.id,
            severity: 'critical',
            category: 'fleet',
            title: `Auto-paused ${schedule.agent.id}: ${drift.signals.join(', ')}`,
            description: `Drift score ${drift.score}/100. Agent paused to prevent further damage.`,
          },
        });
        await prisma.recoveryLog.create({
          data: {
            agentId: schedule.agent.id,
            trigger: 'drift_threshold',
            action: 'auto_pause',
            outcome: 'success',
            details: { score: drift.score, signals: drift.signals },
          },
        });
        console.log(`[Orchestrator] Auto-paused ${schedule.agent.id} — drift score ${drift.score}`);

        results.push({
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          agentId: schedule.agentId,
          status: 'error',
          error: `Auto-paused: drift score ${drift.score}`,
        });
        continue; // Skip wake for this agent
      }
    } catch (driftErr) {
      // Drift check failure is non-fatal — log and continue with wake
      console.warn(`[Orchestrator] Drift check failed for ${schedule.agent.id}:`, driftErr);
    }

    // 4b. Budget check — auto-pause agents over their daily token limit
    try {
      const budget = await checkAgentBudget(schedule.agent.id);
      if (budget.status === 'breaker_tripped') {
        console.log(`[Orchestrator] Budget breaker tripped for ${schedule.agent.id} — ${budget.dailyTokens} tokens`);
        results.push({
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          agentId: schedule.agentId,
          status: 'error',
          error: `Budget breaker: ${budget.dailyTokens} tokens exceeds limit of ${budget.limit}`,
        });
        continue;
      }
    } catch (budgetErr) {
      console.warn(`[Orchestrator] Budget check failed for ${schedule.agent.id}:`, budgetErr);
    }

    // 4c. Authority check — log agents without roles (backward compat, no blocking)
    try {
      const agentRoleCount = await prisma.agentRole.count({
        where: { agentId: schedule.agent.id },
      });
      if (agentRoleCount === 0) {
        console.log(`[Orchestrator] Agent ${schedule.agent.id} has no roles assigned (backward compat — proceeding)`);
      }
    } catch (authErr) {
      console.warn(`[Orchestrator] Authority check failed for ${schedule.agent.id}:`, authErr);
    }

    let wakeStatus: 'ok' | 'error' | 'dry-run' = 'dry-run';
    let wakeError: string | undefined;

    // 5. Build context for the agent
    const contextMessage = await buildHeartbeatContext(schedule.agent.id, schedule.name);

    // 5a. NATIVE MODE: Run agent loop directly in MC
    if (schedule.agent.runtimeMode === 'native') {
      // Resolve provider via tier system: agent override > config tiers > defaults
      const tier = scheduleTypeToTier(schedule.type);
      const customTiers = config.modelTiers as Partial<ModelTierMap> | null;
      const { primary: tierPrimary, fallback: tierFallback } = resolveProviderConfigs(
        tier,
        customTiers,
        {
          providerPrimary: schedule.agent.providerPrimary,
          modelPrimary: schedule.agent.modelPrimary,
          providerFallback: schedule.agent.providerFallback,
          modelFallback: schedule.agent.modelFallback,
        },
      );

      {
        try {
          // Dynamic import from specific file to avoid webpack bundling the entire agent-runtime barrel
          const { runAgentLoop } = await import('@/lib/agent-runtime/agent-loop');
          const sessionId = crypto.randomUUID();
          const agentConfig = {
            agentId: schedule.agent.id,
            workspacePath: schedule.agent.workspacePath,
            providerPrimary: tierPrimary.provider,
            modelPrimary: tierPrimary.model,
            providerFallback: tierFallback?.provider || undefined,
            modelFallback: tierFallback?.model || undefined,
          };

          console.log(`[Orchestrator] Running native agent: ${schedule.agent.id}`);
          const result = await runAgentLoop(agentConfig, contextMessage, sessionId);

          // Track session in DB
          await prisma.agentSession.create({
            data: {
              id: sessionId,
              agentId: schedule.agent.id,
              status: result.ok ? 'completed' : 'failed',
              tokensSent: result.tokensSent,
              tokensRecv: result.tokensRecv,
              toolCalls: result.toolCalls,
              iterations: result.iterations,
              provider: result.provider,
              model: result.model,
              triggerType: 'heartbeat',
              summary: result.response?.slice(0, 500) || null,
              error: result.error || null,
              completedAt: new Date(),
            },
          });

          wakeStatus = result.ok ? 'ok' : 'error';
          wakeError = result.error;
        } catch (e) {
          wakeStatus = 'error';
          wakeError = e instanceof Error ? e.message : String(e);
        }
      }
    }
    // 5b. GATEWAY MODE: Wake via OpenClaw hooks endpoint (existing behavior)
    else if (gatewayUrl && hooksToken) {
      // If gateway is disconnected, queue the action for replay
      if (!gatewayConnected) {
        const payload = {
          message: contextMessage,
          name: `MC Heartbeat: ${schedule.name}`,
          agentId: schedule.agent.id,
          wakeMode: 'now',
          deliver: schedule.channel !== 'none',
          channel: schedule.channel || 'discord',
          to: schedule.deliverTo || undefined,
        };
        queueAction(payload);
        wakeStatus = 'error';
        wakeError = 'Gateway disconnected — action queued for replay';
      } else {
        try {
          const response = await fetch(`${gatewayUrl}/hooks/agent`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${hooksToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: contextMessage,
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
        body: `Context-enriched heartbeat for ${schedule.agent.id}`,
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

  // 8. Run recovery playbooks (non-fatal — errors are logged, not thrown)
  try {
    await recoverMissedHeartbeats();
  } catch (err) {
    console.warn('[Orchestrator] Missed heartbeat recovery failed:', err);
  }
  try {
    await recoverFailedSessions();
  } catch (err) {
    console.warn('[Orchestrator] Failed session recovery failed:', err);
  }
  try {
    await recoverExpiredTokens();
  } catch (err) {
    console.warn('[Orchestrator] Expired token recovery failed:', err);
  }
  try {
    await recoverFailedDeploys();
  } catch (err) {
    console.warn('[Orchestrator] Failed deploy recovery failed:', err);
  }
  try {
    await recoverStalledCI();
  } catch (err) {
    console.warn('[Orchestrator] Stalled CI recovery failed:', err);
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
