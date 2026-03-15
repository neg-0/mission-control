/**
 * @module api/alerts/metrics
 * @description
 * Escalation metrics API — MTTA, MTTR, volume by severity (US-404).
 *
 * GET /api/alerts/metrics?days=7 — Get metrics for the last N days
 */

import { getEscalationMetrics } from '@/lib/escalation-metrics';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7', 10);

    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json({ error: 'days must be between 1 and 365' }, { status: 400 });
    }

    // Return both 7-day and 30-day metrics if no specific period requested
    if (!searchParams.has('days')) {
      const [week, month] = await Promise.all([
        getEscalationMetrics(7),
        getEscalationMetrics(30),
      ]);

      return NextResponse.json({ week, month });
    }

    const metrics = await getEscalationMetrics(days);
    return NextResponse.json(metrics);
  } catch (e) {
    console.error('[Metrics GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
