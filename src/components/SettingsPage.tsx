'use client';

import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Eye,
  Loader2,
  Pause,
  Play,
  Plug,
  Plus,
  Save,
  Timer,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import HeartbeatTuning from './HeartbeatTuning';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrchestratorConfig {
  id: string;
  maxWakesPerTick: number;
  minIntervalMs: number;
  staggerDelayMs: number;
  tickIntervalMs: number;
  tpmLimit: number | null;
  quotaResetHours: number;
  journalEntries: number;
  mdInjections: string[] | null;
  enabled: boolean;
}

interface AgentSchedule {
  id: string;
  agentId: string;
  name: string;
  cronExpr: string | null;
  intervalMs: number | null;
  enabled: boolean;
  priority: number;
  payload: string | null;
  channel: string;
  deliverTo: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  agent: { id: string; role: string };
}

interface AgentInfo {
  id: string;
  role: string;
  status: string;
}

interface RecentWake {
  toId: string;
  subject: string | null;
  status: string;
  sentAt: string;
}

interface TimerStatus {
  running: boolean;
  tickCount: number;
  lastTickAt: string | null;
}

interface HeartbeatData {
  timer: TimerStatus;
  config: OrchestratorConfig | null;
  schedules: AgentSchedule[];
  recentWakes: RecentWake[];
  agents: AgentInfo[];
}

