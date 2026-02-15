/**
 * @module api/projects/[id]
 * @description
 * Full project detail aggregate endpoint.
 * Returns a project with all its checkpoints, goals, tasks, pipelines, and idea.
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/projects/:id
 *
 * Returns full project detail with related entities.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        idea: {
          include: {
            scorecards: true,
          },
        },
        ownerAgent: {
          select: { id: true, role: true, status: true },
        },
        checkpoints: {
          orderBy: { order: 'asc' },
        },
        goals: {
          include: {
            tasks: {
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        tasks: {
          orderBy: { updatedAt: 'desc' },
          take: 50,
        },
        pipelines: {
          include: {
            gates: { orderBy: { order: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        infraResources: true,
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: `Project "${params.id}" not found` },
        { status: 404 }
      );
    }

    // Compute phase summary from checkpoints
    const phases = ['idea', 'ship', 'live', 'scale'];
    const phaseSummary = phases.map(phase => {
      const cps = project.checkpoints.filter(c => c.phase === phase);
      const total = cps.length;
      const passed = cps.filter(c => c.status === 'pass' || c.status === 'skipped').length;
      const blocked = cps.filter(c => c.status === 'blocked' || c.status === 'fail').length;
      const needsHuman = cps.filter(c => c.humanRequired && c.status === 'pending').length;
      return { phase, total, passed, blocked, needsHuman };
    });

    // Find blockers (human-required or failed checkpoints)
    const blockers = project.checkpoints.filter(
      c => (c.humanRequired && c.status === 'pending') || c.status === 'blocked' || c.status === 'fail'
    );

    return NextResponse.json({
      ...project,
      phaseSummary,
      blockers,
    });
  } catch (e) {
    console.error('[Projects GET /id]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
