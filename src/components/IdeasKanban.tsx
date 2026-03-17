'use client';

import { cn } from '@/lib/utils';
import { Archive, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ScorecardItem {
  category: string;
  score: number;
}

interface IdeaItem {
  id: string;
  name: string;
  bluf: string | null;
  score: number;
  status: string;
  stage?: string;
  validationDeadline?: string | null;
  validationTarget?: number | null;
  validationMetrics?: { signups?: number; traffic?: number; conversion?: string } | null;
  timeRemaining?: number | null;
  isExpired?: boolean;
  scorecards?: ScorecardItem[];
}

interface ArchivedIdea {
  id: string;
  title: string;
  score: number | null;
  source: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface IdeasKanbanProps {
  items: IdeaItem[];
  onCardClick?: (ideaId: string) => void;
  onStageChange?: (ideaId: string, newStatus: string) => Promise<void>;
}

// ─── Column Config ──────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'draft', label: '💡 New', statuses: ['draft', 'new'] },
  { key: 'refining', label: '🔬 Refining', statuses: ['refining', 'researching', 'pain_audit', 'copy_draft', 'outreach_scan', 'brief_sent'] },
  { key: 'building_lp', label: '🏗️ Building LP', statuses: ['building_lp', 'landing_page', 'landing_page_complete'] },
  { key: 'validating', label: '⚔️ The Arena', statuses: ['validating', 'outreach_exec'] },
  { key: 'graduated', label: '✅ Validated', statuses: ['graduated', 'validated'] },
  { key: 'killed', label: '💀 Graveyard', statuses: ['killed', 'rejected', 'review_failed'] },
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

const scoreLabels: Record<string, string> = {
  problem_pain_level: '😫 Pain',
  market_demand: '📈 Demand',
  technical_feasibility: '⚙️ Tech',
  competition_gap: '🏆 Gap',
  b2b_value: '💰 B2B',
};

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (score >= 70) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  if (score >= 60) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  return 'bg-red-500/20 text-red-400 border-red-500/30';
}

function stageLabel(stage?: string): string {
  switch (stage) {
    case 'pain_audit': return '🔍 Pain Audit';
    case 'copy_draft': return '✍️ Copy Draft';
    case 'outreach': return '📣 Outreach';
    default: return '';
  }
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '⏰ EXPIRED';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function truncateId(id: string): string {
  return id.split('-')[0] || id.slice(0, 8);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Copy-to-Clipboard UUID ────────────────────────────────────────────────────

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(id).catch(() => { });
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <span
      onClick={handleCopy}
      className="text-[10px] font-mono text-muted-foreground hover:text-primary cursor-pointer transition-colors"
      title={`Click to copy: ${id}`}
    >
      {copied ? '✓ Copied' : truncateId(id)}
    </span>
  );
}

// ─── Score Tooltip ──────────────────────────────────────────────────────────────

function ScoreBadge({ score, scorecards }: { score: number; scorecards?: ScorecardItem[] }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded border cursor-default', scoreColor(score))}>
        {score || '—'}
      </span>

      {showTooltip && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 p-2 rounded-lg bg-[#0c111e] border border-border/50 shadow-xl space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Score Breakdown
          </div>
          {scorecards && scorecards.length > 0 ? (
            scorecards.map(sc => (
              <div key={sc.category} className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">{scoreLabels[sc.category] || sc.category}</span>
                <span className={cn(
                  'font-mono font-semibold',
                  sc.score >= 8 ? 'text-emerald-400' : sc.score >= 6 ? 'text-yellow-400' : 'text-red-400'
                )}>
                  {sc.score}/10
                </span>
              </div>
            ))
          ) : (
            <div className="text-[10px] text-muted-foreground italic">Not yet scored</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Countdown Hook ─────────────────────────────────────────────────────────────

function useCountdown(deadlineIso: string | null | undefined): { display: string; isExpired: boolean } {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!deadlineIso) return;
    const interval = setInterval(() => setNow(Date.now()), 60000); // update every minute
    return () => clearInterval(interval);
  }, [deadlineIso]);

  if (!deadlineIso) return { display: '', isExpired: false };

  const deadline = new Date(deadlineIso).getTime();
  const remaining = deadline - now;
  return {
    display: formatCountdown(remaining),
    isExpired: remaining <= 0,
  };
}

// ─── Arena Card (special) ───────────────────────────────────────────────────────

function ArenaCard({ item, onClick }: { item: IdeaItem; onClick?: () => void }) {
  const { display: countdown, isExpired } = useCountdown(item.validationDeadline);
  const target = item.validationTarget ?? 10;
  const signups = item.validationMetrics?.signups ?? 0;
  const progress = Math.min(100, (signups / target) * 100);

  return (
    <div
      className={cn(
        'border rounded-lg p-3 space-y-2 transition-colors cursor-pointer',
        isExpired
          ? 'bg-red-500/5 border-red-500/30 hover:border-red-500/50'
          : 'bg-card/40 border-amber-500/30 hover:border-amber-500/50'
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <CopyableId id={item.id} />
        <ScoreBadge score={item.score} scorecards={item.scorecards} />
      </div>
      <div className="text-sm font-medium">{item.name}</div>

      {/* Countdown Timer */}
      <div className={cn(
        'text-center py-1.5 rounded text-xs font-mono font-bold',
        isExpired
          ? 'bg-red-500/20 text-red-400'
          : 'bg-amber-500/10 text-amber-400'
      )}>
        ⏱ {countdown}
      </div>

      {/* Signup Scoreboard */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground">Signups</span>
          <span className={cn(
            'font-mono font-bold',
            signups >= target ? 'text-emerald-400' : 'text-foreground'
          )}>
            {signups}/{target}
          </span>
        </div>
        <div className="h-1.5 bg-card/60 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              signups >= target ? 'bg-emerald-500' : 'bg-amber-500'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Standard Card ──────────────────────────────────────────────────────────────

function IdeaCard({
  item,
  isGraveyard = false,
  onClick,
}: {
  item: IdeaItem;
  isGraveyard?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        'border rounded-lg p-2.5 space-y-1.5 transition-colors cursor-pointer',
        isGraveyard
          ? 'bg-card/20 border-border/30 opacity-60 hover:opacity-80'
          : 'bg-card/40 border-border/50 hover:border-primary/20'
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <CopyableId id={item.id} />
        <ScoreBadge score={item.score} scorecards={item.scorecards} />
      </div>
      <div className="text-sm font-medium">{item.name}</div>
      {item.bluf && (
        <div className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{item.bluf}</div>
      )}
      {item.stage && item.status === 'refining' && (
        <div className="text-[10px] text-sky-400">{stageLabel(item.stage)}</div>
      )}
    </div>
  );
}

// ─── Archive Modal ──────────────────────────────────────────────────────────────

function ArchiveModal({ onClose, onIdeaClick }: { onClose: () => void; onIdeaClick: (id: string) => void }) {
  const [items, setItems] = useState<ArchivedIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (cursor?: string | null) => {
    const isFirst = !cursor;
    if (isFirst) setLoading(true);
    else setLoadingMore(true);

    try {
      const url = cursor
        ? `/api/ideas?status=archived&cursor=${encodeURIComponent(cursor)}&limit=20`
        : '/api/ideas?status=archived&limit=20';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setItems(prev => isFirst ? data.items : [...prev, ...data.items]);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    } catch (e) {
      console.error('Archive fetch error:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Infinite scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function handleScroll() {
      if (!el || loadingMore || !hasMore) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        fetchPage(nextCursor);
      }
    }

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [hasMore, loadingMore, nextCursor, fetchPage]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="glass-card w-full max-w-lg mx-4 flex flex-col max-h-[70vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold">Archived Ideas</h2>
            <span className="text-xs text-muted-foreground bg-card/50 px-1.5 py-0.5 rounded-full font-mono">
              {items.length}{hasMore ? '+' : ''}
            </span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-3xl mb-2">🗄️</div>
              <div className="text-sm text-muted-foreground">No archived ideas yet</div>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {items.map(item => (
                <button
                  key={item.id}
                  onClick={() => { onIdeaClick(item.id); onClose(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {item.source && <span>{item.source} · </span>}
                      {formatDate(item.updatedAt)}
                    </div>
                  </div>
                  <span className={cn(
                    'text-xs font-mono px-1.5 py-0.5 rounded border shrink-0',
                    item.score ? scoreColor(item.score) : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                  )}>
                    {item.score ?? '—'}
                  </span>
                </button>
              ))}
              {loadingMore && (
                <div className="py-3 text-center text-xs text-muted-foreground">Loading more…</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function IdeasKanban({ items, onCardClick }: IdeasKanbanProps) {
  const [showArchive, setShowArchive] = useState(false);

  const columns = COLUMNS.map(col => ({
    ...col,
    items: items.filter(item => col.statuses.includes(item.status)),
  }));

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {columns.map(col => (
          <div
            key={col.key}
            className="flex-shrink-0 w-[220px] min-w-[220px] glass-card p-3 space-y-2"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {col.label}
              </h3>
              <div className="flex items-center gap-1.5">
                {col.key === 'killed' && (
                  <button
                    onClick={() => setShowArchive(true)}
                    className="p-0.5 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground"
                    title="View archived ideas"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="text-[10px] text-muted-foreground bg-card/50 px-1.5 py-0.5 rounded-full font-mono">
                  {col.items.length}
                </span>
              </div>
            </div>

            {col.items.length === 0 ? (
              <div className="text-xs text-muted-foreground italic text-center py-4">Empty</div>
            ) : (
              col.items.map(item =>
                col.key === 'validating' ? (
                  <ArenaCard
                    key={item.id}
                    item={item}
                    onClick={() => onCardClick?.(item.id)}
                  />
                ) : (
                  <IdeaCard
                    key={item.id}
                    item={item}
                    isGraveyard={col.key === 'killed'}
                    onClick={() => onCardClick?.(item.id)}
                  />
                )
              )
            )}
          </div>
        ))}
      </div>

      {showArchive && (
        <ArchiveModal
          onClose={() => setShowArchive(false)}
          onIdeaClick={(id) => onCardClick?.(id)}
        />
      )}
    </>
  );
}
