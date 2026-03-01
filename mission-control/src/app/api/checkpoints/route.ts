/**
 * @module api/checkpoints
 * @description
 * CRUD API for lifecycle checkpoints.
 *
 * Checkpoints are binary pass/fail gates that track project progress
 * through the 4 lifecycle phases: idea → ship → live → scale.
 *
 * **Endpoints:**
 * - `GET    /api/checkpoints?projectId=` — List checkpoints for a project
 * - `POST   /api/checkpoints`           — Create or seed checkpoints
 * - `PATCH  /api/checkpoints`           — Update checkpoint status
 */

import { seedCheckpoints, maybePromoteProject } from '@/lib/lifecycle-template';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/checkpoints?projectId=xxx
 *
 * Lists checkpoints for a project, ordered by phase/order.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId query param required' },
        { status: 400 }
      );
    }

    const checkpoints = await prisma.checkpoint.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });

    return NextResponse.json(checkpoints);
  } catch (e) {
    console.error('[Checkpoints GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/checkpoints
 *
 * Two modes:
 * 1. `{ action: "seed", projectId }` — Seed from lifecycle template
 * 2. `{ projectId, phase, key, label, ... }` — Create a single checkpoint
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Seed mode
    if (body.action === 'seed') {
      if (!body.projectId) {
        return NextResponse.json(
          { error: 'projectId required for seeding' },
          { status: 400 }
        );
      }

      // Verify project exists
      const project = await prisma.project.findUnique({
        where: { id: body.projectId },
      });
      if (!project) {
        return NextResponse.json(
          { error: `Project "${body.projectId}" not found` },
          { status: 404 }
        );
      }

      const created = await seedCheckpoints(body.projectId);
      return NextResponse.json({ created, projectId: body.projectId }, { status: 201 });
    }

    // Single checkpoint creation
    const { projectId, phase, key, label, order, automated, humanRequired } = body;
    if (!projectId || !phase || !key || !label || order == null) {
      return NextResponse.json(
        { error: 'projectId, phase, key, label, order are required' },
        { status: 400 }
      );
    }

    const checkpoint = await prisma.checkpoint.create({
      data: {
        projectId,
        phase,
        key,
        label,
        order,
        automated: automated ?? false,
        humanRequired: humanRequired ?? false,
      },
    });

    return NextResponse.json(checkpoint, { status: 201 });
  } catch (e) {
    console.error('[Checkpoints POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/checkpoints
 *
 * Update a checkpoint's status.
 * Human-required checkpoints can only be resolved with resolvedBy set.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, note, resolvedBy, output } = body;

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    // Verify checkpoint exists
    const existing = await prisma.checkpoint.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: `Checkpoint "${id}" not found` },
        { status: 404 }
      );
    }

    // Human-required checkpoints need resolvedBy
    if (existing.humanRequired && status === 'pass' && !resolvedBy) {
      return NextResponse.json(
        { error: 'humanRequired checkpoints need resolvedBy' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (note !== undefined) updateData.note = note;
    if (resolvedBy) updateData.resolvedBy = resolvedBy;
    if (output !== undefined) updateData.output = output;
    if (status === 'pass' || status === 'fail' || status === 'skipped') {
      updateData.resolvedAt = new Date();
    }

    const checkpoint = await prisma.checkpoint.update({
      where: { id },
      data: updateData,
    });

    // Attempt auto-promotion if passing a checkpoint
    let promotion = null;
    if (status === 'pass' || status === 'skipped') {
      try {
        promotion = await maybePromoteProject(checkpoint.projectId);
      } catch (err) {
        console.error('Auto-promotion failed:', err);
      }
    }

    return NextResponse.json({ ...checkpoint, promotion });
  } catch (e) {
    console.error('[Checkpoints PATCH]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
