/**
 * @module api/pipelines
 * @description
 * CRUD API for SDLC quality pipelines in Mission Control.
 *
 * Pipelines enforce the 7-gate quality process before code reaches production:
 *
 * ```
 * lint (soft) -> typecheck -> unit_tests -> build -> security -> red_team -> pre_ship
 * ```
 *
 * Each gate has a severity:
 * - **hard** — failure blocks the entire pipeline
 * - **soft** — failure generates a warning but doesn't block
 *
 * When a gate is updated, the pipeline's overall status is automatically
 * recalculated using {@link calculatePipelineStatus} from the pipeline module.
 *
 * **Endpoints:**
 * - `GET   /api/pipelines` — List pipelines (filter by project, stage, status)
 * - `POST  /api/pipelines` — Create pipeline with default gates
 * - `PATCH /api/pipelines` — Update pipeline or individual gate status
 *
 * @see {@link module:pipeline} for status calculation logic and DEFAULT_GATES
 * @see {@link module:schemas} for request validation schemas
 */

import { calculatePipelineStatus, DEFAULT_GATES } from '@/lib/pipeline';
import { prisma } from '@/lib/prisma';
import {
  CreatePipelineSchema,
  formatZodError,
  UpdatePipelineSchema,
} from '@/lib/schemas';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipelines
 *
 * Lists pipelines with their gates and project info.
 *
 * @param request - Supports query params: `?projectId=&stage=&status=`
 * @returns JSON array of Pipeline records with nested gates (ordered by gate.order)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const stage = searchParams.get('stage');
    const status = searchParams.get('status');

    const where: Prisma.PipelineWhereInput = {};
    if (projectId) where.projectId = projectId;
    if (stage) where.stage = stage;
    if (status) where.status = status;

    const pipelines = await prisma.pipeline.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        gates: { orderBy: { order: 'asc' } },
        project: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(pipelines);
  } catch (e) {
    console.error('[Pipelines GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/pipelines
 *
 * Creates a new pipeline with the 7 default quality gates.
 * Verifies the project exists before creating.
 *
 * @param request - JSON body matching {@link CreatePipelineSchema}
 * @returns Created Pipeline with nested gates (HTTP 201)
 */
export async function POST(request: NextRequest) {
  try {
    const result = CreatePipelineSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }
    const body = result.data;

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

    const pipeline = await prisma.pipeline.create({
      data: {
        projectId: body.projectId,
        stage: body.stage,
        status: 'pending',
        startedAt: new Date(),
        gates: {
          create: DEFAULT_GATES.map((g) => ({
            name: g.name,
            order: g.order,
            severity: g.severity,
            required: g.required,
          })),
        },
      },
      include: {
        gates: { orderBy: { order: 'asc' } },
        project: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(pipeline, { status: 201 });
  } catch (e) {
    console.error('[Pipelines POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/pipelines
 *
 * Updates a pipeline or a specific gate within it.
 *
 * **Two modes:**
 * 1. **Gate update** (when `gateId` is provided): Updates the gate's status,
 *    output, and checkedBy. Then recalculates the overall pipeline status
 *    using {@link calculatePipelineStatus}.
 *
 * 2. **Pipeline update** (when `gateId` is omitted): Directly updates the
 *    pipeline's status or stage.
 *
 * @param request - JSON body matching {@link UpdatePipelineSchema}
 * @returns Updated gate + pipeline status, or updated pipeline with gates
 */
export async function PATCH(request: NextRequest) {
  try {
    const result = UpdatePipelineSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }
    const body = result.data;

    // --- Gate-level update ---
    if (body.gateId) {
      const gateData: Prisma.PipelineGateUpdateInput = {
        checkedAt: new Date(),
      };
      if (body.status) gateData.status = body.status;
      if (body.output !== undefined) gateData.output = body.output;
      if (body.checkedBy) gateData.checkedBy = body.checkedBy;

      const gate = await prisma.pipelineGate.update({
        where: { id: body.gateId },
        data: gateData,
      });

      // Auto-recalculate pipeline status from all gates
      const allGates = await prisma.pipelineGate.findMany({
        where: { pipelineId: body.id },
        orderBy: { order: 'asc' },
      });

      const pipelineStatus = calculatePipelineStatus(
        allGates.map((g) => ({ status: g.status, severity: g.severity }))
      );

      await prisma.pipeline.update({
        where: { id: body.id },
        data: {
          status: pipelineStatus,
          ...(pipelineStatus === 'passing' ? { completedAt: new Date() } : {}),
        },
      });

      return NextResponse.json({ gate, pipelineStatus });
    }

    // --- Pipeline-level update ---
    const pipelineData: Prisma.PipelineUpdateInput = {};
    if (body.status) pipelineData.status = body.status;
    if (body.stage) pipelineData.stage = body.stage;
    if (body.status === 'passing') pipelineData.completedAt = new Date();

    const pipeline = await prisma.pipeline.update({
      where: { id: body.id },
      data: pipelineData,
      include: {
        gates: { orderBy: { order: 'asc' } },
      },
    });

    return NextResponse.json(pipeline);
  } catch (e) {
    console.error('[Pipelines PATCH]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
