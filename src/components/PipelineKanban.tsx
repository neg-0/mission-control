'use client';

import { cn } from '@/lib/utils';

interface PipelineItem {
  id: string;
  name: string;
  bluf: string;
  score: number;
  status: string;
  nextStep?: string;
  url: string | null;
}

interface PipelineKanbanProps {
  items: PipelineItem[];
  onSpawnCeo?: (ideaId: string) => void;
  onCardClick?: (ideaId: string) => void;
}

const COLUMNS = [
  { key: 'Research', label: '🔬 Research', statuses: ['research', 'research_complete', 'Research'] },
  { key: 'Validation', label: '⚖️ Validation', statuses: ['validation', 'Validation'] },
  { key: 'Building', label: '🏗️ Building', statuses: ['building', 'Building', 'mvp'] },
  { key: 'Beta', label: '🟡 Beta', statuses: ['beta', 'Beta'] },
  { key: 'Live', label: '🟢 Live', statuses: ['live', 'Live', 'launched'] },
];

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (score >= 70) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  if (score >= 60) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  return 'bg-red-500/20 text-red-400 border-red-500/30';
}

export function PipelineKanban({ items, onSpawnCeo, onCardClick }: PipelineKanbanProps) {
  const columns = COLUMNS.map((col) => ({
    ...col,
    items: items.filter((item) => col.statuses.includes(item.status)),
  }));

  async function _handleSpawnCeo(ideaId: string) {
    try {
      const res = await fetch('/api/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `ACTION: Spawn CEO for ${ideaId}`,
          context: { source: 'mission-control', action: 'spawn-ceo', target: ideaId },
        }),
      });
      const data = await res.json();
      if (data.success) {
        onSpawnCeo?.(ideaId);
      } else {
        console.error('Spawn CEO failed:', data.error);
      }
    } catch (e) {
      console.error('Spawn CEO request failed:', e);
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {columns.map((col) => (
        <div
          key={col.key}
          className="flex-shrink-0 w-[240px] min-w-[240px] glass-card p-3 space-y-2"
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {col.label}
            </h3>
            <span className="text-[10px] text-muted-foreground bg-card/50 px-1.5 py-0.5 rounded-full font-mono">
              {col.items.length}
            </span>
          </div>

          {col.items.length === 0 ? (
            <div className="text-xs text-muted-foreground italic text-center py-4">Empty</div>
          ) : (
            col.items.map((item) => (
              <div
                key={item.id}
                className="bg-card/40 border border-border/50 rounded-lg p-2.5 space-y-1.5 hover:border-primary/20 transition-colors cursor-pointer"
                onClick={() => onCardClick?.(item.id)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-muted-foreground">{item.id}</span>
                  <span
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                      scoreColor(item.score)
                    )}
                  >
                    {item.score}
                  </span>
                </div>
                <div className="text-sm font-medium">{item.name}</div>
                <div className="text-[11px] text-muted-foreground leading-snug">{item.bluf}</div>
                {item.nextStep && item.nextStep !== item.bluf && (
                  <div className="text-[10px] text-muted-foreground">
                    <span className="text-foreground/50">Next:</span> {item.nextStep}
                  </div>
                )}
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-sky-400 hover:underline block truncate"
                    onClick={(e) => e.stopPropagation()} // Prevent card click
                  >
                    {item.url}
                  </a>
                )}
                {/* Spawn CEO button moved to Modal */}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
