/**
 * @module session-store
 * @description
 * Session persistence using JSONL files. Each message in a conversation
 * is appended as a single JSON line, making sessions append-only and
 * compatible with OpenClaw's session format.
 */

import { existsSync } from 'fs';
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { ChatMessage } from './providers';

const SESSION_DIR = 'sessions';

function sessionPath(workspacePath: string, sessionId: string): string {
  return join(workspacePath, SESSION_DIR, `${sessionId}.jsonl`);
}

/**
 * Load all messages from a session JSONL file.
 */
export async function loadSession(
  workspacePath: string,
  sessionId: string,
): Promise<ChatMessage[]> {
  const path = sessionPath(workspacePath, sessionId);
  if (!existsSync(path)) return [];

  try {
    const content = await readFile(path, 'utf-8');
    const messages: ChatMessage[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line) as ChatMessage);
      } catch {
        // Skip malformed lines
      }
    }
    return messages;
  } catch {
    return [];
  }
}

/**
 * Append a message to a session JSONL file.
 */
export async function saveMessage(
  workspacePath: string,
  sessionId: string,
  message: ChatMessage,
): Promise<void> {
  const path = sessionPath(workspacePath, sessionId);
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await appendFile(path, JSON.stringify(message) + '\n', 'utf-8');
}

/**
 * Save multiple messages to a session.
 */
export async function saveMessages(
  workspacePath: string,
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  const path = sessionPath(workspacePath, sessionId);
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const content = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  await appendFile(path, content, 'utf-8');
}

/**
 * Replace session content entirely (used after compaction).
 */
export async function replaceSession(
  workspacePath: string,
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  const path = sessionPath(workspacePath, sessionId);
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const content = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  await writeFile(path, content, 'utf-8');
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
