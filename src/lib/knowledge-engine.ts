/**
 * @module lib/knowledge-engine
 * @description
 * Knowledge engine — embedding generation, semantic search, and knowledge propagation.
 *
 * ## Architecture
 * - Embeddings are generated via OpenAI's text-embedding-3-small model
 * - Stored as Float32Array binary in KnowledgeEntry.embedding (Bytes field)
 * - Semantic search computes cosine similarity in-memory (Postgres pgvector can replace later)
 * - Propagation loop notifies relevant agents when new knowledge is created
 * - Gardener process reviews stale/contradictory entries
 *
 * ## Scaling Notes
 * - Current: in-memory cosine similarity (works up to ~10K entries)
 * - Next: pgvector extension for Postgres-native vector search
 * - Future: dedicated vector DB (Pinecone, Qdrant) for 100K+ entries
 *
 * @see {@link module:api/knowledge} for REST endpoints
 * @see {@link module:api/cron/knowledge-propagation} for the propagation cron
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

// =============================================================================
// Types
// =============================================================================

export interface SemanticSearchResult {
  id: string;
  agentId: string;
  content: string;
  category: string;
  projectId: string | null;
  source: string | null;
  similarity: number;
  createdAt: Date;
}

export interface PropagationTarget {
  agentId: string;
  relevanceScore: number;
  reason: string;
}

export interface GardenerReport {
  staleEntries: number;
  duplicateGroups: number;
  totalReviewed: number;
  actions: Array<{
    entryId: string;
    action: 'flagged_stale' | 'flagged_duplicate' | 'flagged_contradictory';
    detail: string;
  }>;
}

// =============================================================================
// Embedding Generation
// =============================================================================

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate an embedding vector for text content using OpenAI API.
 * Returns null if the API key is not configured.
 */
export async function generateEmbedding(
  text: string
): Promise<Float32Array | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[Knowledge] OPENAI_API_KEY not set — skipping embedding generation');
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.substring(0, 8000), // API limit
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[Knowledge] Embedding API error:', err);
      return null;
    }

    const data = await response.json();
    const vector = data.data?.[0]?.embedding as number[];
    if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
      console.error('[Knowledge] Unexpected embedding dimensions:', vector?.length);
      return null;
    }

    return new Float32Array(vector);
  } catch (e) {
    console.error('[Knowledge] Embedding generation failed:', e);
    return null;
  }
}

/**
 * Convert Float32Array to Buffer for Prisma Bytes field storage.
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/**
 * Convert Buffer from Prisma Bytes field back to Float32Array.
 */
export function bufferToEmbedding(buffer: Buffer | Uint8Array): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Semantic search: find knowledge entries most similar to the query.
 *
 * @param query - Natural language search query
 * @param options - Search options
 * @returns Ranked results with similarity scores
 */
export async function semanticSearch(
  query: string,
  options: {
    limit?: number;
    minSimilarity?: number;
    projectId?: string | null;
    category?: string;
    agentId?: string;
    includeExpired?: boolean;
  } = {}
): Promise<SemanticSearchResult[]> {
  const {
    limit = 10,
    minSimilarity = 0.3,
    projectId,
    category,
    agentId,
    includeExpired = false,
  } = options;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    // Fallback to text search if embeddings unavailable
    return fallbackTextSearch(query, { limit, projectId, category, agentId });
  }

  // Fetch all entries with embeddings
  const where: Prisma.KnowledgeEntryWhereInput = {
    embedding: { not: null },
  };

  if (projectId) where.projectId = projectId === 'global' ? null : projectId;
  if (category) where.category = category;
  if (agentId) where.agentId = agentId;
  if (!includeExpired) {
    where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];
  }

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    select: {
      id: true,
      agentId: true,
      content: true,
      category: true,
      projectId: true,
      source: true,
      embedding: true,
      createdAt: true,
    },
  });

  // Compute similarities
  const results: SemanticSearchResult[] = [];

  for (const entry of entries) {
    if (!entry.embedding) continue;

    const entryEmbedding = bufferToEmbedding(entry.embedding);
    const similarity = cosineSimilarity(queryEmbedding, entryEmbedding);

    if (similarity >= minSimilarity) {
      results.push({
        id: entry.id,
        agentId: entry.agentId,
        content: entry.content,
        category: entry.category,
        projectId: entry.projectId,
        source: entry.source,
        similarity: Math.round(similarity * 1000) / 1000,
        createdAt: entry.createdAt,
      });
    }
  }

  // Sort by similarity descending, take top N
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

/**
 * Fallback text-based search when embeddings are unavailable.
 */
async function fallbackTextSearch(
  query: string,
  options: {
    limit: number;
    projectId?: string | null;
    category?: string;
    agentId?: string;
  }
): Promise<SemanticSearchResult[]> {
  const where: Prisma.KnowledgeEntryWhereInput = {
    content: { contains: query, mode: 'insensitive' },
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };

  if (options.projectId) {
    where.projectId = options.projectId === 'global' ? null : options.projectId;
  }
  if (options.category) where.category = options.category;
  if (options.agentId) where.agentId = options.agentId;

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options.limit,
  });

  return entries.map((entry: { id: string; agentId: string; content: string; category: string; projectId: string | null; source: string | null; createdAt: Date }) => ({
    id: entry.id,
    agentId: entry.agentId,
    content: entry.content,
    category: entry.category,
    projectId: entry.projectId,
    source: entry.source,
    similarity: 0.5, // Flat score for text matches
    createdAt: entry.createdAt,
  }));
}

