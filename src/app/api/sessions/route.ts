import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';

// Agent config paths — derived from gateway health data
const AGENTS_ROOT = '/home/neg0/.openclaw/agents';

interface AgentConfig {
  agentId: string;
  name: string;
  sessionsPath: string;
}

// Known agents (from openclaw.json config)
const AGENTS: AgentConfig[] = [
  {
    agentId: 'rocket',
    name: 'Rocket (Master CEO)',
    sessionsPath: path.join(AGENTS_ROOT, 'rocket/sessions/sessions.json'),
  },
  {
    agentId: 'captain',
    name: 'Captain (ShipLog CEO)',
    sessionsPath: path.join(AGENTS_ROOT, 'captain/sessions/sessions.json'),
  },
];

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

export async function GET() {
  const sessions: Array<{
    sessionKey: string;
    label: string;
    status: string;
    lastActivityMs: number;
    agentId: string;
    agentName: string;
    kind: string;
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
        });
      }
    } catch (e) {
      console.error(`Failed to read sessions for ${agent.agentId}:`, e);
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
