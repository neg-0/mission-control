'use client';

import { cn } from '@/lib/utils';
import { ExternalLink, GraduationCap, RotateCcw, Sword, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ActivityMessage {
  id: string;
  fromId: string;
  channel: string;
  subject?: string;
  body: string;
  sentAt: string;
}

interface Scorecard {
  id: string;
  category: string;
  score: number;
  rationale?: string;
}

interface IdeaFull {
  id: string;
  title: string;
  description?: string | null;
  source?: string | null;
  sourceUrls?: string[];
  status: string;
  stage: string;
  score: number | null;
  researchNotes?: string | null;
  scorecards: Scorecard[];
  project?: { id: string; name: string; stage: string } | null;
  validationStartedAt?: string | null;
  validationDeadline?: string | null;
  validationTarget?: number | null;
  validationMetrics?: { signups?: number; traffic?: number; conversion?: string } | null;
  refineryData?: Record<string, any> | null;
  timeRemaining?: number | null;
  isExpired?: boolean;
}

interface IdeaDetailProps {
  ideaId: string;
  onBack: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

const scoreLabels: Record<string, string> = {
  problem_pain_level: '😫 Pain Level',
  market_demand: '📈 Market Demand',
  technical_feasibility: '⚙️ Tech Feasibility',
  competition_gap: '🏆 Competition Gap',
  b2b_value: '💰 B2B Value',
};

function statusBadgeClass(status: string) {
  switch (status) {
    case 'draft': return 'bg-gray-500/20 text-gray-300';
    case 'refining': return 'bg-sky-500/20 text-sky-400';
    case 'building_lp': return 'bg-indigo-500/20 text-indigo-400';
    case 'validating': return 'bg-amber-500/20 text-amber-400';
    case 'validated': return 'bg-green-500/20 text-green-400';
    case 'review_failed': return 'bg-orange-500/20 text-orange-400';
    case 'graduated': return 'bg-emerald-500/20 text-emerald-400';
    case 'killed': return 'bg-red-500/20 text-red-400';
    default: return 'bg-gray-500/20 text-gray-300';
  }
}

function statusEmoji(status: string) {
  switch (status) {
    case 'draft': return '💡';
    case 'refining': return '🔬';
    case 'building_lp': return '🏗️';
    case 'validating': return '⚔️';
    case 'validated': return '✅';
    case 'review_failed': return '⚠️';
    case 'graduated': return '🎓';
    case 'killed': return '💀';
    default: return '❓';
  }
}

function stageLabel(stage: string) {
  switch (stage) {
    case 'pain_audit': return '🔍 Pain Audit';
    case 'copy_draft': return '✍️ Copy Draft';
    case 'outreach': return '📣 Outreach';
    default: return stage;
  }
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '⏰ EXPIRED';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

function truncateId(id: string): string {
  return id.split('-')[0] || id.slice(0, 8);
}

// ─── Copyable ID ────────────────────────────────────────────────────────────────

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);

  function handleCopy() {
    navigator.clipboard.writeText(id).catch(() => { });
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <span
      onClick={handleCopy}
      className="font-mono text-muted-foreground hover:text-primary cursor-pointer transition-colors"
      title={`Click to copy: ${id}`}
    >
      {copied ? '✓ Copied' : truncateId(id)}
    </span>
  );
}

// ─── Score Bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, rationale }: { label: string; value: number; rationale?: string }) {
  const pct = (value / 10) * 100;
  const color =
    value >= 8 ? 'bg-emerald-500' : value >= 6 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono font-semibold">{value}/10</span>
      </div>
      <div className="h-2 bg-card/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {rationale && (
        <div className="text-[10px] text-muted-foreground/70 italic leading-snug">{rationale}</div>
      )}
    </div>
  );
}

// ─── Icon Button with Tooltip ───────────────────────────────────────────────────

function IconAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  loading,
  color,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  color: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const colorMap: Record<string, string> = {
    amber: 'hover:bg-amber-500/20 text-amber-400 border-amber-500/20',
    emerald: 'hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
    red: 'hover:bg-red-500/20 text-red-400 border-red-500/20',
    sky: 'hover:bg-sky-500/20 text-sky-400 border-sky-500/20',
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'p-2 rounded-lg border transition-colors disabled:opacity-30',
          colorMap[color] || colorMap.sky
        )}
      >
        {loading ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <Icon size={16} />
        )}
      </button>
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 rounded bg-[#0c111e] border border-border/50 text-[10px] text-muted-foreground whitespace-nowrap z-50 shadow-lg">
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Kickback Modal ─────────────────────────────────────────────────────────────

function KickbackModal({ onSubmit, onClose }: { onSubmit: (comment: string) => void; onClose: () => void }) {
  const [comment, setComment] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm glass-card p-5 space-y-3 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">↩️ Kick Back for Refinement</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What needs more work? (optional)"
          className="w-full h-24 bg-card/60 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(comment)}
            className="text-xs px-3 py-1.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 transition-colors"
          >
            Send Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function IdeaDetail({ ideaId, onBack }: IdeaDetailProps) {
  const [idea, setIdea] = useState<IdeaFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityMessage[]>([]);
  const [showKickback, setShowKickback] = useState(false);

  const loadIdea = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/ideas/${ideaId}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setIdea(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [ideaId]);

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages?subject=${ideaId}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setActivity(data.messages || []);
      }
    } catch { /* ignore */ }
  }, [ideaId]);

  useEffect(() => {
    loadIdea();
    loadActivity();
  }, [loadIdea, loadActivity]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function handleAction(action: 'start_sprint' | 'graduate' | 'kill') {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/ideas/${ideaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('Action failed');
      await loadIdea();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleKickback(comment: string) {
    setShowKickback(false);
    setActionLoading('kickback');
    try {
      const res = await fetch(`/api/ideas/${ideaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'refining', stage: 'pain_audit', kickbackComment: comment }),
      });
      if (!res.ok) throw new Error('Kickback failed');
      await loadIdea();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStageChange(stage: string) {
    try {
      await fetch(`/api/ideas/${ideaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      await loadIdea();
    } catch (e) {
      console.error(e);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading idea…</div>
    );
  }

  if (error || !idea) {
    return (
      <div className="text-center py-12">
        <div className="text-red-400 text-sm">Failed to load idea</div>
        <button onClick={onBack} className="text-xs text-primary mt-2 hover:underline">← Back</button>
      </div>
    );
  }

  const target = idea.validationTarget ?? 10;
  const signups = idea.validationMetrics?.signups ?? 0;
  const signupProgress = Math.min(100, (signups / target) * 100);

  // Determine which actions apply
  const canStartSprint = ['draft', 'refining', 'building_lp'].includes(idea.status);
  const canGraduate = ['validating', 'refining', 'building_lp'].includes(idea.status);
  const canKill = !['graduated', 'killed'].includes(idea.status);
  const canKickback = !['draft', 'killed'].includes(idea.status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Ideas
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold">{idea.title}</h1>
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', statusBadgeClass(idea.status))}>
              {statusEmoji(idea.status)} {idea.status === 'building_lp' ? 'Building LP' : idea.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <CopyableId id={idea.id} />
            {idea.source && <span>from {idea.source}</span>}
            {idea.score != null && idea.score > 0 && (
              <span className="font-mono font-bold text-foreground">Score: {idea.score}</span>
            )}
          </div>
        </div>

        {/* Action Buttons — inline with header */}
        <div className="flex items-center gap-1.5 shrink-0 mt-6">
          {canStartSprint && (
            <IconAction
              icon={Sword}
              label="Start 48h Sprint"
              onClick={() => handleAction('start_sprint')}
              disabled={!!actionLoading}
              loading={actionLoading === 'start_sprint'}
              color="amber"
            />
          )}
          {canGraduate && (
            <IconAction
              icon={GraduationCap}
              label="Graduate → Project"
              onClick={() => handleAction('graduate')}
              disabled={!!actionLoading}
              loading={actionLoading === 'graduate'}
              color="emerald"
            />
          )}
          {canKickback && (
            <IconAction
              icon={RotateCcw}
              label="Kick Back for Refinement"
              onClick={() => setShowKickback(true)}
              disabled={!!actionLoading}
              loading={actionLoading === 'kickback'}
              color="sky"
            />
          )}
          {canKill && (
            <IconAction
              icon={Trash2}
              label="Kill"
              onClick={() => handleAction('kill')}
              disabled={!!actionLoading}
              loading={actionLoading === 'kill'}
              color="red"
            />
          )}
        </div>
      </div>

      {/* Source + Source URLs */}
      {(idea.source || (idea.sourceUrls && idea.sourceUrls.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {idea.source && (
            <span className="px-2 py-1 rounded bg-card/50 text-muted-foreground">
              📎 {idea.source}
            </span>
          )}
          {idea.sourceUrls?.map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
            >
              <ExternalLink size={10} />
              Source {idea.sourceUrls!.length > 1 ? i + 1 : ''}
            </a>
          ))}
        </div>
      )}

      {/* Description */}
      {idea.description && (
        <div className="glass-card p-4">
          <p className="text-sm text-foreground/80 leading-relaxed">{idea.description}</p>
        </div>
      )}

      <div className="grid md:grid-cols-12 gap-4">
        {/* Main Column */}
        <div className="md:col-span-8 space-y-4">

          {/* Validation Sprint Panel (if validating) */}
          {idea.status === 'validating' && (
            <div className="glass-card p-4 border-l-4 border-amber-500">
              <h3 className="text-sm font-semibold mb-3">⚔️ Validation Sprint</h3>
              <div className="grid grid-cols-2 gap-4">
                {/* Countdown */}
                <div className={cn(
                  'text-center py-3 rounded-lg',
                  idea.isExpired ? 'bg-red-500/10' : 'bg-amber-500/10'
                )}>
                  <div className="text-2xl font-mono font-bold">
                    {idea.timeRemaining != null ? formatCountdown(idea.timeRemaining) : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Time Remaining</div>
                </div>
                {/* Signups */}
                <div className="text-center py-3 rounded-lg bg-card/50">
                  <div className={cn(
                    'text-2xl font-mono font-bold',
                    signups >= target ? 'text-emerald-400' : 'text-foreground'
                  )}>
                    {signups} / {target}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Signups</div>
                  <div className="mt-2 mx-4 h-2 bg-card/50 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        signups >= target ? 'bg-emerald-500' : 'bg-amber-500'
                      )}
                      style={{ width: `${signupProgress}%` }}
                    />
                  </div>
                </div>
              </div>
              {idea.validationMetrics?.traffic != null && (
                <div className="mt-3 text-xs text-muted-foreground">
                  📊 Traffic: {idea.validationMetrics.traffic} visitors
                  {idea.validationMetrics.conversion && ` · ${idea.validationMetrics.conversion} conversion`}
                </div>
              )}
            </div>
          )}

          {/* Status Info for Draft */}
          {idea.status === 'draft' && (
            <div className="glass-card p-4 border-l-4 border-gray-500/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
                <span className="text-sm text-muted-foreground">Awaiting Refiner — will be auto-picked up</span>
              </div>
            </div>
          )}

          {/* Building LP Status */}
          {idea.status === 'building_lp' && (
            <div className="glass-card p-4 border-l-4 border-indigo-500">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-sm text-indigo-400 font-medium">🏗️ Building Landing Page</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                CEO is building the landing page and signup form. Once live, this enters the 48h Arena sprint.
              </p>
            </div>
          )}

          {/* Refinery Dashboard */}
          <div className="glass-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">🏭 Refinery Dashboard</h3>
              {idea.status === 'refining' && (
                <div className="flex gap-1">
                  {(['pain_audit', 'copy_draft', 'outreach'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => handleStageChange(s)}
                      className={cn(
                        'text-[10px] px-2 py-1 rounded transition-colors',
                        idea.stage === s
                          ? 'bg-primary/20 text-primary border border-primary/30'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                      )}
                    >
                      {stageLabel(s)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pain Points */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                😫 Pain Points
              </h4>
              {idea.refineryData?.pain_points?.length ? (
                <ul className="space-y-1">
                  {idea.refineryData.pain_points.map((p: string, i: number) => (
                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">•</span> {p}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">No pain points researched yet</p>
              )}
            </div>

            {/* Landing Page Copy */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                ✍️ Landing Page Copy
              </h4>
              {idea.refineryData?.copy ? (
                <div className="bg-card/50 p-3 rounded border border-border/30 space-y-2">
                  <div className="text-sm font-bold text-emerald-400">{idea.refineryData.copy.headline}</div>
                  <div className="text-xs text-foreground/70">{idea.refineryData.copy.subhead}</div>
                  {idea.refineryData.copy.cta && (
                    <div className="text-xs text-sky-400 font-medium">CTA: {idea.refineryData.copy.cta}</div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No copy drafted yet</p>
              )}
            </div>

            {/* Outreach Targets */}
            {idea.refineryData?.outreach_targets?.targets && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  🎯 Outreach Targets
                </h4>
                <div className="flex flex-wrap gap-2">
                  {idea.refineryData.outreach_targets.targets.map((t: any, i: number) => (
                    <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs bg-sky-500/10 text-sky-400 px-2 py-1 rounded border border-sky-500/20 hover:bg-sky-500/20 transition-colors">
                      {t.channel}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Subreddit Rules */}
            {idea.refineryData?.subreddit_rules && idea.refineryData.subreddit_rules.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  📜 Community Rules
                </h4>
                <div className="space-y-1.5">
                  {idea.refineryData.subreddit_rules.map((rule: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                        rule.recommended_approach === 'post' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        rule.recommended_approach === 'comment_only' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                        rule.recommended_approach === 'banned' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                      }`}>
                        {rule.recommended_approach === 'post' ? '✅ POST OK' :
                         rule.recommended_approach === 'comment_only' ? '💬 COMMENT ONLY' :
                         rule.recommended_approach === 'banned' ? '🚫 BANNED' : '❓ UNKNOWN'}
                      </span>
                      <span className="text-foreground/80 font-medium">{rule.subreddit}</span>
                      {rule.restrictions && (
                        <span className="text-muted-foreground">— {rule.restrictions}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outreach Drafts */}
            {idea.refineryData?.outreach_drafts && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  📣 Outreach Drafts
                </h4>
                {Array.isArray(idea.refineryData.outreach_drafts) ? (
                  <div className="space-y-4">
                    {idea.refineryData.outreach_drafts.map((draft: any, i: number) => {
                      const channel = draft.channel || '';
                      const subreddit = channel.replace(/^(Reddit\s+)?r\//, '');
                      const redditSubmitUrl = subreddit
                        ? `https://www.reddit.com/r/${subreddit}/submit?type=self&title=${encodeURIComponent(draft.title || '')}&text=${encodeURIComponent(draft.body || '')}`
                        : null;
                      return (
                        <div key={i} className="bg-card/40 border border-border/40 rounded-lg overflow-hidden">
                          {/* Header bar */}
                          <div className="flex items-center justify-between px-3 py-2 bg-card/60 border-b border-border/30">
                            <div className="flex items-center gap-2">
                              {redditSubmitUrl ? (
                                <a href={`https://www.reddit.com/r/${subreddit}`} target="_blank" rel="noopener noreferrer"
                                  className="text-xs font-semibold text-orange-400 hover:text-orange-300 flex items-center gap-1.5 transition-colors">
                                  <span>📌</span> r/{subreddit}
                                  <span className="text-[10px] opacity-60">↗</span>
                                </a>
                              ) : (
                                <span className="text-xs font-semibold text-muted-foreground">{channel}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">Post {i + 1} of {idea.refineryData!.outreach_drafts.length}</span>
                              {redditSubmitUrl && (
                                <a href={redditSubmitUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-[11px] font-medium bg-orange-500 hover:bg-orange-400 text-white px-2.5 py-1 rounded transition-colors flex items-center gap-1">
                                  🚀 Post to Reddit
                                </a>
                              )}
                            </div>
                          </div>

                          {/* Title — click to copy */}
                          <div
                            onClick={() => {
                              navigator.clipboard.writeText(draft.title || '');
                              const el = document.getElementById(`draft-title-${i}`);
                              if (el) { el.textContent = '✓ Copied!'; setTimeout(() => { el.textContent = draft.title; }, 1500); }
                            }}
                            className="px-3 py-2 cursor-pointer hover:bg-primary/5 transition-colors group border-b border-border/20"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Title</span>
                              <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">click to copy</span>
                            </div>
                            <p id={`draft-title-${i}`} className="text-sm font-semibold text-foreground/90 mt-0.5">{draft.title}</p>
                          </div>

                          {/* Body — click to copy */}
                          <div
                            onClick={() => {
                              navigator.clipboard.writeText(draft.body || '');
                              const el = document.getElementById(`draft-body-toast-${i}`);
                              if (el) { el.classList.remove('opacity-0'); el.classList.add('opacity-100'); setTimeout(() => { el.classList.remove('opacity-100'); el.classList.add('opacity-0'); }, 1500); }
                            }}
                            className="px-3 py-2 cursor-pointer hover:bg-primary/5 transition-colors group relative"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Body</span>
                              <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">click to copy</span>
                            </div>
                            <p className="text-xs text-foreground/70 mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">{draft.body}</p>
                            <div id={`draft-body-toast-${i}`} className="absolute top-2 right-3 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded opacity-0 transition-opacity pointer-events-none">
                              ✓ Copied!
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <pre className="text-xs text-foreground/70 whitespace-pre-wrap max-h-60 overflow-y-auto bg-card/30 p-3 rounded border border-border/30">
                    {typeof idea.refineryData.outreach_drafts === 'string'
                      ? idea.refineryData.outreach_drafts
                      : JSON.stringify(idea.refineryData.outreach_drafts, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Creative Brief */}
            {idea.refineryData?.creative_brief && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  📋 Creative Brief
                </h4>
                <pre className="text-xs text-foreground/70 whitespace-pre-wrap max-h-40 overflow-y-auto bg-card/30 p-3 rounded border border-border/30">
                  {idea.refineryData.creative_brief}
                </pre>
              </div>
            )}

            {/* Source URLs */}
            {idea.refineryData?.source_urls?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  🔗 Sources
                </h4>
                <ul className="space-y-1">
                  {idea.refineryData!.source_urls.map((url: string, i: number) => (
                    <li key={i}>
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-sky-400 hover:underline truncate block">{url}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Agent Activity Feed */}
          {activity.length > 0 && (
            <div className="glass-card p-4 space-y-3">
              <h3 className="text-sm font-semibold">📡 Agent Activity</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {activity.map(msg => (
                  <div key={msg.id} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground whitespace-nowrap shrink-0">
                      {new Date(msg.sentAt).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <span className="text-primary/60 font-mono shrink-0">{msg.fromId}</span>
                    <span className="text-foreground/80">{msg.body}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Research Notes */}
          {idea.researchNotes && (
            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold mb-2">📝 Research Notes</h3>
              <pre className="text-xs text-foreground/80 whitespace-pre-wrap">{idea.researchNotes}</pre>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="md:col-span-4 space-y-4">
          {/* Score Breakdown — always visible */}
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Score Breakdown
            </h3>
            {idea.scorecards.length > 0 ? (
              <>
                {idea.scorecards.map(sc => (
                  <ScoreBar
                    key={sc.id}
                    label={scoreLabels[sc.category] || sc.category}
                    value={sc.score}
                    rationale={sc.rationale}
                  />
                ))}
                {idea.score != null && idea.score > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/30 flex justify-between items-center">
                    <span className="text-xs text-muted-foreground font-semibold">Overall</span>
                    <span className="text-lg font-mono font-bold">{Math.round(idea.score)}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-4">
                <div className="text-2xl mb-2">🔬</div>
                <div className="text-xs text-muted-foreground">Not yet scored</div>
                <div className="text-[10px] text-muted-foreground/60 mt-1">Awaiting refiner analysis</div>
              </div>
            )}
          </div>

          {/* Status info */}
          {idea.status === 'graduated' && idea.project && (
            <div className="glass-card p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Linked Project
              </h3>
              <div className="text-sm font-medium">{idea.project.name}</div>
              <div className="text-xs text-muted-foreground">{idea.project.stage}</div>
            </div>
          )}

          {idea.status === 'killed' && (
            <div className="glass-card p-4">
              <div className="text-xs text-red-400 italic">
                💀 This idea was archived.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Kickback Modal */}
      {showKickback && (
        <KickbackModal
          onSubmit={handleKickback}
          onClose={() => setShowKickback(false)}
        />
      )}
    </div>
  );
}
