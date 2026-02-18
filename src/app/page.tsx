'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Flame,
  ListTodo,
  Search,
  Settings,
  X,
  Zap
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AgentGrid } from '../components/AgentGrid';
import { BlockerBanner } from '../components/BlockerBanner';
import { CostBreakdown } from '../components/CostBreakdown';
import { CronHealth } from '../components/CronHealth';
import { DocPreviewButton } from '../components/DocPreviewButton';
import { FileBrowser } from '../components/FileBrowser';
import GatewayOfflineBanner from '../components/GatewayOfflineBanner';
import { GoalsPanel } from '../components/GoalsPanel';
import { LatestJournalEntries } from '../components/LatestJournalEntries';
import { ScheduleManager } from '../components/ScheduleManager';
import { SettingsPage } from '../components/SettingsPage';

import { IdeaDetail } from '../components/IdeaDetail';
import { IdeasKanban } from '../components/IdeasKanban';
import InfraMonitor from '../components/InfraMonitor';
import { MrrMeter } from '../components/MrrMeter';
import { ProjectDetail } from '../components/ProjectDetail';
import { ProjectsGrid } from '../components/ProjectsGrid';
import { SubAgentsPanel } from '../components/SubAgentsPanel';
import TaskBoard from '../components/TaskBoard';
import { WorkspaceSearch } from '../components/WorkspaceSearch';
import { useGatewayHealth } from '../hooks/useGatewayHealth';
import { useGatewayStream } from '../hooks/useGatewayStream';
import { Alert, computeAlerts } from '../lib/alerts';

import { cn } from '../lib/utils';

// Types (Keep existing types)
interface Workspace {
  id: string;
  label: string;
  path: string;
  model?: string;
  emoji?: string;
}

interface DashboardData {
  updated_at: string;
  global: { mrr_total: number; burn_rate_est: number; active_agents: number; active_projects: number; total_users: number; total_fleet: number };
  pipeline: Array<{ id: string; name: string; bluf: string; score: number; status: string; stage?: string; nextStep?: string; url: string | null; validationDeadline?: string | null; validationTarget?: number | null; validationMetrics?: { signups?: number; traffic?: number; conversion?: string } | null; timeRemaining?: number | null; isExpired?: boolean; scorecards?: Array<{ category: string; score: number }>; sourceUrls?: string[] }>;
  fleet: Array<{ id: string; name: string; emoji: string; health: 'green' | 'yellow' | 'red' | 'gray'; status: string; last_report: string; mrr: number; users: number; traffic: number; cost: number; checklist_progress: number; last_updated: string | null; has_stats: boolean }>;
  goals: Array<{ id: string; name: string; status: string; owner: string }>;
  milestones: Array<{ label: string; mrr: number; status: string }>;
  blockers: Array<{ agentId: string; agentName: string; emoji: string; blocker: string }>;
  cron: { total: number; ok: number; errors: Array<{ name: string; lastStatus: string }> };
}

// ... (Keep Helper Functions & Components: formatRelativeTime, AlertLevel, AlertRow, StatCard, WorkspaceSelector, SettingsModal) ...

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return `${Math.floor(diff / 604800000)}w ago`;
}

// --- Small Components ---

function AlertLevel({ level }: { level: string }) {
  const config: Record<string, string> = {
    red: 'led-red',
    yellow: 'led-yellow',
    green: 'led-green',
  };
  return (
    <div className={cn('w-2 h-2 led led-pulse', config[level] || 'led-gray')} />
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div className="flex items-start gap-3 p-3 hover:bg-accent/50 rounded-lg transition-colors">
      <AlertLevel level={alert.level} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{alert.message}</div>
        <div className="text-xs text-muted-foreground mt-0.5">Source: {alert.source}</div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, trend, onClick }: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'glass-card hover-lift p-4 text-left group',
        onClick && 'cursor-pointer',
        trend === 'up' && 'hover:glow-green',
        trend === 'down' && 'hover:glow-red',
        !trend && 'hover:glow-blue'
      )}
    >
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
        <span className={cn(
          'text-2xl font-bold count-up tabular-nums',
          trend === 'up' && 'text-green-400',
          trend === 'down' && 'text-red-400'
        )}>
          {value}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-2">{label}</div>
    </button>
  );
}

// --- Workspace Selector ---

