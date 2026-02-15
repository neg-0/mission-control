'use client';

import {
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  Pause,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  RepeatIcon,
  Timer,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types (matching OpenClaw jobs.json schema)
// ---------------------------------------------------------------------------

interface CronSchedule {
  kind: 'cron' | 'at' | 'every';
  expr?: string;
  at?: string;
  everyMs?: number;
  tz?: string;
}

interface CronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget?: string;
  wakeMode?: string;
  payload?: { text?: string; kind?: string; message?: string; model?: string };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'cron' && schedule.expr) {
    return schedule.expr;
  }
  if (schedule.kind === 'at' && schedule.at) {
    return new Date(schedule.at).toLocaleString();
  }
  if (schedule.kind === 'every' && schedule.everyMs) {
    const mins = Math.round(schedule.everyMs / 60000);
    if (mins < 60) return `every ${mins}m`;
    return `every ${Math.round(mins / 60)}h`;
  }
  return schedule.kind;
}

function formatTimezone(schedule: CronSchedule): string {
  if (schedule.tz) {
    const city = schedule.tz.split('/')[1]?.replace(/_/g, ' ') || schedule.tz;
    return city;
  }
  return 'UTC';
}

function formatRelativeTime(ms: number): string {
  const diff = ms - Date.now();
  const absDiff = Math.abs(diff);
  const mins = Math.round(absDiff / 60000);
  const hrs = Math.round(absDiff / 3600000);
  if (absDiff < 60000) return diff > 0 ? 'in <1m' : '<1m ago';
  if (mins < 60) return diff > 0 ? `in ${mins}m` : `${mins}m ago`;
  if (hrs < 24) return diff > 0 ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

function ScheduleIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'cron': return <RepeatIcon className="w-3.5 h-3.5" />;
    case 'at': return <Calendar className="w-3.5 h-3.5" />;
    case 'every': return <Timer className="w-3.5 h-3.5" />;
    default: return <Clock className="w-3.5 h-3.5" />;
  }
}

// ---------------------------------------------------------------------------
// Job Row — single job with inline actions
// ---------------------------------------------------------------------------

function JobRow({
  job,
  onToggle,
  onEdit,
  onDelete,
}: {
  job: CronJob;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (job: CronJob) => void;
  onDelete: (id: string) => void;
}) {
  const emoji = AGENT_EMOJIS[job.agentId] || '🤖';
  const lastOk = job.state?.lastStatus === 'ok';
  const errors = job.state?.consecutiveErrors || 0;

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 border border-border/30 rounded-lg group transition-all hover:border-border/60 ${!job.enabled ? 'opacity-40' : ''}`}>
      {/* Toggle enabled */}
      <button
        onClick={() => onToggle(job.id, !job.enabled)}
        className="shrink-0 transition-colors"
        title={job.enabled ? 'Pause job' : 'Enable job'}
      >
        {job.enabled ? (
          <Play className="w-4 h-4 text-emerald-400 fill-emerald-400" />
        ) : (
          <Pause className="w-4 h-4 text-zinc-600" />
        )}
      </button>

      {/* Agent emoji */}
      <span className="text-base shrink-0" title={job.agentId}>{emoji}</span>

      {/* Name */}
      <span className={`text-sm flex-1 truncate ${job.enabled ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}>
        {job.name}
      </span>

      {/* Schedule badge */}
      <span className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono shrink-0">
        <ScheduleIcon kind={job.schedule.kind} />
        {formatSchedule(job.schedule)}
      </span>

      {/* Timezone */}
      {job.schedule.tz && (
        <span className="text-[10px] text-zinc-600 shrink-0 hidden lg:inline">
          {formatTimezone(job.schedule)}
        </span>
      )}

      {/* Status */}
      <div className="flex items-center gap-1 shrink-0">
        {errors > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">{errors}err</span>
        )}
        {lastOk && <Check className="w-3 h-3 text-emerald-500" />}
        {job.deleteAfterRun && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium">once</span>
        )}
      </div>

      {/* Next / Last run */}
      <span className="text-[10px] text-zinc-600 shrink-0 w-16 text-right hidden sm:block">
        {job.state?.nextRunAtMs
          ? formatRelativeTime(job.state.nextRunAtMs)
          : job.state?.lastRunAtMs
            ? formatRelativeTime(job.state.lastRunAtMs)
            : '—'}
      </span>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
        <button
          onClick={() => onEdit(job)}
          className="p-1 rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-300"
          title="Edit"
        >
          <PenLine className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(job.id)}
          className="p-1 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create/Edit Modal
