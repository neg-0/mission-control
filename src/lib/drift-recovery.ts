/**
 * @module drift-recovery
 * @description
 * Auto-recovery playbooks for drifting agents.
 *
 * Two playbooks, each following the carplay-alerts.ts pattern:
 *   query → decide → act → log
 *
 * 1. Missed Heartbeat Recovery — reset schedule for agents that went silent
 * 2. Consecutive Failure Quarantine — cooldown + retry for agents that keep failing
 *    (inspired by Atlas flake/quarantine.ts: 3 fails → quarantine)
 *
 * Both playbooks are non-fatal — errors are caught and logged, never blocking
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
