'use client';

import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  GitPullRequest,
  GripVertical,
  Menu,
  Plus,
  Settings,
  Trash2,
  X,
  XCircle,
  Zap
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FileBrowser } from '../components/FileBrowser';
import GatewayOfflineBanner from '../components/GatewayOfflineBanner';
import { GoalsTracker } from '../components/GoalsTracker';
import { PRQueue } from '../components/PRQueue';
import { SubAgentsPanel } from '../components/SubAgentsPanel';
import { WorkspaceSearch } from '../components/WorkspaceSearch';
import { useGatewayHealth } from '../hooks/useGatewayHealth';
import { useGatewayStream } from '../hooks/useGatewayStream';
import { Alert, computeAlerts } from '../lib/alerts';
import { parseGoals } from '../lib/goals';
import { cn } from '../lib/utils';

// Types
interface Workspace {
  id: string;
  label: string;
  path: string;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
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

  const ledColor: Record<string, string> = {
    red: 'led-red',
    yellow: 'led-yellow',
    green: 'led-green',
    gray: 'led-gray',
  };

  if (workspaces.length === 0) {
    return (
      <div className="text-sm text-muted-foreground px-3 py-2">
        No workspaces configured
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
        <span className="text-sm font-medium truncate">{active?.label || 'Select workspace'}</span>
        <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 glass-card shadow-xl z-50 min-w-[220px] py-1">
            {workspaces.map((ws) => {
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
            })}
          </div>
        </>
      )}
    </div>
  );
}

// --- Settings Panel: Sortable Workspace Row ---

function SortableWorkspaceRow({ ws, onRemove }: { ws: Workspace; onRemove: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ws.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 p-2 rounded-lg border border-border bg-card',
        isDragging && 'opacity-70 shadow-lg'
      )}
    >
      <button
        className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{ws.label}</div>
        <div className="text-xs text-muted-foreground font-mono truncate">{ws.path}</div>
      </div>
      <button
        onClick={() => onRemove(ws.id)}
        className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
        title="Remove workspace"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// --- Settings Modal ---

