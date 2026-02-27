/**
 * GET /api/carplay/project/:id
 *
 * Returns a CarPlay-optimized project detail view:
 * - Today's progress (tasks completed vs pending)
 * - Top blockers (max 3)
 * - Next tasks (max 3)
 */

import { verifyCarPlayToken, unauthorizedResponse } from '@/lib/carplay-auth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyCarPlayToken(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        tasks: true,
        checkpoints: {
          where: { status: { in: ['fail', 'blocked'] } },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const completed = project.tasks.filter((t) => t.status === 'done').length;
    const pending = project.tasks.filter((t) => t.status !== 'done').length;
    const total = project.tasks.length;

    const topBlockers = project.checkpoints.map((c) => ({
      id: c.id,
      title: c.label,
      severity: c.status,
    }));

    const nextTasks = project.tasks
      .filter((t) => t.status !== 'done')
      .sort((a, b) => {
        const pri = { critical: 0, high: 1, medium: 2, low: 3 };
        return (
          (pri[a.priority as keyof typeof pri] ?? 2) -
          (pri[b.priority as keyof typeof pri] ?? 2)
        );
      })
      .slice(0, 3)
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
      }));

    return NextResponse.json({
      projectName: project.name,
      stage: project.stage,
      todayProgress: {
        tasksCompleted: completed,
        tasksPending: pending,
        percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
      topBlockers,
      nextTasks,
    });
  } catch (e) {
    console.error('[CarPlay Project]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
