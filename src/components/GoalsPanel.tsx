'use client';

import { CheckCircle2, ChevronDown, Circle, Loader2, Target } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** DB Goal with nested tasks from /api/goals */
interface DbGoal {
  id: string;
  title: string;
  status: string;       // "queued" | "in_progress" | "complete" | "blocked"
  progress: number;     // 0-100
  ownerAgentId: string | null;
  createdAt: string;
  completedAt?: string | null;
  tasks: DbTask[];
  ownerAgent?: { id: string; status: string } | null;
}

interface DbTask {
  id: string;
  title: string;
  status: string;   // "todo" | "in_progress" | "done" | "blocked"
  priority: string;
  assigneeId: string | null;
  completedAt: string | null;
}

// Agent emoji lookup — matches AGENTS.md fleet manifest
const AGENT_EMOJIS: Record<string, string> = {
  rocket: '🚀',
  captain: '🚢',
  warden: '🛡️',
  architect: '🏗️',
  envoy: '🕊️',
  gardener: '🌿',
  closer: '🤝',
  sarge: '🪖',
  accountant: '💼',
  'ric-flare': '📢',
};

const STATUS_CONFIG: Record<string, { color: string; ringColor: string; label: string }> = {
  complete: { color: 'text-emerald-400', ringColor: 'stroke-emerald-500', label: 'Complete' },
  in_progress: { color: 'text-yellow-400', ringColor: 'stroke-yellow-500', label: 'Active' },
  blocked: { color: 'text-red-400', ringColor: 'stroke-red-500', label: 'Blocked' },
  queued: { color: 'text-zinc-400', ringColor: 'stroke-zinc-500', label: 'Queued' },
};

// ---------------------------------------------------------------------------
// Progress Ring — tiny SVG circle
// ---------------------------------------------------------------------------

function ProgressRing({ progress, status, size = 28 }: { progress: number; status: string; size?: number }) {
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.queued;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" strokeWidth={strokeWidth}
        className="stroke-zinc-700/50"
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={`${config.ringColor} transition-all duration-500`}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Task row with status icon
// ---------------------------------------------------------------------------

function TaskRow({ task }: { task: DbTask }) {
  const isDone = task.status === 'done';
  const isInProgress = task.status === 'in_progress';
  const isBlocked = task.status === 'blocked';

  return (
    <div className="flex items-start gap-2 py-1">
      {isDone ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
      ) : isInProgress ? (
        <Loader2 className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5 animate-spin" />
      ) : isBlocked ? (
        <Circle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
      ) : (
        <Circle className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
      )}
      <span className={`text-xs leading-relaxed ${isDone ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
        {task.title}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single Goal Row — collapsible
// ---------------------------------------------------------------------------

function GoalRow({ goal }: { goal: DbGoal }) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[goal.status] || STATUS_CONFIG.queued;
  const emoji = goal.ownerAgentId ? AGENT_EMOJIS[goal.ownerAgentId] || '🤖' : '👤';
  const doneTasks = goal.tasks.filter(t => t.status === 'done').length;
  const totalTasks = goal.tasks.length;

  // Truncate title for the header
  const maxLen = 50;
  const truncated = goal.title.length > maxLen ? goal.title.slice(0, maxLen) + '…' : goal.title;

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden transition-colors hover:border-border/60">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left group"
      >
        {/* Progress ring */}
        <div className="relative">
          <ProgressRing progress={goal.progress} status={goal.status} />
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-zinc-300 rotate-0" style={{ transform: 'rotate(90deg)' }}>
            {goal.progress}
          </span>
        </div>

        {/* Agent emoji */}
        <span className="text-base shrink-0" title={goal.ownerAgentId || 'unassigned'}>{emoji}</span>

        {/* Title (truncated) */}
        <span className="text-sm text-zinc-200 truncate flex-1">{truncated}</span>

        {/* Task count badge */}
        {totalTasks > 0 && (
          <span className="text-[10px] text-zinc-500 font-mono shrink-0">
            {doneTasks}/{totalTasks}
          </span>
        )}

        {/* Expand chevron */}
        <ChevronDown
          className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-border/20 bg-zinc-900/30 space-y-2 animate-in slide-in-from-top-1 duration-150">
          {/* Full title + ID */}
          <div className="flex items-start gap-2">
            <span className={`text-xs font-mono ${config.color} shrink-0`}>{goal.id}</span>
            <span className="text-xs text-zinc-300 leading-relaxed">{goal.title}</span>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span>{emoji} {goal.ownerAgentId || 'unassigned'}</span>
            <span className={config.color}>{config.label}</span>
            <span>{goal.progress}% complete</span>
            {goal.createdAt && <span>Created {new Date(goal.createdAt).toLocaleDateString()}</span>}
          </div>

          {/* Tasks */}
          {goal.tasks.length > 0 && (
            <div className="mt-1 pl-1 border-l-2 border-zinc-700/50 ml-1">
              {goal.tasks.map(task => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          )}
          {goal.tasks.length === 0 && (
            <p className="text-[10px] text-zinc-600 italic">No tasks linked to this goal</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalsPanel — main export
// ---------------------------------------------------------------------------

interface GoalsPanelProps {
  /** Filter by agent ID. If null, shows all goals. */
  agentId?: string | null;
}

export function GoalsPanel({ agentId }: GoalsPanelProps) {
  const [goals, setGoals] = useState<DbGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    try {
      const url = agentId ? `/api/goals?agentId=${encodeURIComponent(agentId)}` : '/api/goals';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setGoals(data.goals || []);
      }
    } catch (e) {
      console.error('GoalsPanel fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchGoals();
    const timer = setInterval(fetchGoals, 30_000); // refresh every 30s
    return () => clearInterval(timer);
  }, [fetchGoals]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-zinc-500 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading goals…
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className="text-xs text-zinc-600 py-2 italic">No goals found</div>
    );
  }

  // Sort: in_progress first, then blocked, then queued, then complete
  const statusOrder: Record<string, number> = { blocked: 0, in_progress: 1, queued: 2, complete: 3 };
  const sorted = [...goals].sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));

  const activeCount = sorted.filter(g => g.status === 'in_progress' || g.status === 'blocked').length;
  const completeCount = sorted.filter(g => g.status === 'complete').length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5" />
          Strategic Goals
        </h2>
        <span className="text-[10px] text-zinc-500 font-mono">
          {activeCount} active · {completeCount} done · {sorted.length} total
        </span>
      </div>
      <div className="space-y-1.5">
        {sorted.map(goal => (
          <GoalRow key={goal.id} goal={goal} />
        ))}
      </div>
    </div>
  );
}
