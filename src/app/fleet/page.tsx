'use client';

import { Search, ChevronDown, AlertCircle, Heart, Activity, FileText, Zap, MoreVertical } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { GoalsPanel } from '../../components/GoalsPanel';
import { ScheduleManager } from '../../components/ScheduleManager';
import { FileBrowser } from '../../components/FileBrowser';
import { LatestJournalEntries } from '../../components/LatestJournalEntries';
import { SubAgentsPanel } from '../../components/SubAgentsPanel';
import { DocPreviewButton } from '../../components/DocPreviewButton';
import { cn } from '../../lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'goals' | 'schedule' | 'files';

interface JournalEntry {
  id: string;
  agentId: string;
  content: string;
  timestamp: string;
}

// ─── Helper Functions ──────────────────────────────────────────────

function formatRelativeTime(ts: string | number): string {
  let timestamp: number;
  if (typeof ts === 'string') {
    timestamp = new Date(ts).getTime();
  } else {
    timestamp = ts;
  }

  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return `${Math.floor(diff / 604800000)}w ago`;
}

function getHealthColor(health: string): string {
  switch (health) {
    case 'green':
      return 'bg-emerald-500';
    case 'yellow':
      return 'bg-yellow-500';
    case 'red':
      return 'bg-red-500';
    default:
      return 'bg-zinc-500';
  }
}

function getHealthBadgeClass(health: string): string {
  switch (health) {
    case 'green':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'yellow':
      return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
    case 'red':
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    default:
      return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
  }
}

function getHealthDot(health: string): string {
  switch (health) {
    case 'green':
      return '🟢';
    case 'yellow':
      return '🟡';
    case 'red':
      return '🔴';
    default:
      return '⚪';
  }
}

// ─── Fleet Page ─────────────────────────────────────────────────────

export default function FleetPage() {
  return (
    <Suspense>
      <FleetContent />
    </Suspense>
  );
}

