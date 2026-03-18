/**
 * @module api/messages
 * @description
 * API for the Mission Control MessageLog — the central audit trail for
 * all inter-agent and agent-human communication.
 *
 * Every communication in the system flows through the MessageLog:
 * - **schedule** — orchestrator wake notifications
 * - **escalation** — agent-to-human urgent alerts
 * - **kick** — manual agent wake commands
 * - **report** — agent status reports (e.g. ShipLog)
 * - **direct** — agent-to-agent or human-to-agent messages
 *
 * The GET endpoint supports comprehensive filtering for dashboard views
 * and agent skill scripts that need to query communication history.
 *
 * **Endpoints:**
 * - `GET  /api/messages` — Query MessageLog with filters
 * - `POST /api/messages` — Log a new message
 *
 * @see {@link module:schemas.CreateMessageSchema} for validation
 */

import { prisma } from '@/lib/prisma';
import { CreateMessageSchema, formatZodError } from '@/lib/schemas';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messages
 *
 * Queries the MessageLog with optional filtering by sender, recipient,
 * channel, and time range. Results are paginated with a configurable limit
 * (default: 50, max: 200).
 *
 * @param request - Supports query params: `?fromId=&toId=&channel=&since=&until=&limit=`
 * @returns `{ messages: MessageLog[], total: number, limit: number }`
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fromId = searchParams.get('fromId');
    const toId = searchParams.get('toId');
    const channel = searchParams.get('channel');
    const subject = searchParams.get('subject');
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const where: Prisma.MessageLogWhereInput = {};
    if (fromId) where.fromId = fromId;
    if (toId) where.toId = toId;
    if (channel) where.channel = channel;
    if (subject) where.subject = { contains: subject };

    if (since || until) {
      where.sentAt = {};
      if (since) where.sentAt.gte = new Date(since);
      if (until) where.sentAt.lte = new Date(until);
    }

    const messages = await prisma.messageLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take: Math.min(limit, 200),
    });

    const total = await prisma.messageLog.count({ where });

    return NextResponse.json({ messages, total, limit });
  } catch (e) {
    console.error('[Messages GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/messages
 *
 * Logs a new message to the MessageLog. Called by:
 * - Skill scripts (comms_log tool)
 * - API routes (escalation auto-logging, tick wake logging)
 * - Agents (direct communication)
 *
 * @param request - JSON body matching {@link CreateMessageSchema}
 * @returns Created MessageLog record (HTTP 201)
 */
export async function POST(request: NextRequest) {
  try {
    const result = CreateMessageSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }
    const body = result.data;

    const message = await prisma.messageLog.create({
      data: {
        fromId: body.fromId,
        toId: body.toId,
        channel: body.channel,
        subject: body.subject || null,
        body: body.body,
        status: body.status,
        metadata: body.metadata || null,
      },
    });

    return NextResponse.json(message, { status: 201 });
  } catch (e) {
    console.error('[Messages POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
