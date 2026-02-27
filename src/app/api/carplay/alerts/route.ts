/**
 * GET /api/carplay/alerts
 *
 * Returns CarPlay alerts sorted by severity (P0 first) + age.
 * Runs the alert evaluator to refresh the materialized alert view
 * before returning results.
 *
 * Query params:
 * - severity: filter by severity level (0, 1, 2)
 * - resolved: include resolved alerts (default: false)
 */

import { verifyCarPlayToken, unauthorizedResponse } from '@/lib/carplay-auth';
import { evaluateAlerts } from '@/lib/carplay-alerts';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const auth = await verifyCarPlayToken(request);
  if (!auth) return unauthorizedResponse();

  try {
    // Refresh alert materialized view
    await evaluateAlerts();

    const { searchParams } = new URL(request.url);
    const severity = searchParams.get('severity');
    const showResolved = searchParams.get('resolved') === 'true';

    const where: Prisma.CarPlayAlertWhereInput = {};
    if (!showResolved) where.resolved = false;
    if (severity !== null && severity !== '') {
      where.severity = parseInt(severity, 10);
    }

    const alerts = await prisma.carPlayAlert.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { triggeredAt: 'desc' }],
    });

    return NextResponse.json({
      alerts: alerts.map((a) => ({
        id: a.id,
        severity: a.severity,
        type: a.type,
        title: a.title,
        detail: a.detail,
        triggeredAt: a.triggeredAt.toISOString(),
        acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
        repeatCount: a.repeatCount,
      })),
      total: alerts.length,
    });
  } catch (e) {
    console.error('[CarPlay Alerts]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
