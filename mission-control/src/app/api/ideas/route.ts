import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/ideas
 * List all ideas, optionally filtered by status.
 * 
 * Query params:
 *   - status: Filter by specific status (e.g. "validating", "archived")
 *   - includeArchived: "true" to include archived ideas in unfiltered list
 *   - cursor: ID for cursor-based pagination (used with status=archived)
 *   - limit: Max results per page (default 20, max 50)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const cursor = searchParams.get('cursor');
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 200);

    // By default, exclude archived ideas unless explicitly requested
    const excludeArchived = searchParams.get('includeArchived') !== 'true';
    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    } else if (excludeArchived) {
      where.status = { not: 'archived' };
    }

    // Cursor-based pagination for archived ideas
    if (status === 'archived' && cursor) {
      const pageLimit = Math.min(limit, 50);
      const ideas = await prisma.idea.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: pageLimit + 1,
        cursor: { id: cursor },
        skip: 1,
        select: {
          id: true,
          title: true,
          score: true,
          source: true,
          updatedAt: true,
          createdAt: true,
        },
      });

      const hasMore = ideas.length > pageLimit;
      const items = hasMore ? ideas.slice(0, pageLimit) : ideas;
      const nextCursor = hasMore ? items[items.length - 1]?.id : null;

      return NextResponse.json({ items, nextCursor, hasMore });
    }

    // Paginated response for archived status (first page)
    if (status === 'archived') {
      const pageLimit = Math.min(limit, 50);
      const ideas = await prisma.idea.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: pageLimit + 1,
        select: {
          id: true,
          title: true,
          score: true,
          source: true,
          updatedAt: true,
          createdAt: true,
        },
      });

      const hasMore = ideas.length > pageLimit;
      const items = hasMore ? ideas.slice(0, pageLimit) : ideas;
      const nextCursor = hasMore ? items[items.length - 1]?.id : null;

      return NextResponse.json({ items, nextCursor, hasMore });
    }

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
 * Create a new idea draft or perform bulk actions.
 * 
 * Body for bulk archive: { action: "bulk_archive", olderThanDays: 3 }
 * Body for new idea:     { title: "...", description: "...", source: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Bulk archive action
    if (body.action === 'bulk_archive') {
      const days = body.olderThanDays ?? 3;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const result = await prisma.idea.updateMany({
        where: {
          status: 'killed',
          updatedAt: { lt: cutoff },
        },
        data: { status: 'archived' },
      });

      return NextResponse.json({ archived: result.count, cutoffDate: cutoff.toISOString() });
    }

    // Create new idea
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
