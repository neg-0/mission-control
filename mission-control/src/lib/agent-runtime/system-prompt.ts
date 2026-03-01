/**
 * @module system-prompt
 * @description
 * Builds the system prompt for a native-mode agent by loading workspace files
 * (SOUL.md, IDENTITY.md, HEARTBEAT.md, USER.md) and appending MC context.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

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
 * Build the full system prompt for an agent.
 * @param workspacePath - Path to the agent's workspace directory
 * @param mcContext - Context string from buildHeartbeatContext()
 */
export async function buildSystemPrompt(
  workspacePath: string,
  mcContext?: string,
): Promise<string> {
  const [soul, identity, heartbeat, user, tools] = await Promise.all([
    loadWorkspaceFile(workspacePath, 'SOUL.md'),
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
