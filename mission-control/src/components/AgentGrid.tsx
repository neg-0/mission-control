'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';

interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
  health: 'green' | 'yellow' | 'red' | 'gray';
  role?: string;
  status?: string;
  last_updated?: string | null;
}

interface GoalSummary {
  id: string;
  title: string;
  status: string;
  progress: number;
  ownerAgentId: string | null;
}

interface AgentGridProps {
  agents: AgentInfo[];
  onSelectAgent?: (agentId: string) => void;
}

const healthColors: Record<string, { bg: string; border: string; ring: string }> = {
  green: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', ring: 'ring-emerald-500/30' },
  yellow: { bg: 'bg-yellow-500/15', border: 'border-yellow-500/40', ring: 'ring-yellow-500/30' },
  red: { bg: 'bg-red-500/15', border: 'border-red-500/40', ring: 'ring-red-500/30' },
  gray: { bg: 'bg-zinc-500/10', border: 'border-zinc-600/30', ring: 'ring-zinc-500/20' },
};

const healthLabel: Record<string, string> = {
  green: 'Healthy',
  yellow: 'Stale',
  red: 'Offline',
  gray: 'No Signal',
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return `${Math.floor(diff / 604800000)}w ago`;
}

export function AgentGrid({ agents, onSelectAgent }: AgentGridProps) {
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch('/api/goals');
      if (res.ok) {
        const data = await res.json();
        setGoals(data.goals || []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const getAgentGoals = (agentId: string) =>
    goals.filter(g => g.ownerAgentId === agentId);

  const getTopGoal = (agentId: string) => {
    const agentGoals = getAgentGoals(agentId);
    return agentGoals.find(g => g.status === 'in_progress') || agentGoals[0] || null;
  };

  const getOverallProgress = (agentId: string) => {
    const agentGoals = getAgentGoals(agentId);
    if (agentGoals.length === 0) return 0;
    return Math.round(agentGoals.reduce((sum, g) => sum + g.progress, 0) / agentGoals.length);
  };

  if (!agents || agents.length === 0) {
    return <div className="text-sm text-muted-foreground italic">No agents found</div>;
  }

  return (
    <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 lg:grid-cols-12 xl:grid-cols-14 gap-1.5">
      {agents.map((agent) => {
        const colors = healthColors[agent.health] || healthColors.gray;
        const topGoal = getTopGoal(agent.id);
        const progress = getOverallProgress(agent.id);
        const agentGoals = getAgentGoals(agent.id);
        const isHovered = hoveredAgent === agent.id;

        return (
          <div
            key={agent.id}
            className="relative"
            onMouseEnter={() => setHoveredAgent(agent.id)}
            onMouseLeave={() => setHoveredAgent(null)}
          >
            <button
              onClick={() => onSelectAgent?.(agent.id)}
              className={cn(
                'w-full aspect-square rounded-lg border flex flex-col items-center justify-center',
                'transition-all duration-200 cursor-pointer group',
                'hover:scale-110 hover:shadow-lg hover:shadow-black/20',
                colors.bg, colors.border,
                isHovered && `ring-2 ${colors.ring}`
              )}
            >
              <span className="text-base md:text-lg lg:text-2xl xl:text-3xl leading-none">{agent.emoji}</span>
              <span className="text-[7px] md:text-[8px] lg:text-[10px] xl:text-xs text-muted-foreground mt-0.5 truncate max-w-full px-0.5 font-medium leading-none">
                {agent.id}
              </span>
              {/* Health dot */}
              <div className={cn(
                'absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full',
                agent.health === 'green' && 'bg-emerald-400 led-pulse',
                agent.health === 'yellow' && 'bg-yellow-400 led-pulse',
                agent.health === 'red' && 'bg-red-500',
                agent.health === 'gray' && 'bg-zinc-500',
              )} />
            </button>

            {/* Tooltip on hover */}
            {isHovered && (
              <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 glass-card p-3 space-y-2 shadow-xl shadow-black/30 pointer-events-none">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{agent.emoji}</span>
                  <div>
                    <div className="text-sm font-semibold">{agent.name || agent.id}</div>
                    <div className="text-[10px] text-muted-foreground">{agent.role || agent.status || healthLabel[agent.health]}</div>
                  </div>
                </div>

                {agentGoals.length > 0 ? (
                  <>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{agentGoals.length} goal{agentGoals.length !== 1 ? 's' : ''}</span>
                      <span className="font-mono">{progress}% avg</span>
                    </div>
                    <div className="h-1.5 bg-card/50 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          progress >= 80 ? 'bg-emerald-500' : progress >= 40 ? 'bg-sky-500' : 'bg-orange-500'
                        )}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    {topGoal && (
                      <div className="text-[11px] text-foreground/80 leading-snug">
                        <span className="text-muted-foreground">Focus:</span> {topGoal.title}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">No goals assigned</div>
                )}

                {agent.last_updated && (
                  <div className="text-[9px] text-muted-foreground/60">
                    Last seen {formatRelativeTime(new Date(agent.last_updated).getTime())}
                  </div>
                )}
                <div className="text-[9px] text-center text-muted-foreground/40">Click to view details</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
