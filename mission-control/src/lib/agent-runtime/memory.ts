/**
 * @module memory
 * @description
 * Three-tier memory system for the MC native agent runtime.
 *
 * Tier 1: Procedural — Markdown files in workspace (SOUL.md, PLAYBOOK.md)
 *   → Handled by system-prompt.ts, loaded every session.
 *
 * Tier 2: Episodic — AgentJournal + Task tables in Prisma DB
 *   → Already handled by build-heartbeat-context.ts.
 *
 * Tier 3: Semantic — KnowledgeEntry table with optional embeddings
 *   → This module. Stores learned facts, decisions, and lessons.
 *   → Searchable by category, project, recency, and (future) vector similarity.
 */

import { prisma } from '@/lib/prisma';

// =============================================================================
// Types
// =============================================================================

export interface KnowledgeWrite {
  agentId: string;
  content: string;
  category?: 'learned' | 'fact' | 'decision' | 'blocker' | 'lesson';
  projectId?: string;
  source?: 'reflection' | 'compaction' | 'manual' | 'delegation';
  expiresAt?: Date;
}

export interface KnowledgeSearchOptions {
  agentId?: string;
  projectId?: string;
  category?: string;
  limit?: number;
  since?: Date;
}

// =============================================================================
// Write Knowledge
// =============================================================================

/**
 * Store a knowledge entry in the semantic memory.
 */
export async function writeKnowledge(entry: KnowledgeWrite): Promise<string> {
  const record = await prisma.knowledgeEntry.create({
    data: {
      agentId: entry.agentId,
      content: entry.content,
      category: entry.category || 'learned',
      projectId: entry.projectId || null,
      source: entry.source || 'manual',
      expiresAt: entry.expiresAt || null,
      // Embedding generation deferred to Phase 2 (requires embedding API)
      embedding: null,
    },
  });

  return record.id;
}

// =============================================================================
// Search Knowledge
// =============================================================================

/**
 * Search knowledge entries by category, project, and recency.
 * Phase 1: text matching + filtering. Phase 2 will add vector similarity.
 */
export async function searchKnowledge(
  query: string,
  options: KnowledgeSearchOptions = {},
): Promise<Array<{
  id: string;
  content: string;
  category: string;
  agentId: string;
  source: string | null;
  createdAt: Date;
}>> {
  const where: Record<string, unknown> = {};

  if (options.agentId) where.agentId = options.agentId;
  if (options.projectId) where.projectId = options.projectId;
  if (options.category) where.category = options.category;
  if (options.since) where.createdAt = { gte: options.since };

  // Exclude expired entries
  where.OR = [
    { expiresAt: null },
    { expiresAt: { gt: new Date() } },
  ];

  // Phase 1: simple text search via Prisma contains
  // Phase 2: replace with vector similarity search
  if (query) {
    where.content = { contains: query, mode: 'insensitive' };
  }

  return prisma.knowledgeEntry.findMany({
    where,
    select: {
      id: true,
      content: true,
      category: true,
      agentId: true,
      source: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit || 20,
  });
}

// =============================================================================
// Get Knowledge for Context Injection
// =============================================================================

/**
 * Get relevant knowledge entries for an agent's heartbeat context.
 * Combines agent-specific and project-scoped knowledge.
 */
export async function getKnowledgeContext(
  agentId: string,
  projectId?: string,
  limit: number = 10,
): Promise<string> {
  const entries = await prisma.knowledgeEntry.findMany({
    where: {
      OR: [
        { agentId }, // Agent's own knowledge
        ...(projectId ? [{ projectId }] : []), // Project-shared knowledge
      ],
      // Exclude expired
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      ],
    },
    select: {
      content: true,
      category: true,
      agentId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  if (entries.length === 0) return '';

  const lines = entries.map((e) => {
    const own = e.agentId === agentId ? '' : ` (from ${e.agentId})`;
    return `  - [${e.category}${own}] ${e.content}`;
  });

  return `🧠 KNOWLEDGE BASE (${entries.length} entries):\n${lines.join('\n')}`;
}

// =============================================================================
// Pre-Compaction Memory Flush
// =============================================================================

/**
 * Extract key facts from a conversation before compaction.
 * Called by the agent loop before summarizing old messages.
 * Saves extracted knowledge as "compaction" source entries.
 */
export async function extractPreCompactionKnowledge(
  agentId: string,
  facts: string[],
  projectId?: string,
): Promise<number> {
  let saved = 0;
  for (const fact of facts) {
    if (fact.trim().length < 10) continue; // Skip trivial entries
    await writeKnowledge({
      agentId,
      content: fact.trim(),
      category: 'learned',
      projectId,
      source: 'compaction',
    });
    saved++;
  }
  return saved;
}

// =============================================================================
// Daily Reflection
// =============================================================================

/**
 * Generate a daily reflection prompt for an agent.
 * This is used by a cron schedule to ask agents what they learned.
 */
export function buildReflectionPrompt(agentId: string): string {
  return `
## Daily Reflection

Please review your recent work and extract key learnings:

1. **What worked well?** — approaches, tools, or strategies that were effective
2. **What didn't work?** — things you tried that failed or were suboptimal
3. **Key decisions made** — important choices and their rationale
4. **Facts discovered** — new information about projects, APIs, or systems
5. **Blockers encountered** — issues that slowed or stopped progress

For each insight, use the mc_journal tool to record it.
Format: one clear, factual statement per learning.
Agent: ${agentId}
`;
}
