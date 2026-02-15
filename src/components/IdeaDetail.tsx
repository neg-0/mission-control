'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';

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
  refineryData?: { painPoints?: string[]; avatars?: string[]; copyVariants?: string[] } | null;
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

function ScoreBar({ label, value }: { label: string; value: number }) {
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
      const res = await fetch('/api/ideas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ideaId, action }),
      });
      if (!res.ok) throw new Error('Action failed');
      await loadIdea();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStageChange(stage: string) {
    try {
      await fetch('/api/ideas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ideaId, stage }),
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Ideas
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">{idea.title}</h1>
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusBadgeClass(idea.status))}>
              {statusEmoji(idea.status)} {idea.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="font-mono">{idea.id}</span>
            {idea.source && <span>from {idea.source}</span>}
            {idea.score != null && (
              <span className="font-mono font-bold text-foreground">Score: {idea.score}</span>
            )}
          </div>
        </div>
      </div>

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
              {idea.refineryData?.painPoints?.length ? (
                <ul className="space-y-1">
                  {idea.refineryData.painPoints.map((p, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">•</span> {p}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">No pain points researched yet</p>
              )}
            </div>

            {/* Avatars */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                👤 Target Avatars
              </h4>
              {idea.refineryData?.avatars?.length ? (
                <div className="flex flex-wrap gap-2">
                  {idea.refineryData.avatars.map((a, i) => (
                    <span key={i} className="text-xs bg-sky-500/10 text-sky-400 px-2 py-1 rounded border border-sky-500/20">
                      {a}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No avatars defined yet</p>
              )}
            </div>

            {/* Copy Variants */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                ✍️ Copy Variants
              </h4>
              {idea.refineryData?.copyVariants?.length ? (
                <div className="space-y-2">
                  {idea.refineryData.copyVariants.map((c, i) => (
                    <div key={i} className="text-sm font-medium bg-card/50 p-2 rounded border border-border/30">
                      &ldquo;{c}&rdquo;
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No copy variants drafted yet</p>
              )}
            </div>
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
          {/* Score Breakdown */}
          {idea.scorecards.length > 0 && (
            <div className="glass-card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Score Breakdown
              </h3>
              {idea.scorecards.map(sc => (
                <ScoreBar
                  key={sc.id}
                  label={scoreLabels[sc.category] || sc.category}
                  value={sc.score}
                />
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Actions
            </h3>
            {(idea.status === 'draft' || idea.status === 'refining') && (
              <>
                {idea.status === 'draft' && (
                  <button
                    onClick={() => handleAction('start_sprint')}
                    disabled={!!actionLoading}
                    className="w-full text-xs py-2.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === 'start_sprint' ? '...' : '🔬 Start Refining'}
                  </button>
                )}
                <button
                  onClick={() => handleAction('start_sprint')}
                  disabled={!!actionLoading}
                  className="w-full text-xs py-2.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'start_sprint' ? '...' : '⚔️ Start 48h Sprint'}
                </button>
              </>
            )}
            {idea.status === 'validating' && (
              <>
                <button
                  onClick={() => handleAction('graduate')}
                  disabled={!!actionLoading}
                  className="w-full text-xs py-2.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'graduate' ? '...' : '🎓 Graduate → Project'}
                </button>
                <button
                  onClick={() => handleAction('kill')}
                  disabled={!!actionLoading}
                  className="w-full text-xs py-2.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'kill' ? '...' : '💀 Kill (Bust)'}
                </button>
              </>
            )}
            {idea.status === 'graduated' && idea.project && (
              <div className="text-xs text-emerald-400">
                ✅ Graduated to project: <span className="font-mono">{idea.project.name}</span>
              </div>
            )}
            {idea.status === 'killed' && (
              <div className="text-xs text-red-400 italic">
                This idea was archived.
              </div>
            )}
          </div>

          {/* Linked Project */}
          {idea.project && (
            <div className="glass-card p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Linked Project
              </h3>
              <div className="text-sm font-medium">{idea.project.name}</div>
              <div className="text-xs text-muted-foreground">{idea.project.stage}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
