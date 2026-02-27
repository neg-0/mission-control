/**
 * POST /api/carplay/ack
 *
 * Acknowledge a CarPlay alert. Also cross-updates the upstream
 * escalation if the alert was sourced from one.
 */

import { verifyCarPlayToken, unauthorizedResponse, auditLog } from '@/lib/carplay-auth';
import { acknowledgeAlert } from '@/lib/carplay-alerts';
import { AckAlertSchema, formatZodError } from '@/lib/schemas';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const auth = await verifyCarPlayToken(request);
  if (!auth) return unauthorizedResponse();

  try {
    const result = AckAlertSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const alert = await acknowledgeAlert(result.data.alertId, 'carplay');

    await auditLog('ack_alert', { alertId: result.data.alertId }, auth.deviceId);

    return NextResponse.json({
      id: alert.id,
      acknowledgedAt: alert.acknowledgedAt?.toISOString(),
    });
  } catch (e) {
    console.error('[CarPlay Ack]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
