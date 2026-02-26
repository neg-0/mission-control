/**
 * PATCH /api/agents/runtime
 * Update an agent's runtime configuration (mode, provider, model).
 *
 * Body: {
 *   agentId: string,
 *   runtimeMode?: "gateway" | "native",
 *   providerPrimary?: string,
 *   modelPrimary?: string,
 *   providerFallback?: string | null,
 *   modelFallback?: string | null,
 * }
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const UpdateRuntimeSchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  runtimeMode: z.enum(['gateway', 'native']).optional(),
  providerPrimary: z.enum(['openai', 'gemini', 'anthropic']).optional().nullable(),
  modelPrimary: z.string().optional().nullable(),
  providerFallback: z.enum(['openai', 'gemini', 'anthropic']).optional().nullable(),
  modelFallback: z.string().optional().nullable(),
});

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = UpdateRuntimeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.format() },
        { status: 400 },
      );
    }

    const { agentId, ...updates } = parsed.data;

    // Validate native mode has required provider/model
    if (updates.runtimeMode === 'native') {
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { providerPrimary: true, modelPrimary: true },
      });

      const effectiveProvider = updates.providerPrimary ?? agent?.providerPrimary;
      const effectiveModel = updates.modelPrimary ?? agent?.modelPrimary;

      if (!effectiveProvider || !effectiveModel) {
        return NextResponse.json(
          { error: 'Native mode requires providerPrimary and modelPrimary to be set' },
          { status: 400 },
        );
      }
    }

    // Build update data, filtering out undefined values
    const data: Record<string, unknown> = {};
    if (updates.runtimeMode !== undefined) data.runtimeMode = updates.runtimeMode;
    if (updates.providerPrimary !== undefined) data.providerPrimary = updates.providerPrimary;
    if (updates.modelPrimary !== undefined) data.modelPrimary = updates.modelPrimary;
    if (updates.providerFallback !== undefined) data.providerFallback = updates.providerFallback;
    if (updates.modelFallback !== undefined) data.modelFallback = updates.modelFallback;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 },
      );
    }

    const agent = await prisma.agent.update({
      where: { id: agentId },
      data,
      select: {
        id: true,
        role: true,
        runtimeMode: true,
        providerPrimary: true,
        modelPrimary: true,
        providerFallback: true,
        modelFallback: true,
      },
    });

    return NextResponse.json(agent);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Record to update not found')) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    console.error('[API] PATCH /api/agents/runtime error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/agents/runtime
 * Get runtime config for all agents.
 */
export async function GET() {
  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      role: true,
      status: true,
      runtimeMode: true,
      providerPrimary: true,
      modelPrimary: true,
      providerFallback: true,
      modelFallback: true,
    },
    orderBy: { id: 'asc' },
  });

  return NextResponse.json(agents);
}
