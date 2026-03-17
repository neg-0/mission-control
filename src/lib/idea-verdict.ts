/**
 * @module idea-verdict
 * @description
 * Idea auto-verdict with override window (US-302, Task 3.8).
 *
 * When a validation sprint expires:
 *   1. Calculate verdict (PASS / NEAR_MISS / FAIL) based on signups vs target
 *   2. Apply an override window (default 4h) before auto-executing verdict
 *   3. During override window, human can override via PATCH /api/ideas/[id]
 *   4. After window expires, verdict auto-executes
 *
 * This replaces the inline verdict logic in cron-jobs/refinery-verdict
 * with a more robust system that gives humans a chance to intervene.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { SYSTEM_NOTIFY_USER } from './schemas';

const OVERRIDE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

export type VerdictDecision = 'PASS' | 'NEAR_MISS' | 'FAIL';

export interface VerdictResult {
  ideaId: string;
  title: string;
  signups: number;
  target: number;
  decision: VerdictDecision;
  autoExecuted: boolean;
  overrideWindowEndsAt?: Date;
}

/**
 * Calculate the verdict for an idea based on signup count vs target.
 */
export function calculateVerdict(signups: number, target: number): VerdictDecision {
  if (signups >= target) return 'PASS';
  if (signups >= target * 0.8) return 'NEAR_MISS';
  return 'FAIL';
}

/**
 * Process expired validation sprints with override window.
 *
 * Two phases:
 *   Phase 1: Mark ideas as "pending_verdict" with an override deadline
 *   Phase 2: Auto-execute verdicts that passed the override window
 */
export async function processVerdicts(
  db: PrismaClient = defaultPrisma,
): Promise<VerdictResult[]> {
  const results: VerdictResult[] = [];
  const now = new Date();

  // Phase 1: Find newly expired sprints (validating + past deadline)
  // that haven't been marked for verdict yet
  const expiredIdeas = await db.idea.findMany({
    where: {
      status: 'validating',
      validationDeadline: { lt: now },
    },
  });

  for (const idea of expiredIdeas) {
    const signups = await db.waitlistSignup.count({
      where: { ideaId: idea.id },
    });

    const target = idea.validationTarget || 10;
    const decision = calculateVerdict(signups, target);
    const overrideWindowEndsAt = new Date(now.getTime() + OVERRIDE_WINDOW_MS);

    // Store verdict decision in refineryData but don't execute yet
    await db.idea.update({
      where: { id: idea.id },
      data: {
        status: 'review_failed', // Moves out of validating — pending human review
        refineryData: {
          ...(idea.refineryData as object || {}),
          pendingVerdict: decision,
          verdictSignups: signups,
          verdictTarget: target,
          overrideWindowEndsAt: overrideWindowEndsAt.toISOString(),
          verdictCalculatedAt: now.toISOString(),
        },
      },
    });

    // Log verdict calculation
    await db.messageLog.create({
      data: {
        fromId: 'verdict-engine',
        toId: SYSTEM_NOTIFY_USER,
        channel: 'refinery_verdict',
        subject: `Verdict pending: ${idea.title}`,
        body: `Sprint expired. Signups: ${signups}/${target}. Calculated: ${decision}. Override window ends at ${overrideWindowEndsAt.toISOString()}.`,
        status: 'sent',
        metadata: {
          ideaId: idea.id,
          signups,
          target,
          decision,
          phase: 'pending',
        },
      },
    });

    results.push({
      ideaId: idea.id,
      title: idea.title,
      signups,
      target,
      decision,
      autoExecuted: false,
      overrideWindowEndsAt,
    });
  }

  // Phase 2: Auto-execute verdicts past override window
  const pendingIdeas = await db.idea.findMany({
    where: {
      status: 'review_failed',
      refineryData: { not: null as unknown as undefined },
    },
  });

  for (const idea of pendingIdeas) {
    const data = idea.refineryData as Record<string, unknown> | null;
    if (!data?.pendingVerdict || !data?.overrideWindowEndsAt) continue;

    const windowEnd = new Date(data.overrideWindowEndsAt as string);
    if (now < windowEnd) continue; // Still in override window

    const decision = data.pendingVerdict as VerdictDecision;
    const signups = (data.verdictSignups as number) || 0;
    const target = (data.verdictTarget as number) || 10;

    // Auto-execute the verdict
    let newStatus = idea.status;
    if (decision === 'PASS') {
      newStatus = 'validated';
    }
    // NEAR_MISS and FAIL stay as review_failed — but mark as auto-executed

    await db.idea.update({
      where: { id: idea.id },
      data: {
        status: newStatus,
        refineryData: {
          ...data,
          verdictAutoExecuted: true,
          verdictExecutedAt: now.toISOString(),
        },
      },
    });

    await db.messageLog.create({
      data: {
        fromId: 'verdict-engine',
        toId: SYSTEM_NOTIFY_USER,
        channel: 'refinery_verdict',
        subject: `Verdict auto-executed: ${idea.title}`,
        body: `Override window expired. Decision: ${decision}. Signups: ${signups}/${target}. Status: ${newStatus}.`,
        status: 'sent',
        metadata: {
          ideaId: idea.id,
          signups,
          target,
          decision,
          phase: 'auto-executed',
        },
      },
    });

    results.push({
      ideaId: idea.id,
      title: idea.title,
      signups,
      target,
      decision,
      autoExecuted: true,
    });
  }

  return results;
}
