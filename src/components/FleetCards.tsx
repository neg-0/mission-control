'use client';

import { cn } from '@/lib/utils';

interface FleetAgent {
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

interface FleetCardsProps {
  agents: FleetAgent[];
  onSelectAgent?: (id: string) => void;
  onWakeAgent?: (id: string) => void;
}

const healthDot: Record<string, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
  gray: 'bg-zinc-500',
};

const healthLabel: Record<string, string> = {
  green: 'Healthy',
  yellow: 'Idle',
  red: 'Blocked',
  gray: 'Offline',
};

function formatCurrency(val: number): string {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
  return `$${val}`;
}

export function FleetCards({ agents, onSelectAgent, onWakeAgent }: FleetCardsProps) {
  if (!agents || agents.length === 0) {
    return <div className="text-sm text-muted-foreground italic">No agents found in AGENTS.md</div>;
  }

  async function handleWake(agentId: string) {
    try {
      const res = await fetch('/api/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `ACTION: Wake agent ${agentId}`,
          context: { source: 'mission-control', action: 'wake', target: agentId },
        }),
      });
      const data = await res.json();
      if (data.success) {
        onWakeAgent?.(agentId);
      } else {
        console.error('Wake failed:', data.error);
      }
    } catch (e) {
      console.error('Wake request failed:', e);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {agents.map((agent) => (
        <div
          key={agent.id}
          className={cn(
            'fleet-card glass-card p-4 space-y-3 group cursor-pointer transition-all duration-200',
            agent.health === 'gray'
              ? 'opacity-60 border-zinc-700/40 hover:border-zinc-500/40'
              : 'hover:border-primary/30'
          )}
          onClick={() => agent.has_stats && onSelectAgent?.(agent.id)}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">{agent.emoji}</span>
              <div>
                <div className="text-sm font-semibold">{agent.name}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{agent.status}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={cn('w-2 h-2 rounded-full', healthDot[agent.health], agent.health !== 'gray' && 'led-pulse')} />
              <span className="text-[10px] text-muted-foreground">{healthLabel[agent.health]}</span>
            </div>
          </div>

          {/* No Signal warning */}
          {!agent.has_stats && (
            <div className="flex items-center gap-2 text-xs text-yellow-400/80 bg-yellow-500/10 rounded px-2 py-1.5 border border-yellow-500/20">
              <span>⚠️</span>
              <span>Agent needs to report via <code>/api/journal</code></span>
            </div>
          )}

          {/* Stats */}
          {agent.has_stats && (
            <>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-card/50 rounded-lg py-2">
                  <div className="text-base font-bold font-mono">{formatCurrency(agent.mrr)}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">MRR</div>
                </div>
                <div className="bg-card/50 rounded-lg py-2">
                  <div className="text-base font-bold font-mono">{agent.users}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Users</div>
                </div>
              </div>

              {/* Mission */}
              <div className="text-xs text-muted-foreground">
                <span className="text-foreground/70 font-medium">Mission:</span> {agent.last_report || 'Not reported'}
              </div>

              {/* Checklist */}
              {agent.checklist_progress > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Pre-Ship Checklist</span>
                    <span>{Math.round(agent.checklist_progress * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-card/50 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        agent.checklist_progress >= 1
                          ? 'bg-emerald-500'
                          : agent.checklist_progress >= 0.6
                            ? 'bg-sky-500'
                            : 'bg-orange-500'
                      )}
                      style={{ width: `${agent.checklist_progress * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Last updated */}
          {agent.last_updated && (
            <div className="text-[10px] text-muted-foreground">
              Last report: {agent.last_updated}
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              className="text-xs px-2 py-1.5 rounded bg-card/50 hover:bg-primary/20 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 border border-transparent hover:border-primary/30"
              onClick={(e) => {
                e.stopPropagation();
                handleWake(agent.id);
              }}
            >
              ⚡ Wake
            </button>
            <button
              className="text-xs px-2 py-1.5 rounded bg-card/50 hover:bg-card text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 border border-transparent hover:border-border"
              onClick={(e) => {
                e.stopPropagation();
                onSelectAgent?.(agent.id);
              }}
            >
              📋 Logs
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
