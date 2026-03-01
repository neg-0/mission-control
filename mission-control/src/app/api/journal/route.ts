/**
 * @module /api/journal
 * @description
 * Agent journal API — persistent memory across isolated heartbeat sessions.
 *
 * POST — Agent writes a journal entry (did, next, status, blockers)
 * GET  — Query recent entries (used by context builder and dashboard)
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const JournalEntrySchema = z.object({
  agentId: z.string().min(1),
  did: z.string().min(1),
  next: z.string().optional().nullable(),
  status: z.string().default('healthy'),
  blockers: z.string().optional().nullable(),
  metadata: z.any().optional().nullable(),
});

/**
 * POST /api/journal — Agent writes an end-of-heartbeat journal entry
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = JournalEntrySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid journal entry', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const entry = await prisma.agentJournal.create({
      data: {
        agentId: parsed.data.agentId,
        did: parsed.data.did,
        next: parsed.data.next ?? null,
        status: parsed.data.status,
        blockers: parsed.data.blockers ?? null,
        metadata: parsed.data.metadata
          ? JSON.parse(JSON.stringify(parsed.data.metadata))
          : undefined,
      },
    });

    // Also update the agent's lastHeartbeat timestamp
    await prisma.agent
      .update({
        where: { id: parsed.data.agentId },
        data: { lastHeartbeat: new Date() },
      })
      .catch(() => {
        // Agent might not exist in MC yet — don't fail the journal write
      });

    return NextResponse.json({ success: true, id: entry.id }, { status: 201 });
  } catch (error) {
    console.error('[journal] POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/journal?agentId=captain&limit=5 — Query recent journal entries
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '5', 10), 50);

    const where = agentId ? { agentId } : {};

    const entries = await prisma.agentJournal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[journal] GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
