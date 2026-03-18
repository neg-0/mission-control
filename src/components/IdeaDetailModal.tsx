'use client';

import { useEffect, useState } from 'react';

interface Scorecard {
  id: string;
  category: string;
  score: number;
  rationale?: string;
}

interface IdeaDetail {
  id: string;
  title: string;
  description: string | null;
  source: string | null;
  status: string;
  stage: string;
  score: number | null;
  researchNotes: string | null;
  scorecards: Scorecard[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refineryData: Record<string, any> | null;
  validationMetrics: Record<string, unknown> | null;
  project: { id: string; name: string; stage: string } | null;
}

interface IdeaDetailModalProps {
  ideaId: string | null;
  onClose: () => void;
  onSpawnCeo: (ideaId: string) => void;
}

const scoreLabels: Record<string, string> = {
  problem_pain_level: '😫 Pain Level',
  market_demand: '📈 Market Demand',
  technical_feasibility: '⚙️ Tech Feasibility',
  competition_gap: '🏆 Competition Gap',
  b2b_value: '💰 B2B Value',
};

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

export function IdeaDetailModal({ ideaId, onClose, onSpawnCeo }: IdeaDetailModalProps) {
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!ideaId) {
      setIdea(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/ideas/${ideaId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then((data) => {
        setIdea(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [ideaId]);

  async function handleAction(action: 'green-light' | 'archive' | 'return') {
    if (!ideaId) return;
    setActionLoading(action);

    try {
      const _res = await fetch('/api/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `ACTION: Pipeline Decision for ${ideaId} -> ${action}`,
          context: { source: 'mission-control', action, target: ideaId },
        }),
      });
      if (action === 'green-light') {
        // Green light means Spawn CEO
        onSpawnCeo(ideaId);
      }
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  }

  if (!ideaId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto glass-card p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors text-lg"
          onClick={onClose}
        >
          ✕
        </button>

        {loading && (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        )}

        {error && (
          <div className="text-center py-8">
            <div className="text-sm text-red-400">No idea.json found for {ideaId}</div>
            <div className="text-xs text-muted-foreground mt-1">
              This idea may not have a detailed breakdown yet
            </div>
          </div>
        )}

        {idea && (
          <>
            <div>
              <div className="text-[10px] font-mono text-muted-foreground">{idea.id}</div>
              <h2 className="text-lg font-semibold mt-0.5">{idea.title}</h2>
              <div className="flex gap-2 mt-1">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 uppercase tracking-wider">{idea.status}</span>
                {idea.stage && idea.stage !== idea.status && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 uppercase tracking-wider">{idea.stage}</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">
                {idea.source}
              </div>
            </div>

            <p className="text-sm text-foreground/80 leading-relaxed">
              {idea.description}
            </p>

            {/* Scorecards */}
            {idea.scorecards?.length > 0 && (
              <div className="space-y-2 pt-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Score Breakdown
                </h3>
                {idea.scorecards.map((sc) => (
                  <ScoreBar
                    key={sc.id}
                    label={scoreLabels[sc.category] || sc.category}
                    value={sc.score}
                  />
                ))}
              </div>
            )}

            {/* Research Notes */}
            {idea.researchNotes && (
              <div className="pt-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Research Notes</h3>
                <pre className="text-xs text-foreground/70 whitespace-pre-wrap max-h-40 overflow-y-auto bg-card/30 p-2 rounded">{idea.researchNotes}</pre>
              </div>
            )}

            {/* Refinery Data */}
            {idea.refineryData && (
              <div className="pt-2 space-y-3">
                {/* Pain Points */}
                {idea.refineryData.pain_points && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Pain Points</h3>
                    <ul className="text-xs text-foreground/70 space-y-1">
                      {(idea.refineryData.pain_points as string[]).map((p: string, i: number) => (
                        <li key={i} className="flex gap-1"><span className="text-red-400">•</span> {p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Copy */}
                {idea.refineryData.copy && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Landing Page Copy</h3>
                    <div className="text-xs bg-card/30 p-2 rounded space-y-1">
                      <div className="font-semibold text-emerald-400">{idea.refineryData.copy.headline}</div>
                      <div className="text-foreground/70">{idea.refineryData.copy.subhead}</div>
                    </div>
                  </div>
                )}

                {/* Outreach Drafts */}
                {idea.refineryData.outreach_drafts && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Outreach Drafts</h3>
                    <pre className="text-xs text-foreground/70 whitespace-pre-wrap max-h-40 overflow-y-auto bg-card/30 p-2 rounded">
                      {typeof idea.refineryData.outreach_drafts === 'string'
                        ? idea.refineryData.outreach_drafts
                        : JSON.stringify(idea.refineryData.outreach_drafts, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Decision Controls */}
            <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border/30">
              <button
                className="text-xs py-2 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors"
                onClick={() => handleAction('green-light')}
                disabled={!!actionLoading}
              >
                {actionLoading === 'green-light' ? '...' : '🟢 Green Light (Spawn CEO)'}
              </button>
              <button
                className="text-xs py-2 rounded bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 transition-colors"
                onClick={() => handleAction('return')}
                disabled={!!actionLoading}
              >
                {actionLoading === 'return' ? '...' : '↩️ Return for Review'}
              </button>
              <button
                className="text-xs py-2 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors"
                onClick={() => handleAction('archive')}
                disabled={!!actionLoading}
              >
                {actionLoading === 'archive' ? '...' : '🗑️ Archive'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