// ---------------------------------------------------------------------------

function JobModal({
  job,
  onSave,
  onClose,
}: {
  job: CronJob | null; // null = create mode
  onSave: (data: Partial<CronJob> & { agentId: string; name: string }) => void;
  onClose: () => void;
}) {
  const isEdit = !!job;
  const [agentId, setAgentId] = useState(job?.agentId || 'rocket');
  const [name, setName] = useState(job?.name || '');
  const [scheduleKind, setScheduleKind] = useState<'cron' | 'at' | 'every'>(job?.schedule.kind || 'cron');
  const [cronExpr, setCronExpr] = useState(job?.schedule.expr || '0 * * * *');
  const [everyMs, setEveryMs] = useState(String((job?.schedule.everyMs || 3600000) / 60000));
  const [atDate, setAtDate] = useState(job?.schedule.at || '');
  const [timezone, setTimezone] = useState(job?.schedule.tz || '');
  const [wakeMode, setWakeMode] = useState(job?.wakeMode || 'next-heartbeat');
  const [payloadText, setPayloadText] = useState(job?.payload?.text || job?.payload?.message || '');
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [oneShot, setOneShot] = useState(job?.deleteAfterRun ?? false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const schedule: CronSchedule = { kind: scheduleKind };
    if (scheduleKind === 'cron') {
      schedule.expr = cronExpr;
      if (timezone) schedule.tz = timezone;
    } else if (scheduleKind === 'every') {
      schedule.everyMs = parseInt(everyMs) * 60000;
    } else if (scheduleKind === 'at') {
      schedule.at = atDate;
    }

    const payload = payloadText ? { text: payloadText, kind: 'systemEvent' as const } : undefined;

    onSave({
      ...(isEdit && { id: job.id }),
      agentId,
      name,
      schedule,
      wakeMode,
      enabled,
      deleteAfterRun: oneShot,
      payload,
    });
  };

  const agents = Object.keys(AGENT_EMOJIS);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-border rounded-xl w-full max-w-lg mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">{isEdit ? 'Edit Job' : 'New Scheduled Job'}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Agent + Name row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Agent</label>
              <select value={agentId} onChange={e => setAgentId(e.target.value)}
                className="w-full bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                {agents.map(a => <option key={a} value={a}>{AGENT_EMOJIS[a]} {a}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} required
                className="w-full bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200"
                placeholder="e.g. Heartbeat Check-in"
              />
            </div>
          </div>

          {/* Schedule type */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Schedule</label>
            <div className="flex gap-2 mb-2">
              {(['cron', 'every', 'at'] as const).map(kind => (
                <button key={kind} type="button"
                  onClick={() => setScheduleKind(kind)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${scheduleKind === kind
                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                    : 'border-border/40 text-zinc-500 hover:text-zinc-300'
                    }`}
                >
                  {kind === 'cron' ? '⏰ Cron' : kind === 'every' ? '🔄 Interval' : '📅 One-time'}
                </button>
              ))}
            </div>
            {scheduleKind === 'cron' && (
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <input value={cronExpr} onChange={e => setCronExpr(e.target.value)}
                    className="w-full bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200 font-mono"
                    placeholder="0 * * * *"
                  />
                </div>
                <input value={timezone} onChange={e => setTimezone(e.target.value)}
                  className="w-full bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-400"
                  placeholder="TZ (optional)"
                />
              </div>
            )}
            {scheduleKind === 'every' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Every</span>
                <input type="number" value={everyMs} onChange={e => setEveryMs(e.target.value)} min="1"
                  className="w-20 bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200 text-center"
                />
                <span className="text-xs text-zinc-500">minutes</span>
              </div>
            )}
            {scheduleKind === 'at' && (
              <input type="datetime-local" value={atDate?.slice(0, 16) || ''} onChange={e => setAtDate(new Date(e.target.value).toISOString())}
                className="w-full bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200"
              />
            )}
          </div>

          {/* Wake mode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Wake Mode</label>
              <select value={wakeMode} onChange={e => setWakeMode(e.target.value)}
                className="w-full bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                <option value="next-heartbeat">Next Heartbeat</option>
                <option value="now">Immediate</option>
              </select>
            </div>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)}
                  className="rounded bg-zinc-800 border-border"
                />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={oneShot} onChange={() => setOneShot(!oneShot)}
                  className="rounded bg-zinc-800 border-border"
                />
                One-shot
              </label>
            </div>
          </div>

          {/* Payload */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Payload (optional)</label>
            <textarea value={payloadText} onChange={e => setPayloadText(e.target.value)} rows={2}
              className="w-full bg-zinc-800 border border-border rounded px-2 py-1.5 text-sm text-zinc-200 resize-none"
              placeholder="Message sent to the agent when triggered..."
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-1.5 text-xs rounded border border-border text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-1.5 text-xs rounded bg-blue-600 text-white font-medium hover:bg-blue-500 transition-colors flex items-center gap-1.5"
            >
              {isEdit ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              {isEdit ? 'Save Changes' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stagger Panel
// ---------------------------------------------------------------------------

function StaggerPanel({
  jobs,
  onApplyStagger,
}: {
  jobs: CronJob[];
  onApplyStagger: (updates: { id: string; schedule: CronSchedule }[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [baseCron, setBaseCron] = useState('0 * * * *');
  const [staggerMin, setStaggerMin] = useState('3');

  // Get unique agent IDs that have cron jobs
  const cronAgents = [...new Set(jobs.filter(j => j.schedule.kind === 'cron' && j.enabled).map(j => j.agentId))];

  if (cronAgents.length < 2) return null;

  const preview = calculatePreview(baseCron, cronAgents, parseInt(staggerMin) || 1);

  return (
    <div className="border border-dashed border-yellow-500/30 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <Zap className="w-3.5 h-3.5 text-yellow-400" />
        <span className="text-xs text-yellow-400 font-medium">TPM Stagger Calculator</span>
        <span className="text-[10px] text-zinc-600 flex-1">{cronAgents.length} agents</span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-yellow-500/20 bg-yellow-500/5 space-y-3">
          <p className="text-[10px] text-zinc-500 pt-2">
            Auto-offset cron expressions so agents don&apos;t all wake at the same time.
          </p>

          <div className="flex items-center gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">Base cron</label>
              <input value={baseCron} onChange={e => setBaseCron(e.target.value)}
                className="bg-zinc-800 border border-border rounded px-2 py-1 text-xs text-zinc-200 font-mono w-32"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">Gap (minutes)</label>
              <input type="number" value={staggerMin} onChange={e => setStaggerMin(e.target.value)} min="1" max="30"
                className="bg-zinc-800 border border-border rounded px-2 py-1 text-xs text-zinc-200 w-16 text-center"
              />
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-1">
            <span className="text-[10px] text-zinc-500">Preview:</span>
            {preview.map(p => (
              <div key={p.agentId} className="flex items-center gap-2 text-xs">
                <span className="w-5 text-center">{AGENT_EMOJIS[p.agentId] || '🤖'}</span>
                <span className="text-zinc-400 w-20 truncate">{p.agentId}</span>
                <code className="text-emerald-400 font-mono text-[10px]">{p.expr}</code>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              const updates = preview.map(p => {
                // Find matching job for this agent
                const match = jobs.find(j => j.agentId === p.agentId && j.schedule.kind === 'cron' && j.enabled);
                if (!match) return null;
                return { id: match.id, schedule: { kind: 'cron' as const, expr: p.expr, tz: match.schedule.tz } };
              }).filter(Boolean) as { id: string; schedule: CronSchedule }[];
              onApplyStagger(updates);
            }}
            className="px-3 py-1.5 text-xs rounded bg-yellow-600/80 text-white font-medium hover:bg-yellow-500 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Apply Stagger
          </button>
        </div>
      )}
    </div>
  );
}

function calculatePreview(baseExpr: string, agentIds: string[], gap: number): { agentId: string; expr: string }[] {
  const parts = baseExpr.split(' ');
  if (parts.length !== 5) return agentIds.map(id => ({ agentId: id, expr: baseExpr }));

  return agentIds.map((agentId, index) => {
    const offset = (index * gap) % 60;
    const newParts = [...parts];
    if (/^\d+$/.test(parts[0])) {
      newParts[0] = String((parseInt(parts[0]) + offset) % 60);
    } else if (/^\*\/\d+$/.test(parts[0])) {
      const interval = parseInt(parts[0].split('/')[1]);
      const mins: number[] = [];
      for (let m = offset % interval; m < 60; m += interval) mins.push(m);
      if (mins.length === 0) mins.push(offset % 60);
      newParts[0] = mins.join(',');
    } else if (parts[0] === '*') {
      newParts[0] = String(offset);
    }
    return { agentId, expr: newParts.join(' ') };
  });
}

// ---------------------------------------------------------------------------
// ScheduleManager — main export
// ---------------------------------------------------------------------------

export function ScheduleManager({ agentId }: { agentId?: string }) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const url = agentId
        ? `/api/cron-jobs?agentId=${encodeURIComponent(agentId)}`
        : '/api/cron-jobs';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (e) {
      console.error('ScheduleManager fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchJobs();
    const timer = setInterval(fetchJobs, 30_000);
    return () => clearInterval(timer);
  }, [fetchJobs]);

  const handleToggle = async (id: string, enabled: boolean) => {
    setSaving(true);
    try {
      await fetch('/api/cron-jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      await fetchJobs();
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (data: Partial<CronJob> & { agentId: string; name: string }) => {
    setSaving(true);
    try {
      const isEdit = 'id' in data && data.id;
      await fetch('/api/cron-jobs', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await fetchJobs();
      setEditingJob(null);
      setShowCreate(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this scheduled job?')) return;
    setSaving(true);
    try {
      await fetch('/api/cron-jobs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await fetchJobs();
    } finally {
      setSaving(false);
    }
  };

  const handleApplyStagger = async (updates: { id: string; schedule: CronSchedule }[]) => {
    setSaving(true);
    try {
      for (const u of updates) {
        await fetch('/api/cron-jobs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: u.id, schedule: u.schedule }),
        });
      }
      await fetchJobs();
    } finally {
      setSaving(false);
    }
  };

  // Group and filter
  const filteredJobs = filter ? jobs.filter(j => j.agentId === filter) : jobs;
  const agents = agentId ? [] : [...new Set(jobs.map(j => j.agentId))].sort();
  const enabledCount = jobs.filter(j => j.enabled).length;

  if (loading) {
    return (
      <div className="glass-card p-6 flex items-center gap-2 text-zinc-500 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading schedules…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          Schedule Manager
          {saving && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 font-mono">
            {enabledCount} active / {jobs.length} total
          </span>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded bg-blue-600/80 text-white font-medium hover:bg-blue-500 transition-colors"
          >
            <Plus className="w-3 h-3" /> New
          </button>
        </div>
      </div>

      {/* Agent filter tabs */}
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setFilter('')}
          className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${!filter ? 'bg-zinc-700/50 border-zinc-600 text-zinc-200' : 'border-border/30 text-zinc-500 hover:text-zinc-300'
            }`}
        >
          All ({jobs.length})
        </button>
        {agents.map(a => {
          const count = jobs.filter(j => j.agentId === a).length;
          return (
            <button
              key={a}
              onClick={() => setFilter(filter === a ? '' : a)}
              className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${filter === a ? 'bg-zinc-700/50 border-zinc-600 text-zinc-200' : 'border-border/30 text-zinc-500 hover:text-zinc-300'
                }`}
            >
              {AGENT_EMOJIS[a] || '🤖'} {a} ({count})
            </button>
          );
        })}
      </div>

      {/* Stagger calculator */}
      <StaggerPanel jobs={jobs} onApplyStagger={handleApplyStagger} />

      {/* Job list */}
      <div className="space-y-1.5">
        {filteredJobs.map(job => (
          <JobRow
            key={job.id}
            job={job}
            onToggle={handleToggle}
            onEdit={setEditingJob}
            onDelete={handleDelete}
          />
        ))}
        {filteredJobs.length === 0 && (
          <p className="text-xs text-zinc-600 py-4 text-center italic">No scheduled jobs{filter ? ` for ${filter}` : ''}</p>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <JobModal job={agentId ? { agentId } as CronJob : null} onSave={handleSave} onClose={() => setShowCreate(false)} />
      )}
      {editingJob && (
        <JobModal job={editingJob} onSave={handleSave} onClose={() => setEditingJob(null)} />
      )}
    </div>
  );
}