function SettingsModal({ workspaces, onSave, onClose, connected, connecting }: {
  workspaces: Workspace[];
  onSave: (workspaces: Workspace[]) => void;
  onClose: () => void;
  connected: boolean;
  connecting: boolean;
}) {
  const [editableWorkspaces, setEditableWorkspaces] = useState<Workspace[]>(workspaces);
  const [newLabel, setNewLabel] = useState('');
  const [newPath, setNewPath] = useState('');
  const [dirty, setDirty] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setEditableWorkspaces(items => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        setDirty(true);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }

  function handleRemove(id: string) {
    setEditableWorkspaces(prev => prev.filter(ws => ws.id !== id));
    setDirty(true);
  }

  function handleAdd() {
    if (!newLabel.trim() || !newPath.trim()) return;
    const id = newLabel.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    setEditableWorkspaces(prev => [...prev, { id, label: newLabel.trim(), path: newPath.trim() }]);
    setNewLabel('');
    setNewPath('');
    setDirty(true);
  }

  function handleSave() {
    onSave(editableWorkspaces);
    setDirty(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="glass-card p-6 w-full max-w-lg mx-4 space-y-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Settings</h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded"><X className="w-4 h-4" /></button>
        </div>

        {/* Gateway Info */}
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

        {/* Workspaces Section */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Agent Workspaces</h3>
          <p className="text-xs text-muted-foreground mb-3">Drag to reorder priority. First workspace is the default.</p>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={editableWorkspaces.map(w => w.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {editableWorkspaces.map(ws => (
                  <SortableWorkspaceRow key={ws.id} ws={ws} onRemove={handleRemove} />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {editableWorkspaces.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
              No workspaces configured. Add one below.
            </div>
          )}

          {/* Add Workspace */}
          <div className="mt-3 space-y-2 p-3 border border-border rounded-lg bg-muted/30">
            <div className="text-xs font-medium text-muted-foreground">Add Workspace</div>
            <input
              type="text"
              placeholder="Label (e.g. Rocket 🚀)"
              className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:border-primary/50"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
            />
            <input
              type="text"
              placeholder="Path (e.g. /home/neg0/.openclaw/workspace-rocket)"
              className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-primary/50"
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button
              onClick={handleAdd}
              disabled={!newLabel.trim() || !newPath.trim()}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>

        {/* Save */}
        {dirty && (
          <button
            onClick={handleSave}
            className="w-full py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          >
            Save Changes
          </button>
        )}
      </div>
    </div>
  );
}

// --- Main Page ---

export default function MissionControl() {
  const searchParams = useSearchParams();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'prs' | 'goals'>(
    (searchParams.get('tab') as 'files' | 'prs' | 'goals') || 'goals'
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
  const [showSettings, setShowSettings] = useState(false);

  // Workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);

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

  // URL sync helper — pushes state to browser history
  function syncUrl(overrides: { ws?: string; tab?: string; file?: string | null; q?: string | null } = {}) {
    const params = new URLSearchParams(window.location.search);
    const updates: Record<string, string | null> = {
      ws: overrides.ws ?? activeWorkspace?.id ?? null,
      tab: overrides.tab ?? activeTab,
      file: ('file' in overrides ? overrides.file : searchSelectedFile) ?? null,
      q: ('q' in overrides ? overrides.q : highlightQuery) ?? null,
    };
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    // Only push if URL actually changed
    if (newUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState({}, '', newUrl);
    }
  }

  // Handle browser back/forward
  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const urlWs = params.get('ws');
      const urlTab = params.get('tab') as 'files' | 'prs' | 'goals' | null;
      const urlFile = params.get('file');
      const urlQ = params.get('q');

      if (urlTab) setActiveTab(urlTab);
      if (urlFile !== searchSelectedFile) setSearchSelectedFile(urlFile);
      if (urlQ !== highlightQuery) setHighlightQuery(urlQ);
      if (urlWs) {
        const match = workspaces.find(w => w.id === urlWs);
        if (match && match.id !== activeWorkspace?.id) setActiveWorkspace(match);
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [workspaces, activeWorkspace, searchSelectedFile, highlightQuery]);

  // Load workspaces on mount
  useEffect(() => {
    async function loadWorkspaces() {
      try {
        const res = await fetch('/api/workspaces');
        if (res.ok) {
          const data: Workspace[] = await res.json();
          setWorkspaces(data);
          // Restore from URL or default to first
          const urlWs = searchParams.get('ws');
          const match = urlWs ? data.find(w => w.id === urlWs) : null;
          if (match) {
            setActiveWorkspace(match);
          } else if (data.length > 0 && !activeWorkspace) {
            setActiveWorkspace(data[0]);
          }
        }
      } catch (e) {
        console.error('Failed to load workspaces:', e);
      }
    }
    loadWorkspaces();
  }, []);

  // Update "last sync" label
  useEffect(() => {
    const timer = setInterval(() => {
      setLastSyncLabel(formatRelativeTime(lastSyncTs));
    }, 10000);
    return () => clearInterval(timer);
  }, [lastSyncTs]);

  // Fetch alerts and stats
  const fetchAlerts = useCallback(async () => {
    const wsPath = activeWorkspace?.path;
    try {
      const fetchArgs = wsPath
        ? [
          fetch('/api/github/prs?repo=neg-0/comp-iq'),
          fetch(`/api/files/read?path=GOALS.md&workspace=${encodeURIComponent(wsPath)}`),
          fetch('/api/sessions'),
        ]
        : [
          fetch('/api/github/prs?repo=neg-0/comp-iq'),
          Promise.resolve(new Response(JSON.stringify({ content: '' }))),
          fetch('/api/sessions'),
        ];

      const [prsRes, goalsRes, agentsRes] = await Promise.all(fetchArgs);

      const prsData = prsRes.ok ? await prsRes.json() : { prs: [] };
      const goalsData = goalsRes.ok ? await goalsRes.json() : { content: '' };
      const agentsData = agentsRes.ok ? await agentsRes.json() : { sessions: [] };

      const prs = prsData.prs || [];
      const goals = parseGoals(goalsData.content || '');
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

      // Compute per-workspace health from alerts
      // Fetch goals for each workspace and compute alerts per workspace
      const severityOrder: Record<string, number> = { red: 0, yellow: 1, gray: 2, green: 3 };
      const healthMap: Record<string, 'red' | 'yellow' | 'green' | 'gray'> = {};

      await Promise.all(workspaces.map(async (ws) => {
        try {
          const wsGoalsRes = await fetch(`/api/files/read?path=GOALS.md&workspace=${encodeURIComponent(ws.path)}`);
          const wsGoalsData = wsGoalsRes.ok ? await wsGoalsRes.json() : { content: '' };
          const wsGoals = parseGoals(wsGoalsData.content || '');
          const wsAlerts = computeAlerts(prs, wsGoals, agents);
          // Find most severe alert level
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
      }));
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
    syncUrl({ ws: ws.id, file: null, q: null });
  }

  // Save workspaces from settings
  async function saveWorkspaces(updated: Workspace[]) {
    try {
      const res = await fetch('/api/workspaces', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        setWorkspaces(updated);
        // If active workspace was removed, switch to first
        if (activeWorkspace && !updated.find(w => w.id === activeWorkspace.id)) {
          setActiveWorkspace(updated[0] || null);
        }
      }
    } catch (e) {
      console.error('Failed to save workspaces:', e);
    }
  }

  // Handle search result selecting a file (possibly from another workspace)
  function handleSearchSelect(filePath: string, workspacePath: string, query: string) {
    // Switch workspace if needed
    const targetWs = workspaces.find(w => w.path === workspacePath);
    if (targetWs && targetWs.id !== activeWorkspace?.id) {
      setActiveWorkspace(targetWs);
    }
    setSearchSelectedFile(filePath);
    setHighlightQuery(query || null);
    setActiveTab('files');
    syncUrl({
      ws: targetWs?.id,
      tab: 'files',
      file: filePath,
      q: query || null,
    });
  }

  return (
    <div className="min-h-screen text-foreground pb-12 relative">
      {/* Animated mesh background */}
      <div className="mesh-bg fixed inset-0 -z-10">
        <div className="mesh-bg-accent" />
      </div>
      {/* Gateway offline banner */}
      <GatewayOfflineBanner {...gatewayHealth} />
      {/* Header */}
      <header className="sticky top-0 z-50 glass-card rounded-none border-x-0 border-t-0">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center">
          {/* Left: Workspace Selector */}
          <div className="flex-1 flex items-center">
            <WorkspaceSelector
              workspaces={workspaces}
              active={activeWorkspace}
              onSelect={switchWorkspace}
              health={workspaceHealth}
            />
          </div>

          {/* Center: Logo Title */}
          <h1 className="select-none flex items-center gap-0">
            <span className="text-lg font-light tracking-[0.3em] uppercase text-foreground/70">
              Mission
            </span>
            <span className="mx-2 w-px h-5 bg-foreground/20" />
            <span className="text-xl font-bold tracking-[0.2em] uppercase flex items-center">
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                CONTR
              </span>
              {/* Radar icon replacing the "O" */}
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

          {/* Right: Status + Settings */}
          <div className="flex-1 flex items-center justify-end gap-3">
            <div className="hidden md:flex items-center gap-2">
              <div className={cn(
                'w-2 h-2 led',
                connected ? 'led-green' : connecting ? 'led-yellow led-pulse' : 'led-gray'
              )} />
              <span className="text-sm text-muted-foreground">
                {connected ? 'Live' : connecting ? 'Connecting...' : 'Offline'}
              </span>
            </div>
            <button className="p-2 hover:bg-accent rounded-lg" title="Settings" onClick={() => setShowSettings(true)}>
              <Settings className="w-4 h-4" />
            </button>

            {/* Mobile menu toggle */}
            <button
              className="md:hidden p-2 hover:bg-accent rounded-lg"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4">
        {/* No workspaces empty state */}
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-4">🛰️</div>
            <h2 className="text-lg font-semibold mb-2">No workspaces configured</h2>
            <p className="text-sm text-muted-foreground mb-4">Add an agent workspace in Settings to get started.</p>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Settings className="w-4 h-4" /> Open Settings
            </button>
          </div>
        ) : (
          <>
            {/* Workspace Search */}
            <div className="mb-4">
              <WorkspaceSearch
                onSelectFile={handleSearchSelect}
                initialQuery={highlightQuery ?? undefined}
              />
            </div>

            {/* Alert Banner — only for critical (red) alerts */}
            {alerts.some(a => a.level === 'red') && (
              <div className="mb-4 glass-card px-4 py-3 flex items-center gap-3 glow-red text-red-200">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {alerts.find(a => a.level === 'red')!.message}
                </span>
              </div>
            )}

            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <StatCard label="PRs Open" value={stats.prsOpen ?? '—'} icon={GitPullRequest} />
              <StatCard label="Ready to Merge" value={stats.prsReadyToMerge ?? '—'} icon={CheckCircle2} trend={stats.prsReadyToMerge != null && stats.prsReadyToMerge > 0 ? 'up' : undefined} />
              <StatCard label="Blocked" value={stats.prsBlocked ?? '—'} icon={XCircle} trend={stats.prsBlocked != null && stats.prsBlocked > 0 ? 'down' : undefined} />
              <StatCard label="Agents Active" value={stats.agentsActive ?? '—'} icon={Zap} />
            </div>

            {/* Mobile Tab Selector */}
            <div className="md:hidden flex gap-2 mb-4 overflow-x-auto pb-2">
              {(['goals', 'files', 'prs'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); syncUrl({ tab }); }}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                    activeTab === tab
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-accent text-muted-foreground'
                  )}
                >
                  {tab === 'files' && '📁 Files'}
                  {tab === 'prs' && '📋 PRs'}
                  {tab === 'goals' && '🎯 Goals'}
                </button>
              ))}
            </div>

            {/* Main 3-Column Grid */}
            <div className="grid md:grid-cols-12 gap-4">
              {/* Left Column: Files */}
              <div className={cn(
                'md:col-span-3',
                activeTab !== 'files' && 'hidden md:block'
              )}>
                <FileBrowser
                  className="h-[600px]"
                  initialFile={searchSelectedFile}
                  workspace={activeWorkspace?.path}
                  highlightQuery={highlightQuery}
                />
              </div>

              {/* Center Column: Goals + Sub-Agents */}
              <div className={cn(
                'md:col-span-5 space-y-4',
                activeTab !== 'goals' && 'hidden md:block'
              )}>
                <GoalsTracker workspace={activeWorkspace?.path} />
                <SubAgentsPanel />
              </div>

              {/* Right Column: PRs + Alerts */}
              <div className={cn(
                'md:col-span-4 space-y-4',
                activeTab !== 'prs' && 'hidden md:block'
              )}>
                <PRQueue />

                {/* Alerts */}
                {alerts.length > 0 && (
                  <div className="glass-card overflow-hidden">
                    <div className="p-3 border-b border-border flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-orange-400" />
                      <h2 className="font-semibold">Alerts</h2>
                    </div>
                    <div className="p-2">
                      {alerts.map((alert) => (
                        <AlertRow key={alert.id} alert={alert} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          workspaces={workspaces}
          onSave={saveWorkspaces}
          onClose={() => setShowSettings(false)}
          connected={connected}
          connecting={connecting}
        />
      )}

      {/* Footer Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 glass-card rounded-none border-x-0 border-b-0 px-4 py-2">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className={cn(
              connected ? 'text-green-400' : 'text-gray-400'
            )}>
              {connected ? '🟢' : '⚪'} Gateway: {connected ? 'Connected' : 'Disconnected'}
            </span>
            <span>📁 {activeWorkspace?.path || 'No workspace selected'}</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Last sync: {lastSyncLabel}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export const dynamic = 'force-dynamic';
