'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useGatewayHealth, type GatewayHealthState } from '../hooks/useGatewayHealth';
import { useGatewayStream } from '../hooks/useGatewayStream';
import { Alert, computeAlerts, type FleetAgent } from '../lib/alerts';

// ─── Types ──────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  label: string;
  path: string;
  model?: string;
  emoji?: string;
}

export interface DashboardGlobal {
  mrr_total: number;
  mrr_delta?: number;
  burn_rate_est: number;
  active_agents: number;
  active_projects: number;
  total_users: number;
  total_fleet: number;
}

export interface FleetMember {
  id: string;
  name: string;
  emoji: string;
  health: 'green' | 'yellow' | 'red' | 'gray';
  status: string;
  last_report: string;
  mrr: number;
  users: number;
  traffic: number;
  cost: number;
  checklist_progress: number;
  last_updated: string | null;
  has_stats: boolean;
}

export interface PipelineIdea {
  id: string;
  name: string;
  bluf: string;
  score: number;
  status: string;
  stage?: string;
  nextStep?: string;
  url: string | null;
  validationDeadline?: string | null;
  validationTarget?: number | null;
  validationMetrics?: { signups?: number; traffic?: number; conversion?: string } | null;
  timeRemaining?: number | null;
  isExpired?: boolean;
  scorecards?: Array<{ category: string; score: number }>;
  sourceUrls?: string[];
}

export interface Blocker {
  agentId: string;
  agentName: string;
  emoji: string;
  blocker: string;
}

export interface DashboardData {
  updated_at: string;
  global: DashboardGlobal;
  pipeline: PipelineIdea[];
  fleet: FleetMember[];
  goals: Array<{ id: string; name: string; status: string; owner: string }>;
  milestones: Array<{ label: string; mrr: number; status: string }>;
  blockers: Blocker[];
  cron: { total: number; ok: number; errors: Array<{ name: string; lastStatus: string }> };
}

export interface MyTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  description?: string | null;
  assigneeId?: string | null;
  assigneeType?: string | null;
  createdAt?: string | null;
  goal?: { id: string; title: string } | null;
  project?: { id: string; name: string } | null;
}

export type GatewayHealthFull = GatewayHealthState & {
  checkHealth: () => Promise<void>;
  controlGateway: (action: 'start' | 'stop' | 'restart') => Promise<void>;
};

interface DashboardContextValue {
  // Data
  dashboardData: DashboardData | null;
  alerts: Alert[];
  myTasks: MyTask[];
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  workspaceHealth: Record<string, 'red' | 'yellow' | 'green' | 'gray'>;

  // Gateway
  gatewayHealth: GatewayHealthFull;
  connected: boolean;
  connecting: boolean;

  // State
  booting: boolean;
  lastSyncLabel: string;

  // Actions
  setActiveWorkspace: (ws: Workspace) => void;
  refreshAlerts: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}

// ─── Helper ─────────────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return `${Math.floor(diff / 604800000)}w ago`;
}

function mapDbGoalToLegacy(dbGoal: { id: string; title: string; status: string; progress: number; ownerAgentId: string | null; createdAt: string; completedAt?: string | null }) {
  const statusMap: Record<string, string> = { complete: '🟢', in_progress: '🟡', blocked: '🔴', queued: '⚪' };
  return {
    id: dbGoal.id,
    title: dbGoal.title,
    status: statusMap[dbGoal.status] || '⚪',
    progress: dbGoal.progress,
    owner: dbGoal.ownerAgentId || 'unassigned',
    blockers: [] as string[],
    created: dbGoal.createdAt?.slice(0, 10),
    completed: dbGoal.completedAt?.slice(0, 10),
    priority: 0,
  };
}

