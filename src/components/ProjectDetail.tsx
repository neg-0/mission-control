'use client';

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  GitBranch,
  Globe,
  Loader2,
  Shield,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Checkpoint {
  id: string;
  phase: string;
  key: string;
  label: string;
  order: number;
  status: string;
  automated: boolean;
  humanRequired: boolean;
  output: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
}

interface PhaseSummary {
  phase: string;
  total: number;
  passed: number;
  blocked: number;
  needsHuman: number;
}

interface PipelineGate {
  id: string;
  name: string;
  order: number;
  severity: string;
  status: string;
}

interface Pipeline {
  id: string;
  stage: string;
  status: string;
  gates: PipelineGate[];
}

interface ProjectData {
  id: string;
  name: string;
  stage: string;
  description: string | null;
  repoUrl: string | null;
  deployedUrl: string | null;
  ownerAgent: { id: string; role: string; status: string } | null;
  idea: { id: string; title: string; score: number | null } | null;
  checkpoints: Checkpoint[];
  goals: { id: string; title: string; status: string; progress: number; tasks: { id: string; title: string; status: string }[] }[];
  tasks: { id: string; title: string; status: string; priority: string }[];
  pipelines: Pipeline[];
  phaseSummary: PhaseSummary[];
  blockers: Checkpoint[];
}

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASES = [
  { key: 'idea', label: 'Idea', emoji: '💡', color: 'violet' },
  { key: 'ship', label: 'Ship', emoji: '🚀', color: 'blue' },
  { key: 'live', label: 'Live', emoji: '🟢', color: 'emerald' },
  { key: 'scale', label: 'Scale', emoji: '📈', color: 'amber' },
];

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusIcon(status: string, size = 14) {
  switch (status) {
    case 'pass':
    case 'passing':
      return <CheckCircle2 size={size} className="text-emerald-400" />;
    case 'fail':
    case 'failing':
      return <XCircle size={size} className="text-red-400" />;
    case 'blocked':
      return <AlertTriangle size={size} className="text-orange-400" />;
    case 'skipped':
      return <SkipForward size={size} className="text-muted-foreground" />;
    case 'pending':
    default:
      return <Circle size={size} className="text-muted-foreground/50" />;
  }
}

function phaseStatus(summary: PhaseSummary | undefined): 'complete' | 'active' | 'pending' {
  if (!summary || summary.total === 0) return 'pending';
  if (summary.passed === summary.total) return 'complete';
  if (summary.passed > 0 || summary.blocked > 0 || summary.needsHuman > 0) return 'active';
  return 'pending';
}

