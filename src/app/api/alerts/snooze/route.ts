/**
 * @module api/alerts/snooze
 * @description
 * Snooze a CarPlay alert for 1h, 4h, or 24h.
 *
 * Snoozing pauses escalation and hides the alert temporarily.
 * When the snooze expires, the alert returns at its current severity
 * (it does NOT re-escalate from the original level — per US-403).
 *
 * POST /api/alerts/snooze — Snooze an alert
 */

import { snoozeAlert } from '@/lib/alert-escalation';
import { SnoozeAlertSchema, formatZodError } from '@/lib/schemas';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const result = SnoozeAlertSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const { alertId, hours } = result.data;
    const durationMs = hours * 60 * 60 * 1000;

    // TODO: Replace with authenticated user ID when auth is implemented
    const userId = 'dustin';
    const alert = await snoozeAlert(alertId, durationMs, userId);

    return NextResponse.json({
      ok: true,
      alert,
      snoozedUntil: alert.snoozedUntil,
    });
  } catch (e) {
    console.error('[Snooze POST]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
