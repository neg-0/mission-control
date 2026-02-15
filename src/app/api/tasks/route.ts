import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const assigneeId = searchParams.get('assigneeId');
    const goalId = searchParams.get('goalId');

    const where: any = {};
    if (status) where.status = status;
    if (assigneeId) where.assigneeId = assigneeId;
    if (goalId) where.goalId = goalId;

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

    return NextResponse.json(task);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

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

    return NextResponse.json(task);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
