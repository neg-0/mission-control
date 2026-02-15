/**
 * Goals API Route — `/api/goals`
 *
 * Provides CRUD access to the Goal model in the MC database.
 * Replaces the old file-based GOALS.md parsing approach.
 *
 * GET  /api/goals            → All goals (optionally filtered by agentId)
 * GET  /api/goals?agentId=X  → Goals owned by agent X
 * PATCH /api/goals           → Update a goal (id required)
 * POST  /api/goals           → Create a new goal
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/goals
 *
 * Returns all goals with their related tasks, optionally filtered by ownerAgentId.
 *
 * Query params:
 *   - agentId: Filter by owner agent ID (optional)
 *   - status:  Filter by goal status (optional)
 *
 * Response: { goals: Goal[] }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const status = searchParams.get('status');

    const where: Prisma.GoalWhereInput = {};
    if (agentId) where.ownerAgentId = agentId;
    if (status) where.status = status;

    const goals = await prisma.goal.findMany({
      where,
      include: {
        tasks: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            assigneeId: true,
            completedAt: true,
          },
        },
        ownerAgent: {
          select: { id: true, status: true },
        },
      },
      orderBy: [
        { status: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    return NextResponse.json({ goals });
  } catch (error) {
    console.error('Goals GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 });
  }
}

/**
 * PATCH /api/goals
 *
 * Update a goal's status, progress, or title.
 *
 * Body: { id: string, status?: string, progress?: number, title?: string }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Validate status if provided
    const validStatuses = ['queued', 'in_progress', 'complete', 'blocked'];
    if (updates.status && !validStatuses.includes(updates.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate progress if provided
    if (updates.progress !== undefined) {
      const p = Number(updates.progress);
      if (isNaN(p) || p < 0 || p > 100) {
        return NextResponse.json(
          { error: 'progress must be between 0 and 100' },
          { status: 400 }
        );
      }
      updates.progress = p;
    }

    const data: Prisma.GoalUpdateInput = {};
    if (updates.title) data.title = updates.title;
    if (updates.status) data.status = updates.status;
    if (updates.progress !== undefined) data.progress = updates.progress;

    const goal = await prisma.goal.update({
      where: { id },
      data,
      include: {
        tasks: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            assigneeId: true,
            completedAt: true,
          },
        },
      },
    });

    return NextResponse.json({ goal });
  } catch (error) {
    console.error('Goals PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}

/**
 * POST /api/goals
 *
 * Create a new goal.
 *
 * Body: { id: string, title: string, ownerAgentId: string, status?: string, progress?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, title, ownerAgentId, status = 'queued', progress = 0 } = body;

    if (!id || !title || !ownerAgentId) {
      return NextResponse.json(
        { error: 'id, title, and ownerAgentId are required' },
        { status: 400 }
      );
    }

    const goal = await prisma.goal.create({
      data: {
        id,
        title,
        status,
        progress,
        ownerAgentId,
      },
      include: {
        tasks: true,
      },
    });

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error('Goals POST error:', error);
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 });
  }
}
