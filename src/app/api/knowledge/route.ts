/**
 * @module api/knowledge
 * @description
 * Knowledge API — CRUD + search for the shared knowledge base.
 *
 * **Endpoints:**
 * - GET  /api/knowledge — Search/list knowledge entries
 * - POST /api/knowledge — Create a new knowledge entry
 *
 * **Query params (GET):**
 * - `q` — Full-text search across content
 * - `agentId` — Filter by creator agent
 * - `projectId` — Filter by project (null = global)
 * - `category` — Filter by type: learned, fact, decision, lesson, playbook, blocker
 * - `source` — Filter by source: reflection, compaction, manual, delegation, propagation
 * - `tags` — Comma-separated tag filter
 * - `limit` — Max results (default 50)
 * - `offset` — Pagination offset
 * - `includeExpired` — Include entries past their expiresAt (default false)
 *
 * @see {@link module:lib/knowledge-engine} for semantic search and propagation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formatZodError } from '@/lib/schemas';

// =============================================================================
// Validation
// =============================================================================

const CreateKnowledgeSchema = z.object({
  agentId: z.string().min(1),
  content: z.string().min(1).max(10000),
  category: z
    .enum(['learned', 'fact', 'decision', 'lesson', 'playbook', 'blocker'])
    .default('learned'),
  projectId: z.string().nullish(),
  source: z
    .enum(['reflection', 'compaction', 'manual', 'delegation', 'propagation'])
    .default('manual'),
  tags: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().nullish(),
  metadata: z.record(z.string(), z.string()).optional(),
});

// =============================================================================
// GET /api/knowledge — Search/list entries
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const agentId = searchParams.get('agentId');
    const projectId = searchParams.get('projectId');
    const category = searchParams.get('category');
    const source = searchParams.get('source');
    const tags = searchParams.get('tags');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const includeExpired = searchParams.get('includeExpired') === 'true';

    // Build where clause
    const where: Record<string, unknown> = {};

    if (agentId) where.agentId = agentId;
    if (projectId) where.projectId = projectId === 'global' ? null : projectId;
    if (category) where.category = category;
    if (source) where.source = source;

    // Full-text search on content
    if (q) {
      where.content = { contains: q, mode: 'insensitive' };
    }

    // Tag filtering (stored in content as #tag format or in metadata)
    if (tags) {
      const tagList = tags.split(',').map((t) => t.trim());
      where.AND = tagList.map((tag) => ({
        content: { contains: `#${tag}`, mode: 'insensitive' as const },
      }));
    }

    // Exclude expired unless requested
    if (!includeExpired) {
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ];
    }

    const [entries, total] = await Promise.all([
      prisma.knowledgeEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.knowledgeEntry.count({ where }),
    ]);

    return NextResponse.json({
      entries,
      total,
      limit,
      offset,
      hasMore: offset + entries.length < total,
    });
  } catch (e) {
    console.error('[Knowledge GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// POST /api/knowledge — Create a new entry
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = CreateKnowledgeSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const data = result.data;

    // Append tags to content as #tag markers (for text search)
    let content = data.content;
    if (data.tags.length > 0) {
      const tagLine = data.tags.map((t) => `#${t}`).join(' ');
      content = `${content}\n\nTags: ${tagLine}`;
    }

    const entry = await prisma.knowledgeEntry.create({
      data: {
        agentId: data.agentId,
        content,
        category: data.category,
        projectId: data.projectId || null,
        source: data.source,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });

    // Log to MessageLog for audit
    await prisma.messageLog.create({
      data: {
        fromId: data.agentId,
        toId: 'system',
        channel: 'knowledge',
        body: `New ${data.category}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`,
        metadata: {
          knowledgeId: entry.id,
          category: data.category,
          source: data.source,
          tags: data.tags.join(','),
        },
      },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (e) {
    console.error('[Knowledge POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
