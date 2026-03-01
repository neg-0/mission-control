import { PrismaClient } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

const prisma = new PrismaClient();

/**
 * PATCH /api/projects/[id]/railway
 * Link a Mission Control project to a Railway project + environment.
 *
 * Body: { railwayProjectId: string, railwayEnvironmentId: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { railwayProjectId, railwayEnvironmentId } = body;

    if (!railwayProjectId || !railwayEnvironmentId) {
      return NextResponse.json(
        { error: 'railwayProjectId and railwayEnvironmentId are required' },
        { status: 400 },
      );
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        railwayProjectId,
        railwayEnvironmentId,
      },
      select: {
        id: true,
        name: true,
        railwayProjectId: true,
        railwayEnvironmentId: true,
        ownerAgentId: true,
      },
    });

    return NextResponse.json({ ok: true, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('Record to update not found')) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    // eslint-disable-next-line no-console
    console.error('[Railway Link] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/projects/[id]/railway
 * Get Railway linking status for a project.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        railwayProjectId: true,
        railwayEnvironmentId: true,
        ownerAgentId: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({
      linked: !!(project.railwayProjectId && project.railwayEnvironmentId),
      project,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Railway Link] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
