/**
 * @module api/knowledge/search
 * @description
 * Semantic search endpoint — "find knowledge similar to X"
 *
 * Uses OpenAI embeddings + cosine similarity when available,
 * falls back to text-based search otherwise.
 *
 * **Endpoint:**
 * - POST /api/knowledge/search
 *
 * **Body:**
 * - `query` — Natural language search query
 * - `limit` — Max results (default 10)
 * - `minSimilarity` — Minimum cosine similarity threshold (default 0.3)
 * - `projectId` — Optional project filter
 * - `category` — Optional category filter
 * - `agentId` — Optional agent filter
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { semanticSearch } from '@/lib/knowledge-engine';
import { formatZodError } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

const SearchSchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).default(10),
  minSimilarity: z.number().min(0).max(1).default(0.3),
  projectId: z.string().nullish(),
  category: z.string().optional(),
  agentId: z.string().optional(),
  includeExpired: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = SearchSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const data = result.data;

    const results = await semanticSearch(data.query, {
      limit: data.limit,
      minSimilarity: data.minSimilarity,
      projectId: data.projectId,
      category: data.category,
      agentId: data.agentId,
      includeExpired: data.includeExpired,
    });

    return NextResponse.json({
      query: data.query,
      results,
      total: results.length,
      method: process.env.OPENAI_API_KEY ? 'semantic' : 'text-fallback',
    });
  } catch (e) {
    console.error('[Knowledge Search]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
