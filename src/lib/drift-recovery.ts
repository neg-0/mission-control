/**
 * @module drift-recovery
 * @description
 * Auto-recovery playbooks for drifting agents.
 *
 * Five playbooks, each following the carplay-alerts.ts pattern:
 *   query → decide → act → log
 *
 * 1. Missed Heartbeat Recovery — reset schedule for agents that went silent
 * 2. Consecutive Failure Quarantine — cooldown + retry for agents that keep failing
 * 3. Expired Token Recovery — refresh Railway OAuth tokens automatically
 * 4. Failed Deploy Retry — retry failing pipelines (max 2 per 24h)
 * 5. Stalled CI Recovery — cancel + re-trigger stalled CI workflows
 *
 * All playbooks are non-fatal — errors are caught and logged, never blocking
 * the orchestrator tick.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

export interface RecoveryResult {
  agentId: string;
  trigger: string;
  action: string;
  outcome: 'success' | 'failed' | 'skipped';
  details?: Record<string, unknown>;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000; // 1 minute before retry

// ---------------------------------------------------------------------------
// Playbook 1: Missed Heartbeat Recovery
// ---------------------------------------------------------------------------

/**
 * Find active agents whose last journal entry is overdue relative to their
 * heartbeat schedule, and reset their schedule to fire on the next tick.
 *
 * This catches agents that silently stopped responding — their session
 * may have completed but no journal was written, or the schedule drifted.
 */
