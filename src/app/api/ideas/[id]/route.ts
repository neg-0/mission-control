import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/ideas/[id]
 * Fetch a single idea details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const idea = await prisma.idea.findUnique({
      where: { id: params.id },
      include: {
        scorecards: true,
        project: true
      }
    });

    if (!idea) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }

    return NextResponse.json(idea);
  } catch (e) {
    console.error('[Idea Detail GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/ideas/[id]
 * Update idea status, metrics, or start validation sprint.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();

    // Special Logic: Start Validation Sprint
    if (body.action === 'start_sprint') {
      const now = new Date();
      const deadline = new Date(now.getTime() + 48 * 60 * 60 * 1000); // +48h

      const updated = await prisma.idea.update({
        where: { id: params.id },
        data: {
          status: 'validating',
          stage: 'outreach',
          validationStartedAt: now,
          validationDeadline: deadline,
          validationTarget: 10
        }
      });
      return NextResponse.json(updated);
    }

    // Special Logic: Graduate to Project
    if (body.action === 'graduate') {
      const idea = await prisma.idea.findUnique({ where: { id: params.id } });
      if (!idea) return NextResponse.json({ error: 'Idea not found' }, { status: 404 });

      // Create Project
      const project = await prisma.project.create({
        data: {
          id: idea.id, // Use same ID? Or generic slug? Let's use ID for lineage.
          name: idea.title,
          stage: 'research', // Starts at research phase
          description: idea.description,
          idea: { connect: { id: idea.id } }
        }
      });

      // Update Idea status
      await prisma.idea.update({
        where: { id: params.id },
        data: { status: 'graduated', projectId: project.id }
      });

      return NextResponse.json({ ideaId: idea.id, projectId: project.id });
    }

    // Special Logic: Kill
    if (body.action === 'kill') {
      const updated = await prisma.idea.update({
        where: { id: params.id },
        data: { status: 'killed' }
      });
      return NextResponse.json(updated);
    }

    // Standard Update — only pass known fields
    const allowedFields = ['status', 'stage', 'title', 'description', 'source', 'sourceUrls',
      'score', 'researchNotes', 'refineryData', 'validationMetrics',
      'validationTarget', 'validationStartedAt', 'validationDeadline'] as const;

    const data: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        data[key] = body[key];
      }
    }

    const updated = await prisma.idea.update({
      where: { id: params.id },
      data
    });

    return NextResponse.json(updated);
  } catch (e) {
    console.error('[Idea Detail PATCH]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/ideas/[id]
 * Delete (or archive) an idea.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.idea.delete({
      where: { id: params.id }
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[Idea DELETE]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
