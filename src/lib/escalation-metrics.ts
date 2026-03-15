/**
 * @module escalation-metrics
 * @description
 * Escalation metrics — MTTA (Mean Time To Acknowledge) and MTTR (Mean Time
 * To Resolve) calculations (US-404).
 *
 * Metrics cover configurable time windows (7 days, 30 days).
 * Alerts with MTTR > 24h are flagged for rule review.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export interface EscalationMetrics {
  period: string;
  totalAlerts: number;
  acknowledged: number;
  resolved: number;
  mttaMs: number | null; // Mean Time To Acknowledge (ms)
  mttrMs: number | null; // Mean Time To Resolve (ms)
  mttaFormatted: string;
  mttrFormatted: string;
  bySeverity: Record<string, number>;
  slowResolutions: number; // Alerts with MTTR > 24h
  falsePositiveRate: number; // dismissed / (resolved + dismissed)
}

/**
 * Calculate escalation metrics for a given time window.
 */
export async function getEscalationMetrics(
  days: number = 7,
  db: PrismaClient = defaultPrisma,
): Promise<EscalationMetrics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const alerts = await db.carPlayAlert.findMany({
    where: { triggeredAt: { gte: since } },
  });

  const totalAlerts = alerts.length;

  // MTTA: average time from triggeredAt to acknowledgedAt
  const ackedAlerts = alerts.filter((a) => a.acknowledgedAt);
  const mttaMs = ackedAlerts.length > 0
    ? ackedAlerts.reduce(
        (sum, a) => sum + (a.acknowledgedAt!.getTime() - a.triggeredAt.getTime()),
        0,
      ) / ackedAlerts.length
    : null;

  // MTTR: average time from triggeredAt to resolvedAt
  const resolvedAlerts = alerts.filter((a) => a.resolvedAt);
  const mttrMs = resolvedAlerts.length > 0
    ? resolvedAlerts.reduce(
        (sum, a) => sum + (a.resolvedAt!.getTime() - a.triggeredAt.getTime()),
        0,
      ) / resolvedAlerts.length
    : null;

  // Slow resolutions (MTTR > 24h)
  const slowResolutions = resolvedAlerts.filter(
    (a) => a.resolvedAt!.getTime() - a.triggeredAt.getTime() > TWENTY_FOUR_HOURS_MS,
  ).length;

  // Volume by severity
  const bySeverity: Record<string, number> = { P0: 0, P1: 0, P2: 0 };
  for (const alert of alerts) {
    const key = `P${alert.promotedFrom ?? alert.severity}`;
    bySeverity[key] = (bySeverity[key] || 0) + 1;
  }

  // False positive rate: alerts dismissed vs resolved
  // We look at escalations for this since CarPlayAlert doesn't have a "dismissed" state
  const escalations = await db.escalation.findMany({
    where: { createdAt: { gte: since } },
    select: { status: true },
  });

  const dismissed = escalations.filter((e) => e.status === 'dismissed').length;
  const resolvedEscalations = escalations.filter((e) => e.status === 'resolved').length;
  const falsePositiveRate =
    dismissed + resolvedEscalations > 0
      ? dismissed / (dismissed + resolvedEscalations)
      : 0;

  return {
    period: `${days}d`,
    totalAlerts,
    acknowledged: ackedAlerts.length,
    resolved: resolvedAlerts.length,
    mttaMs,
    mttrMs,
    mttaFormatted: mttaMs ? formatDuration(mttaMs) : 'N/A',
    mttrFormatted: mttrMs ? formatDuration(mttrMs) : 'N/A',
    bySeverity,
    slowResolutions,
    falsePositiveRate: Math.round(falsePositiveRate * 100),
  };
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