const AGENT_EMOJIS: Record<string, string> = {
  main: '⚙️',
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

const INTERVAL_PRESETS = [
  { label: '15m', ms: 900_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '4h', ms: 14_400_000 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff > 0 ? 'just now' : 'in <1m';
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return diff > 0 ? `${mins}m ago` : `in ${mins}m`;
  const hrs = Math.round(abs / 3_600_000);
  return diff > 0 ? `${hrs}h ago` : `in ${hrs}h`;
}

// Compute deconfliction preview: given agents with same interval,
// show their effective offset times
function computeDeconfliction(
  schedules: AgentSchedule[],
  staggerMs: number,
): { agentId: string; offsetMs: number; effectiveTime: string }[] {
  // Group by interval
  const byInterval = new Map<number, AgentSchedule[]>();
  for (const s of schedules.filter(s => s.enabled && s.intervalMs)) {
    const key = s.intervalMs!;
    if (!byInterval.has(key)) byInterval.set(key, []);
    byInterval.get(key)!.push(s);
  }

  const results: { agentId: string; offsetMs: number; effectiveTime: string }[] = [];

  for (const [intervalMs, group] of byInterval) {
    if (group.length < 2) {
      group.forEach(s => results.push({ agentId: s.agentId, offsetMs: 0, effectiveTime: `every ${formatMs(intervalMs)}` }));
      continue;
    }
    group.forEach((s, i) => {
      const offset = i * staggerMs;
      results.push({
        agentId: s.agentId,
        offsetMs: offset,
        effectiveTime: `every ${formatMs(intervalMs)} +${formatMs(offset)} offset`,
      });
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Section: Orchestrator Controls
// ---------------------------------------------------------------------------

function OrchestratorControls({
  config,
  onSave,
  saving,
}: {
  config: OrchestratorConfig;
  onSave: (updates: Partial<OrchestratorConfig>) => void;
  saving: boolean;
}) {
  const [maxWakes, setMaxWakes] = useState(config.maxWakesPerTick);
  const [stagger, setStagger] = useState(config.staggerDelayMs / 1000);
  const [tickInterval, setTickInterval] = useState(config.tickIntervalMs / 1000);

  const dirty =
    maxWakes !== config.maxWakesPerTick ||
    stagger !== config.staggerDelayMs / 1000 ||
    tickInterval !== config.tickIntervalMs / 1000;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {/* Max Wakes Per Tick */}
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">
            Max Wakes / Tick
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={maxWakes}
              onChange={e => setMaxWakes(parseInt(e.target.value) || 1)}
              min={1}
              max={20}
              className="w-16 bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200 text-center"
            />
            <span className="text-[10px] text-zinc-600">agents per cycle</span>
          </div>
        </div>

        {/* Stagger Delay */}
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">
            Stagger / Drip Delay
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={stagger}
              onChange={e => setStagger(parseInt(e.target.value) || 5)}
              min={5}
              max={300}
              className="w-16 bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200 text-center"
            />
            <span className="text-[10px] text-zinc-600">seconds between wakes</span>
          </div>
        </div>

        {/* Tick Interval */}
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">
            Tick Interval
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={tickInterval}
              onChange={e => setTickInterval(parseInt(e.target.value) || 10)}
              min={10}
              max={600}
              className="w-16 bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200 text-center"
            />
            <span className="text-[10px] text-zinc-600">seconds per check</span>
          </div>
        </div>
      </div>

      {dirty && (
        <button
          onClick={() =>
            onSave({
              maxWakesPerTick: maxWakes,
              staggerDelayMs: stagger * 1000,
              tickIntervalMs: tickInterval * 1000,
            })
          }
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-600 text-white font-medium hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save Changes
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Agent Schedule Row
// ---------------------------------------------------------------------------

function AgentScheduleRow({
  schedule,
  agentRole,
  deconflictInfo,
  onToggle,
  onIntervalChange,
  onDelete,
}: {
  schedule: AgentSchedule;
  agentRole: string;
  deconflictInfo?: { offsetMs: number; effectiveTime: string };
  onToggle: (id: string, enabled: boolean) => void;
  onIntervalChange: (id: string, intervalMs: number) => void;
  onDelete: (id: string) => void;
}) {
  const emoji = AGENT_EMOJIS[schedule.agentId] || '🤖';
  const [showCustom, setShowCustom] = useState(false);
  const [customMin, setCustomMin] = useState(
    schedule.intervalMs ? Math.round(schedule.intervalMs / 60_000) : 30
  );

  const currentPreset = INTERVAL_PRESETS.find(p => p.ms === schedule.intervalMs);

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 border border-border/30 rounded-lg group transition-all hover:border-border/60',
        !schedule.enabled && 'opacity-40'
      )}
    >
      {/* Toggle */}
      <button onClick={() => onToggle(schedule.id, !schedule.enabled)} className="shrink-0">
        {schedule.enabled ? (
          <Play className="w-4 h-4 text-emerald-400 fill-emerald-400" />
        ) : (
          <Pause className="w-4 h-4 text-zinc-600" />
        )}
      </button>

      {/* Agent */}
      <span className="text-base shrink-0" title={schedule.agentId}>
        {emoji}
      </span>
      <div className="flex-1 min-w-0">
        <span className={cn('text-sm truncate block', schedule.enabled ? 'text-zinc-200' : 'text-zinc-500')}>
          {schedule.agentId}
        </span>
        <span className="text-[10px] text-zinc-600 truncate block">{agentRole}</span>
      </div>

      {/* Interval selector */}
      <div className="flex items-center gap-1 shrink-0">
        {INTERVAL_PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => {
              onIntervalChange(schedule.id, p.ms);
              setShowCustom(false);
            }}
            className={cn(
              'px-2 py-0.5 text-[10px] rounded-full border transition-colors',
              schedule.intervalMs === p.ms
                ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                : 'border-border/30 text-zinc-600 hover:text-zinc-400'
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={cn(
            'px-2 py-0.5 text-[10px] rounded-full border transition-colors',
            showCustom || (!currentPreset && schedule.intervalMs)
              ? 'bg-violet-500/20 border-violet-500/50 text-violet-400'
              : 'border-border/30 text-zinc-600 hover:text-zinc-400'
          )}
        >
          {!currentPreset && schedule.intervalMs ? formatMs(schedule.intervalMs) : '⚙️'}
        </button>
      </div>

      {/* Custom interval input */}
      {showCustom && (
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            value={customMin}
            onChange={e => setCustomMin(parseInt(e.target.value) || 1)}
            min={1}
            className="w-14 bg-zinc-800 border border-border rounded px-1.5 py-0.5 text-[10px] text-zinc-200 text-center"
          />
          <span className="text-[10px] text-zinc-600">min</span>
          <button
            onClick={() => {
              onIntervalChange(schedule.id, customMin * 60_000);
              setShowCustom(false);
            }}
            className="p-0.5 rounded hover:bg-zinc-700/50 text-emerald-400"
          >
            <Check className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Deconfliction badge */}
      {deconflictInfo && deconflictInfo.offsetMs > 0 && (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-mono shrink-0">
          +{formatMs(deconflictInfo.offsetMs)}
        </span>
      )}

      {/* Last / Next wake */}
      <div className="text-right shrink-0 w-16 hidden sm:block">
        <div className="text-[10px] text-zinc-500">{formatRelative(schedule.nextRunAt)}</div>
        <div className="text-[9px] text-zinc-700">{formatRelative(schedule.lastRunAt)}</div>
      </div>

      {/* Delete */}
      <button
        onClick={() => onDelete(schedule.id)}
        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Add Schedule Modal
// ---------------------------------------------------------------------------

function AddScheduleModal({
  agents,
  existingAgentIds,
  onAdd,
  onClose,
}: {
  agents: AgentInfo[];
  existingAgentIds: Set<string>;
  onAdd: (agentId: string, intervalMs: number) => void;
  onClose: () => void;
}) {
  const availableAgents = agents.filter(a => !existingAgentIds.has(a.id));
  const [selectedAgent, setSelectedAgent] = useState(availableAgents[0]?.id || '');
  const [intervalMs, setIntervalMs] = useState(1_800_000); // 30m default

  if (availableAgents.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-zinc-900 border border-border rounded-xl p-5 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-zinc-400">All agents already have heartbeat schedules.</p>
          <button onClick={onClose} className="mt-3 px-3 py-1.5 text-xs rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-border rounded-xl w-full max-w-md mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Add Heartbeat Schedule</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Agent</label>
            <select
              value={selectedAgent}
              onChange={e => setSelectedAgent(e.target.value)}
              className="w-full bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200"
            >
              {availableAgents.map(a => (
                <option key={a.id} value={a.id}>
                  {AGENT_EMOJIS[a.id] || '🤖'} {a.id} — {a.role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">Interval</label>
            <div className="flex gap-2 flex-wrap">
              {INTERVAL_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setIntervalMs(p.ms)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    intervalMs === p.ms
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                      : 'border-border/40 text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-xs rounded border border-border text-zinc-500 hover:text-zinc-300">
              Cancel
            </button>
            <button
              onClick={() => onAdd(selectedAgent, intervalMs)}
              className="px-4 py-1.5 text-xs rounded bg-blue-600 text-white font-medium hover:bg-blue-500 flex items-center gap-1.5"
            >
              <Plus className="w-3 h-3" /> Add Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Deconfliction Timeline
// ---------------------------------------------------------------------------

function DeconflictionTimeline({
  schedules,
  staggerMs,
}: {
  schedules: AgentSchedule[];
  staggerMs: number;
}) {
  const deconfliction = computeDeconfliction(schedules, staggerMs);

  if (deconfliction.length === 0) return null;

  // Group by interval for visual clarity
  const byInterval = new Map<string, typeof deconfliction>();
  for (const d of deconfliction) {
    const sched = schedules.find(s => s.agentId === d.agentId);
    const key = sched?.intervalMs ? formatMs(sched.intervalMs) : 'custom';
    if (!byInterval.has(key)) byInterval.set(key, []);
    byInterval.get(key)!.push(d);
  }

  const hasConflicts = deconfliction.some((_, i, arr) => {
    if (i === 0) return false;
    return arr[i].offsetMs === arr[i - 1].offsetMs && arr[i].offsetMs === 0;
  });

  return (
    <div className="border border-dashed border-yellow-500/30 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <Zap className="w-3.5 h-3.5 text-yellow-400" />
        <span className="text-xs text-yellow-400 font-medium">Auto-Deconfliction Preview</span>
        {!hasConflicts && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 ml-auto">
            ✓ No conflicts
          </span>
        )}
      </div>
      <div className="px-4 pb-3 bg-yellow-500/5 space-y-3">
        <p className="text-[10px] text-zinc-500 pt-1">
          When multiple agents share the same interval, the stagger delay ({formatMs(staggerMs)}) offsets their wake times to prevent API rate limits.
        </p>
        {[...byInterval.entries()].map(([interval, agents]) => (
          <div key={interval}>
            {byInterval.size > 1 && (
              <div className="text-[10px] text-zinc-500 mb-1 font-mono">— every {interval} —</div>
            )}
            <div className="grid gap-1">
              {agents.map(a => (
                <div key={a.agentId} className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-center">{AGENT_EMOJIS[a.agentId] || '🤖'}</span>
                  <span className="text-zinc-400 w-20 truncate">{a.agentId}</span>
                  {a.offsetMs > 0 ? (
                    <code className="text-yellow-400 font-mono text-[10px]">+{formatMs(a.offsetMs)} offset</code>
                  ) : (
                    <code className="text-emerald-400 font-mono text-[10px]">base (no offset)</code>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Recent Wake Log
// ---------------------------------------------------------------------------

function RecentWakeLog({ wakes }: { wakes: RecentWake[] }) {
  if (wakes.length === 0) {
    return (
      <p className="text-xs text-zinc-600 italic py-2">No wakes in the last hour</p>
    );
  }
  return (
    <div className="space-y-1 max-h-40 overflow-y-auto">
      {wakes.map((w, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            w.status === 'delivered' ? 'bg-emerald-500' : w.status === 'failed' ? 'bg-red-500' : 'bg-zinc-500'
          )} />
          <span className="w-5 text-center shrink-0">{AGENT_EMOJIS[w.toId] || '🤖'}</span>
          <span className="text-zinc-400 w-20 truncate shrink-0">{w.toId}</span>
          <span className="text-zinc-600 truncate flex-1">{w.subject || '—'}</span>
          <span className="text-[10px] text-zinc-700 shrink-0">{formatRelative(w.sentAt)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: OpenClaw Cron Jobs (read-only)
// ---------------------------------------------------------------------------

interface CronJobInfo {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; expr?: string; everyMs?: number };
  state?: { lastStatus?: string; consecutiveErrors?: number; nextRunAtMs?: number };
}

function CronJobsReadOnly({ jobs }: { jobs: CronJobInfo[] }) {
  if (jobs.length === 0) {
    return <p className="text-xs text-zinc-600 italic py-2">No cron jobs found</p>;
  }
  return (
    <div className="space-y-1">
      {jobs.map(j => (
        <div key={j.id} className={cn('flex items-center gap-2 text-xs px-2 py-1.5 rounded', !j.enabled && 'opacity-40')}>
          <span className="w-5 text-center shrink-0">{AGENT_EMOJIS[j.agentId] || '🤖'}</span>
          <span className={cn('flex-1 truncate', j.enabled ? 'text-zinc-300' : 'text-zinc-600 line-through')}>
            {j.name}
          </span>
          <code className="text-[10px] text-zinc-500 font-mono shrink-0">
            {j.schedule.expr || (j.schedule.everyMs ? `every ${formatMs(j.schedule.everyMs)}` : j.schedule.kind)}
          </code>
          {j.state?.consecutiveErrors ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">{j.state.consecutiveErrors}err</span>
          ) : j.state?.lastStatus === 'ok' ? (
            <Check className="w-3 h-3 text-emerald-500 shrink-0" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Rebuild Control
// ---------------------------------------------------------------------------

function RebuildControl() {
  const [status, setStatus] = useState<'idle' | 'confirming' | 'building' | 'complete' | 'failed'>('idle');
  const [logLines, setLogLines] = useState<string[]>([]);

  const startRebuild = async () => {
    setStatus('building');
    setLogLines(['Starting rebuild…']);
    try {
      const res = await fetch('/api/control-rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rebuild' }),
      });
      const data = await res.json();
      if (!data.ok) {
        setStatus('failed');
        setLogLines(prev => [...prev, `Error: ${data.message}`]);
        return;
      }
      // Poll for status
      const poll = setInterval(async () => {
        try {
          const sRes = await fetch('/api/control-rebuild', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'status' }),
          });
          const sData = await sRes.json();
          if (sData.lines?.length) setLogLines(sData.lines);
          if (sData.status === 'complete') {
            clearInterval(poll);
            setStatus('complete');
          } else if (sData.status === 'failed') {
            clearInterval(poll);
            setStatus('failed');
          }
        } catch {
          // Server likely down during rebuild, keep polling
        }
      }, 3000);
      // Safety timeout — stop polling after 5 min
      setTimeout(() => clearInterval(poll), 300_000);
    } catch {
      setStatus('failed');
      setLogLines(prev => [...prev, 'Failed to reach API']);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-300 font-medium">Production Rebuild</div>
          <div className="text-[10px] text-zinc-600 mt-0.5">
            Stops the service, runs <code className="bg-zinc-800 px-1 rounded">npm run build</code>, then restarts.
          </div>
        </div>
        {status === 'idle' && (
          <button
            onClick={() => setStatus('confirming')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-amber-600/80 text-white font-medium hover:bg-amber-500 transition-colors"
          >
            <Zap className="w-3 h-3" /> Rebuild
          </button>
        )}
        {status === 'confirming' && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-amber-400">This will take the UI offline briefly.</span>
            <button
              onClick={startRebuild}
              className="px-3 py-1.5 text-xs rounded bg-red-600 text-white font-medium hover:bg-red-500 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setStatus('idle')}
              className="px-3 py-1.5 text-xs rounded border border-border text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        {status === 'building' && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <Loader2 className="w-3 h-3 animate-spin" /> Building…
          </span>
        )}
        {status === 'complete' && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <Check className="w-3 h-3" /> Done — page will reload
          </span>
        )}
        {status === 'failed' && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertTriangle className="w-3 h-3" /> Failed
            </span>
            <button
              onClick={() => { setStatus('idle'); setLogLines([]); }}
              className="px-2 py-1 text-[10px] rounded border border-border text-zinc-500 hover:text-zinc-300"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Build log */}
      {logLines.length > 0 && (status === 'building' || status === 'complete' || status === 'failed') && (
        <div className="bg-zinc-950 border border-border/30 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-[10px] text-zinc-500 space-y-0.5">
          {logLines.map((line, i) => (
            <div key={i} className={cn(
              line.includes('Error') || line.includes('ERR!') ? 'text-red-400' :
                line.includes('===') ? 'text-amber-400 font-semibold' :
                  line.startsWith('[') ? 'text-cyan-400' : ''
            )}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Railway Integration
// ---------------------------------------------------------------------------

function RailwayIntegration() {
  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [tokenAge, setTokenAge] = useState<number | null>(null);
  const [healthy, setHealthy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  const checkStatus = useCallback(() => {
    // Check URL params for fresh connection result
    const params = new URLSearchParams(window.location.search);
    const railwayParam = params.get('railway');
    if (railwayParam === 'connected') {
      setStatus('connected');
      setHealthy(true);
      params.delete('railway');
      const clean = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (clean ? `?${clean}` : ''));
      return;
    }
    if (railwayParam === 'error') {
      setStatus('disconnected');
      return;
    }

    // Check server-side token presence
    fetch('/api/auth/railway/status')
      .then(res => res.json())
      .then(data => {
        setStatus(data.connected ? 'connected' : 'disconnected');
        setLastRefresh(data.lastRefreshAt);
        setTokenAge(data.tokenAgeMinutes);
        setHealthy(data.healthy ?? false);
      })
      .catch(() => setStatus('disconnected'));
  }, []);

  useEffect(() => {
    checkStatus();
    const timer = setInterval(checkStatus, 30_000);
    return () => clearInterval(timer);
  }, [checkStatus]);

  const handleConnect = () => {
    window.location.href = '/api/auth/railway/login';
  };

  const handleRefreshNow = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const res = await fetch('/api/cron/refresh-tokens');
      const data = await res.json();
      if (data.status === 'ok') {
        setRefreshResult(`✓ Refreshed — ${data.accountToken?.distributed ?? 0} workspaces, ${data.projectTokens?.generated ?? 0} project tokens`);
        setHealthy(true);
        setLastRefresh(data.refreshedAt);
        setTokenAge(0);
      } else {
        setRefreshResult(`✗ ${data.message || data.error || 'Failed'}`);
      }
    } catch {
      setRefreshResult('✗ Failed to reach refresh endpoint');
    } finally {
      setRefreshing(false);
    }
  };

  const isConnected = status === 'connected';

  return (
    <div className="rounded-lg border border-purple-500/20 bg-gradient-to-br from-purple-950/30 to-zinc-900/50 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M.527 17.236c-.348-.678-.49-1.404-.49-2.164V8.928c0-.76.142-1.486.49-2.164L7.08 12l-6.553 5.236ZM2.56 3.2c.503-.454 1.09-.753 1.737-.882L15.07 12 4.297 21.682c-.647-.13-1.234-.428-1.737-.882L10.927 12 2.56 3.2ZM7.378 1.418C7.99 1.147 8.66 1 9.373 1h5.254c.714 0 1.384.147 1.995.418L9.073 7.657 7.378 1.418ZM17.44 3.2c.503.454.902 1.014 1.184 1.636L12.927 12l5.697 7.164c-.282.622-.681 1.182-1.184 1.636L8.927 12l8.513-8.8ZM23.473 6.764c.348.678.49 1.404.49 2.164v6.144c0 .76-.142 1.486-.49 2.164L16.92 12l6.553-5.236ZM16.622 22.582c-.611.27-1.281.418-1.995.418H9.373c-.714 0-1.384-.147-1.995-.418l7.549-6.239 1.695 6.239Z" fill="#C084FC" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">Railway</h3>
            <p className="text-xs text-zinc-500">Automated deployments & infrastructure</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <button
              onClick={handleRefreshNow}
              disabled={refreshing}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-all duration-200 active:scale-95 disabled:opacity-50"
            >
              {refreshing ? '⟳ Refreshing…' : '⟳ Refresh Now'}
            </button>
          )}
          <button
            onClick={handleConnect}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/20 active:scale-95"
          >
            {isConnected ? 'Reconnect' : 'Connect Railway'}
          </button>
        </div>
      </div>

      {/* Status row */}
      <div className="mt-4 text-xs text-zinc-500 bg-zinc-900/40 px-3 py-2.5 rounded-md border border-zinc-800/50 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-1.5 h-1.5 rounded-full',
            isConnected && healthy ? 'bg-emerald-500' :
              isConnected && !healthy ? 'bg-amber-500 animate-pulse' :
                'bg-zinc-600'
          )}></div>
          <span>
            {isConnected && healthy ? 'Connected & healthy' :
              isConnected && !healthy ? 'Connected — token may be stale' :
                status === 'checking' ? 'Checking…' : 'Not connected'}
          </span>
        </div>
        {lastRefresh && (
          <div className="flex items-center gap-2 text-[10px] text-zinc-600">
            <span>Last refresh: {new Date(lastRefresh).toLocaleString()}</span>
            {tokenAge !== null && (
              <span className={cn(
                'px-1.5 py-0.5 rounded',
                tokenAge < 50 ? 'bg-emerald-500/10 text-emerald-400' :
                  tokenAge < 65 ? 'bg-amber-500/10 text-amber-400' :
                    'bg-red-500/10 text-red-400'
              )}>
                {tokenAge}m ago
              </span>
            )}
          </div>
        )}
        {refreshResult && (
          <div className={cn(
            'text-[10px] mt-1',
            refreshResult.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'
          )}>
            {refreshResult}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage({
  connected,
  connecting,
}: {
  connected: boolean;
  connecting: boolean;
}) {
  const [data, setData] = useState<HeartbeatData | null>(null);
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string[]>(['orchestrator', 'schedules', 'integrations']);

  const fetchData = useCallback(async () => {
    try {
      const [hbRes, cronRes] = await Promise.all([
        fetch('/api/heartbeat/status'),
        fetch('/api/cron-jobs'),
      ]);
      if (hbRes.ok) setData(await hbRes.json());
      if (cronRes.ok) {
        const cronData = await cronRes.json();
        setCronJobs(cronData.jobs || []);
      }
    } catch (e) {
      console.error('Settings fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 15_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const toggleSection = (id: string) => {
    setExpandedSection(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  // --- Config save ---
  const saveConfig = async (updates: Partial<OrchestratorConfig>) => {
    setSaving(true);
    try {
      await fetch('/api/orchestrator/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  // --- Toggle orchestrator ---
  const toggleOrchestrator = async () => {
    if (!data?.config) return;
    await saveConfig({ enabled: !data.config.enabled });
  };

  // --- Schedule operations ---
  const toggleSchedule = async (id: string, enabled: boolean) => {
    setSaving(true);
    try {
      await fetch('/api/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  const changeInterval = async (id: string, intervalMs: number) => {
    setSaving(true);
    try {
      await fetch('/api/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, intervalMs, cronExpr: null }),
      });
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Delete this heartbeat schedule?')) return;
    setSaving(true);
    try {
      await fetch('/api/schedules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  const addSchedule = async (agentId: string, intervalMs: number) => {
    setSaving(true);
    try {
      await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          type: 'heartbeat',
          name: 'Heartbeat',
          intervalMs,
          priority: 1,
          payload: `🤖 Heartbeat: Read HEARTBEAT.md, run roster_checkin, check task_list, report status.`,
          channel: 'discord',
          deliverTo: 'user:339585248826228749',
          enabled: true,
        }),
      });
      setShowAddModal(false);
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  // --- Bulk actions ---
  const enableAll = async () => {
    setSaving(true);
    try {
      for (const s of data?.schedules || []) {
        if (!s.enabled) {
          await fetch('/api/schedules', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: s.id, enabled: true }),
          });
        }
      }
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  const disableAll = async () => {
    setSaving(true);
    try {
      for (const s of data?.schedules || []) {
        if (s.enabled) {
          await fetch('/api/schedules', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: s.id, enabled: false }),
          });
        }
      }
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  // Deconfliction data
  const deconfliction = useMemo(
    () => computeDeconfliction(data?.schedules || [], data?.config?.staggerDelayMs || 30_000),
    [data]
  );

  const existingAgentIds = useMemo(
    () => new Set(data?.schedules.map(s => s.agentId) || []),
    [data]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {/* ============ HEARTBEAT ORCHESTRATOR ============ */}
      <div className="glass-card overflow-hidden">
        <div
          onClick={() => toggleSection('orchestrator')}
          className="w-full flex items-center gap-3 px-5 py-3 text-left cursor-pointer"
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleSection('orchestrator'); }}
        >
          <Activity className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-zinc-200 flex-1">Heartbeat Orchestrator</span>

          {/* Live status badges */}
          <div className="flex items-center gap-2 mr-2">
            {data?.config?.enabled ? (
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Running
              </span>
            ) : (
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-500 font-medium">
                Stopped
              </span>
            )}
            {data?.config && (
              <span className="text-[10px] text-zinc-600 font-mono">
                tick #{data.timer.tickCount}
              </span>
            )}
          </div>

          {/* Master toggle */}
          <button
            onClick={e => {
              e.stopPropagation();
              toggleOrchestrator();
            }}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0',
              data?.config?.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
            )}
          >
            <span
              className={cn(
                'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                data?.config?.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
              )}
            />
          </button>

          <ChevronDown
            className={cn('w-4 h-4 text-zinc-500 transition-transform',
              expandedSection.includes('orchestrator') && 'rotate-180'
            )}
          />
        </div>

        {expandedSection.includes('orchestrator') && data?.config && (
          <div className="px-5 pb-5 border-t border-border/30 pt-4 space-y-4">
            <OrchestratorControls config={data.config} onSave={saveConfig} saving={saving} />

            {/* Timer status */}
            <div className="flex items-center gap-4 text-[10px] text-zinc-600">
              <span>Last tick: {formatRelative(data.timer.lastTickAt)}</span>
              <span>Tick interval: {formatMs(data.config.tickIntervalMs)}</span>
              <span>Stagger: {formatMs(data.config.staggerDelayMs)}</span>
              <span>Max wakes/tick: {data.config.maxWakesPerTick}</span>
            </div>
          </div>
        )}
      </div>

      {/* ============ HEARTBEAT CONTEXT TUNING ============ */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('context')}
          className="w-full flex items-center gap-3 px-5 py-3 text-left"
        >
          <BookOpen className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-zinc-200 flex-1">Heartbeat Context</span>
          <span className="text-[10px] text-zinc-600 mr-2">
            {data?.config?.journalEntries ?? 5} journal entries · {(data?.config?.mdInjections as string[] || []).length} injections
          </span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-500 transition-transform',
              expandedSection.includes('context') && 'rotate-180'
            )}
          />
        </button>

        {expandedSection.includes('context') && data?.config && (
          <div className="px-5 pb-5 border-t border-border/30 pt-4">
            <HeartbeatTuning
              agents={data.agents}
              config={{
                journalEntries: data.config.journalEntries ?? 5,
                mdInjections: (data.config.mdInjections as string[]) || [],
              }}
              onSave={(updates) => saveConfig(updates as Partial<OrchestratorConfig>)}
              saving={saving}
            />
          </div>
        )}
      </div>

      {/* ============ AGENT HEARTBEAT SCHEDULES ============ */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('schedules')}
          className="w-full flex items-center gap-3 px-5 py-3 text-left"
        >
          <Timer className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-200 flex-1">Agent Heartbeat Schedules</span>
          <span className="text-[10px] text-zinc-600 mr-2">
            {data?.schedules.filter(s => s.enabled).length || 0} active / {data?.schedules.length || 0} total
          </span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-500 transition-transform',
              expandedSection.includes('schedules') && 'rotate-180'
            )}
          />
        </button>

        {expandedSection.includes('schedules') && (
          <div className="px-5 pb-5 border-t border-border/30 pt-4 space-y-3">
            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded bg-blue-600/80 text-white font-medium hover:bg-blue-500 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add Agent
              </button>
              <button
                onClick={enableAll}
                className="px-2.5 py-1 text-[10px] rounded border border-border/40 text-zinc-500 hover:text-emerald-400 hover:border-emerald-500/30 transition-colors"
              >
                Enable All
              </button>
              <button
                onClick={disableAll}
                className="px-2.5 py-1 text-[10px] rounded border border-border/40 text-zinc-500 hover:text-red-400 hover:border-red-500/30 transition-colors"
              >
                Disable All
              </button>
              {saving && <Loader2 className="w-3 h-3 animate-spin text-blue-400 ml-auto" />}
            </div>

            {/* Schedule rows */}
            <div className="space-y-1.5">
              {(data?.schedules || []).map(s => {
                const info = deconfliction.find(d => d.agentId === s.agentId);
                const agentInfo = data?.agents.find(a => a.id === s.agentId);
                return (
                  <AgentScheduleRow
                    key={s.id}
                    schedule={s}
                    agentRole={agentInfo?.role || s.agent?.role || ''}
                    deconflictInfo={info}
                    onToggle={toggleSchedule}
                    onIntervalChange={changeInterval}
                    onDelete={deleteSchedule}
                  />
                );
              })}
              {(!data?.schedules || data.schedules.length === 0) && (
                <p className="text-xs text-zinc-600 py-4 text-center italic">
                  No heartbeat schedules configured. Click &quot;Add Agent&quot; to create one.
                </p>
              )}
            </div>

            {/* Deconfliction Preview */}
            {(data?.schedules || []).filter(s => s.enabled).length >= 2 && (
              <DeconflictionTimeline
                schedules={data?.schedules || []}
                staggerMs={data?.config?.staggerDelayMs || 30_000}
              />
            )}
          </div>
        )}
      </div>

      {/* ============ INTEGRATIONS ============ */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('integrations')}
          className="w-full flex items-center gap-3 px-5 py-3 text-left"
        >
          <Plug className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-zinc-200 flex-1">Integrations</span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-500 transition-transform',
              expandedSection.includes('integrations') && 'rotate-180'
            )}
          />
        </button>

        {expandedSection.includes('integrations') && (
          <div className="px-5 pb-5 border-t border-border/30 pt-4 space-y-4">
            <RailwayIntegration />
          </div>
        )}
      </div>

      {/* ============ RECENT ACTIVITY ============ */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('activity')}
          className="w-full flex items-center gap-3 px-5 py-3 text-left"
        >
          <Eye className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-zinc-200 flex-1">Recent Wake Activity</span>
          <span className="text-[10px] text-zinc-600 mr-2">
            {data?.recentWakes.length || 0} in last hour
          </span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-500 transition-transform',
              expandedSection.includes('activity') && 'rotate-180'
            )}
          />
        </button>

        {expandedSection.includes('activity') && (
          <div className="px-5 pb-4 border-t border-border/30 pt-3">
            <RecentWakeLog wakes={data?.recentWakes || []} />
          </div>
        )}
      </div>

      {/* ============ GATEWAY CONNECTION ============ */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('gateway')}
          className="w-full flex items-center gap-3 px-5 py-3 text-left"
        >
          {connected ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-zinc-500" />
          )}
          <span className="text-sm font-semibold text-zinc-200 flex-1">Gateway Connection</span>
          <span className={cn(
            'text-[10px] font-medium mr-2',
            connected ? 'text-emerald-400' : 'text-zinc-600'
          )}>
            {connected ? 'Connected' : connecting ? 'Connecting…' : 'Disconnected'}
          </span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-500 transition-transform',
              expandedSection.includes('gateway') && 'rotate-180'
            )}
          />
        </button>

        {expandedSection.includes('gateway') && (
          <div className="px-5 pb-4 border-t border-border/30 pt-3 space-y-2">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Gateway URL</label>
              <div className="bg-zinc-800/50 rounded px-3 py-2 font-mono text-xs text-zinc-400 break-all mt-1">
                {process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <div className={cn('w-2 h-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-zinc-600')} />
              {connected ? 'WebSocket stream active' : connecting ? 'Attempting connection…' : 'No active connection'}
            </div>
          </div>
        )}
      </div>

      {/* ============ OPENCLAW CRON JOBS (read-only) ============ */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('cron')}
          className="w-full flex items-center gap-3 px-5 py-3 text-left"
        >
          <Clock className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-zinc-200 flex-1">OpenClaw Cron Jobs</span>
          <span className="text-[10px] text-zinc-600 mr-2">
            {cronJobs.filter(j => j.enabled).length} active / {cronJobs.length} total (read-only)
          </span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-500 transition-transform',
              expandedSection.includes('cron') && 'rotate-180'
            )}
          />
        </button>

        {expandedSection.includes('cron') && (
          <div className="px-5 pb-4 border-t border-border/30 pt-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-3 h-3 text-yellow-500" />
              <span className="text-[10px] text-yellow-500/80">
                Managed by OpenClaw runtime — view only
              </span>
            </div>
            <CronJobsReadOnly jobs={cronJobs} />
          </div>
        )}
      </div>

      {/* ============ SYSTEM ============ */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('system')}
          className="w-full flex items-center gap-3 px-5 py-3 text-left"
        >
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-zinc-200 flex-1">System</span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-500 transition-transform',
              expandedSection.includes('system') && 'rotate-180'
            )}
          />
        </button>

        {expandedSection.includes('system') && (
          <div className="px-5 pb-5 border-t border-border/30 pt-4 space-y-3">
            <RebuildControl />
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAddModal && data && (
        <AddScheduleModal
          agents={data.agents}
          existingAgentIds={existingAgentIds}
          onAdd={addSchedule}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