// ─── Provider ───────────────────────────────────────────────────────

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  // Workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [booting, setBooting] = useState(true);

  // Dashboard data
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [workspaceHealth, setWorkspaceHealth] = useState<Record<string, 'red' | 'yellow' | 'green' | 'gray'>>({});

  // Sync
  const [lastSyncTs, setLastSyncTs] = useState<number>(Date.now());
  const [lastSyncLabel, setLastSyncLabel] = useState('just now');

  // Gateway
  const { connected, connecting } = useGatewayStream({
    onEvent: (event) => {
      console.log('[Gateway Event]', event);
    },
  });
  const gatewayHealth = useGatewayHealth();

  // Load workspaces on mount
  useEffect(() => {
    async function loadWorkspaces() {
      try {
        const res = await fetch('/api/workspaces');
        if (res.ok) {
          const data: Workspace[] = await res.json();
          setWorkspaces(data);
          if (data.length > 0 && !activeWorkspace) {
            setActiveWorkspace(data[0]);
          }
        }
      } catch (e) {
        console.error('Failed to load workspaces:', e);
      } finally {
        setBooting(false);
      }
    }
    loadWorkspaces();
  }, []);

  // Fetch dashboard data
  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetch('/api/dashboard');
        if (res.ok) {
          const data = await res.json();
          setDashboardData(data);
        }
      } catch (e) {
        console.error('Failed to load dashboard:', e);
      }
    }
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch My Tasks
  useEffect(() => {
    async function fetchMyTasks() {
      try {
        const [userRes, criticalRes] = await Promise.all([
          fetch('/api/tasks?assigneeId=dustin&excludeStatus=done'),
          fetch('/api/tasks?status=blocked'),
        ]);
        const userTasks: MyTask[] = userRes.ok ? await userRes.json() : [];
        const blockedTasks: MyTask[] = criticalRes.ok ? await criticalRes.json() : [];
        const all = [...userTasks];
        for (const t of blockedTasks) {
          if (!all.find(x => x.id === t.id)) all.push(t);
        }
        const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        all.sort((a, b) => {
          if (a.status === 'blocked' && b.status !== 'blocked') return -1;
          if (b.status === 'blocked' && a.status !== 'blocked') return 1;
          return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
        });
        setMyTasks(all.slice(0, 10));
      } catch { /* silent */ }
    }
    fetchMyTasks();
    const interval = setInterval(fetchMyTasks, 120000);
    return () => clearInterval(interval);
  }, []);

  // Fetch alerts & health
  const refreshAlerts = useCallback(async () => {
    try {
      const agentId = activeWorkspace?.id;
      const goalsUrl = agentId ? `/api/goals?agentId=${encodeURIComponent(agentId)}` : '/api/goals';
      const [prsRes, goalsRes, agentsRes] = await Promise.all([
        fetch('/api/github/prs?repo=neg-0/comp-iq'),
        fetch(goalsUrl),
        fetch('/api/sessions'),
      ]);

      const prsData = prsRes.ok ? await prsRes.json() : { prs: [] };
      const goalsData = goalsRes.ok ? await goalsRes.json() : { goals: [] };
      const agentsData = agentsRes.ok ? await agentsRes.json() : { sessions: [] };

      const prs = prsData.prs || [];
      const goals = (goalsData.goals || []).map(mapDbGoalToLegacy);
      const agents = (agentsData.sessions || []).map((session: { sessionKey: string; status: string; lastActivityMs?: number; label?: string }) => ({
        id: session.sessionKey,
        status: session.status === 'active' ? 'running' : session.status,
        lastActivityMs: session.lastActivityMs,
        label: session.label,
      }));

      // Build fleet agent list for alert computation
      const fleetAgents: FleetAgent[] = (dashboardData?.fleet || []).map(m => ({
        id: m.id,
        name: m.name,
        health: m.health,
        last_report: m.last_report,
      }));

      const currentAlerts = computeAlerts(prs, goals, agents, fleetAgents);
      setAlerts(currentAlerts);

      // Per-workspace health
      const severityOrder: Record<string, number> = { red: 0, yellow: 1, gray: 2, green: 3 };
      const healthMap: Record<string, 'red' | 'yellow' | 'green' | 'gray'> = {};
      const allGoalsRes = await fetch('/api/goals');
      const allGoalsData = allGoalsRes.ok ? await allGoalsRes.json() : { goals: [] };
      const allGoals = (allGoalsData.goals || []).map(mapDbGoalToLegacy);

      for (const ws of workspaces) {
        try {
          const wsGoals = allGoals.filter((g: { owner: string }) => g.owner === ws.id);
          const wsFleet = fleetAgents.filter(f => f.id === ws.id);
          const wsAlerts = computeAlerts(prs, wsGoals, agents, wsFleet);
          let worstLevel: 'red' | 'yellow' | 'green' | 'gray' = 'green';
          for (const a of wsAlerts) {
            if (severityOrder[a.level] < severityOrder[worstLevel]) {
              worstLevel = a.level;
            }
          }
          healthMap[ws.id] = worstLevel;
        } catch {
          healthMap[ws.id] = 'gray';
        }
      }
      setWorkspaceHealth(healthMap);
      setLastSyncTs(Date.now());
      setLastSyncLabel('just now');
    } catch (e) {
      console.error('Failed to compute alerts:', e);
    }
  }, [activeWorkspace, workspaces]);

  useEffect(() => {
    refreshAlerts();
    const interval = setInterval(refreshAlerts, 120000);
    return () => clearInterval(interval);
  }, [refreshAlerts]);

  // Sync label ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setLastSyncLabel(formatRelativeTime(lastSyncTs));
    }, 10000);
    return () => clearInterval(timer);
  }, [lastSyncTs]);

  return (
    <DashboardContext.Provider
      value={{
        dashboardData,
        alerts,
        myTasks,
        workspaces,
        activeWorkspace,
        workspaceHealth,
        gatewayHealth,
        connected,
        connecting,
        booting,
        lastSyncLabel,
        setActiveWorkspace,
        refreshAlerts,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
