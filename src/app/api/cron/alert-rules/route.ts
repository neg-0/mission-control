/**
 * @module api/cron/alert-rules
 * @description
 * Alert Rules Engine — evaluates fleet/PR/goal rules and auto-creates
 * escalations for persistent issues. Designed to run on a cron schedule
 * (e.g. every 30 minutes) or be triggered manually.
 *
 * Rules:
 * 1. CI failing >24h → blocker escalation
 * 2. PR needs review >48h → warning escalation
 * 3. Agent no check-in >48h → critical escalation
 *
 * De-duplication: Before creating an escalation, checks if an open
 * escalation with the same title already exists (prevents spam).
 *
 * POST /api/cron/alert-rules — Run the rules engine
 * GET  /api/cron/alert-rules — Check last run status
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HOURS = (n: number) => n * 60 * 60 * 1000;

interface RuleResult {
  rule: string;
  fired: boolean;
  escalationCreated: boolean;
  message: string;
}

async function createEscalationIfNew(params: {
  fromAgentId: string;
  severity: string;
  category: string;
  title: string;
  description: string;
}): Promise<boolean> {
  // Check for existing open escalation with same title
  const existing = await prisma.escalation.findFirst({
    where: {
      title: params.title,
      status: { in: ['open', 'acknowledged'] },
    },
  });

  if (existing) return false;

  // Create escalation
  const escalation = await prisma.escalation.create({
    data: {
      fromAgentId: params.fromAgentId,
      severity: params.severity,
      category: params.category,
      title: params.title,
      description: params.description,
    },
  });

  // Auto-log to MessageLog for audit trail
  await prisma.messageLog.create({
    data: {
      fromId: 'alert-rules-engine',
      toId: 'dustin',
      channel: 'escalation',
      subject: `[${params.severity.toUpperCase()}] ${params.title}`,
      body: params.description,
      status: 'sent',
      metadata: { escalationId: escalation.id, category: params.category, source: 'alert-rules-engine' },
    },
  });

  return true;
}

export async function POST(_request: NextRequest) {
  const results: RuleResult[] = [];

  try {
    // ─── Rule 1: CI failing >24h ────────────────────────────────────
    // Fetch PRs from GitHub API (reuse existing endpoint)
    try {
      const prsRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/github/prs?repo=neg-0/comp-iq`);
      if (prsRes.ok) {
        const prsData = await prsRes.json();
        const prs = prsData.prs || [];

        for (const pr of prs) {
          const updatedAt = pr.updatedAt ? new Date(pr.updatedAt).getTime() : null;
          const age = updatedAt ? Date.now() - updatedAt : null;

          if (pr.ci === 'failed' && age !== null && age > HOURS(24)) {
            const title = `CI failing >24h on PR #${pr.id}: ${pr.title}`;
            const created = await createEscalationIfNew({
              fromAgentId: 'alert-rules-engine',
              severity: 'blocker',
              category: 'ci-failure',
              title,
              description: `PR #${pr.id} "${pr.title}" has had failing CI for over 24 hours. This is blocking the pipeline.${pr.url ? ` URL: ${pr.url}` : ''}`,
            });
            results.push({ rule: 'ci-failing-24h', fired: true, escalationCreated: created, message: title });
          }

          if (pr.reviewState === 'pending' && age !== null && age > HOURS(48)) {
            const title = `PR #${pr.id} needs review for >48h: ${pr.title}`;
            const created = await createEscalationIfNew({
              fromAgentId: 'alert-rules-engine',
              severity: 'warning',
              category: 'pr-review-stale',
              title,
              description: `PR #${pr.id} "${pr.title}" has been waiting for review for over 48 hours.${pr.url ? ` URL: ${pr.url}` : ''}`,
            });
            results.push({ rule: 'pr-review-48h', fired: true, escalationCreated: created, message: title });
          }
        }
      }
    } catch (e) {
      results.push({ rule: 'pr-rules', fired: false, escalationCreated: false, message: `PR fetch error: ${e}` });
    }

    // ─── Rule 2: Agent no check-in >48h ─────────────────────────────
    try {
      const agents = await prisma.agent.findMany({
        where: { status: { not: 'disabled' } },
        select: { id: true, status: true, lastHeartbeat: true },
      });

      for (const agent of agents) {
        if (!agent.lastHeartbeat) continue;
        const age = Date.now() - new Date(agent.lastHeartbeat).getTime();

        if (age > HOURS(48)) {
          const title = `${agent.id} has not checked in for >48h`;
          const created = await createEscalationIfNew({
            fromAgentId: agent.id,
            severity: 'critical',
            category: 'agent-mia',
            title,
            description: `Agent "${agent.id}" last heartbeat was ${Math.round(age / HOURS(1))}h ago. The agent may be stuck or offline.`,
          });
          results.push({ rule: 'agent-mia-48h', fired: true, escalationCreated: created, message: title });
        }
      }
    } catch (e) {
      results.push({ rule: 'agent-mia', fired: false, escalationCreated: false, message: `Agent fetch error: ${e}` });
    }

    // ─── Rule 3: Goals blocked >72h with no escalation ──────────────
    try {
      const blockedGoals = await prisma.goal.findMany({
        where: { status: 'blocked' },
        select: { id: true, title: true, updatedAt: true, ownerAgentId: true },
      });

      for (const goal of blockedGoals) {
        const age = Date.now() - new Date(goal.updatedAt).getTime();
        if (age > HOURS(72)) {
          const title = `Goal ${goal.id} blocked for >72h: ${goal.title}`;
          const created = await createEscalationIfNew({
            fromAgentId: goal.ownerAgentId || 'alert-rules-engine',
            severity: 'critical',
            category: 'goal-blocked',
            title,
            description: `Goal "${goal.title}" has been in blocked status for ${Math.round(age / HOURS(1))}h without resolution.`,
          });
          results.push({ rule: 'goal-blocked-72h', fired: true, escalationCreated: created, message: title });
        }
      }
    } catch (e) {
      results.push({ rule: 'goal-blocked', fired: false, escalationCreated: false, message: `Goal fetch error: ${e}` });
    }

    const escalationsCreated = results.filter(r => r.escalationCreated).length;
    const rulesFired = results.filter(r => r.fired).length;

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      summary: `${rulesFired} rules fired, ${escalationsCreated} new escalations created`,
      results,
    });
  } catch (e) {
    console.error('[Alert Rules Engine]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  // Return recent escalations created by the rules engine
  try {
    const recent = await prisma.escalation.findMany({
      where: {
        fromAgentId: 'alert-rules-engine',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({
      ok: true,
      recentEscalations: recent,
      count: recent.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
