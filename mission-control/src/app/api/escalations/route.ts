/**
 * @module api/escalations
 * @description
 * API for agent escalation management.
 *
 * Escalations are urgent alerts from agents to the human operator (Dustin).
 * When an agent encounters a problem it can't solve — a blocker, security
 * concern, or decision that requires human judgement — it creates an escalation.
 *
 * Each escalation has a severity level:
 * - `warning` — non-urgent, informational
 * - `critical` — needs attention soon
 * - `blocker` — work is stopped until resolved
 *
 * Creating an escalation automatically logs a message on the "escalation"
 * channel in the {@link MessageLog} for audit purposes.
 *
 * **Endpoints:**
 * - `GET   /api/escalations` — List escalations (filter by status, severity, agent)
 * - `POST  /api/escalations` — Create a new escalation
 * - `PATCH /api/escalations` — Resolve or acknowledge an escalation
 *
 * @see {@link module:schemas.CreateEscalationSchema} for validation
 */

import { prisma } from '@/lib/prisma';
import {
  CreateEscalationSchema,
  UpdateEscalationSchema,
  formatZodError,
} from '@/lib/schemas';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/escalations
 *
 * Lists escalations with optional filtering.
 *
 * @param request - Supports query params: `?status=open&severity=critical&fromAgentId=warden`
 * @returns JSON array of Escalation records
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const severity = searchParams.get('severity');
    const fromAgentId = searchParams.get('fromAgentId');

    const where: Prisma.EscalationWhereInput = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (fromAgentId) where.fromAgentId = fromAgentId;

    const escalations = await prisma.escalation.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    });

    return NextResponse.json(escalations);
  } catch (e) {
    console.error('[Escalations GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/escalations
 *
 * Creates a new escalation and auto-logs it to the MessageLog.
 * The message is sent to "dustin" on the "escalation" channel with
 * the severity level in the subject line.
 *
 * @param request - JSON body matching {@link CreateEscalationSchema}
 * @returns Created Escalation record (HTTP 201)
 */
export async function POST(request: NextRequest) {
  try {
    const result = CreateEscalationSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }
    const body = result.data;

    const escalation = await prisma.escalation.create({
      data: {
        fromAgentId: body.fromAgentId,
        severity: body.severity,
        category: body.category,
        title: body.title,
        description: body.description || null,
      },
    });

    // Auto-log escalation as a message for audit trail
    await prisma.messageLog.create({
      data: {
        fromId: body.fromAgentId,
        toId: 'dustin',
        channel: 'escalation',
        subject: `[${body.severity.toUpperCase()}] ${body.title}`,
        body: body.description || body.title,
        status: 'sent',
        metadata: { escalationId: escalation.id, category: body.category },
      },
    });

    return NextResponse.json(escalation, { status: 201 });
  } catch (e) {
    console.error('[Escalations POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/escalations
 *
 * Updates an escalation's status. Used to acknowledge, resolve, or dismiss.
 * When status is set to "resolved" or "dismissed", `resolvedAt` is auto-set.
 *
 * @param request - JSON body matching {@link UpdateEscalationSchema}
 * @returns Updated Escalation record
 */
export async function PATCH(request: NextRequest) {
  try {
    const result = UpdateEscalationSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }
    const body = result.data;

    const data: Prisma.EscalationUpdateInput = {};
    if (body.status) data.status = body.status;
    if (body.resolvedBy) data.resolvedBy = body.resolvedBy;
    if (body.resolution) data.resolution = body.resolution;
    if (body.status === 'resolved' || body.status === 'dismissed') {
      data.resolvedAt = new Date();
    }

    const escalation = await prisma.escalation.update({
      where: { id: body.id },
      data,
    });

    return NextResponse.json(escalation);
  } catch (e) {
    console.error('[Escalations PATCH]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