function FleetContent() {
  const searchParams = useSearchParams();
  const { dashboardData, workspaces } = useDashboard();

  const selectedAgentId = searchParams.get('agent');
  const detailTab = (searchParams.get('tab') || 'overview') as DetailTab;
  const preselectedFile = searchParams.get('file');
  const highlightQuery = searchParams.get('q');

  const [searchQuery, setSearchQuery] = useState('');
  const [filteredAgents, setFilteredAgents] = useState(dashboardData?.fleet || []);
  const [latestJournals, setLatestJournals] = useState<Record<string, JournalEntry>>({});

  // Update URL when agent is selected
  const selectAgent = useCallback(
    (agentId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('agent', agentId);
      params.delete('tab'); // Reset tab to overview
      window.history.replaceState(null, '', `?${params.toString()}`);
    },
    [searchParams]
  );

  // Update URL when tab is changed
  const setDetailTab = useCallback(
    (tab: DetailTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      window.history.replaceState(null, '', `?${params.toString()}`);
    },
    [searchParams]
  );

  // Filter agents by search query
  useEffect(() => {
    if (!dashboardData?.fleet) {
      setFilteredAgents([]);
      return;
    }

    if (!searchQuery.trim()) {
      setFilteredAgents(dashboardData.fleet);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredAgents(
        dashboardData.fleet.filter(
          agent =>
            agent.name.toLowerCase().includes(q) ||
            agent.id.toLowerCase().includes(q) ||
            agent.status.toLowerCase().includes(q)
        )
      );
    }
  }, [searchQuery, dashboardData?.fleet]);

  // Fetch latest journal entries for all agents
  useEffect(() => {
    const fetchJournals = async () => {
      if (!dashboardData?.fleet) return;

      try {
        const journals: Record<string, JournalEntry> = {};
        await Promise.all(
          dashboardData.fleet.map(async agent => {
            try {
              const response = await fetch(`/api/journal?agentId=${agent.id}&limit=1`);
              if (response.ok) {
                const data = await response.json();
                if (data.entries && data.entries.length > 0) {
                  journals[agent.id] = data.entries[0];
                }
              }
            } catch (error) {
              console.error(`Failed to fetch journal for ${agent.id}:`, error);
            }
          })
        );
        setLatestJournals(journals);
      } catch (error) {
        console.error('Failed to fetch journals:', error);
      }
    };

    fetchJournals();
  }, [dashboardData?.fleet]);

  const selectedAgent = dashboardData?.fleet.find(a => a.id === selectedAgentId);

  return (
    <div className="flex-1 grid grid-cols-12 gap-4 p-6">
      {/* LEFT PANEL: Agent List (4 cols on md, 3 on lg) */}
      <div className="col-span-12 md:col-span-4 lg:col-span-3 flex flex-col gap-4 min-h-0">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={cn(
              'w-full bg-primary/15 border border-primary/30 rounded-lg py-2 pl-10 pr-4',
              'text-sm text-foreground placeholder-muted-foreground',
              'focus:outline-none focus:border-primary/60'
            )}
          />
        </div>

        {/* Agent List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {filteredAgents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {searchQuery ? 'No agents found' : 'No agents in fleet'}
            </div>
          ) : (
            filteredAgents.map(agent => (
              <button
                key={agent.id}
                onClick={() => selectAgent(agent.id)}
                className={cn(
                  'w-full text-left glass-card p-3 rounded-lg transition-all hover-lift',
                  'border border-primary/20 hover:border-primary/40',
                  selectedAgentId === agent.id && 'border-primary/60 bg-primary/20'
                )}
              >
                {/* Agent Header Row */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{agent.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{agent.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{agent.id}</div>
                  </div>
                  {/* Health LED */}
                  <div
                    className={cn(
                      'led',
                      getHealthColor(agent.health),
                      agent.health === 'red' && 'led-pulse'
                    )}
                  />
                </div>

                {/* Status and Last Seen */}
                <div className="text-xs text-muted-foreground">
                  <span className="inline-block bg-primary/10 rounded px-2 py-0.5 mr-2">
                    {agent.status}
                  </span>
                  <span>{formatRelativeTime(agent.last_report)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Detail (8 cols on md, 9 on lg) */}
      <div className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col gap-4 min-h-0">
        {!selectedAgent ? (
          <FleetCommandGrid
            agents={filteredAgents}
            latestJournals={latestJournals}
            onSelectAgent={selectAgent}
          />
        ) : (
          <>
            {/* Agent Header */}
            <div className="glass-card rounded-lg border border-primary/20 p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-3">
                  <span className="text-3xl">{selectedAgent.emoji}</span>
                  <div>
                    <h2 className="text-xl font-bold">{selectedAgent.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      Last seen {formatRelativeTime(selectedAgent.last_report)}
                    </p>
                  </div>
                </div>

                {/* Health Badge */}
                <div
                  className={cn(
                    'px-3 py-1 rounded-full border text-sm font-medium',
                    getHealthBadgeClass(selectedAgent.health)
                  )}
                >
                  {selectedAgent.health.charAt(0).toUpperCase() + selectedAgent.health.slice(1)}
                </div>
              </div>

              {/* Quick Access Buttons */}
              <div className="flex flex-wrap gap-2">
                {['SOUL.md', 'IDENTITY.md', 'HEARTBEAT.md', 'AGENTS.md', 'TOOLS.md', 'USER.md'].map(
                  filename => (
                    <DocPreviewButton
                      key={filename}
                      label={filename.replace('.md', '')}
                      workspace={selectedAgent.id}
                      filename={filename}
                    />
                  )
                )}
              </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-2 border-b border-primary/20 pb-2">
              {(['overview', 'goals', 'schedule', 'files'] as DetailTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={cn(
                    'px-4 py-2 text-sm font-medium transition-colors rounded-t-lg',
                    detailTab === tab
                      ? 'text-primary border-b-2 border-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">
              {detailTab === 'overview' && (
                <OverviewTab agent={selectedAgent} workspaces={workspaces} />
              )}
              {detailTab === 'goals' && (
                <div className="glass-card rounded-lg border border-primary/20 p-4">
                  <GoalsPanel agentId={selectedAgent.id} />
                </div>
              )}
              {detailTab === 'schedule' && (
                <div className="glass-card rounded-lg border border-primary/20 p-4">
                  <ScheduleManager agentId={selectedAgent.id} />
                </div>
              )}
              {detailTab === 'files' && (
                <div className="glass-card rounded-lg border border-primary/20 p-4">
                  <FileBrowser
                    workspace={selectedAgent.id}
                    initialFile={preselectedFile}
                    highlightQuery={highlightQuery}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Fleet Command Grid Component ───────────────────────────────────

function FleetCommandGrid({
  agents,
  latestJournals,
  onSelectAgent,
}: {
  agents: any[];
  latestJournals: Record<string, JournalEntry>;
  onSelectAgent: (agentId: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="flex-1 glass-card rounded-lg border border-primary/20 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-muted-foreground">No agents in fleet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map(agent => (
        <CommandCard
          key={agent.id}
          agent={agent}
          latestJournal={latestJournals[agent.id]}
          onSelect={() => onSelectAgent(agent.id)}
        />
      ))}
    </div>
  );
}

// ─── Command Card Component ─────────────────────────────────────────

function CommandCard({
  agent,
  latestJournal,
  onSelect,
}: {
  agent: any;
  latestJournal?: JournalEntry;
  onSelect: () => void;
}) {
  const [isKicking, setIsKicking] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const handleKick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsKicking(true);

    try {
      const response = await fetch('/api/kick', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: agent.id,
          message: 'Manual kick from Fleet Command',
        }),
      });

      if (response.ok) {
        // Show success feedback (could add toast notification here)
        console.log(`Kicked agent ${agent.id}`);
      }
    } catch (error) {
      console.error('Failed to kick agent:', error);
    } finally {
      setIsKicking(false);
    }
  };

  const extractMissionFromJournal = (content: string): string => {
    // Try to extract mission/task from journal entry content
    if (!content) return 'No active mission';

    // Look for mission statement patterns
    const missionMatch = content.match(/mission[:\s]+([^.\n]+)/i);
    if (missionMatch) {
      return missionMatch[1].substring(0, 60) + (missionMatch[1].length > 60 ? '...' : '');
    }

    // Fall back to first line
    const firstLine = content.split('\n')[0];
    return firstLine.substring(0, 60) + (firstLine.length > 60 ? '...' : '');
  };

  return (
    <div
      onClick={onSelect}
      className={cn(
        'glass-card rounded-lg border border-primary/20 p-4',
        'transition-all hover-lift cursor-pointer',
        'hover:border-primary/40 relative'
      )}
    >
      {/* Header: Emoji + Name + Health Dot */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-2xl">{agent.emoji}</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{agent.name}</h3>
            <p className="text-xs text-muted-foreground">{agent.status}</p>
          </div>
        </div>
        <span className="text-lg flex-shrink-0">{getHealthDot(agent.health)}</span>
      </div>

      {/* Business Stats Row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-primary/10 rounded p-2 text-center">
          <div className="text-xs text-muted-foreground">MRR</div>
          <div className="text-sm font-semibold">${(agent.mrr || 0).toLocaleString()}</div>
        </div>
        <div className="bg-primary/10 rounded p-2 text-center">
          <div className="text-xs text-muted-foreground">Users</div>
          <div className="text-sm font-semibold">{(agent.users || 0).toLocaleString()}</div>
        </div>
        <div className="bg-primary/10 rounded p-2 text-center">
          <div className="text-xs text-muted-foreground">Traffic</div>
          <div className="text-sm font-semibold">{(agent.traffic || 0).toLocaleString()}</div>
        </div>
      </div>

      {/* Current Mission */}
      <div className="mb-3">
        <p className="text-xs text-muted-foreground mb-1">Current Mission</p>
        <p className="text-xs line-clamp-2 text-foreground">
          {latestJournal ? extractMissionFromJournal(latestJournal.content) : 'No mission data'}
        </p>
      </div>

      {/* Pre-ship Checklist Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Pre-ship Checklist</p>
          <p className="text-xs font-semibold">{agent.checklist_progress || 0}%</p>
        </div>
        <div className="w-full bg-primary/20 rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${agent.checklist_progress || 0}%` }}
          />
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            // Select agent and navigate to journal (overview tab)
            onSelect();
          }}
          className={cn(
            'flex-1 text-xs py-1.5 rounded transition-colors',
            'bg-primary/20 text-primary hover:bg-primary/30'
          )}
          title="View Journal"
        >
          <FileText className="w-3 h-3 inline mr-1" />
          Journal
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            // Select agent and navigate to files tab
            const agentId = agent.id;
            const params = new URLSearchParams(window.location.search);
            params.set('agent', agentId);
            params.set('tab', 'files');
            window.history.replaceState(null, '', `?${params.toString()}`);
          }}
          className={cn(
            'flex-1 text-xs py-1.5 rounded transition-colors',
            'bg-primary/20 text-primary hover:bg-primary/30'
          )}
          title="View Workspace"
        >
          <Activity className="w-3 h-3 inline mr-1" />
          Workspace
        </button>

        <button
          onClick={handleKick}
          disabled={isKicking}
          className={cn(
            'flex-1 text-xs py-1.5 rounded transition-colors',
            'bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50'
          )}
          title="Kick Agent"
        >
          <Zap className="w-3 h-3 inline mr-1" />
          {isKicking ? 'Kicking...' : 'Kick'}
        </button>
      </div>

      {/* Last Seen Badge */}
      <div className="mt-3 text-xs text-muted-foreground text-center">
        Seen {formatRelativeTime(agent.last_report)}
      </div>
    </div>
  );
}

// ─── Overview Tab Component ─────────────────────────────────────────

function OverviewTab({ agent, workspaces }: { agent: any; workspaces: any[] }) {
  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="MRR"
          value={`$${(agent.mrr || 0).toLocaleString()}`}
          icon={<Heart className="w-4 h-4" />}
          trend={agent.mrr > 0 ? 'up' : 'neutral'}
        />
        <StatCard
          label="Users"
          value={(agent.users || 0).toLocaleString()}
          icon={<Activity className="w-4 h-4" />}
          trend={agent.users > 0 ? 'up' : 'neutral'}
        />
        <StatCard
          label="Traffic"
          value={(agent.traffic || 0).toLocaleString()}
          icon={<ChevronDown className="w-4 h-4" />}
          trend={agent.traffic > 0 ? 'up' : 'neutral'}
        />
      </div>

      {/* Latest Journal Entries */}
      <div className="glass-card rounded-lg border border-primary/20 p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Journal Entries
        </h3>
        <LatestJournalEntries agentId={agent.id} />
      </div>

      {/* Sub-agents Panel */}
      <div className="glass-card rounded-lg border border-primary/20 p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <ChevronDown className="w-4 h-4" />
          Sub-agents
        </h3>
        <SubAgentsPanel agentId={agent.id} />
      </div>
    </div>
  );
}

// ─── Stat Card Component ────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  trend,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend: 'up' | 'down' | 'neutral';
}) {
  const trendColor =
    trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-muted-foreground';

  return (
    <div className={cn('glass-card rounded-lg border border-primary/20 p-4')}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase">{label}</span>
        <div className={cn('text-primary', trendColor)}>{icon}</div>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
