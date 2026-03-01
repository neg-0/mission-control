'use client';

interface BlockerEntry {
  agentId: string;
  agentName: string;
  emoji: string;
  blocker: string;
}

interface BlockerBannerProps {
  blockers: BlockerEntry[];
}

export function BlockerBanner({ blockers }: BlockerBannerProps) {
  if (!blockers || blockers.length === 0) return null;

  return (
    <div className="space-y-2">
      {blockers.map((b, i) => (
        <div
          key={`${b.agentId}-${i}`}
          className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 animate-pulse-subtle"
          style={{ animationDuration: '3s' }}
        >
          <span className="text-lg flex-shrink-0">🚨</span>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-red-400">
              {b.emoji} {b.agentName} is blocked:
            </span>
            <span className="text-sm text-red-300/80 ml-2">{b.blocker}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