function WorkspaceSelector({ workspaces, active, onSelect, health }: {
  workspaces: Workspace[];
  active: Workspace | null;
  onSelect: (ws: Workspace) => void;
  health?: Record<string, 'red' | 'yellow' | 'green' | 'gray'>;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const showSearch = workspaces.length > 20;

  const ledColor: Record<string, string> = {
    red: 'led-red',
    yellow: 'led-yellow',
    green: 'led-green',
    gray: 'led-gray',
  };

  const filtered = filter.trim()
    ? workspaces.filter(ws =>
      ws.label.toLowerCase().includes(filter.toLowerCase()) ||
      ws.id.toLowerCase().includes(filter.toLowerCase())
    )
    : workspaces;

  useEffect(() => {
    if (open && showSearch) {
      setTimeout(() => filterRef.current?.focus(), 50);
    }
    if (!open) setFilter('');
  }, [open, showSearch]);

  if (workspaces.length === 0) {
    return (
      <div className="text-sm text-muted-foreground px-3 py-2">
        No agents configured
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/50 hover:bg-accent transition-colors border border-border/50 min-w-[160px]"
      >
        {active && health?.[active.id] && (
          <div className={cn('w-2 h-2 led led-pulse shrink-0', ledColor[health[active.id]] || 'led-gray')} />
        )}
        <span className="text-sm font-medium truncate">{active?.label || 'Select agent'}</span>
        <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 glass-card shadow-xl z-50 min-w-[260px] py-1 flex flex-col">
            {showSearch && (
              <div className="px-2 py-1.5 border-b border-border/50">
                <div className="flex items-center gap-2 bg-muted rounded px-2 py-1">
                  <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <input
                    ref={filterRef}
                    type="text"
                    placeholder="Filter agents…"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>
            )}

            <div className="overflow-y-auto max-h-[360px]">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  No agents match &ldquo;{filter}&rdquo;
                </div>
              ) : (
                filtered.map((ws) => {
                  const severity = health?.[ws.id] || 'gray';
                  return (
                    <button
                      key={ws.id}
                      onClick={() => { onSelect(ws); setOpen(false); }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2',
                        active?.id === ws.id && 'bg-primary/10 text-primary'
                      )}
                    >
                      <div className={cn('w-2 h-2 led led-pulse shrink-0', ledColor[severity])} />
                      <span className="truncate">{ws.label}</span>
                      {active?.id === ws.id && <CheckCircle2 className="w-3.5 h-3.5 ml-auto shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            {workspaces.length > 8 && (
              <div className="px-3 py-1.5 border-t border-border/50 text-[10px] text-muted-foreground text-center">
                {filtered.length} of {workspaces.length} agents
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SettingsModal({ onClose, connected, connecting }: {
  onClose: () => void;
  connected: boolean;
  connecting: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="glass-card p-6 w-full max-w-lg mx-4 space-y-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Settings</h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs text-muted-foreground">Gateway URL</label>
            <div className="bg-muted rounded px-3 py-2 font-mono text-xs break-all">
              {process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Gateway Status</label>
            <div className="flex items-center gap-2">
              <div className={cn('w-2 h-2 led', connected ? 'led-green' : 'led-gray')} />
              <span>{connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}</span>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <h3 className="text-sm font-semibold">Agent Config</h3>
          <p className="text-xs text-muted-foreground">
            Agents are auto-populated from <code className="bg-muted px-1 py-0.5 rounded text-[11px]">openclaw.json</code>.
            Edit that file to add or remove agents.
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Main Page ---

function MissionControlInner() {
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<'warroom' | 'ideas' | 'projects' | 'agents' | 'tasks' | 'infra' | 'settings'>(
    (searchParams.get('tab') as 'warroom' | 'ideas' | 'projects' | 'agents' | 'tasks' | 'infra' | 'settings') || 'warroom'
  );
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [searchSelectedFile, setSearchSelectedFile] = useState<string | null>(
    searchParams.get('file')
  );
  const [highlightQuery, setHighlightQuery] = useState<string | null>(
    searchParams.get('q')
  );
  const [lastSyncTs, setLastSyncTs] = useState<number>(Date.now());
  const [lastSyncLabel, setLastSyncLabel] = useState('just now');

  // Workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [booting, setBooting] = useState(true);

  // Gateway connection
  const { connected, connecting } = useGatewayStream({
    onEvent: (event) => {
      console.log('[Gateway Event]', event);
    },
  });

  // Gateway health monitoring
  const gatewayHealth = useGatewayHealth();

  // Stats
  const [stats, setStats] = useState<{
    prsOpen: number | null;
    prsReadyToMerge: number | null;
    prsBlocked: number | null;
    agentsActive: number | null;
  }>({
    prsOpen: null,
    prsReadyToMerge: null,
    prsBlocked: null,
    agentsActive: null,
  });

  // Per-workspace health status for LED indicators
  const [workspaceHealth, setWorkspaceHealth] = useState<Record<string, 'red' | 'yellow' | 'green' | 'gray'>>({});

  // Dashboard data (War Room)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(
    searchParams.get('idea')
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);

  // Agents tab — master/detail state
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentDetailTab, setAgentDetailTab] = useState<'overview' | 'goals' | 'schedule' | 'files'>('overview');
  const [agentSearchQuery, setAgentSearchQuery] = useState('');

  // My Tasks (for War Room)
  interface MyTask { id: string; title: string; status: string; priority: string; description?: string | null; assigneeId?: string | null; assigneeType?: string | null; createdAt?: string | null; goal?: { id: string; title: string } | null; project?: { id: string; name: string } | null }
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // URL sync helper
  function syncUrl(overrides: { tab?: string; agent?: string | null; detail?: string | null; file?: string | null; q?: string | null } = {}) {
    const params = new URLSearchParams(window.location.search);
    const tab = overrides.tab ?? activeTab;
    const updates: Record<string, string | null> = {
      tab,
      agent: ('agent' in overrides ? overrides.agent : (tab === 'agents' ? selectedAgentId : null)) ?? null,
      detail: ('detail' in overrides ? overrides.detail : (tab === 'agents' && selectedAgentId ? agentDetailTab : null)) ?? null,
      file: ('file' in overrides ? overrides.file : searchSelectedFile) ?? null,
      q: ('q' in overrides ? overrides.q : highlightQuery) ?? null,
    };
    // Clear agent/detail when not on agents tab
    if (tab !== 'agents') {
      updates.agent = null;
      updates.detail = null;
    }
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Remove legacy ws param
    params.delete('ws');
    const qs = params.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    if (newUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState({}, '', newUrl);
    }
  }

  // Handle browser back/forward
  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get('tab') as 'warroom' | 'ideas' | 'projects' | 'agents' | 'tasks' | 'infra' | 'settings' | null;
      const urlAgent = params.get('agent');
      const urlDetail = params.get('detail') as 'overview' | 'goals' | 'schedule' | 'files' | null;
      const urlFile = params.get('file');
      const urlQ = params.get('q');
      const urlIdea = params.get('idea');

      if (urlTab) setActiveTab(urlTab);
      if (urlAgent !== selectedAgentId) setSelectedAgentId(urlAgent);
      if (urlDetail) setAgentDetailTab(urlDetail);
      else if (!urlAgent) setAgentDetailTab('overview');
      if (urlFile !== searchSelectedFile) setSearchSelectedFile(urlFile);
      if (urlQ !== highlightQuery) setHighlightQuery(urlQ);
      setSelectedIdeaId(urlIdea);

      // Derive workspace from agent
      if (urlAgent) {
        const ws = workspaces.find(w => w.id === urlAgent);
        if (ws && ws.id !== activeWorkspace?.id) setActiveWorkspace(ws);
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [workspaces, activeWorkspace, selectedAgentId, searchSelectedFile, highlightQuery]);

  // Load workspaces on mount + restore URL state
  useEffect(() => {
    async function loadWorkspaces() {
      try {
        const res = await fetch('/api/workspaces');
        if (res.ok) {
          const data: Workspace[] = await res.json();
          setWorkspaces(data);

          // Restore agent/detail from URL (supports deep links & refresh)
          const urlAgent = searchParams.get('agent') || searchParams.get('ws'); // backward compat
          const urlDetail = searchParams.get('detail') as 'overview' | 'goals' | 'schedule' | 'files' | null;

          if (urlAgent) {
            setSelectedAgentId(urlAgent);
            if (urlDetail) setAgentDetailTab(urlDetail);
            const ws = data.find(w => w.id === urlAgent);
            if (ws) setActiveWorkspace(ws);
          } else if (data.length > 0 && !activeWorkspace) {
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

  // Fetch dashboard data for War Room
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

  // Fetch My Tasks for War Room
  useEffect(() => {
    async function fetchMyTasks() {
      try {
        // Fetch tasks assigned to user (Dustin) or high-priority unassigned
        const [userRes, criticalRes] = await Promise.all([
          fetch('/api/tasks?assigneeId=dustin'),
          fetch('/api/tasks?status=blocked'),
        ]);
        const userTasks: MyTask[] = userRes.ok ? await userRes.json() : [];
        const blockedTasks: MyTask[] = criticalRes.ok ? await criticalRes.json() : [];
        // Merge and deduplicate
        const all = [...userTasks];
        for (const t of blockedTasks) {
          if (!all.find(x => x.id === t.id)) all.push(t);
        }
        // Sort: blocked first, then by priority
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

  // Update "last sync" label
  useEffect(() => {
    const timer = setInterval(() => {
      setLastSyncLabel(formatRelativeTime(lastSyncTs));
    }, 10000);
    return () => clearInterval(timer);
  }, [lastSyncTs]);

  /** Map DB goal record to legacy Goal shape for computeAlerts */
  const mapDbGoalToLegacy = (dbGoal: { id: string; title: string; status: string; progress: number; ownerAgentId: string | null; createdAt: string; completedAt?: string | null }) => {
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
  };

  // Fetch alerts and stats
  const fetchAlerts = useCallback(async () => {
    try {
      // Fetch goals from DB via /api/goals instead of parsing GOALS.md files
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
        status: session.status === 'active' ? 'running' : (session.status as 'running' | 'completed' | 'failed' | 'idle'),
        lastActivityMs: session.lastActivityMs,
        label: session.label,
      }));

      const currentAlerts = computeAlerts(prs, goals, agents);
      setAlerts(currentAlerts);
      setStats({
        prsOpen: prs.length,
        prsReadyToMerge: prs.filter((p: { reviewState: string; ci: string }) => p.reviewState === 'approved' && p.ci === 'passing').length,
        prsBlocked: prs.filter((p: { reviewState: string; ci: string }) => p.reviewState === 'changes_requested' || p.ci === 'failed').length,
        agentsActive: agents.filter((a: { status: string }) => a.status === 'running' || a.status === 'active').length,
      });

      // Compute per-workspace health from DB goals
      const severityOrder: Record<string, number> = { red: 0, yellow: 1, gray: 2, green: 3 };
      const healthMap: Record<string, 'red' | 'yellow' | 'green' | 'gray'> = {};

      // Fetch all goals once, group by owner for per-workspace health
      const allGoalsRes = await fetch('/api/goals');
      const allGoalsData = allGoalsRes.ok ? await allGoalsRes.json() : { goals: [] };
      const allGoals = (allGoalsData.goals || []).map(mapDbGoalToLegacy);

      for (const ws of workspaces) {
        try {
          const wsGoals = allGoals.filter((g: { owner: string }) => g.owner === ws.id);
          const wsAlerts = computeAlerts(prs, wsGoals, agents);
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
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 120000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Handle workspace switch
  function switchWorkspace(ws: Workspace) {
    setActiveWorkspace(ws);
    setSearchSelectedFile(null);
    setHighlightQuery(null);
    syncUrl({ file: null, q: null });
  }

  // Handle search result selecting a file
  function handleSearchSelect(filePath: string, workspacePath: string, query: string) {
    const targetWs = workspaces.find(w => w.path === workspacePath);
    if (targetWs) {
      if (targetWs.id !== activeWorkspace?.id) setActiveWorkspace(targetWs);
      setSelectedAgentId(targetWs.id);
    }
    setSearchSelectedFile(filePath);
    setHighlightQuery(query || null);
    setActiveTab('agents');
    setAgentDetailTab('files');
    syncUrl({
      tab: 'agents',
      agent: targetWs?.id || null,
      detail: 'files',
      file: filePath,
      q: query || null,
    });
  }

  // Handle fleet card click — navigate to Agents tab with agent selected
  function handleFleetSelect(agentId: string) {
    setSelectedAgentId(agentId);
    setAgentDetailTab('overview');
    setActiveTab('agents');
    const ws = workspaces.find(w => w.id === agentId);
    if (ws) setActiveWorkspace(ws);
    syncUrl({ tab: 'agents', agent: agentId, detail: 'overview' });
  }

  return (
    <div className="min-h-screen text-foreground pb-12 relative">
      <div className="mesh-bg fixed inset-0 -z-10">
        <div className="mesh-bg-accent" />
      </div>
      <GatewayOfflineBanner {...gatewayHealth} />
      <header className="sticky top-0 z-50 glass-card rounded-none border-x-0 border-t-0">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center">
          <div className="flex-1 flex items-center">
          </div>

          <h1 className="select-none flex items-center gap-0">
            <span className="text-lg font-light tracking-[0.3em] uppercase text-foreground/70">
              Mission
            </span>
            <span className="mx-2 w-px h-5 bg-foreground/20" />
            <span className="text-xl font-bold tracking-[0.2em] uppercase flex items-center">
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                CONTR
              </span>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                className="inline-block -mx-0.5 relative top-px"
              >
                <circle cx="12" cy="12" r="10" stroke="url(#radar-grad)" strokeWidth="1.5" fill="none" opacity="0.6" />
                <circle cx="12" cy="12" r="6" stroke="url(#radar-grad)" strokeWidth="1.5" fill="none" opacity="0.8" />
                <circle cx="12" cy="12" r="2" stroke="url(#radar-grad)" strokeWidth="1.5" fill="none" />
                <circle cx="14" cy="10" r="2" fill="#22d3ee" className="animate-pulse" />
                <defs>
                  <linearGradient id="radar-grad" x1="0" y1="0" x2="24" y2="24">
                    <stop offset="0%" stopColor="#60a5fa" />
                    <stop offset="100%" stopColor="#22d3ee" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                L
              </span>
            </span>
          </h1>

          <div className="flex-1 flex items-center justify-end gap-3">
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4">
        {booting ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-5xl mb-6 animate-pulse">🛰️</div>
            <h2 className="text-lg font-semibold tracking-widest uppercase text-foreground/90 mb-4"
              style={{ fontFamily: 'var(--font-mono, monospace)' }}>
              Mission Control
            </h2>
            <div className="w-64 h-1 bg-muted rounded-full overflow-hidden mb-6">
              <div className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 rounded-full animate-boot-bar" />
            </div>
            <div className="space-y-1 text-xs text-muted-foreground font-mono">
              <p className="animate-fade-in" style={{ animationDelay: '0ms' }}>▸ Connecting to gateway…</p>
              <p className="animate-fade-in" style={{ animationDelay: '400ms' }}>▸ Scanning workspaces…</p>
              <p className="animate-fade-in" style={{ animationDelay: '800ms' }}>▸ Loading fleet telemetry…</p>
            </div>
            <style jsx>{`
              @keyframes boot-bar {
                0%   { width: 0%; }
                60%  { width: 70%; }
                100% { width: 100%; }
              }
              @keyframes fade-in {
                0%   { opacity: 0; transform: translateY(4px); }
                100% { opacity: 1; transform: translateY(0); }
              }
              .animate-boot-bar {
                animation: boot-bar 2s ease-out forwards;
              }
              .animate-fade-in {
                opacity: 0;
                animation: fade-in 0.5s ease-out forwards;
              }
            `}</style>
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-4">🛰️</div>
            <h2 className="text-lg font-semibold mb-2">No workspaces configured</h2>
            <p className="text-sm text-muted-foreground mb-4">Add an agent workspace in Settings to get started.</p>
            <button
              onClick={() => { setActiveTab('settings'); syncUrl({ tab: 'settings', agent: null, detail: null }); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Settings className="w-4 h-4" /> Open Settings
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <WorkspaceSearch
                onSelectFile={handleSearchSelect}
                initialQuery={highlightQuery ?? undefined}
              />
            </div>

            {alerts.some(a => a.level === 'red') && (
              <div className="mb-4 glass-card px-4 py-3 flex items-center gap-3 glow-red text-red-200">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {alerts.find(a => a.level === 'red')!.message}
                </span>
              </div>
            )}

            <div className="flex gap-1 mb-4 border-b border-border/50 pb-px overflow-x-auto scrollbar-hide">
              {(['warroom', 'ideas', 'projects', 'agents', 'tasks', 'infra', 'settings'] as const).map((tab) => {
                const labels = {
                  warroom: '🎯 War Room',
                  ideas: '💡 Ideas',
                  projects: '🚀 Projects',
                  agents: '🤖 Agents',
                  tasks: '📋 Tasks',
                  infra: '☁️ Infra',
                  settings: '⚙️ Settings',
                };
                return (
                  <button
                    key={tab}
                    onClick={() => { setActiveTab(tab); setSelectedIdeaId(null); syncUrl({ tab, agent: tab === 'agents' ? selectedAgentId : null, detail: tab === 'agents' && selectedAgentId ? agentDetailTab : null }); }}
                    className={cn(
                      'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap shrink-0',
                      activeTab === tab
                        ? 'bg-accent text-foreground border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    )}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>

            {/* ============ WAR ROOM TAB ============ */}
            {activeTab === 'warroom' && (
              <div className="space-y-4">
                {/* Blockers Banner */}
                <BlockerBanner blockers={dashboardData?.blockers ?? []} />

                {/* Row 1: MRR Goal Bar — full width */}
                <div className="glass-card p-4">
                  <MrrMeter
                    current={dashboardData?.global.mrr_total ?? 0}
                    milestones={dashboardData?.milestones}
                  />
                </div>

                {/* Row 2: Key Stats — 4 cards in a row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="glass-card text-center p-3">
                    <div className="text-lg font-bold font-mono">{dashboardData?.global.active_agents ?? 0}<span className="text-xs text-muted-foreground">/{dashboardData?.global.total_fleet ?? 0}</span></div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Agents</div>
                  </div>
                  <div className="glass-card text-center p-3">
                    <div className="text-lg font-bold font-mono">{dashboardData?.global.active_projects ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Projects</div>
                  </div>
                  <div className="glass-card text-center p-3">
                    <div className="text-lg font-bold font-mono">{dashboardData?.global.total_users ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Users</div>
                  </div>
                  <div
                    className="glass-card text-center p-3 cursor-pointer hover:ring-1 hover:ring-red-400/40 transition-all"
                    onClick={() => setShowCostBreakdown(true)}
                    title="Click to open cost ledger"
                  >
                    <div className="text-lg font-bold font-mono text-red-400">${dashboardData?.global.burn_rate_est?.toFixed(2) ?? '0.00'}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Burn/mo ✎</div>
                  </div>
                </div>


                {/* Row 2: Fleet Grid (compact) */}
                <div className="glass-card px-4 py-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" /> Fleet Status
                  </h2>
                  <AgentGrid
                    agents={dashboardData?.fleet ?? []}
                    onSelectAgent={handleFleetSelect}
                  />
                </div>

                {/* Row 3: My Tasks + Blockers side by side */}
                <div className="grid md:grid-cols-2 gap-4">
                  {/* My Tasks */}
                  <div className="glass-card px-4 py-3">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <ListTodo className="w-3.5 h-3.5" /> My Tasks
                    </h2>
                    {myTasks.length === 0 ? (
                      <div className="text-sm text-muted-foreground italic py-2">No tasks assigned to you</div>
                    ) : (
                      <div className="space-y-1.5">
                        {myTasks.map(t => {
                          const isExpanded = expandedTaskId === t.id;
                          const age = t.createdAt ? formatRelativeTime(new Date(t.createdAt).getTime()) : null;
                          return (
                            <div key={t.id}>
                              <button
                                onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                                className={cn(
                                  'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                                  t.status === 'blocked' ? 'bg-red-500/10 border border-red-500/20' : 'bg-card/40 hover:bg-card/60',
                                )}
                              >
                                <span className={cn(
                                  'text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0',
                                  t.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                                    t.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                      'bg-zinc-500/20 text-zinc-400'
                                )}>{t.priority}</span>
                                <span className={cn('flex-1', !isExpanded && 'truncate')}>{t.title}</span>
                                {t.status === 'blocked' && <span className="text-[10px] text-red-400 font-medium shrink-0">BLOCKED</span>}
                                <span className={cn('text-[10px] text-muted-foreground shrink-0 transition-transform', isExpanded && 'rotate-180')}>▼</span>
                              </button>
                              {isExpanded && (
                                <div className="mt-1 ml-2 px-3 py-2 rounded bg-card/30 border border-border/30 space-y-1.5 text-xs text-muted-foreground animate-in slide-in-from-top-1">
                                  {t.assigneeId && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-foreground/60 font-medium">Agent:</span>
                                      <span className="text-foreground/90">{t.assigneeId}</span>
                                      {t.assigneeType && <span className="text-[10px] bg-accent/50 px-1 rounded">{t.assigneeType}</span>}
                                    </div>
                                  )}
                                  {t.description && (
                                    <div className="text-foreground/80 leading-relaxed">{t.description}</div>
                                  )}
                                  <div className="flex flex-wrap gap-3">
                                    <div><span className="font-medium text-foreground/60">Status:</span> <span className={cn(
                                      t.status === 'blocked' ? 'text-red-400' :
                                        t.status === 'done' ? 'text-emerald-400' :
                                          t.status === 'in_progress' ? 'text-sky-400' : 'text-foreground/80'
                                    )}>{t.status}</span></div>
                                    <div><span className="font-medium text-foreground/60">Priority:</span> <span className={cn(
                                      t.priority === 'critical' ? 'text-red-400' :
                                        t.priority === 'high' ? 'text-orange-400' : 'text-foreground/80'
                                    )}>{t.priority}</span></div>
                                    {age && <div><span className="font-medium text-foreground/60">Age:</span> {age}</div>}
                                  </div>
                                  {t.goal && <div><span className="font-medium text-foreground/60">Goal:</span> {t.goal.title}</div>}
                                  {t.project && <div><span className="font-medium text-foreground/60">Project:</span> {t.project.name}</div>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Alerts / Fires */}
                  <div className="glass-card px-4 py-3">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-orange-400" /> Fires & Alerts
                    </h2>
                    {alerts.length === 0 ? (
                      <div className="text-sm text-emerald-400/80 italic py-2">All clear — no fires 🎉</div>
                    ) : (
                      <div className="space-y-1">
                        {alerts.slice(0, 8).map((alert) => (
                          <AlertRow key={alert.id} alert={alert} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ============ PROJECTS TAB ============ */}
            {/* ============ IDEAS TAB ============ */}
            {activeTab === 'ideas' && (
              <>
                {selectedIdeaId ? (
                  <IdeaDetail
                    ideaId={selectedIdeaId}
                    onBack={() => {
                      setSelectedIdeaId(null);
                      const url = new URL(window.location.href);
                      url.searchParams.delete('idea');
                      window.history.pushState({}, '', url.toString());
                    }}
                  />
                ) : (
                  <div className="space-y-4">
                    <IdeasKanban
                      items={dashboardData?.pipeline ?? []}
                      onCardClick={(ideaId) => {
                        setSelectedIdeaId(ideaId);
                        const url = new URL(window.location.href);
                        url.searchParams.set('idea', ideaId);
                        window.history.pushState({}, '', url.toString());
                      }}
                    />
                  </div>
                )}
              </>
            )}

            {/* ============ PROJECTS TAB ============ */}
            {activeTab === 'projects' && (
              <>
                {selectedProjectId ? (
                  <ProjectDetail
                    projectId={selectedProjectId}
                    onBack={() => setSelectedProjectId(null)}
                  />
                ) : (
                  <ProjectsGrid onSelectProject={setSelectedProjectId} activeTab={activeTab} />
                )}
              </>
            )}

            {/* ============ AGENTS TAB ============ */}
            {activeTab === 'agents' && (() => {
              const fleet = dashboardData?.fleet ?? [];
              const filteredAgents = agentSearchQuery
                ? fleet.filter(a =>
                  a.name?.toLowerCase().includes(agentSearchQuery.toLowerCase()) ||
                  a.id.toLowerCase().includes(agentSearchQuery.toLowerCase()) ||
                  a.status?.toLowerCase().includes(agentSearchQuery.toLowerCase())
                )
                : fleet;
              const selectedAgent = fleet.find(a => a.id === selectedAgentId) || null;
              const selectedAgentWorkspace = workspaces.find(w => w.id === selectedAgentId) || null;

              return (
                <>


                  {/* Master/Detail Layout */}
                  <div className="grid md:grid-cols-12 gap-4" style={{ minHeight: '600px' }}>
                    {/* LEFT: Agent List */}
                    <div className="md:col-span-4 lg:col-span-3 glass-card overflow-hidden flex flex-col">
                      <div className="p-3 border-b border-border">
                        <input
                          type="text"
                          placeholder="Filter agents..."
                          value={agentSearchQuery}
                          onChange={(e) => setAgentSearchQuery(e.target.value)}
                          className="w-full bg-card/60 border border-border/50 rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                        <div className="text-[10px] text-muted-foreground mt-1.5">
                          {filteredAgents.length} agent{filteredAgents.length !== 1 ? 's' : ''}
                          {agentSearchQuery && ` matching "${agentSearchQuery}"`}
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        {filteredAgents.map(agent => {
                          const isSelected = agent.id === selectedAgentId;
                          return (
                            <button
                              key={agent.id}
                              onClick={() => {
                                setSelectedAgentId(agent.id);
                                setAgentDetailTab('overview');
                                const ws = workspaces.find(w => w.id === agent.id);
                                if (ws) setActiveWorkspace(ws);
                                syncUrl({ agent: agent.id, detail: 'overview' });
                              }}
                              className={cn(
                                'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-border/30',
                                isSelected
                                  ? 'bg-primary/15 border-l-2 border-l-primary'
                                  : 'hover:bg-accent/50'
                              )}
                            >
                              <span className="text-lg flex-shrink-0">{agent.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{agent.name || agent.id}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{agent.status || '—'}</div>
                              </div>
                              <div className={cn(
                                'w-2 h-2 rounded-full flex-shrink-0',
                                agent.health === 'green' && 'bg-emerald-400',
                                agent.health === 'yellow' && 'bg-yellow-400',
                                agent.health === 'red' && 'bg-red-500',
                                agent.health === 'gray' && 'bg-zinc-500',
                              )} />
                            </button>
                          );
                        })}
                        {filteredAgents.length === 0 && (
                          <div className="p-4 text-sm text-muted-foreground text-center italic">No agents match</div>
                        )}
                      </div>
                    </div>

                    {/* RIGHT: Detail Panel */}
                    <div className="md:col-span-8 lg:col-span-9 flex flex-col">
                      {selectedAgent ? (
                        <>
                          {/* Agent Header */}
                          <div className="glass-card p-4 mb-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-3xl">{selectedAgent.emoji}</span>
                                <div>
                                  <h2 className="text-lg font-bold">{selectedAgent.name || selectedAgent.id}</h2>
                                  <div className="text-xs text-muted-foreground">
                                    {selectedAgent.last_updated ? `Last seen ${formatRelativeTime(new Date(selectedAgent.last_updated).getTime())}` : 'No activity reported'}
                                  </div>
                                </div>
                                <div className={cn(
                                  'px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider flex items-center gap-1.5',
                                  selectedAgent.health === 'green' && 'bg-emerald-500/20 text-emerald-400',
                                  selectedAgent.health === 'yellow' && 'bg-yellow-500/20 text-yellow-400',
                                  selectedAgent.health === 'red' && 'bg-red-500/20 text-red-400',
                                  selectedAgent.health === 'gray' && 'bg-zinc-500/20 text-zinc-400',
                                )}>
                                  <div className={cn(
                                    'w-1.5 h-1.5 rounded-full',
                                    selectedAgent.health === 'green' && 'bg-emerald-400',
                                    selectedAgent.health === 'yellow' && 'bg-yellow-400',
                                    selectedAgent.health === 'red' && 'bg-red-400',
                                    selectedAgent.health === 'gray' && 'bg-zinc-400',
                                  )} />
                                  {selectedAgent.health === 'green' ? 'Healthy' : selectedAgent.health === 'yellow' ? 'Stale' : selectedAgent.health === 'red' ? 'Offline' : 'No Signal'}
                                </div>
                              </div>
                            </div>
                            {/* Doc quick-access */}
                            {selectedAgentWorkspace && (
                              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/30">
                                {['SOUL.md', 'IDENTITY.md', 'HEARTBEAT.md', 'AGENTS.md', 'TOOLS.md', 'USER.md'].map(doc => (
                                  <DocPreviewButton
                                    key={doc}
                                    label={doc}
                                    workspace={selectedAgentWorkspace.path}
                                    filename={doc}
                                  />
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Detail Sub-tabs */}
                          <div className="flex gap-1 mb-3">
                            {(['overview', 'goals', 'schedule', 'files'] as const).map(tab => (
                              <button
                                key={tab}
                                onClick={() => { setAgentDetailTab(tab); syncUrl({ detail: tab }); }}
                                className={cn(
                                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize',
                                  agentDetailTab === tab
                                    ? 'bg-primary/20 text-primary border border-primary/30'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                                )}
                              >
                                {tab === 'overview' && '📊 '}
                                {tab === 'goals' && '🎯 '}
                                {tab === 'schedule' && '⏰ '}
                                {tab === 'files' && '📁 '}
                                {tab}
                              </button>
                            ))}
                          </div>

                          {/* Detail Content */}
                          <div className="flex-1">
                            {agentDetailTab === 'overview' && (
                              <div className="space-y-4">
                                {/* Status + Mission from FleetCards data */}
                                <div className="glass-card p-4">
                                  <div className="grid grid-cols-3 gap-3">
                                    <div className="text-center p-2 bg-card/40 rounded-lg">
                                      <div className="text-lg font-bold font-mono">${selectedAgent.mrr ?? 0}</div>
                                      <div className="text-[10px] text-muted-foreground uppercase">MRR</div>
                                    </div>
                                    <div className="text-center p-2 bg-card/40 rounded-lg">
                                      <div className="text-lg font-bold font-mono">{selectedAgent.users ?? 0}</div>
                                      <div className="text-[10px] text-muted-foreground uppercase">Users</div>
                                    </div>
                                    <div className="text-center p-2 bg-card/40 rounded-lg">
                                      <div className="text-lg font-bold font-mono">{selectedAgent.traffic ?? 0}</div>
                                      <div className="text-[10px] text-muted-foreground uppercase">Traffic</div>
                                    </div>
                                  </div>
                                </div>
                                {/* Latest Journal Entries */}
                                {selectedAgentId && (
                                  <LatestJournalEntries agentId={selectedAgentId} />
                                )}
                                {/* Sub-agents / processes for this agent */}
                                <SubAgentsPanel agentId={selectedAgentId || undefined} />
                              </div>
                            )}

                            {agentDetailTab === 'goals' && (
                              <div className="glass-card overflow-hidden">
                                <GoalsPanel agentId={selectedAgentId || activeWorkspace?.id} />
                              </div>
                            )}

                            {agentDetailTab === 'schedule' && (
                              <div className="glass-card overflow-hidden p-4">
                                <ScheduleManager agentId={selectedAgentId || undefined} />
                              </div>
                            )}

                            {agentDetailTab === 'files' && (
                              <FileBrowser
                                className="h-[500px]"
                                initialFile={searchSelectedFile}
                                workspace={selectedAgentWorkspace?.path || '/home/neg0/.openclaw'}
                                highlightQuery={highlightQuery}
                              />
                            )}
                          </div>
                        </>
                      ) : (
                        /* No agent selected — prompt */
                        <div className="flex-1 flex flex-col items-center justify-center text-center glass-card p-8">
                          <div className="text-5xl mb-4">🤖</div>
                          <h3 className="text-lg font-semibold mb-2">Select an Agent</h3>
                          <p className="text-sm text-muted-foreground max-w-md">
                            Choose an agent from the list to view their status, goals, schedule, and workspace files.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}


            {/* ============ TASKS TAB ============ */}
            {activeTab === 'tasks' && (
              <div className="h-[700px] flex flex-col">
                <TaskBoard />
              </div>
            )}

            {/* ============ INFRA TAB ============ */}
            {activeTab === 'infra' && (
              <div className="min-h-[600px]">
                <InfraMonitor />
              </div>
            )}

            {/* ============ SETTINGS TAB ============ */}
            {activeTab === 'settings' && (
              <div className="min-h-[600px]">
                <SettingsPage connected={connected} connecting={connecting} />
              </div>
            )}
          </>
        )}
      </main>



      {/* Legacy modal removed — Ideas tab uses inline IdeaDetail */}

      {showCostBreakdown && (
        <CostBreakdown onClose={() => setShowCostBreakdown(false)} />
      )}

      <footer className="fixed bottom-0 left-0 right-0 glass-card rounded-none border-x-0 border-b-0 px-4 py-2">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Overall status LED */}
            {(() => {
              const gwOk = gatewayHealth.online;
              const wsOk = connected;
              const orchOk = gatewayHealth.status === 'running';
              const overallColor = !gwOk ? 'led-red' : (!wsOk || !orchOk) ? 'led-yellow' : 'led-green';
              return <div className={cn('w-2 h-2 led led-pulse shrink-0', overallColor)} />;
            })()}
            <span className={cn(gatewayHealth.online ? 'text-emerald-400' : 'text-red-400')}>
              GW: {gatewayHealth.online ? 'OK' : 'Down'}
            </span>
            <span className="text-border">│</span>
            <span className={cn(connected ? 'text-emerald-400' : connecting ? 'text-yellow-400' : 'text-red-400')}>
              WS: {connected ? 'Connected' : connecting ? 'Connecting' : 'Disconnected'}
            </span>
            <span className="text-border">│</span>
            <span className={cn(
              gatewayHealth.status === 'running' ? 'text-emerald-400' :
                gatewayHealth.status === 'restarting' ? 'text-yellow-400' : 'text-red-400'
            )}>
              Orch: {gatewayHealth.status === 'running' ? 'Running' : gatewayHealth.status === 'unknown' ? '—' : gatewayHealth.status}
            </span>
            <span className="text-border hidden sm:inline">│</span>
            <span className="hidden sm:inline">Sync: {lastSyncLabel}</span>
            {dashboardData?.cron && (
              <>
                <span className="text-border hidden md:inline">│</span>
                <span className="hidden md:inline"><CronHealth
                  total={dashboardData.cron.total}
                  ok={dashboardData.cron.ok}
                  errors={dashboardData.cron.errors}
                /></span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 sm:hidden">
            <span>Sync: {lastSyncLabel}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function MissionControl() {
  return (
    <Suspense>
      <MissionControlInner />
    </Suspense>
  );
}

export const dynamic = 'force-dynamic';
