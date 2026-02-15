'use client';

import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectSummary {
  id: string;
  name: string;
  stage: string;
  description: string | null;
  repoUrl: string | null;
  deployedUrl: string | null;
  ownerAgent: { id: string; role: string } | null;
  counts: { checkpoints: number; tasks: number; pipelines: number; goals: number };
  checkpointProgress: { total: number; passed: number; blocked: number };
}

const stageConfig: Record<string, { emoji: string; label: string; cls: string }> = {
  research: { emoji: '🔬', label: 'Research', cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  validation: { emoji: '⚖️', label: 'Validation', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
  building: { emoji: '🏗️', label: 'Building', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  beta: { emoji: '🟡', label: 'Beta', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  launched: { emoji: '🟢', label: 'Live', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  backlog: { emoji: '📋', label: 'Backlog', cls: 'bg-card/50 text-muted-foreground border-border/30' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectsGrid({
  onSelectProject,
  activeTab,
}: {
  onSelectProject: (id: string) => void;
  activeTab: string;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (activeTab !== 'projects' || loaded) return;
    fetch('/api/projects')
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        // Sort: projects needing attention float to top
        const sorted = [...data].sort((a: ProjectSummary, b: ProjectSummary) => {
          const aBlocked = a.checkpointProgress?.blocked ?? 0;
          const bBlocked = b.checkpointProgress?.blocked ?? 0;
          // Blockers first
          if (aBlocked !== bBlocked) return bBlocked - aBlocked;
          // Then by lifecycle progress (least done first)
          const aPct = a.checkpointProgress?.total ? a.checkpointProgress.passed / a.checkpointProgress.total : 1;
          const bPct = b.checkpointProgress?.total ? b.checkpointProgress.passed / b.checkpointProgress.total : 1;
          return aPct - bPct;
        });
        setProjects(sorted);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [activeTab, loaded]);

  if (!loaded || projects.length === 0) return null;

  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        🚀 Projects
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {projects.map(p => {
          const cfg = stageConfig[p.stage] || stageConfig.backlog;
          const cpPct =
            p.checkpointProgress.total > 0
              ? Math.round(
                (p.checkpointProgress.passed / p.checkpointProgress.total) * 100,
              )
              : 0;
          return (
            <button
              key={p.id}
              onClick={() => onSelectProject(p.id)}
              className="glass-card hover-lift p-3 text-left group transition-all"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold truncate">{p.name}</span>
                <span
                  className={cn(
                    'text-[9px] font-mono px-1.5 py-0.5 rounded border whitespace-nowrap ml-2',
                    cfg.cls,
                  )}
                >
                  {cfg.emoji} {cfg.label}
                </span>
              </div>
              {p.checkpointProgress.total > 0 && (
                <div className="mb-1.5">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                    <span>Lifecycle</span>
                    <span className="font-mono">{cpPct}%</span>
                  </div>
                  <div className="h-1 bg-card/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500/60 rounded-full transition-all"
                      style={{ width: `${cpPct}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                {p.counts.tasks > 0 && <span>{p.counts.tasks} tasks</span>}
                {p.counts.goals > 0 && <span>{p.counts.goals} goals</span>}
                {p.checkpointProgress.blocked > 0 && (
                  <span className="text-orange-400">
                    ⚠ {p.checkpointProgress.blocked} blockers
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
