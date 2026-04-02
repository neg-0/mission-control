/**
 * @module session-store
 * @description
 * Session persistence backed by Postgres via Prisma. Each message in a
 * conversation is stored as a row in agent_messages, linked to an AgentSession.
 *
 * The workspacePath parameter is retained in all signatures for backwards
 * compatibility but is no longer used for storage.
 */

import { prisma } from '../prisma';
import type { ChatMessage } from './providers';

// =============================================================================
// Internal helpers
// =============================================================================

function messageToData(
  sessionId: string,
  msg: ChatMessage,
): { sessionId: string; role: string; content: string | null; metadata: object | null } {
  const { role, content, ...rest } = msg;
  return {
    sessionId,
    role,
    content: content ?? null,
    metadata: Object.keys(rest).length > 0 ? (rest as object) : null,
  };
}

function recordToMessage(record: {
  role: string;
  content: string | null;
  metadata: unknown;
}): ChatMessage {
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  return { role: record.role, content: record.content, ...meta } as ChatMessage;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Load all messages for a session, ordered by insertion time.
 */
export async function loadSession(
  _workspacePath: string,
  sessionId: string,
): Promise<ChatMessage[]> {
  try {
    const rows = await prisma.agentMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(recordToMessage);
  } catch (err) {
    console.warn('[session-store] loadSession failed:', err);
    return [];
  }
}

/**
 * Persist a single message to the session.
 */
export async function saveMessage(
  _workspacePath: string,
  sessionId: string,
  message: ChatMessage,
): Promise<void> {
  try {
    await prisma.agentMessage.create({ data: messageToData(sessionId, message) });
  } catch (err) {
    console.warn('[session-store] saveMessage failed:', err);
  }
}

/**
 * Persist multiple messages to the session in one batch.
 */
export async function saveMessages(
  _workspacePath: string,
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  try {
    await prisma.agentMessage.createMany({
      data: messages.map((m) => messageToData(sessionId, m)),
    });
  } catch (err) {
    console.warn('[session-store] saveMessages failed:', err);
  }
}

/**
 * Replace session content entirely (used after compaction).
 * Deletes all existing messages then inserts the new set atomically.
 */
export async function replaceSession(
  _workspacePath: string,
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.agentMessage.deleteMany({ where: { sessionId } });
      if (messages.length > 0) {
        await tx.agentMessage.createMany({
          data: messages.map((m) => messageToData(sessionId, m)),
        });
      }
    });
  } catch (err) {
    console.warn('[session-store] replaceSession failed:', err);
  }
}

/**
 * Estimate token count for a set of messages (~4 chars per token).
 */
export function estimateTokenCount(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += (m.content || '').length;
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        chars += tc.arguments.length + tc.name.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}
