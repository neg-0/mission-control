'use client';

import { Calendar, Clock, Loader2, Pause, RepeatIcon, Timer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  schedule: {
    kind: string;
    expr?: string;
    at?: string;
    everyMs?: number;
    tz?: string;
  };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSchedule(schedule: CronJob['schedule']): string {
  if (schedule.kind === 'cron' && schedule.expr) {
    const tz = schedule.tz ? ` (${schedule.tz.split('/')[1]?.replace('_', ' ') || schedule.tz})` : '';
    return `${schedule.expr}${tz}`;
  }
  if (schedule.kind === 'at' && schedule.at) {
    return new Date(schedule.at).toLocaleString();
  }
  if (schedule.kind === 'every' && schedule.everyMs) {
    const mins = Math.round(schedule.everyMs / 60000);
    if (mins < 60) return `every ${mins}m`;
    const hrs = Math.round(mins / 60);
    return `every ${hrs}h`;
  }
  return schedule.kind;
}

function formatRelativeTime(ms: number): string {
  const now = Date.now();
  const diff = ms - now;
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
    case 'cron': return <RepeatIcon className="w-3 h-3" />;
    case 'at': return <Calendar className="w-3 h-3" />;
    case 'every': return <Timer className="w-3 h-3" />;
    default: return <Clock className="w-3 h-3" />;
  }
}

// ---------------------------------------------------------------------------
// CronJobsPanel
// ---------------------------------------------------------------------------

interface CronJobsPanelProps {
  /** Filter by agentId. If omitted or "main", shows all. */
  agentId?: string;
}

export function CronJobsPanel({ agentId }: CronJobsPanelProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const url = agentId ? `/api/cron-jobs?agentId=${encodeURIComponent(agentId)}` : '/api/cron-jobs';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (e) {
      console.error('CronJobsPanel fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchJobs();
    const timer = setInterval(fetchJobs, 60_000); // refresh every 60s
    return () => clearInterval(timer);
  }, [fetchJobs]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-zinc-500 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading schedules…
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-xs text-zinc-600 py-2 italic">No scheduled jobs</div>
    );
  }

  const enabledJobs = jobs.filter(j => j.enabled);
  const disabledJobs = jobs.filter(j => !j.enabled);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Scheduled Jobs
        </h2>
        <span className="text-[10px] text-zinc-500 font-mono">
          {enabledJobs.length} active{disabledJobs.length > 0 ? ` · ${disabledJobs.length} paused` : ''}
        </span>
      </div>

      <div className="space-y-1">
        {enabledJobs.map(job => (
          <div key={job.id} className="flex items-center gap-2 px-3 py-2 border border-border/30 rounded-lg group hover:border-border/60 transition-colors">
            {/* Status indicator */}
            <div className="shrink-0">
              {job.state?.lastStatus === 'ok' ? (
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" title="Last run: OK" />
              ) : job.state?.lastStatus === 'error' ? (
                <div className="w-2.5 h-2.5 rounded-full bg-red-400" title="Last run: error" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-500" title="No status" />
              )}
            </div>

            {/* Job name */}
            <span className="text-xs text-zinc-200 truncate flex-1">{job.name}</span>

            {/* Schedule badge */}
            <span className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono shrink-0">
              <ScheduleIcon kind={job.schedule.kind} />
              {formatSchedule(job.schedule)}
            </span>

            {/* Next / Last run */}
            <span className="text-[10px] text-zinc-600 shrink-0 hidden sm:inline">
              {job.state?.nextRunAtMs ? (
                <span title={`Next: ${new Date(job.state.nextRunAtMs).toLocaleString()}`}>
                  {formatRelativeTime(job.state.nextRunAtMs)}
                </span>
              ) : job.state?.lastRunAtMs ? (
                <span title={`Last: ${new Date(job.state.lastRunAtMs).toLocaleString()}`}>
                  {formatRelativeTime(job.state.lastRunAtMs)}
                </span>
              ) : null}
            </span>

            {/* One-shot badge */}
            {job.deleteAfterRun && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium shrink-0">once</span>
            )}
          </div>
        ))}

        {disabledJobs.map(job => (
          <div key={job.id} className="flex items-center gap-2 px-3 py-2 border border-border/20 rounded-lg opacity-50">
            <Pause className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            <span className="text-xs text-zinc-500 truncate flex-1 line-through">{job.name}</span>
            <span className="text-[10px] text-zinc-600 font-mono shrink-0">paused</span>
          </div>
        ))}
      </div>
    </div>
  );
}
