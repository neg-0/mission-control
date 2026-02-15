import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';

export interface Workspace {
  id: string;
  label: string;
  path: string;
  model?: string;
  emoji?: string;
}

const OPENCLAW_CONFIG = '/home/neg0/.openclaw/openclaw.json';

// Cache with TTL to avoid reading the file on every request
let cache: { workspaces: Workspace[]; ts: number } | null = null;
const CACHE_TTL = 30_000; // 30 seconds

async function loadWorkspaces(): Promise<Workspace[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return cache.workspaces;
  }
  try {
    const raw = await readFile(OPENCLAW_CONFIG, 'utf-8');
    const cfg = JSON.parse(raw);
    const agentList: Array<{
      id: string;
      name: string;
      workspace?: string;
      model?: string;
      identity?: { name?: string; emoji?: string };
    }> = cfg?.agents?.list || [];

    const workspaces: Workspace[] = agentList
      .filter(a => a.workspace) // skip any agent without a workspace
      .map(a => ({
        id: a.id,
        label: a.identity?.name
          ? `${a.identity.emoji || ''} ${a.identity.name}`.trim()
          : a.name,
        path: a.workspace!,
        model: a.model,
        emoji: a.identity?.emoji,
      }));

    cache = { workspaces, ts: Date.now() };
    return workspaces;
  } catch (e) {
    console.error('Failed to load agents from openclaw.json:', e);
    return cache?.workspaces || [];
  }
}

export async function GET() {
  const workspaces = await loadWorkspaces();
  return NextResponse.json(workspaces);
}
