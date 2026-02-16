/**
 * @module token-utils
 * @description
 * Utilities for persisting Railway OAuth tokens to .env files
 * and distributing access tokens to OpenClaw agent workspaces.
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const OPENCLAW_DIR = '/home/neg0/.openclaw';
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
const MC_ENV_PATH = path.join(process.cwd(), '.env');

// ---------------------------------------------------------------------------
// .env file manipulation
// ---------------------------------------------------------------------------

/**
 * Update (or append) a single KEY=value in a .env file.
 * - If the key already exists, its value is replaced in-place.
 * - If the key does not exist, a new line is appended.
 * - Preserves all other content and comments.
 */
export async function updateEnvVar(
  envPath: string,
  key: string,
  value: string,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    // File doesn't exist yet — we'll create it
    content = '';
  }

  const regex = new RegExp(`^${key}=.*$`, 'm');

  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    // Ensure there's a trailing newline before appending
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += `${key}=${value}\n`;
  }

  await writeFile(envPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Agent workspace discovery
// ---------------------------------------------------------------------------

interface OpenClawAgent {
  id: string;
  workspace: string;
}

/**
 * Read openclaw.json and return the list of agent workspace paths.
 */
export async function getAgentWorkspaces(): Promise<string[]> {
  const raw = await readFile(OPENCLAW_CONFIG, 'utf-8');
  const config = JSON.parse(raw);
  const agents: OpenClawAgent[] = config?.agents?.list ?? [];
  return agents.map((a) => a.workspace).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Token distribution
// ---------------------------------------------------------------------------

/**
 * Write RAILWAY_TOKEN=<token> into every agent workspace's .env file.
 * Logs successes and failures but does not throw on individual failures
 * so one broken workspace doesn't block the rest.
 */
export async function distributeTokenToAgents(
  token: string,
): Promise<{ updated: string[]; failed: string[] }> {
  const workspaces = await getAgentWorkspaces();
  const updated: string[] = [];
  const failed: string[] = [];

  for (const ws of workspaces) {
    const envPath = path.join(ws, '.env');
    try {
      await updateEnvVar(envPath, 'RAILWAY_TOKEN', token);
      updated.push(ws);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[TokenDistribute] Failed to update ${envPath}:`, err);
      failed.push(ws);
    }
  }

  return { updated, failed };
}

/**
 * Persist tokens to Mission Control's own .env and update process.env in-memory.
 */
export async function persistMCTokens(
  accessToken: string,
  refreshToken?: string,
): Promise<void> {
  await updateEnvVar(MC_ENV_PATH, 'RAILWAY_TOKEN', accessToken);
  process.env.RAILWAY_TOKEN = accessToken;

  if (refreshToken) {
    await updateEnvVar(MC_ENV_PATH, 'RAILWAY_REFRESH_TOKEN', refreshToken);
    process.env.RAILWAY_REFRESH_TOKEN = refreshToken;
  }
}
