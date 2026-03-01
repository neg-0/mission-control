/**
 * @module api/projects
 * @description
 * List all projects with summary stats.
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects?stage=building,beta,launched
 *
 * Lists projects with owner info and checkpoint counts.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const stageFilter = searchParams.get('stage');

    const where: Record<string, unknown> = {};
    if (stageFilter) {
      where.stage = { in: stageFilter.split(',') };
    }

    const projects = await prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        ownerAgent: {
          select: { id: true, role: true },
        },
        _count: {
          select: {
            checkpoints: true,
            tasks: true,
            pipelines: true,
            goals: true,
          },
        },
      },
    });

    // Also fetch checkpoint summary per project
    const projectsWithCheckpoints = await Promise.all(
      projects.map(async (p) => {
        const checkpoints = await prisma.checkpoint.findMany({
          where: { projectId: p.id },
          select: { status: true, humanRequired: true, phase: true },
        });

        const cpTotal = checkpoints.length;
        const cpPassed = checkpoints.filter(c => c.status === 'pass' || c.status === 'skipped').length;
        const cpBlocked = checkpoints.filter(c => (c.humanRequired && c.status === 'pending') || c.status === 'blocked' || c.status === 'fail').length;

        return {
          id: p.id,
          name: p.name,
          stage: p.stage,
          description: p.description,
          repoUrl: p.repoUrl,
          deployedUrl: p.deployedUrl,
          ownerAgent: p.ownerAgent,
          counts: p._count,
          checkpointProgress: { total: cpTotal, passed: cpPassed, blocked: cpBlocked },
        };
      })
    );

    return NextResponse.json(projectsWithCheckpoints);
  } catch (e) {
    console.error('[Projects GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
