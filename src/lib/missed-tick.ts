/**
 * @module missed-tick
 * @description
 * Missed tick detection and catch-up logic (US-501).
 *
 * Detects when orchestrator ticks are overdue and:
 *   - Logs a warning for ticks > 2x overdue
 *   - Creates a P1 alert after 3+ consecutive missed ticks
 *   - Returns catch-up info so the orchestrator can process extra schedules
 *
 * Uses a lightweight approach: compares the last tick timestamp from
 * MessageLog against the expected tick interval from OrchestratorConfig.
 *
 * Non-fatal — errors are caught and logged, never blocking the tick.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

export interface MissedTickResult {
  missedCount: number;
  catchUpNeeded: boolean;
  lastTickAt: Date | null;
  expectedIntervalMs: number;
  gapMs: number;
  escalated: boolean;
}

/**
 * Detect missed ticks and determine if catch-up is needed.
 *
 * Called at the START of each tick, before processing schedules.
 */
export async function detectMissedTicks(
  db: PrismaClient = defaultPrisma,
): Promise<MissedTickResult> {
  // Get the orchestrator config for tick interval
  const config = await db.orchestratorConfig.findUnique({
    where: { id: 'singleton' },
  });

  const tickIntervalMs = config?.tickIntervalMs ?? 60000;

  // Find the most recent orchestrator tick log
  const lastTickLog = await db.messageLog.findFirst({
    where: {
      fromId: 'orchestrator',
      channel: 'schedule',
    },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });

  if (!lastTickLog) {
    // No ticks recorded yet — first tick, no misses
    return {
      missedCount: 0,
      catchUpNeeded: false,
      lastTickAt: null,
      expectedIntervalMs: tickIntervalMs,
      gapMs: 0,
      escalated: false,
    };
  }

  const gapMs = Date.now() - lastTickLog.sentAt.getTime();
  const missedCount = Math.floor(gapMs / tickIntervalMs) - 1; // -1 because one interval is expected

  if (missedCount <= 0) {
    return {
      missedCount: 0,
      catchUpNeeded: false,
      lastTickAt: lastTickLog.sentAt,
      expectedIntervalMs: tickIntervalMs,
      gapMs,
      escalated: false,
    };
  }

  // Log warning for any missed ticks
  console.warn(
    `[MissedTick] Detected ${missedCount} missed tick(s). Gap: ${Math.round(gapMs / 1000)}s, expected: ${tickIntervalMs / 1000}s`,
  );

  // Catch-up is needed if gap > 2x interval
  const catchUpNeeded = gapMs > tickIntervalMs * 2;

  let escalated = false;

  // Escalate if 3+ consecutive misses
  if (missedCount >= 3) {
    try {
      // Check for existing open escalation to avoid spam
      const existing = await db.escalation.findFirst({
        where: {
          fromAgentId: 'orchestrator',
          category: 'orchestrator',
          status: { in: ['open', 'ack'] },
          title: { contains: 'missed ticks' },
        },
      });

      if (!existing) {
        await db.escalation.create({
          data: {
            fromAgentId: 'orchestrator',
            severity: 'critical',
            category: 'orchestrator',
            title: `Orchestrator: ${missedCount} consecutive missed ticks`,
            description: `The orchestrator missed ${missedCount} ticks (gap: ${Math.round(gapMs / 60000)}min, expected interval: ${tickIntervalMs / 1000}s). Agent schedules may be delayed. Catch-up has been initiated.`,
          },
        });
        escalated = true;
      }
    } catch (err) {
      console.warn('[MissedTick] Failed to create escalation:', err);
    }
  }

  // Log a recovery entry for the missed ticks
  try {
    await db.recoveryLog.create({
      data: {
        agentId: 'orchestrator',
        trigger: 'missed_ticks',
        action: catchUpNeeded ? 'catch_up' : 'warning_logged',
        outcome: 'success',
        details: { missedCount, gapMs, tickIntervalMs, catchUpNeeded },
      },
    });
  } catch {
    // Best-effort logging
  }

  return {
    missedCount,
    catchUpNeeded,
    lastTickAt: lastTickLog.sentAt,
    expectedIntervalMs: tickIntervalMs,
    gapMs,
    escalated,
  };
}
