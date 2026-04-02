import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';

import { getOpenClawConfigPath } from '@/lib/config';

interface AgentConfig {
  agentId: string;
  name: string;
  sessionsPath: string;
}

interface SessionEntry {
  sessionId?: string;
  updatedAt?: number;
  systemSent?: boolean;
  chatType?: string;
  origin?: {
    label?: string;
    provider?: string;
    surface?: string;
  };
}

// Cached config (agents + models) with TTL
let configCache: {
  agents: AgentConfig[];
  primary: string;
  subagent: string;
  ts: number;
} | null = null;
const CACHE_TTL = 60_000; // 1 minute

async function loadConfig(): Promise<{
  agents: AgentConfig[];
  primary: string;
  subagent: string;
}> {
  if (configCache && Date.now() - configCache.ts < CACHE_TTL) {
    return configCache;
  }
  try {
    const raw = await readFile(getOpenClawConfigPath(), 'utf-8');
    const cfg = JSON.parse(raw);

    // Parse agents
    const agentList: Array<{
      id: string;
      name: string;
      agentDir?: string;
    }> = cfg?.agents?.list || [];

    const agents: AgentConfig[] = agentList
      .filter(a => a.agentDir)
      .map(a => ({
        agentId: a.id,
        name: a.name,
        sessionsPath: path.join(a.agentDir!, 'sessions', 'sessions.json'),
      }));

    // Parse models
    const defaults = cfg?.agents?.defaults || {};
    const primary = defaults?.model?.primary || 'unknown';
    const subagent = defaults?.subagents?.model?.primary || primary;

    configCache = { agents, primary, subagent, ts: Date.now() };
    return configCache;
  } catch (e) {
    console.error('Failed to load openclaw.json:', e);
    return configCache || { agents: [], primary: 'unknown', subagent: 'unknown' };
  }
}

export async function GET() {
  const { agents: AGENTS, primary, subagent } = await loadConfig();

  const sessions: Array<{
    sessionKey: string;
    label: string;
    status: string;
    lastActivityMs: number;
    agentId: string;
    agentName: string;
    kind: string;
    model: string;
  }> = [];

  for (const agent of AGENTS) {
    try {
      const raw = await readFile(agent.sessionsPath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, SessionEntry>;

      for (const [key, entry] of Object.entries(data)) {
        // Determine session kind from key pattern
        const kind = key.includes(':cron:')
          ? 'cron'
          : key.includes(':subagent:')
            ? 'subagent'
            : key.includes(':discord:') || key.includes(':slack:')
              ? 'channel'
              : 'main';

        // Derive a human-readable label
        let label = kind.charAt(0).toUpperCase() + kind.slice(1) + ' Session';
        if (kind === 'cron') label = 'Cron Job';
        if (kind === 'subagent') label = 'Sub-Agent';
        if (kind === 'channel' && entry.origin?.provider) {
          label = `${entry.origin.provider.charAt(0).toUpperCase() + entry.origin.provider.slice(1)} Chat`;
        }
        if (kind === 'main') label = 'Main Session';

        // Resolve model: main sessions get the primary, everything else gets subagent
        const model = kind === 'main' ? primary : subagent;

        const ageMs = entry.updatedAt ? Date.now() - entry.updatedAt : Infinity;
        const isActive = ageMs < 5 * 60 * 1000; // Active if updated within 5 minutes

        sessions.push({
          sessionKey: key,
          label,
          status: isActive ? 'active' : 'idle',
          lastActivityMs: entry.updatedAt || 0,
          agentId: agent.agentId,
          agentName: agent.name,
          kind,
          model,
        });
      }
    } catch (e) {
      // Silently skip agents whose sessions file doesn't exist yet
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to read sessions for ${agent.agentId}:`, e);
      }
    }
  }

  // Sort by most recently active
  sessions.sort((a, b) => b.lastActivityMs - a.lastActivityMs);

  return NextResponse.json({
    sessions,
    agents: AGENTS.map(a => ({
      agentId: a.agentId,
      name: a.name,
      sessionCount: sessions.filter(s => s.agentId === a.agentId).length,
    })),
  });
}
