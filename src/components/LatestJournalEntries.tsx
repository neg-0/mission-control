'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface JournalEntry {
  id: string;
  agentId: string;
  did: string;
  next: string | null;
  status: string;
  blockers: string | null;
  metadata: unknown;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  healthy: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Healthy' },
  blocked: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Blocked' },
  idle: { bg: 'bg-zinc-500/15', text: 'text-zinc-400', label: 'Idle' },
  error: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Error' },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  // Relative for recent entries
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  // Absolute for older entries
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${month} ${day}, ${time}`;
}

export function LatestJournalEntries({ agentId }: { agentId: string }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    setExpanded(new Set());

    fetch(`/api/journal?agentId=${encodeURIComponent(agentId)}&limit=10`)
      .then(r => r.ok ? r.json() : { entries: [] })
      .then(data => {
        if (!cancelled) setEntries(data.entries || []);
      })
      .catch(() => { })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [agentId]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="glass-card p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          📝 Latest Reports
        </h3>
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-card/40 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="glass-card p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          📝 Latest Reports
        </h3>
        <p className="text-sm text-muted-foreground italic">No journal entries yet</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        📝 Latest Reports
        <span className="ml-2 text-[10px] font-normal text-muted-foreground/60">
          ({entries.length} entries)
        </span>
      </h3>
      <div className="space-y-1.5">
        {entries.map((entry) => {
          const style = STATUS_STYLES[entry.status] || STATUS_STYLES.healthy;
          const isExpanded = expanded.has(entry.id);

          return (
            <button
              key={entry.id}
              onClick={() => toggleExpand(entry.id)}
              className={cn(
                'w-full text-left rounded-lg transition-all',
                'bg-card/40 hover:bg-card/60 border border-transparent',
                isExpanded && 'border-border/40 bg-card/60'
              )}
            >
              {/* Compact row */}
              <div className="flex items-start gap-2.5 px-3 py-2">
                {/* Status pill */}
                <span className={cn(
                  'flex-shrink-0 mt-0.5 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded',
                  style.bg, style.text
                )}>
                  {style.label}
                </span>

                {/* Did summary — truncated when collapsed */}
                <span className={cn(
                  'flex-1 text-sm text-foreground/85',
                  !isExpanded && 'truncate'
                )}>
                  {entry.did}
                </span>

                {/* Timestamp */}
                <span className="flex-shrink-0 text-[10px] text-muted-foreground/60 tabular-nums mt-0.5">
                  {formatTimestamp(entry.createdAt)}
                </span>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/20 mt-1">
                  {/* Full "did" text */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                      Accomplished
                    </div>
                    <div className="text-sm text-foreground/80 whitespace-pre-wrap">
                      {entry.did}
                    </div>
                  </div>

                  {/* Next */}
                  {entry.next && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                        Next
                      </div>
                      <div className="text-sm text-foreground/80 whitespace-pre-wrap">
                        {entry.next}
                      </div>
                    </div>
                  )}

                  {/* Blockers */}
                  {entry.blockers && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-red-400/70 mb-0.5">
                        ⚠️ Blockers
                      </div>
                      <div className="text-sm text-red-300/80 whitespace-pre-wrap">
                        {entry.blockers}
                      </div>
                    </div>
                  )}

                  {/* Absolute timestamp */}
                  <div className="text-[10px] text-muted-foreground/50 pt-1">
                    {new Date(entry.createdAt).toLocaleString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
