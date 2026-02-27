/**
 * POST /api/carplay/message
 *
 * Send a Siri/CarPlay dictation to Rocket and return the parsed
 * two-output response:
 * - carplayDigest: short text for the car display (≤480 chars)
 * - fullText: detailed response stored in message timeline
 *
 * The fullText is also routed to Discord + message timeline by
 * the carplay-message handler.
 */

import { verifyCarPlayToken, unauthorizedResponse, auditLog } from '@/lib/carplay-auth';
import { sendToRocket } from '@/lib/carplay-message';
import { CarPlayMessageSchema, formatZodError } from '@/lib/schemas';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const auth = await verifyCarPlayToken(request);
  if (!auth) return unauthorizedResponse();

  try {
    const result = CarPlayMessageSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const { text, source } = result.data;
    const response = await sendToRocket(text, source);

    await auditLog('send_message', { text, source }, auth.deviceId);

    return NextResponse.json({
      carplayDigest: response.carplayDigest,
      messageId: response.messageId,
    });
  } catch (e) {
    console.error('[CarPlay Message]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
