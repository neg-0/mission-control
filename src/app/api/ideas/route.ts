import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/ideas
 * List all ideas, optionally filtered by status.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // e.g. "validating"

    const where = status ? { status } : {};

    const ideas = await prisma.idea.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        scorecards: true,
        project: { select: { id: true, name: true } }
      }
    });

    return NextResponse.json(ideas);
  } catch (e) {
    console.error('[Ideas GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/ideas
 * Create a new idea draft.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, source } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title required' }, { status: 400 });
    }

    const idea = await prisma.idea.create({
      data: {
        id: crypto.randomUUID(),
        title,
        description,
        source: source || 'Manual',
        status: 'draft',
        stage: 'pain_audit'
      }
    });

    return NextResponse.json(idea, { status: 201 });
  } catch (e) {
    console.error('[Ideas POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