export async function recoverMissedHeartbeats(
  db: PrismaClient = defaultPrisma,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];

  // Find all active agents with enabled heartbeat schedules
  const schedules = await db.schedule.findMany({
    where: {
      type: 'heartbeat',
      enabled: true,
      agent: { status: 'active' },
    },
    include: {
      agent: { select: { id: true } },
    },
  });

  for (const schedule of schedules) {
    const agentId = schedule.agent.id;

    // Get last journal entry
    const latestJournal = await db.agentJournal.findFirst({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    // No journal ever → skip (new agent, not a missed heartbeat)
    if (!latestJournal) continue;

    // Determine if the agent is overdue
    const intervalMs = schedule.intervalMs || 3600000; // default 1h
    const staleThreshold = intervalMs * 3;
    const timeSinceJournal = Date.now() - latestJournal.createdAt.getTime();

    if (timeSinceJournal <= staleThreshold) continue;

    // Recovery: reset nextRunAt to now so the agent wakes on next tick
    try {
      await db.schedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: new Date() },
      });

      await db.recoveryLog.create({
        data: {
          agentId,
          trigger: 'missed_heartbeat',
          action: 'schedule_reset',
          outcome: 'success',
          details: {
            timeSinceJournalMs: timeSinceJournal,
            scheduleId: schedule.id,
            intervalMs,
          },
        },
      });

      results.push({
        agentId,
        trigger: 'missed_heartbeat',
        action: 'schedule_reset',
        outcome: 'success',
      });
    } catch (err) {
      results.push({
        agentId,
        trigger: 'missed_heartbeat',
        action: 'schedule_reset',
        outcome: 'failed',
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Playbook 2: Consecutive Failure Quarantine
// ---------------------------------------------------------------------------

/**
 * Find agents with 3+ consecutive failed sessions and attempt recovery:
 * - If already recovered within the last hour → skip (cooldown guard), escalate to critical
 * - Otherwise → reset schedule with 60s cooldown, create warning escalation
 *
 * Inspired by Atlas flake/quarantine.ts pattern.
 */
export async function recoverFailedSessions(
  db: PrismaClient = defaultPrisma,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];

  // Find active agents
  const agents = await db.agent.findMany({
    where: { status: 'active' },
    select: { id: true },
  });

  for (const agent of agents) {
    // Get the 3 most recent sessions
    const recentSessions = await db.agentSession.findMany({
      where: { agentId: agent.id },
      orderBy: { startedAt: 'desc' },
      take: 3,
      select: { status: true },
    });

    // Need at least 3 sessions, all failed/timeout
    if (recentSessions.length < 3) continue;
    const allFailed = recentSessions.every(
      (s) => s.status === 'failed' || s.status === 'timeout',
    );
    if (!allFailed) continue;

    // Cooldown guard: check if we already recovered this agent recently
    const recentRecovery = await db.recoveryLog.findFirst({
      where: {
        agentId: agent.id,
        trigger: 'consecutive_failures',
        createdAt: { gte: new Date(Date.now() - ONE_HOUR_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentRecovery) {
      // Already tried within the last hour — escalate to critical instead of retrying
      try {
        await db.escalation.create({
          data: {
            fromAgentId: agent.id,
            severity: 'critical',
            category: 'fleet',
            title: `Agent ${agent.id}: repeated failures despite recovery attempt`,
            description: 'Auto-recovery was attempted within the last hour but failures persist. Manual intervention may be needed.',
          },
        });

        await db.recoveryLog.create({
          data: {
            agentId: agent.id,
            trigger: 'consecutive_failures',
            action: 'cooldown_retry',
            outcome: 'skipped',
            details: { reason: 'cooldown_active', lastRecoveryId: recentRecovery.id },
          },
        });
      } catch (err) {
        // Best-effort escalation, but log the failure
        console.warn(`[DriftRecovery] Failed to create critical escalation for agent ${agent.id}:`, err);
      }

      results.push({
        agentId: agent.id,
        trigger: 'consecutive_failures',
        action: 'cooldown_retry',
        outcome: 'skipped',
        details: { reason: 'cooldown_active' },
      });
      continue;
    }

    // Recovery: reset schedule with a 1-minute cooldown before retry
    try {
      const heartbeatSchedule = await db.schedule.findFirst({
        where: {
          agentId: agent.id,
          type: 'heartbeat',
          enabled: true,
        },
      });

      if (heartbeatSchedule) {
        await db.schedule.update({
          where: { id: heartbeatSchedule.id },
          data: { nextRunAt: new Date(Date.now() + COOLDOWN_MS) },
        });
      }

      // Create warning escalation so it surfaces in War Room + CarPlay
      await db.escalation.create({
        data: {
          fromAgentId: agent.id,
          severity: 'warning',
          category: 'fleet',
          title: `Agent ${agent.id}: 3 consecutive session failures — attempting recovery`,
          description: 'Schedule reset with 60s cooldown. Will retry on next tick.',
        },
      });

      await db.recoveryLog.create({
        data: {
          agentId: agent.id,
          trigger: 'consecutive_failures',
          action: 'cooldown_retry',
          outcome: 'success',
          details: { scheduleId: heartbeatSchedule?.id ?? null },
        },
      });

      results.push({
        agentId: agent.id,
        trigger: 'consecutive_failures',
        action: 'cooldown_retry',
        outcome: 'success',
      });
    } catch (err) {
      results.push({
        agentId: agent.id,
        trigger: 'consecutive_failures',
        action: 'cooldown_retry',
        outcome: 'failed',
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Playbook 3: Expired Token Recovery (Task 1.5)
// ---------------------------------------------------------------------------

/**
 * Detect expired/missing Railway tokens and trigger a refresh.
 *
 * Detection: RAILWAY_LAST_REFRESH_AT is either missing or older than 2 hours
 * (tokens expire after 1h; 2h gives buffer for the hourly cron).
 *
 * 30-minute cooldown guard prevents rapid-fire refreshes.
 */
export async function recoverExpiredTokens(
  db: PrismaClient = defaultPrisma,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];

  const lastRefresh = process.env.RAILWAY_LAST_REFRESH_AT;
  const tokenPresent = !!process.env.RAILWAY_API_TOKEN;

  if (tokenPresent && lastRefresh) {
    const refreshAge = Date.now() - new Date(lastRefresh).getTime();
    if (refreshAge < 2 * ONE_HOUR_MS) {
      return results; // Token is fresh enough
    }
  }

  // If no Railway projects exist, skip (no Railway integration)
  const railwayProjectCount = await db.project.count({
    where: { railwayProjectId: { not: null } },
  });
  if (railwayProjectCount === 0) return results;

  // Cooldown guard: already tried within 30 minutes?
  const recentRecovery = await db.recoveryLog.findFirst({
    where: {
      trigger: 'expired_token',
      createdAt: { gte: new Date(Date.now() - THIRTY_MIN_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (recentRecovery) {
    results.push({
      agentId: 'system',
      trigger: 'expired_token',
      action: 'token_refresh',
      outcome: 'skipped',
      details: { reason: 'cooldown_active', lastAttempt: recentRecovery.createdAt },
    });
    return results;
  }

  try {
    const { refreshRailwayToken } = await import('./token-utils');
    const refreshResult = await refreshRailwayToken();

    await db.recoveryLog.create({
      data: {
        agentId: 'system',
        trigger: 'expired_token',
        action: 'token_refresh',
        outcome: refreshResult.ok ? 'success' : 'failed',
        details: refreshResult.ok
          ? { distribution: refreshResult.distribution }
          : { error: refreshResult.error },
      },
    });

    results.push({
      agentId: 'system',
      trigger: 'expired_token',
      action: 'token_refresh',
      outcome: refreshResult.ok ? 'success' : 'failed',
      details: refreshResult.ok
        ? { distribution: refreshResult.distribution }
        : { error: refreshResult.error },
    });

    if (!refreshResult.ok) {
      await db.escalation.create({
        data: {
          fromAgentId: 'system',
          severity: 'critical',
          category: 'infra',
          title: 'Railway token refresh failed during recovery',
          description: `Auto-recovery attempted token refresh but failed: ${refreshResult.error}`,
        },
      });
    }
  } catch (err) {
    results.push({
      agentId: 'system',
      trigger: 'expired_token',
      action: 'token_refresh',
      outcome: 'failed',
      details: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Playbook 4: Failed Deploy Retry (Task 1.6)
// ---------------------------------------------------------------------------

/**
 * Find pipelines with status='failing' and retry by resetting the owner
 * agent's heartbeat schedule to fire on the next tick.
 *
 * Guards:
 * - Max 2 retries per pipeline per 24h
 * - 10-minute cooldown between retries for the same pipeline
 * - Escalates to critical if max retries exceeded
 */
export async function recoverFailedDeploys(
  db: PrismaClient = defaultPrisma,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];

  const failingPipelines = await db.pipeline.findMany({
    where: { status: 'failing' },
    include: {
      project: { select: { id: true, name: true, ownerAgentId: true } },
    },
  });

  for (const pipeline of failingPipelines) {
    const agentId = pipeline.project?.ownerAgentId;
    if (!agentId) continue;

    const recentRetries = await db.recoveryLog.count({
      where: {
        trigger: 'failed_deploy',
        agentId,
        createdAt: { gte: new Date(Date.now() - TWENTY_FOUR_HOURS_MS) },
        details: { path: ['pipelineId'], equals: pipeline.id },
      },
    });

    if (recentRetries >= 2) {
      await db.escalation.create({
        data: {
          fromAgentId: agentId,
          severity: 'critical',
          category: 'pipeline',
          title: `Pipeline ${pipeline.project?.name ?? pipeline.id}: deploy failing after ${recentRetries} recovery attempts`,
          description: 'Max recovery retries (2/24h) exceeded. Manual intervention required.',
        },
      });

      results.push({
        agentId,
        trigger: 'failed_deploy',
        action: 'retry_deploy',
        outcome: 'skipped',
        details: { reason: 'max_retries_exceeded', retries: recentRetries, pipelineId: pipeline.id },
      });
      continue;
    }

    // 10-minute cooldown
    const lastRetry = await db.recoveryLog.findFirst({
      where: {
        trigger: 'failed_deploy',
        agentId,
        createdAt: { gte: new Date(Date.now() - TEN_MIN_MS) },
        details: { path: ['pipelineId'], equals: pipeline.id },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (lastRetry) {
      results.push({
        agentId,
        trigger: 'failed_deploy',
        action: 'retry_deploy',
        outcome: 'skipped',
        details: { reason: 'cooldown_active', pipelineId: pipeline.id },
      });
      continue;
    }

    try {
      const schedule = await db.schedule.findFirst({
        where: { agentId, type: 'heartbeat', enabled: true },
      });

      if (schedule) {
        await db.schedule.update({
          where: { id: schedule.id },
          data: { nextRunAt: new Date() },
        });
      }

      await db.recoveryLog.create({
        data: {
          agentId,
          trigger: 'failed_deploy',
          action: 'retry_deploy',
          outcome: 'success',
          details: {
            pipelineId: pipeline.id,
            projectName: pipeline.project?.name,
            retryNumber: recentRetries + 1,
          },
        },
      });

      results.push({
        agentId,
        trigger: 'failed_deploy',
        action: 'retry_deploy',
        outcome: 'success',
        details: { pipelineId: pipeline.id },
      });
    } catch (err) {
      results.push({
        agentId,
        trigger: 'failed_deploy',
        action: 'retry_deploy',
        outcome: 'failed',
        details: { error: err instanceof Error ? err.message : String(err), pipelineId: pipeline.id },
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Playbook 5: Stalled CI Recovery (Task 1.7)
// ---------------------------------------------------------------------------

/**
 * Find pipelines with status='pending' that have been running for > 30 minutes,
 * cancel the GitHub Actions workflow, and re-trigger.
 *
 * Guards:
 * - Max 1 retry per pipeline per 24h
 * - Requires GITHUB_TOKEN env var
 */
export async function recoverStalledCI(
  db: PrismaClient = defaultPrisma,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) return results;

  const stalledPipelines = await db.pipeline.findMany({
    where: {
      status: 'pending',
      startedAt: { lte: new Date(Date.now() - THIRTY_MIN_MS) },
    },
    include: {
      project: { select: { id: true, name: true, ownerAgentId: true, repoUrl: true } },
    },
  });

  for (const pipeline of stalledPipelines) {
    const agentId = pipeline.project?.ownerAgentId;
    if (!agentId) continue;

    const repoUrl = pipeline.project?.repoUrl;
    if (!repoUrl) continue;

    const recentRetries = await db.recoveryLog.count({
      where: {
        trigger: 'stalled_ci',
        agentId,
        createdAt: { gte: new Date(Date.now() - TWENTY_FOUR_HOURS_MS) },
        details: { path: ['pipelineId'], equals: pipeline.id },
      },
    });

    if (recentRetries >= 1) {
      await db.escalation.create({
        data: {
          fromAgentId: agentId,
          severity: 'critical',
          category: 'pipeline',
          title: `Pipeline ${pipeline.project?.name ?? pipeline.id}: CI stalled after recovery attempt`,
          description: 'Max CI recovery retries (1/24h) exceeded. Manual intervention required.',
        },
      });

      results.push({
        agentId,
        trigger: 'stalled_ci',
        action: 'cancel_and_retrigger',
        outcome: 'skipped',
        details: { reason: 'max_retries_exceeded', pipelineId: pipeline.id },
      });
      continue;
    }

    const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!repoMatch) continue;
    const [, owner, repo] = repoMatch;

    try {
      const { cancelWorkflowRuns, retriggerWorkflow } = await import('./github-actions');
      await cancelWorkflowRuns(githubToken, owner, repo);
      await retriggerWorkflow(githubToken, owner, repo);

      await db.pipeline.update({
        where: { id: pipeline.id },
        data: { startedAt: new Date() },
      });

      await db.recoveryLog.create({
        data: {
          agentId,
          trigger: 'stalled_ci',
          action: 'cancel_and_retrigger',
          outcome: 'success',
          details: {
            pipelineId: pipeline.id,
            projectName: pipeline.project?.name,
            repo: `${owner}/${repo}`,
          },
        },
      });

      results.push({
        agentId,
        trigger: 'stalled_ci',
        action: 'cancel_and_retrigger',
        outcome: 'success',
        details: { pipelineId: pipeline.id, repo: `${owner}/${repo}` },
      });
    } catch (err) {
      results.push({
        agentId,
        trigger: 'stalled_ci',
        action: 'cancel_and_retrigger',
        outcome: 'failed',
        details: { error: err instanceof Error ? err.message : String(err), pipelineId: pipeline.id },
      });
    }
  }

  return results;
}