const phaseColors: Record<string, { ring: string; bg: string; text: string; glow: string }> = {
  violet: { ring: 'ring-violet-500', bg: 'bg-violet-500', text: 'text-violet-400', glow: 'shadow-violet-500/30' },
  blue: { ring: 'ring-blue-500', bg: 'bg-blue-500', text: 'text-blue-400', glow: 'shadow-blue-500/30' },
  emerald: { ring: 'ring-emerald-500', bg: 'bg-emerald-500', text: 'text-emerald-400', glow: 'shadow-emerald-500/30' },
  amber: { ring: 'ring-amber-500', bg: 'bg-amber-500', text: 'text-amber-400', glow: 'shadow-amber-500/30' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PhaseTimeline({ phaseSummary }: { phaseSummary: PhaseSummary[] }) {
  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, i) => {
        const summary = phaseSummary.find(s => s.phase === phase.key);
        const status = phaseStatus(summary);
        const colors = phaseColors[phase.color];

        return (
          <div key={phase.key} className="flex items-center">
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                status === 'complete' && `${colors.bg}/20 ${colors.text} ring-1 ${colors.ring}/30`,
                status === 'active' && `${colors.bg}/30 ${colors.text} ring-2 ${colors.ring} shadow-md ${colors.glow}`,
                status === 'pending' && 'bg-card/30 text-muted-foreground/50',
              )}
            >
              <span>{phase.emoji}</span>
              <span>{phase.label}</span>
              {summary && summary.total > 0 && (
                <span className="font-mono text-[10px] opacity-70">
                  {summary.passed}/{summary.total}
                </span>
              )}
            </div>
            {i < PHASES.length - 1 && (
              <div className={cn(
                'w-6 h-px mx-1',
                status === 'complete' ? 'bg-emerald-500/50' : 'bg-border/30',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BlockerPanel({
  blockers,
  onResolve,
}: {
  blockers: Checkpoint[];
  onResolve: (id: string, status: string) => void;
}) {
  if (blockers.length === 0) return null;

  return (
    <div className="glass-card border-orange-500/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2 bg-orange-500/5">
        <AlertTriangle className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-orange-300">
          Needs You ({blockers.length})
        </h3>
      </div>
      <div className="p-2 space-y-1">
        {blockers.map(b => (
          <div
            key={b.id}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-card/30 hover:bg-card/50 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              {b.status === 'fail' ? (
                <XCircle size={16} className="text-red-400" />
              ) : b.status === 'blocked' ? (
                <AlertTriangle size={16} className="text-orange-400" />
              ) : (
                <Clock size={16} className="text-yellow-400" />
              )}
              <div>
                <div className="text-sm font-medium">{b.label}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{b.phase} · {b.key}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onResolve(b.id, 'pass')}
                className="text-[10px] px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors"
              >
                ✅ Approve
              </button>
              <button
                onClick={() => onResolve(b.id, 'skipped')}
                className="text-[10px] px-2.5 py-1 rounded bg-card/50 hover:bg-card/80 text-muted-foreground border border-border/30 transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CheckpointGrid({ checkpoints, activePhase }: { checkpoints: Checkpoint[]; activePhase: string }) {
  const grouped = PHASES.map(p => ({
    ...p,
    checkpoints: checkpoints.filter(c => c.phase === p.key),
  }));

  return (
    <div className="space-y-3">
      {grouped.map(group => {
        if (group.checkpoints.length === 0) return null;
        const isActive = group.key === activePhase;
        const colors = phaseColors[group.color];

        return (
          <div key={group.key} className={cn('glass-card overflow-hidden', isActive && 'ring-1 ring-inset ' + colors.ring + '/20')}>
            <div className={cn('px-4 py-2 border-b border-border/30 flex items-center gap-2', isActive && colors.bg + '/5')}>
              <span>{group.emoji}</span>
              <span className={cn('text-xs font-semibold uppercase tracking-wider', isActive ? colors.text : 'text-muted-foreground')}>
                {group.label} Phase
              </span>
              <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                {group.checkpoints.filter(c => c.status === 'pass' || c.status === 'skipped').length}/{group.checkpoints.length}
              </span>
            </div>
            <div className="p-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {group.checkpoints.map(cp => (
                  <div
                    key={cp.id}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                      cp.status === 'pass' && 'bg-emerald-500/5',
                      cp.status === 'fail' && 'bg-red-500/5',
                      cp.status === 'blocked' && 'bg-orange-500/5',
                      cp.status === 'pending' && 'bg-card/20',
                    )}
                  >
                    {statusIcon(cp.status, 14)}
                    <span className={cn(
                      cp.status === 'pass' && 'text-foreground/60 line-through',
                      cp.status === 'pending' && 'text-muted-foreground',
                    )}>
                      {cp.label}
                    </span>
                    {cp.humanRequired && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 ml-auto">
                        HUMAN
                      </span>
                    )}
                    {cp.automated && !cp.humanRequired && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 ml-auto">
                        AUTO
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QualityGates({ pipelines }: { pipelines: Pipeline[] }) {
  const latest = pipelines[0];
  if (!latest) return null;

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border/30 flex items-center gap-2">
        <Shield size={14} className="text-blue-400" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Quality Gates
        </span>
        <span className={cn(
          'text-[10px] font-mono px-1.5 py-0.5 rounded ml-auto',
          latest.status === 'passing' && 'bg-emerald-500/10 text-emerald-400',
          latest.status === 'failing' && 'bg-red-500/10 text-red-400',
          latest.status === 'pending' && 'bg-card/50 text-muted-foreground',
        )}>
          {latest.status}
        </span>
      </div>
      <div className="p-3 flex flex-wrap gap-2">
        {latest.gates.map(gate => (
          <div
            key={gate.id}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
              gate.status === 'passing' && 'bg-emerald-500/10 text-emerald-400',
              gate.status === 'failing' && 'bg-red-500/10 text-red-400',
              gate.status === 'pending' && 'bg-card/30 text-muted-foreground',
              gate.status === 'skipped' && 'bg-card/20 text-muted-foreground/50',
            )}
          >
            {statusIcon(gate.status, 12)}
            <span>{gate.name}</span>
            {gate.severity === 'soft' && (
              <span className="text-[9px] opacity-50">(soft)</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ProjectDetail({ projectId, onBack }: ProjectDetailProps) {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const loadProject = () => {
    setLoading(true);
    fetch(`/api/projects/${projectId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Not found (${res.status})`);
        return res.json();
      })
      .then(data => {
        setProject(data);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleResolve(checkpointId: string, status: string) {
    setResolving(checkpointId);
    try {
      await fetch('/api/checkpoints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: checkpointId,
          status,
          resolvedBy: 'dustin',
        }),
      });
      loadProject(); // Refresh
    } catch (e) {
      console.error('Failed to resolve checkpoint:', e);
    } finally {
      setResolving(null);
    }
  }

  async function handleSeedCheckpoints() {
    try {
      await fetch('/api/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed', projectId }),
      });
      loadProject();
    } catch (e) {
      console.error('Failed to seed checkpoints:', e);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (error || !project) {
    return (
      <div className="text-center py-12">
        <div className="text-sm text-red-400 mb-2">{error || 'Project not found'}</div>
        <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          ← Back to projects
        </button>
      </div>
    );
  }

  // Determine active phase
  const activePhase = PHASES.find(p => {
    const summary = project.phaseSummary.find(s => s.phase === p.key);
    return summary && summary.passed < summary.total;
  })?.key || 'scale';

  const hasCheckpoints = project.checkpoints.length > 0;
  const totalTasks = project.tasks.length;
  const doneTasks = project.tasks.filter(t => t.status === 'done').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              onClick={onBack}
              className="mt-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-lg font-bold">{project.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                {project.ownerAgent && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    🤖 {project.ownerAgent.id} ({project.ownerAgent.role})
                  </span>
                )}
                <span className={cn(
                  'text-[10px] font-mono px-1.5 py-0.5 rounded',
                  project.stage === 'launched' && 'bg-emerald-500/10 text-emerald-400',
                  project.stage === 'building' && 'bg-blue-500/10 text-blue-400',
                  project.stage === 'research' && 'bg-violet-500/10 text-violet-400',
                  project.stage === 'beta' && 'bg-amber-500/10 text-amber-400',
                  project.stage === 'backlog' && 'bg-card/50 text-muted-foreground',
                )}>
                  {project.stage}
                </span>
              </div>
              {project.description && (
                <p className="text-xs text-muted-foreground mt-2 max-w-lg">{project.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] flex items-center gap-1 px-2 py-1 rounded bg-card/50 hover:bg-card/80 text-muted-foreground hover:text-foreground transition-colors"
              >
                <GitBranch size={12} /> Repo
              </a>
            )}
            {project.deployedUrl && (
              <a
                href={project.deployedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] flex items-center gap-1 px-2 py-1 rounded bg-card/50 hover:bg-card/80 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Globe size={12} /> Live
                <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>

        {/* Phase Timeline */}
        <div className="mt-4 pt-3 border-t border-border/30 overflow-x-auto">
          <PhaseTimeline phaseSummary={project.phaseSummary} />
        </div>
      </div>

      {/* Seed checkpoints if none exist */}
      {!hasCheckpoints && (
        <div className="glass-card p-6 text-center">
          <div className="text-muted-foreground text-sm mb-3">
            No checkpoints configured for this project yet.
          </div>
          <button
            onClick={handleSeedCheckpoints}
            className="text-xs px-4 py-2 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 transition-colors"
          >
            🌱 Seed Lifecycle Checkpoints
          </button>
        </div>
      )}

      {/* Blocker Panel */}
      {hasCheckpoints && (
        <BlockerPanel
          blockers={project.blockers}
          onResolve={handleResolve}
        />
      )}

      {/* Checkpoints + Quality Gates side by side */}
      {hasCheckpoints && (
        <div className="grid md:grid-cols-12 gap-4">
          <div className="md:col-span-8">
            <CheckpointGrid checkpoints={project.checkpoints} activePhase={activePhase} />
          </div>
          <div className="md:col-span-4 space-y-4">
            <QualityGates pipelines={project.pipelines} />

            {/* Metrics Strip */}
            <div className="glass-card p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Metrics</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-card/30 rounded-lg p-2 text-center">
                  <div className="text-lg font-bold font-mono">
                    {totalTasks > 0 ? `${Math.round((doneTasks / totalTasks) * 100)}%` : '—'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Tasks Done</div>
                </div>
                <div className="bg-card/30 rounded-lg p-2 text-center">
                  <div className="text-lg font-bold font-mono">{project.pipelines.length}</div>
                  <div className="text-[10px] text-muted-foreground">Pipelines</div>
                </div>
                <div className="bg-card/30 rounded-lg p-2 text-center">
                  <div className="text-lg font-bold font-mono">{project.goals.length}</div>
                  <div className="text-[10px] text-muted-foreground">Goals</div>
                </div>
                <div className="bg-card/30 rounded-lg p-2 text-center">
                  <div className="text-lg font-bold font-mono">
                    {project.idea?.score ? Math.round(project.idea.score) : '—'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Idea Score</div>
                </div>
              </div>
            </div>

            {/* Goals summary */}
            {project.goals.length > 0 && (
              <div className="glass-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border/30">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Goals
                  </span>
                </div>
                <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
                  {project.goals.map(g => (
                    <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-card/30">
                      {statusIcon(g.status === 'complete' ? 'pass' : g.status === 'blocked' ? 'blocked' : 'pending', 14)}
                      <span className="text-sm flex-1 truncate">{g.title}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{g.progress}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
