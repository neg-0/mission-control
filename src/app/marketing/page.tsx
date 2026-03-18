'use client';

import { useMemo } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import { cn } from '../../lib/utils';
import {
  Megaphone,
  TrendingUp,
  Users,
  Globe,
  ArrowRight,
  ExternalLink,
  Timer,
  Target,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface OutreachIdea {
  id: string;
  name: string;
  status: string;
  stage?: string;
  score: number;
  validationDeadline?: string | null;
  validationTarget?: number | null;
  validationMetrics?: {
    signups?: number;
    traffic?: number;
    conversion?: string;
  } | null;
  url: string | null;
  sourceUrls?: string[];
  timeRemaining?: number | null;
  isExpired?: boolean;
}

// ─── Funnel Stage Config ────────────────────────────────────────────

const FUNNEL_STAGES = [
  { key: 'draft', label: 'Inbox', emoji: '💡', color: 'bg-slate-500' },
  { key: 'refining', label: 'Research', emoji: '🔬', color: 'bg-blue-500' },
  { key: 'building_lp', label: 'Landing Page', emoji: '🏗️', color: 'bg-purple-500' },
  { key: 'validating', label: 'Validation', emoji: '⚔️', color: 'bg-amber-500' },
  { key: 'graduated', label: 'Graduated', emoji: '✅', color: 'bg-emerald-500' },
] as const;

const STATUS_MAP: Record<string, string> = {
  draft: 'draft',
  new: 'draft',
  refining: 'refining',
  researching: 'refining',
  pain_audit: 'refining',
  copy_draft: 'refining',
  outreach_scan: 'refining',
  brief_sent: 'refining',
  building_lp: 'building_lp',
  landing_page: 'building_lp',
  landing_page_complete: 'building_lp',
  validating: 'validating',
  outreach_exec: 'validating',
  graduated: 'graduated',
  validated: 'graduated',
};

// ─── Helpers ────────────────────────────────────────────────────────

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'EXPIRED';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ─── Marketing Page ─────────────────────────────────────────────────

export default function MarketingPage() {
  const { dashboardData } = useDashboard();
  const pipeline = dashboardData?.pipeline ?? [];

  // Compute funnel counts
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const stage of FUNNEL_STAGES) counts[stage.key] = 0;

    for (const idea of pipeline) {
      const mapped = STATUS_MAP[idea.status];
      if (mapped && counts[mapped] !== undefined) counts[mapped]++;
    }

    return FUNNEL_STAGES.map(stage => ({
      ...stage,
      count: counts[stage.key],
    }));
  }, [pipeline]);

  // Active outreach campaigns (validating stage)
  const activeCampaigns = useMemo(
    () => pipeline.filter(i => ['validating', 'outreach_exec'].includes(i.status)),
    [pipeline]
  );

  // Ideas in outreach prep (building LP or outreach stage)
  const outreachPrep = useMemo(
    () =>
      pipeline.filter(i =>
        ['building_lp', 'landing_page', 'landing_page_complete', 'copy_draft', 'outreach_scan', 'brief_sent'].includes(i.status)
      ),
    [pipeline]
  );

  // Aggregate metrics
  const totalSignups = useMemo(
    () => pipeline.reduce((sum, i) => sum + (i.validationMetrics?.signups ?? 0), 0),
    [pipeline]
  );
  const totalTraffic = useMemo(
    () => pipeline.reduce((sum, i) => sum + (i.validationMetrics?.traffic ?? 0), 0),
    [pipeline]
  );
  const graduatedCount = useMemo(
    () => pipeline.filter(i => ['graduated', 'validated'].includes(i.status)).length,
    [pipeline]
  );

  const maxFunnel = Math.max(...funnelData.map(s => s.count), 1);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Megaphone className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold">Marketing Engine</h1>
        <span className="text-xs text-muted-foreground bg-primary/10 px-2 py-0.5 rounded-full">
          {pipeline.length} ideas in pipeline
        </span>
      </div>

      {/* Aggregate Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          icon={<Target className="w-4 h-4" />}
          label="Active Campaigns"
          value={activeCampaigns.length}
          accent="text-amber-400"
        />
        <StatCard
          icon={<Users className="w-4 h-4" />}
          label="Total Signups"
          value={totalSignups}
          accent="text-emerald-400"
        />
        <StatCard
          icon={<Globe className="w-4 h-4" />}
          label="Total Traffic"
          value={totalTraffic}
          accent="text-blue-400"
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Graduated"
          value={graduatedCount}
          accent="text-emerald-400"
        />
      </div>

      {/* Conversion Funnel */}
      <div className="glass-card rounded-lg border border-primary/20 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Idea Conversion Funnel
        </h2>
        <div className="space-y-3">
          {funnelData.map((stage, idx) => (
            <div key={stage.key} className="flex items-center gap-3">
              <span className="text-lg w-6 text-center">{stage.emoji}</span>
              <span className="text-xs font-medium w-24 text-muted-foreground">{stage.label}</span>
              <div className="flex-1 h-6 bg-card/40 rounded overflow-hidden relative">
                <div
                  className={cn('h-full rounded transition-all duration-700', stage.color)}
                  style={{ width: `${Math.max((stage.count / maxFunnel) * 100, stage.count > 0 ? 8 : 0)}%`, opacity: 0.7 }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold">
                  {stage.count}
                </span>
              </div>
              {idx < funnelData.length - 1 && (
                <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Conversion rates */}
        <div className="mt-4 pt-3 border-t border-border/30 flex flex-wrap gap-4 text-[10px] text-muted-foreground">
          {funnelData.slice(0, -1).map((stage, idx) => {
            const next = funnelData[idx + 1];
            const rate = stage.count > 0 ? ((next.count / stage.count) * 100).toFixed(0) : '—';
            return (
              <span key={stage.key}>
                {stage.label} → {next.label}: <span className="font-mono text-foreground">{rate}%</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Active Campaigns (Validation Sprints) */}
      <div className="glass-card rounded-lg border border-primary/20 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          ⚔️ Active Validation Campaigns
        </h2>
        {activeCampaigns.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No active validation sprints. Move ideas through the funnel to start campaigns.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeCampaigns.map(idea => (
              <CampaignCard key={idea.id} idea={idea} />
            ))}
          </div>
        )}
      </div>

      {/* Outreach Prep Pipeline */}
      <div className="glass-card rounded-lg border border-primary/20 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          🏗️ Outreach Prep Pipeline
        </h2>
        {outreachPrep.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No ideas in outreach preparation. Ideas in research will appear here when ready.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {outreachPrep.map(idea => (
              <PrepCard key={idea.id} idea={idea} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat Card ──────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="glass-card rounded-lg border border-primary/20 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase">{label}</span>
        <div className={accent}>{icon}</div>
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

// ─── Campaign Card (Active Validation Sprint) ───────────────────────

function CampaignCard({ idea }: { idea: OutreachIdea }) {
  const target = idea.validationTarget ?? 10;
  const signups = idea.validationMetrics?.signups ?? 0;
  const traffic = idea.validationMetrics?.traffic ?? 0;
  const progress = Math.min(100, (signups / target) * 100);

  const deadline = idea.validationDeadline ? new Date(idea.validationDeadline).getTime() : null;
  const remaining = deadline ? deadline - Date.now() : null;
  const isExpired = remaining !== null && remaining <= 0;

  return (
    <div
      className={cn(
        'border rounded-lg p-4 space-y-3',
        isExpired
          ? 'bg-red-500/5 border-red-500/30'
          : 'bg-card/40 border-amber-500/30'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{idea.name}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{idea.id.split('-')[0]}</div>
        </div>
        <span
          className={cn(
            'text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0',
            idea.score >= 80
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : idea.score >= 70
              ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
              : 'bg-red-500/20 text-red-400 border-red-500/30'
          )}
        >
          {idea.score}
        </span>
      </div>

      {/* Countdown */}
      {remaining !== null && (
        <div
          className={cn(
            'text-center py-1.5 rounded text-xs font-mono font-bold',
            isExpired ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/10 text-amber-400'
          )}
        >
          <Timer className="w-3 h-3 inline mr-1" />
          {isExpired ? '⏰ EXPIRED' : formatCountdown(remaining)}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] text-muted-foreground">Signups</div>
          <div className={cn('text-sm font-bold', signups >= target ? 'text-emerald-400' : 'text-foreground')}>
            {signups}/{target}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Traffic</div>
          <div className="text-sm font-bold">{traffic}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">CVR</div>
          <div className="text-sm font-bold">{idea.validationMetrics?.conversion || '—'}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-2 bg-card/60 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              signups >= target ? 'bg-emerald-500' : 'bg-amber-500'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Landing page link */}
      {idea.url && (
        <a
          href={idea.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" />
          Landing Page
        </a>
      )}
    </div>
  );
}

// ─── Prep Card (Ideas in Outreach Preparation) ─────────────────────

function PrepCard({ idea }: { idea: OutreachIdea }) {
  const stageLabels: Record<string, string> = {
    building_lp: '🏗️ Building LP',
    landing_page: '🏗️ Building LP',
    landing_page_complete: '✅ LP Complete',
    copy_draft: '✍️ Copy Draft',
    outreach_scan: '🔍 Outreach Scan',
    brief_sent: '📨 Brief Sent',
  };

  return (
    <div className="border rounded-lg p-3 bg-card/40 border-border/50 hover:border-primary/20 transition-colors space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{idea.name}</div>
        </div>
        <span
          className={cn(
            'text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ml-2',
            idea.score >= 80
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : idea.score >= 70
              ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
              : 'bg-orange-500/20 text-orange-400 border-orange-500/30'
          )}
        >
          {idea.score}
        </span>
      </div>

      <div className="text-[10px] text-sky-400">{stageLabels[idea.status] || idea.status}</div>

      {idea.url && (
        <a
          href={idea.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" />
          Landing Page
        </a>
      )}
    </div>
  );
}
