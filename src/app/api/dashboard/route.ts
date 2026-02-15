import { AgentCostSummary, calculateBurnRate } from '@/lib/burn-rate';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';

const OPENCLAW_CONFIG = '/home/neg0/.openclaw/openclaw.json';

// Helper to map status icons
function mapStatusToIcon(status: string): string {
  switch (status) {
    case 'complete': return '🟢';
    case 'in_progress': return '🟡';
    case 'queued': return '⚪';
    case 'blocked': return '🔴';
    default: return '⚪';
  }
}

async function syncAgentsFromConfig() {
  try {
    const raw = await readFile(OPENCLAW_CONFIG, 'utf-8');
    const cfg = JSON.parse(raw);
    const agentList = cfg?.agents?.list || [];

    for (const agent of agentList) {
      const role = agent.identity?.name || agent.name || 'Agent';
      const workspace = agent.workspace || '';
      const emoji = agent.identity?.emoji || '🤖';

      // Upsert agent to ensure they exist in DB
      // We only update static metadata here, not dynamic state (status/heartbeat)
      await prisma.agent.upsert({
        where: { id: agent.id },
        update: {
          role: role,
          workspacePath: workspace
        },
        create: {
          id: agent.id,
          role: role,
          workspacePath: workspace,
          status: 'active'
        }
      });
    }
    return agentList; // Return for emoji lookup
  } catch (e) {
    console.error('Failed to sync agents from openclaw.json:', e);
    return [];
  }
}

export async function GET() {
  try {
    // 0. Sync Config to DB (Auto-discovery)
    const configAgents = await syncAgentsFromConfig();

    // Build emoji map from config
    const emojiMap: Record<string, string> = {};
    for (const agent of configAgents) {
      emojiMap[agent.id] = agent.identity?.emoji || '🤖';
    }
    // Default for rocket
    if (!emojiMap['rocket']) emojiMap['rocket'] = '🚀';

    // 1. Fetch Agents (Fleet)
    const dbAgents = await prisma.agent.findMany({
      include: {
        metrics: {
          orderBy: { recordedAt: 'desc' },
        },
        reports: {
          orderBy: { date: 'desc' },
          take: 1,
        }
      }
    });

    // Calculate real burn rate (hybrid: manual ledger + auto stats)
    const burnRate = await calculateBurnRate();

    // Build agent stats lookup from burn-rate's auto-gathered data
    const agentStatsMap: Record<string, AgentCostSummary> = {};
    for (const ac of burnRate.agentCosts) {
      agentStatsMap[ac.agentId] = ac;
    }

    const fleet = dbAgents.map(agent => {
      const lastReport = agent.reports[0];
      const agentStats = agentStatsMap[agent.id];

      // Look up specific metric types from DB
      const mrrMetric = agent.metrics.find(m => m.type === 'mrr');
      const usersMetric = agent.metrics.find(m => m.type === 'users');

      // Calculate health (Heartbeat check)
      let health = 'gray';
      if (agent.lastHeartbeat) {
        const diff = Date.now() - agent.lastHeartbeat.getTime();
        health = diff < 86400000 ? 'green' : 'yellow';
      }

      return {
        id: agent.id,
        name: agent.role || agent.id,
        role: agent.role,
        emoji: emojiMap[agent.id] || '🤖',
        health,
        status: lastReport?.focus || agent.status,
        mrr: agentStats?.mrr ?? mrrMetric?.value ?? 0,
        users: agentStats?.users ?? usersMetric?.value ?? 0,
        traffic: agentStats?.traffic ?? 0,
        cost: agentStats?.cost ?? 0,
        checklist_progress: 0,
        last_report: lastReport?.focus || '',
        blocker: lastReport?.blockers || null,
        last_updated: agent.lastHeartbeat ? agent.lastHeartbeat.toISOString() : null,
        has_stats: !!agent.lastHeartbeat || agent.metrics.length > 0 || !!lastReport || !!agentStats,
      };
    });

    // 2. Fetch Ideas (The Lab)
    const dbIdeas = await prisma.idea.findMany({
      orderBy: { score: 'desc' },
      include: {
        scorecards: true
      }
    });

    const pipeline = dbIdeas.map(idea => {
      // Compute time remaining for validating ideas
      let timeRemaining: number | null = null;
      let isExpired = false;
      if (idea.status === 'validating' && idea.validationDeadline) {
        const ms = idea.validationDeadline.getTime() - Date.now();
        timeRemaining = Math.max(0, ms);
        isExpired = ms <= 0;
      }

      return {
        id: idea.id,
        name: idea.title,
        bluf: idea.description,
        score: idea.score || 0,
        status: idea.status,
        stage: idea.stage,
        nextStep: idea.status,
        url: null,
        validationDeadline: idea.validationDeadline?.toISOString() ?? null,
        validationTarget: idea.validationTarget ?? null,
        validationMetrics: idea.validationMetrics ?? null,
        timeRemaining,
        isExpired,
      };
    });

    // 4. Goals
    const dbGoals = await prisma.goal.findMany({
      orderBy: { id: 'asc' }
    });

    const goals = dbGoals.map(g => ({
      id: g.id,
      name: g.title,
      status: mapStatusToIcon(g.status),
      owner: g.ownerAgentId || 'rocket'
    }));

    // 5. Global Stats — REAL DATA from burn-rate calculator
    const activeAgents = fleet.filter(a => a.health !== 'gray').length;
    const activeProjects = await prisma.project.count({
      where: { stage: { in: ['launched', 'beta', 'building'] } }
    });

    const global = {
      mrr_total: burnRate.mrr,
      burn_rate_est: burnRate.total,
      active_agents: activeAgents,
      active_projects: activeProjects,
      total_users: burnRate.totalUsers,
      total_fleet: fleet.length,
      total_traffic: burnRate.totalTraffic,
    };

    // Milestones — compute status based on real MRR
    const milestoneThresholds = [
      { label: 'First $1', mrr: 1 },
      { label: 'Ramen Profitable', mrr: 3000 },
      { label: '$1M MRR', mrr: 1000000 },
    ];
    const milestones = milestoneThresholds.map(m => ({
      ...m,
      status: burnRate.mrr >= m.mrr ? '🟢' : '⚪',
    }));

    // Cron health — read from jobs.json
    const cron = { total: 0, ok: 0, errors: [] as string[] };
    try {
      const jobsRaw = await readFile('/home/neg0/.openclaw/cron/jobs.json', 'utf-8');
      const jobsData = JSON.parse(jobsRaw);
      const jobs = jobsData.jobs || [];
      cron.total = jobs.length;
      cron.ok = jobs.filter((j: { enabled: boolean }) => j.enabled).length;
      cron.errors = jobs
        .filter((j: { state?: { lastError?: string } }) => j.state?.lastError)
        .map((j: { name: string; state: { lastError: string } }) => `${j.name}: ${j.state.lastError}`);
    } catch {
      // No cron jobs file
    }

    return NextResponse.json({
      updated_at: new Date().toISOString(),
      global,
      pipeline,
      fleet,
      goals,
      milestones,
      blockers: [],
      cron,
    });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