// =============================================================================
// Embedding Refresh
// =============================================================================

/**
 * Generate/refresh embeddings for entries that don't have them.
 * Called by the propagation cron or manually.
 *
 * @returns Number of entries updated
 */
export async function refreshEmbeddings(batchSize = 50): Promise<number> {
  const entries = await prisma.knowledgeEntry.findMany({
    where: { embedding: null },
    orderBy: { createdAt: 'desc' },
    take: batchSize,
    select: { id: true, content: true },
  });

  let updated = 0;

  for (const entry of entries) {
    const embedding = await generateEmbedding(entry.content);
    if (embedding) {
      await prisma.knowledgeEntry.update({
        where: { id: entry.id },
        data: { embedding: embeddingToBuffer(embedding) },
      });
      updated++;
    }
  }

  return updated;
}

// =============================================================================
// Knowledge Propagation
// =============================================================================

/**
 * Determine which agents should be notified about a new knowledge entry.
 * Uses project affiliation and category relevance.
 */
export async function findPropagationTargets(
  entry: {
    agentId: string;
    projectId: string | null;
    category: string;
    content: string;
  }
): Promise<PropagationTarget[]> {
  const targets: PropagationTarget[] = [];

  // Get all active agents except the creator
  const agents = await prisma.agent.findMany({
    where: {
      status: 'active',
      NOT: { id: entry.agentId },
    },
    select: { id: true, role: true },
  });

  for (const agent of agents) {
    let relevanceScore = 0;
    const reasons: string[] = [];

    // Global knowledge is relevant to all agents
    if (!entry.projectId) {
      relevanceScore += 0.3;
      reasons.push('global knowledge');
    }

    // Decisions and lessons are high-value for everyone
    if (['decision', 'lesson', 'playbook'].includes(entry.category)) {
      relevanceScore += 0.4;
      reasons.push(`high-value category: ${entry.category}`);
    }

    // Facts are moderate value
    if (entry.category === 'fact') {
      relevanceScore += 0.2;
      reasons.push('fact');
    }

    // Blockers are urgent
    if (entry.category === 'blocker') {
      relevanceScore += 0.5;
      reasons.push('blocker alert');
    }

    // Only propagate if relevance is above threshold
    if (relevanceScore >= 0.3) {
      targets.push({
        agentId: agent.id,
        relevanceScore: Math.round(relevanceScore * 100) / 100,
        reason: reasons.join(', '),
      });
    }
  }

  // Sort by relevance
  targets.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return targets;
}

/**
 * Propagate a knowledge entry to relevant agents via MC message bus.
 */
export async function propagateKnowledge(
  entryId: string
): Promise<{ notified: number; targets: string[] }> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) return { notified: 0, targets: [] };

  const targets = await findPropagationTargets(entry);
  const notifiedAgents: string[] = [];

  for (const target of targets) {
    await prisma.messageLog.create({
      data: {
        fromId: entry.agentId,
        toId: target.agentId,
        channel: 'knowledge',
        body: `New ${entry.category} from ${entry.agentId}: ${entry.content.substring(0, 150)}`,
        metadata: {
          knowledgeId: entry.id,
          fromAgent: entry.agentId,
          category: entry.category,
          relevanceScore: String(target.relevanceScore),
          reason: target.reason,
        },
      },
    });
    notifiedAgents.push(target.agentId);
  }

  return { notified: notifiedAgents.length, targets: notifiedAgents };
}

// =============================================================================
// Gardener — Knowledge Health Review
// =============================================================================

/**
 * Gardener review: scan the knowledge base for stale, duplicate,
 * or potentially contradictory entries.
 */
export async function gardenerReview(): Promise<GardenerReport> {
  const actions: GardenerReport['actions'] = [];

  // 1. Find stale entries (older than 90 days, no expiry, category=learned)
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - 90);

  const staleEntries = await prisma.knowledgeEntry.findMany({
    where: {
      createdAt: { lt: staleThreshold },
      expiresAt: null,
      category: { in: ['learned', 'blocker'] },
    },
    select: { id: true, content: true, category: true, agentId: true },
  });

  for (const entry of staleEntries) {
    actions.push({
      entryId: entry.id,
      action: 'flagged_stale',
      detail: `${entry.category} entry by ${entry.agentId} is ${Math.floor((Date.now() - staleThreshold.getTime()) / 86400000 + 90)} days old`,
    });
  }

  // 2. Find potential duplicates (same agent, same category, similar first 50 chars)
  const allEntries = await prisma.knowledgeEntry.findMany({
    where: {
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, content: true, category: true, agentId: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const seen = new Map<string, string>();
  let duplicateGroups = 0;

  for (const entry of allEntries) {
    const fingerprint = `${entry.agentId}:${entry.category}:${entry.content.substring(0, 60).toLowerCase()}`;
    const existing = seen.get(fingerprint);

    if (existing) {
      actions.push({
        entryId: entry.id,
        action: 'flagged_duplicate',
        detail: `Likely duplicate of ${existing} (same agent, category, and content prefix)`,
      });
      duplicateGroups++;
    } else {
      seen.set(fingerprint, entry.id);
    }
  }

  return {
    staleEntries: staleEntries.length,
    duplicateGroups,
    totalReviewed: allEntries.length,
    actions,
  };
}
