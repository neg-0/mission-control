/**
 * @module api/knowledge/[id]
 * @description
 * Single knowledge entry operations — GET detail, PATCH update, DELETE.
 *
 * **Endpoints:**
 * - GET    /api/knowledge/:id — Get a single entry
 * - PATCH  /api/knowledge/:id — Update content, category, tags, expiry
 * - DELETE /api/knowledge/:id — Soft-expire (set expiresAt to now) or hard delete
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formatZodError } from '@/lib/schemas';

// =============================================================================
// Validation
// =============================================================================

const UpdateKnowledgeSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  category: z
    .enum(['learned', 'fact', 'decision', 'lesson', 'playbook', 'blocker'])
    .optional(),
  tags: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().nullish(),
  source: z
    .enum(['reflection', 'compaction', 'manual', 'delegation', 'propagation'])
    .optional(),
});

// =============================================================================
// GET /api/knowledge/:id
// =============================================================================

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const entry = await prisma.knowledgeEntry.findUnique({ where: { id } });

    if (!entry) {
      return NextResponse.json(
        { error: `Knowledge entry not found: ${id}` },
        { status: 404 }
      );
    }

    return NextResponse.json(entry);
  } catch (e) {
    console.error('[Knowledge GET/:id]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// PATCH /api/knowledge/:id
// =============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const result = UpdateKnowledgeSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const data = result.data;

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (data.content !== undefined) {
      let content = data.content;
      if (data.tags && data.tags.length > 0) {
        const tagLine = data.tags.map((t) => `#${t}`).join(' ');
        content = `${content}\n\nTags: ${tagLine}`;
      }
      updateData.content = content;
    }

    if (data.category !== undefined) updateData.category = data.category;
    if (data.source !== undefined) updateData.source = data.source;
    if (data.expiresAt !== undefined) {
      updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    }

    // Clear embedding when content changes (will be re-generated)
    if (data.content !== undefined) {
      updateData.embedding = null;
    }

    const entry = await prisma.knowledgeEntry.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(entry);
  } catch (e) {
    console.error('[Knowledge PATCH/:id]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// DELETE /api/knowledge/:id
// =============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const hard = searchParams.get('hard') === 'true';

    if (hard) {
      await prisma.knowledgeEntry.delete({ where: { id } });
      return NextResponse.json({ deleted: true, id });
    }

    // Soft delete: set expiresAt to now
    const entry = await prisma.knowledgeEntry.update({
      where: { id },
      data: { expiresAt: new Date() },
    });

    return NextResponse.json({ expired: true, entry });
  } catch (e) {
    console.error('[Knowledge DELETE/:id]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
