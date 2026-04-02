/**
 * @module system-prompt
 * @description
 * Builds the system prompt for a native-mode agent by loading workspace files
 * (SOUL.md, IDENTITY.md, HEARTBEAT.md, USER.md) and appending MC context.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/prisma';

/**
 * Load a workspace markdown file, returning empty string if not found.
 */
async function loadWorkspaceFile(workspacePath: string, filename: string): Promise<string> {
  try {
    return await readFile(join(workspacePath, filename), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Load SOUL.md content for a native-mode agent.
 * Prefers Agent.soulContent from DB; falls back to filesystem with a deprecation warning.
 */
async function loadSoulContent(agentId: string, workspacePath: string): Promise<string> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { soulContent: true },
  });

  if (agent?.soulContent) {
    return agent.soulContent;
  }

  // Filesystem fallback
  const content = await loadWorkspaceFile(workspacePath, 'SOUL.md');
  if (content) {
    console.warn(
      `[DEPRECATION] Agent "${agentId}" soulContent loaded from filesystem. ` +
        `Migrate SOUL.md content to Agent.soulContent in the database.`
    );
  }
  return content;
}

/**
 * Load system prompt for a native-mode agent.
 * Prefers Agent.systemPrompt from DB; falls back to building from workspace files.
 */
async function loadSystemPromptFromDb(agentId: string): Promise<string | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { systemPrompt: true },
  });

  return agent?.systemPrompt ?? null;
}

/**
 * Build the full system prompt for an agent.
 * @param workspacePath - Path to the agent's workspace directory
 * @param mcContext - Context string from buildHeartbeatContext()
 * @param agentId - Optional agent ID; when provided, prefers DB columns over filesystem
 */
export async function buildSystemPrompt(
  workspacePath: string,
  mcContext?: string,
  agentId?: string,
): Promise<string> {
  // If agentId provided and DB has a stored systemPrompt, use it directly
  if (agentId) {
    const stored = await loadSystemPromptFromDb(agentId);
    if (stored) {
      const sections: string[] = [stored];
      if (mcContext) {
        sections.push(`\n---\n## Current Context\n\n${mcContext}`);
      }
      return sections.join('\n');
    }
    console.warn(
      `[DEPRECATION] Agent "${agentId}" systemPrompt loaded from filesystem. ` +
        `Migrate system prompt content to Agent.systemPrompt in the database.`
    );
  }

  // Build from workspace files (soul from DB if agentId known, otherwise filesystem)
  const soulPromise = agentId
    ? loadSoulContent(agentId, workspacePath)
    : loadWorkspaceFile(workspacePath, 'SOUL.md');

  const [soul, identity, heartbeat, user, tools] = await Promise.all([
    soulPromise,
    loadWorkspaceFile(workspacePath, 'IDENTITY.md'),
    loadWorkspaceFile(workspacePath, 'HEARTBEAT.md'),
    loadWorkspaceFile(workspacePath, 'USER.md'),
    loadWorkspaceFile(workspacePath, 'TOOLS.md'),
  ]);

  const sections: string[] = [];

  if (soul) sections.push(soul);
  if (identity) sections.push(`\n---\n${identity}`);
  if (heartbeat) sections.push(`\n---\n${heartbeat}`);
  if (user) sections.push(`\n---\n${user}`);
  if (tools) sections.push(`\n---\n${tools}`);

  // MC-specific instructions
  sections.push(`
---
## Mission Control Integration

You are running in MC Native Mode. You have direct access to Mission Control tools:

- **mc_journal** — Log what you did and what's next (REQUIRED every session)
- **mc_escalate** — Escalate issues to the human operator
- **mc_delegate** — Assign tasks to other agents in the fleet
- **mc_message** — Send messages to other agents or the operator

### Rules
1. Always write a journal entry at the end of your session using mc_journal.
2. If you encounter a blocker you cannot resolve, escalate it.
3. If a task would be better handled by another agent, delegate it.
4. Prefer small, focused actions over large, risky changes.
5. When modifying code, always verify with appropriate checks (lint, typecheck, tests).
`);

  if (mcContext) {
    sections.push(`\n---\n## Current Context\n\n${mcContext}`);
  }

  return sections.join('\n');
}
