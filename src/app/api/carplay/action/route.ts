/**
 * POST /api/carplay/action
 *
 * Perform a car-safe action from the allowlisted set:
 * - pause_outreach: disable outreach-related schedules
 * - resume_outreach: re-enable outreach schedules
 * - kick_rocket: send a wake command to Rocket via the OpenClaw gateway
 *
 * Every action is audit-logged.
 */

import { verifyCarPlayToken, unauthorizedResponse, auditLog } from '@/lib/carplay-auth';
import { CarPlayActionSchema, formatZodError } from '@/lib/schemas';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const auth = await verifyCarPlayToken(request);
  if (!auth) return unauthorizedResponse();

  try {
    const result = CarPlayActionSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const { action, context } = result.data;
    let actionResult: unknown;

    switch (action) {
      case 'pause_outreach': {
        const updated = await prisma.schedule.updateMany({
          where: {
            name: { contains: 'outreach', mode: 'insensitive' },
            enabled: true,
          },
          data: { enabled: false },
        });
        actionResult = { paused: updated.count };
        break;
      }

      case 'resume_outreach': {
        const updated = await prisma.schedule.updateMany({
          where: {
            name: { contains: 'outreach', mode: 'insensitive' },
            enabled: false,
          },
          data: { enabled: true },
        });
        actionResult = { resumed: updated.count };
        break;
      }

      case 'kick_rocket': {
        const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
        const hooksToken = process.env.OPENCLAW_HOOKS_TOKEN;

        if (!gatewayUrl || !hooksToken) {
          // Dry-run — log locally
          await prisma.messageLog.create({
            data: {
              fromId: 'carplay',
              toId: 'rocket',
              channel: 'kick',
              subject: 'CarPlay kick (dry-run)',
              body: context || 'Wake up — CarPlay kick',
              status: 'sent',
              metadata: { source: 'carplay', mode: 'dry-run' },
            },
          });
          actionResult = { mode: 'dry-run', message: 'Hooks not configured' };
          break;
        }

        const response = await fetch(`${gatewayUrl}/hooks/wake`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${hooksToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: context || 'CarPlay wake — check status',
            mode: 'now',
          }),
        });

        const wakeResult = response.ok
          ? await response.json()
          : { error: await response.text() };

        await prisma.messageLog.create({
          data: {
            fromId: 'carplay',
            toId: 'rocket',
            channel: 'kick',
            subject: 'CarPlay kick',
            body: context || 'Wake up — CarPlay kick',
            status: response.ok ? 'delivered' : 'failed',
            metadata: { source: 'carplay', result: wakeResult },
          },
        });

        actionResult = { mode: 'live', success: response.ok, result: wakeResult };
        break;
      }
    }

    await auditLog(action, { context, result: actionResult }, auth.deviceId);

    return NextResponse.json({ action, result: actionResult });
  } catch (e) {
    console.error('[CarPlay Action]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
