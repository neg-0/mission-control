import type { Goal } from './goals';

export type AlertLevel = 'red' | 'yellow' | 'green';

export interface Alert {
  level: AlertLevel;
  message: string;
  source: 'pr' | 'goal' | 'agent';
  id: string;
}

export interface PR {
  id: number;
  title: string;
  ci: 'passing' | 'failed' | 'pending' | 'skipped';
  reviewState: 'approved' | 'changes_requested' | 'pending' | 'dismissed';
  updatedAt?: string;
  unresolvedComments?: number;
  url?: string;
  owner?: string;
}

export interface Agent {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'idle' | 'active';
  lastActivityMs?: number;
  label?: string;
}

function ageMs(timestamp?: string): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return null;
  return Date.now() - parsed;
}

export function computeAlerts(prs: PR[], goals: Goal[], agents: Agent[]): Alert[] {
  const alerts: Alert[] = [];

  const hours = (count: number) => count * 60 * 60 * 1000;
  const days = (count: number) => count * 24 * 60 * 60 * 1000;

  // PR alerts
  for (const pr of prs) {
    const prAge = ageMs(pr.updatedAt);

    if (pr.ci === 'failed' && prAge !== null && prAge > hours(24)) {
      alerts.push({
        id: `pr-${pr.id}-ci-failed`,
        level: 'red',
        source: 'pr',
        message: `PR #${pr.id} has failing CI for >24h`,
      });
    }

    if (pr.reviewState === 'pending' && prAge !== null && prAge > hours(48)) {
      alerts.push({
        id: `pr-${pr.id}-needs-review`,
        level: 'yellow',
        source: 'pr',
        message: `PR #${pr.id} needs review for >48h`,
      });
    }
  }

  // Goal alerts
  for (const goal of goals) {
    const goalAge = ageMs(goal.created);

    if (goal.status === '🔴' && goalAge !== null && goalAge > days(3)) {
      alerts.push({
        id: `${goal.id}-blocked`,
        level: 'red',
        source: 'goal',
        message: `${goal.id} blocked for >3 days`,
      });
    }

    if (goal.status === '🟡' && goal.progress < 100 && goalAge !== null && goalAge > days(2)) {
      alerts.push({
        id: `${goal.id}-stalled`,
        level: 'yellow',
        source: 'goal',
        message: `${goal.id} has no progress for >2 days`,
      });
    }
  }

  // Agent alerts (basic)
  for (const agent of agents) {
    if (agent.status === 'failed') {
      alerts.push({
        id: `agent-${agent.id}-failed`,
        level: 'red',
        source: 'agent',
        message: `Agent ${agent.label || agent.id} failed`,
      });
    }
  }

  if (alerts.length === 0) {
    alerts.push({
      id: 'all-clear',
      level: 'green',
      source: 'agent',
      message: 'All clear',
    });
  }

  return alerts;
}
