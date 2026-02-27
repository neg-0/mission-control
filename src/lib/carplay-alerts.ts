/**
 * @module carplay-alerts
 * @description
 * CarPlay alert evaluator — P0/P1/P2 interrupt classification system.
 *
 * Reads signals from multiple sources (Escalations, Pipelines, Agents,
 * PRs, Metrics) and produces a materialized, deduplicated, prioritized
 * alert stream for the CarPlay cockpit.
 *
 * Interrupt policy (from CarPlay PRD §5):
 * - P0 (driving interrupt): prod down, CI blocking main >30min, security,
 *   outreach emergency, Stripe failures
 * - P1 (quiet notify): lighthouse regression, intermittent drip failures,
 *   degraded gateway — auto-promotes to P0 if >3 repeats or >2h persistent
 * - P2 (badge only): new PRs, non-blocking review comments
 */

import { prisma } from './prisma';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

interface AlertInput {
  severity: number;
  type: string;
  title: string;
  detail?: string;
  dedupeKey: string;
  sourceId?: string;
  sourceType?: string;
}

/**
 * Evaluate all signal sources and upsert CarPlayAlerts.
 * Returns the current list of unresolved alerts sorted by severity + age.
 */
export async function evaluateAlerts() {
  const signals: AlertInput[] = [];

  // 1. Escalations → P0/P1
  const openEscalations = await prisma.escalation.findMany({
    where: { status: { in: ['open', 'ack'] } },
  });

  for (const esc of openEscalations) {
    const severity = esc.severity === 'blocker' ? 0 : esc.severity === 'critical' ? 1 : 2;
    signals.push({
      severity,
      type: mapEscalationCategory(esc.category),
      title: esc.title,
      detail: esc.description ?? undefined,
      dedupeKey: `escalation:${esc.id}`,
      sourceId: esc.id,
      sourceType: 'escalation',
    });
  }

  // 2. Pipelines — CI failing on main
  const failingPipelines = await prisma.pipeline.findMany({
    where: { status: 'failing' },
    include: { project: true },
  });

  for (const pl of failingPipelines) {
    const age = Date.now() - (pl.startedAt?.getTime() ?? pl.createdAt.getTime());
    const severity = age > THIRTY_MINUTES_MS ? 0 : 1;
    signals.push({
      severity,
      type: 'ci',
      title: `CI failing: ${pl.project.name} (${pl.stage})`,
      detail: `Pipeline ${pl.id} has been failing for ${Math.round(age / 60000)}min`,
      dedupeKey: `ci:${pl.projectId}:${pl.stage}`,
      sourceId: pl.id,
      sourceType: 'pipeline',
    });
  }

  // 3. Agent health — failed or offline >2h
  const agents = await prisma.agent.findMany();
  const latestJournals = await prisma.agentJournal.findMany({
    where: { agentId: { in: agents.map((a) => a.id) } },
    orderBy: { createdAt: 'desc' },
    distinct: ['agentId'],
  });
  const journalMap = new Map(latestJournals.map((j) => [j.agentId, j]));

  for (const agent of agents) {
    const journal = journalMap.get(agent.id);

    if (journal?.status === 'error' || journal?.status === 'blocked') {
      signals.push({
        severity: 1,
        type: 'fleet',
        title: `Agent ${agent.id} is ${journal.status}`,
        detail: journal.blockers ?? undefined,
        dedupeKey: `agent:${agent.id}:${journal.status}`,
        sourceId: agent.id,
        sourceType: 'agent',
      });
    }

    // Check for offline agents (no journal in 2h, no heartbeat in 2h)
    const lastActivity = journal?.createdAt ?? agent.lastHeartbeat;
    if (lastActivity && Date.now() - lastActivity.getTime() > TWO_HOURS_MS) {
      signals.push({
        severity: 1,
        type: 'fleet',
        title: `Agent ${agent.id} offline >2h`,
        dedupeKey: `agent:${agent.id}:offline`,
        sourceId: agent.id,
        sourceType: 'agent',
      });
    }
  }

  // 4. Critical tasks (burning)
  const criticalTasks = await prisma.task.findMany({
    where: {
      priority: 'critical',
      status: { notIn: ['done'] },
    },
    take: 5,
  });

  for (const task of criticalTasks) {
    signals.push({
      severity: 1,
      type: 'fleet',
      title: `Critical task: ${task.title}`,
      dedupeKey: `task:${task.id}:critical`,
      sourceId: task.id,
      sourceType: 'task',
    });
  }

  // Upsert all signals
  for (const signal of signals) {
    await upsertAlert(signal);
  }

  // Auto-resolve alerts whose source signal is no longer present
  await autoResolveStaleAlerts(signals.map((s) => s.dedupeKey));

  // Auto-promote P1s that are old or repeated
  await autoPromote();

  // Return current alerts
  return prisma.carPlayAlert.findMany({
    where: { resolved: false },
    orderBy: [{ severity: 'asc' }, { triggeredAt: 'desc' }],
  });
}

