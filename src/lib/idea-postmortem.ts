/**
 * @module idea-postmortem
 * @description
 * Generate post-mortem reports for killed ideas (US-302, Task 3.9).
 *
 * When an idea is killed, we generate a structured post-mortem that captures:
 *   - Why the idea existed (original pain point)
 *   - What validation was attempted
 *   - Why it failed (data-driven reasons)
 *   - Lessons learned (patterns to avoid or retry)
 *
 * Post-mortems are stored in the idea's refineryData and logged
 * to MessageLog for the team audit trail.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { SYSTEM_NOTIFY_USER } from './schemas';

export interface PostMortem {
  ideaId: string;
  title: string;
  origin: string;
  timeline: TimelineEntry[];
  validationSummary: ValidationSummary | null;
  deathReason: string;
  lessons: string[];
  generatedAt: string;
}

interface TimelineEntry {
  date: string;
  event: string;
}

interface ValidationSummary {
  target: number;
  actual: number;
  percentOfTarget: number;
  duration: string | null;
  verdict: string | null;
}

/**
 * Generate a post-mortem for a killed idea.
 */
export async function generatePostMortem(
  ideaId: string,
  db: PrismaClient = defaultPrisma,
): Promise<PostMortem | null> {
  const idea = await db.idea.findUnique({
    where: { id: ideaId },
    include: { scorecards: true },
  });

  if (!idea || idea.status !== 'killed') {
    return null;
  }

  // Build timeline from available data
  const timeline: TimelineEntry[] = [];
  timeline.push({ date: idea.createdAt.toISOString(), event: `Created as "${idea.source || 'Manual'}" idea` });

  if (idea.validationStartedAt) {
    timeline.push({ date: idea.validationStartedAt.toISOString(), event: 'Validation sprint started' });
  }
  if (idea.validationDeadline) {
    timeline.push({ date: idea.validationDeadline.toISOString(), event: 'Validation deadline' });
  }
  timeline.push({ date: idea.updatedAt.toISOString(), event: 'Killed' });

  // Validation summary
  let validationSummary: ValidationSummary | null = null;
  const signupCount = await db.waitlistSignup.count({ where: { ideaId: idea.id } });
  const target = idea.validationTarget || 10;
  const refineryData = idea.refineryData as Record<string, unknown> | null;

  if (idea.validationStartedAt) {
    const durationMs = idea.validationDeadline
      ? idea.validationDeadline.getTime() - idea.validationStartedAt.getTime()
      : null;

    validationSummary = {
      target,
      actual: signupCount,
      percentOfTarget: Math.round((signupCount / target) * 100),
      duration: durationMs ? formatDuration(durationMs) : null,
      verdict: refineryData?.pendingVerdict as string || null,
    };
  }

  // Determine death reason from available data
  const deathReason = deriveDeathReason(idea, signupCount, target, refineryData);

  // Derive lessons
  const lessons = deriveLessons(idea, signupCount, target, refineryData);

  const postmortem: PostMortem = {
    ideaId: idea.id,
    title: idea.title,
    origin: idea.source || 'Unknown',
    timeline,
    validationSummary,
    deathReason,
    lessons,
    generatedAt: new Date().toISOString(),
  };

  // Store in idea refineryData
  await db.idea.update({
    where: { id: idea.id },
    data: {
      refineryData: {
        ...(refineryData || {}),
        postmortem: postmortem as unknown as Record<string, unknown>,
      } as Parameters<typeof db.idea.update>[0]['data']['refineryData'],
    },
  });

  // Log to audit trail
  await db.messageLog.create({
    data: {
      fromId: 'postmortem-engine',
      toId: SYSTEM_NOTIFY_USER,
      channel: 'refinery_verdict',
      subject: `Post-mortem: ${idea.title}`,
      body: formatPostMortemSummary(postmortem),
      status: 'sent',
      metadata: { ideaId: idea.id, postmortem: JSON.parse(JSON.stringify(postmortem)) },
    },
  });

  return postmortem;
}

/**
 * Generate post-mortems for all killed ideas that don't have one yet.
 */
export async function generateMissingPostMortems(
  db: PrismaClient = defaultPrisma,
): Promise<PostMortem[]> {
  const killedIdeas = await db.idea.findMany({
    where: { status: 'killed' },
    select: { id: true, refineryData: true },
  });

  const results: PostMortem[] = [];

  for (const idea of killedIdeas) {
    const data = idea.refineryData as Record<string, unknown> | null;
    if (data?.postmortem) continue; // Already has post-mortem

    const pm = await generatePostMortem(idea.id, db);
    if (pm) results.push(pm);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveDeathReason(
  idea: { score: number | null; description: string | null },
  signups: number,
  target: number,
  refineryData: Record<string, unknown> | null,
): string {
  const reasons: string[] = [];

  if (refineryData?.pendingVerdict === 'FAIL') {
    reasons.push(`Failed validation: ${signups}/${target} signups (${Math.round((signups / target) * 100)}% of target)`);
  } else if (refineryData?.pendingVerdict === 'NEAR_MISS') {
    reasons.push(`Near miss on validation: ${signups}/${target} signups — close but not enough signal`);
  }

  if (idea.score !== null && idea.score < 40) {
    reasons.push(`Low confidence score: ${idea.score}/100`);
  }

  if (signups === 0 && target > 0) {
    reasons.push('Zero signups — no market signal detected');
  }

  if (reasons.length === 0) {
    reasons.push('Manually killed — reason not recorded');
  }

  return reasons.join('. ');
}

function deriveLessons(
  idea: { title: string; source: string | null; score: number | null },
  signups: number,
  target: number,
  refineryData: Record<string, unknown> | null,
): string[] {
  const lessons: string[] = [];

  if (signups === 0) {
    lessons.push('Consider testing demand before building — zero signups suggests the pain point may not resonate');
  }

  if (signups > 0 && signups < target * 0.5) {
    lessons.push('Some interest exists but too weak — consider repositioning the value prop before retrying');
  }

  if (refineryData?.pendingVerdict === 'NEAR_MISS') {
    lessons.push('Close to validation threshold — this idea might succeed with better outreach or a longer sprint');
  }

  if (idea.score !== null && idea.score >= 70 && signups < target * 0.5) {
    lessons.push('High internal score but low external validation — internal enthusiasm may not reflect market demand');
  }

  if (lessons.length === 0) {
    lessons.push('Document the specific reason for killing to improve future idea evaluation');
  }

  return lessons;
}

function formatPostMortemSummary(pm: PostMortem): string {
  const lines: string[] = [];
  lines.push(`# Post-Mortem: ${pm.title}`);
  lines.push(`Origin: ${pm.origin}`);
  lines.push(`Death reason: ${pm.deathReason}`);

  if (pm.validationSummary) {
    const vs = pm.validationSummary;
    lines.push(`Validation: ${vs.actual}/${vs.target} signups (${vs.percentOfTarget}% of target)`);
    if (vs.duration) lines.push(`Sprint duration: ${vs.duration}`);
    if (vs.verdict) lines.push(`Verdict: ${vs.verdict}`);
  }

  if (pm.lessons.length > 0) {
    lines.push('Lessons:');
    pm.lessons.forEach((l) => lines.push(`  - ${l}`));
  }

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
