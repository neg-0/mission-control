import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

/**
 * Recalculate a goal's progress from its tasks and write back to the DB.
 * progress = Math.round(done / total * 100)
 * Also auto-sets status to 'complete' when all tasks are done,
 * and reverts to 'in_progress' if a task is un-done.
 */
async function recalcGoalProgress(goalId: string) {
  const tasks = await prisma.task.findMany({
    where: { goalId },
    select: { status: true },
  });

  if (tasks.length === 0) return;

  const done = tasks.filter(t => t.status === 'done').length;
  const progress = Math.round((done / tasks.length) * 100);

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { status: true },
  });

  const data: { progress: number; status?: string } = { progress };

  // Auto-complete when all tasks are done
  if (progress === 100 && goal?.status !== 'complete') {
    data.status = 'complete';
  }
  // Revert to in_progress if a task was un-done on a completed goal
  if (progress < 100 && goal?.status === 'complete') {
    data.status = 'in_progress';
  }

  await prisma.goal.update({ where: { id: goalId }, data });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const assigneeId = searchParams.get('assigneeId');
    const goalId = searchParams.get('goalId');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (status) where.status = status;
    if (assigneeId) where.assigneeId = assigneeId;
    if (goalId) where.goalId = goalId;

    // Support excludeStatus param (e.g. ?excludeStatus=done)
    const excludeStatus = searchParams.get('excludeStatus');
    if (excludeStatus) {
      where.status = { ...((where.status && typeof where.status === 'object') ? where.status : {}), not: excludeStatus };
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        goal: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      }
    });

    return NextResponse.json(tasks);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Validate required
    if (!body.title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description,
        status: body.status || 'todo',
        priority: body.priority || 'medium',
        assigneeId: body.assigneeId,
        assigneeType: body.assigneeType || 'agent',
        goalId: body.goalId,
        projectId: body.projectId,
      }
    });

    // Adding a task to a goal changes the denominator → recalc
    if (task.goalId) {
      await recalcGoalProgress(task.goalId);
    }

    return NextResponse.json(task);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};
    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === 'done') data.completedAt = new Date();
    }
    if (body.assigneeId !== undefined) {
      data.assigneeId = body.assigneeId;
      data.assigneeType = body.assigneeType || 'agent';
    }

    const task = await prisma.task.update({
      where: { id: body.id },
      data,
    });

    // Recalculate parent goal progress when task status changes
    if (body.status !== undefined && task.goalId) {
      await recalcGoalProgress(task.goalId);
    }

    return NextResponse.json(task);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