// ---------------------------------------------------------------------------
// Upsert with deduplication
// ---------------------------------------------------------------------------

async function upsertAlert(input: AlertInput) {
  const existing = await prisma.carPlayAlert.findUnique({
    where: { dedupeKey: input.dedupeKey },
  });

  if (existing && !existing.resolved) {
    // Already tracked — increment repeat count
    await prisma.carPlayAlert.update({
      where: { id: existing.id },
      data: {
        repeatCount: existing.repeatCount + 1,
        title: input.title,
        detail: input.detail,
      },
    });
  } else if (!existing) {
    // New alert
    await prisma.carPlayAlert.create({
      data: {
        severity: input.severity,
        type: input.type,
        title: input.title,
        detail: input.detail,
        dedupeKey: input.dedupeKey,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
      },
    });
  } else {
    // Was resolved but signal returned — reopen
    await prisma.carPlayAlert.update({
      where: { id: existing.id },
      data: {
        resolved: false,
        resolvedAt: null,
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        repeatCount: 1,
        acknowledgedAt: null,
        acknowledgedBy: null,
        promotedFrom: null,
        triggeredAt: new Date(),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Auto-promotion: P1 → P0 if >3 repeats or >2h old
// ---------------------------------------------------------------------------

async function autoPromote() {
  const candidates = await prisma.carPlayAlert.findMany({
    where: {
      severity: 1,
      resolved: false,
    },
  });

  for (const alert of candidates) {
    const age = Date.now() - alert.triggeredAt.getTime();
    if (alert.repeatCount > 3 || age > TWO_HOURS_MS) {
      await prisma.carPlayAlert.update({
        where: { id: alert.id },
        data: {
          severity: 0,
          promotedFrom: 1,
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-resolve: mark alerts as resolved if signal gone
// ---------------------------------------------------------------------------

async function autoResolveStaleAlerts(activeKeys: string[]) {
  const activeSet = new Set(activeKeys);
  const unresolvedAlerts = await prisma.carPlayAlert.findMany({
    where: { resolved: false },
  });

  for (const alert of unresolvedAlerts) {
    if (!activeSet.has(alert.dedupeKey)) {
      await prisma.carPlayAlert.update({
        where: { id: alert.id },
        data: { resolved: true, resolvedAt: new Date() },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Acknowledge a CarPlay alert. Also acknowledges the upstream escalation
 * if the alert was sourced from one.
 */
export async function acknowledgeAlert(id: string, by: string) {
  const alert = await prisma.carPlayAlert.update({
    where: { id },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedBy: by,
    },
  });

  // Cross-update source escalation if applicable
  if (alert.sourceType === 'escalation' && alert.sourceId) {
    await prisma.escalation
      .update({
        where: { id: alert.sourceId },
        data: { status: 'ack' },
      })
      .catch(() => {}); // best-effort
  }

  return alert;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapEscalationCategory(category: string): string {
  const map: Record<string, string> = {
    security: 'security',
    infra: 'prod',
    production: 'prod',
    budget: 'stripe',
    product: 'fleet',
    architecture: 'fleet',
    merge: 'ci',
  };
  return map[category] ?? 'fleet';
}
