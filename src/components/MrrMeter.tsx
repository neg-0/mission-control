'use client';

import { useEffect, useRef, useState } from 'react';

interface MrrMeterProps {
  current: number;
  delta?: number;
  milestones?: Array<{ label: string; mrr: number; status: string }>;
}

// Log10 scale markers
const MARKERS = [
  { value: 0, label: '$0' },
  { value: 10, label: '$10' },
  { value: 100, label: '$100' },
  { value: 1000, label: '$1K' },
  { value: 10000, label: '$10K' },
  { value: 100000, label: '$100K' },
  { value: 1000000, label: '$1M' },
];

const LOG_MAX = 6; // log10(1,000,000)

function valueToPercent(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1000000) return 100;
  // Use log10 scale: $1 = 0%, $1M = 100%
  const logVal = Math.log10(Math.max(value, 1));
  return (logVal / LOG_MAX) * 100;
}

function markerPercent(value: number): number {
  if (value <= 0) return 0;
  return (Math.log10(value) / LOG_MAX) * 100;
}

// Dynamic glow intensity: higher value = more visual energy
function glowIntensity(percent: number): { blur: number; opacity: number; pulseSpeed: number } {
  const t = percent / 100;
  return {
    blur: 8 + t * 32,           // 8px → 40px blur
    opacity: 0.3 + t * 0.7,     // 0.3 → 1.0
    pulseSpeed: 3 - t * 2,      // 3s → 1s (faster at higher values)
  };
}

export function MrrMeter({ current, milestones }: MrrMeterProps) {
  const percent = valueToPercent(current);
  const glow = glowIntensity(percent);
  const barRef = useRef<HTMLDivElement>(null);
  const [animated, setAnimated] = useState(0);

  // Animate the bar fill on mount
  useEffect(() => {
    const timer = setTimeout(() => setAnimated(percent), 100);
    return () => clearTimeout(timer);
  }, [percent]);

  const formatMrr = (v: number) => {
    if (v >= 1000000) return '$1M';
    if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
    return `$${v.toFixed(v < 10 ? 2 : 0)}`;
  };

  // Find the next unachieved milestone
  const nextMilestone = milestones?.find((m) => m.status === '⚪' && m.mrr > current);

  return (
    <div className="w-full">
      {/* Header row */}
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold tracking-tight">{formatMrr(current)}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly Recurring Revenue</span>
        </div>
        {nextMilestone && (
          <span className="text-xs text-muted-foreground">
            Next: 🥇 <span className="text-foreground/80 font-medium">{nextMilestone.label}</span>
            <span className="text-muted-foreground ml-1">({formatMrr(nextMilestone.mrr)})</span>
          </span>
        )}
      </div>

      {/* Meter bar */}
      <div className="relative w-full h-8 rounded-full overflow-hidden bg-muted/30 border border-border/50">
        {/* Background grid lines at markers */}
        {MARKERS.map((m, i) => {
          if (m.value === 0) return null;
          const pos = markerPercent(m.value);
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-border/30"
              style={{ left: `${pos}%` }}
            />
          );
        })}

        {/* Filled bar with gradient */}
        <div
          ref={barRef}
          className="absolute top-0 left-0 bottom-0 rounded-full transition-all duration-[2000ms] ease-out"
          style={{
            width: `${animated}%`,
            background: `linear-gradient(90deg, 
              #0ea5e9 0%, 
              #06b6d4 30%, 
              #10b981 60%, 
              #22c55e 80%, 
              #eab308 95%, 
              #f59e0b 100%
            )`,
          }}
        />

        {/* Glow overlay — intensity scales with value */}
        <div
          className="absolute top-0 left-0 bottom-0 rounded-full pointer-events-none"
          style={{
            width: `${animated}%`,
            background: `linear-gradient(90deg, 
              rgba(14, 165, 233, 0.6) 0%, 
              rgba(16, 185, 129, 0.6) 50%, 
              rgba(234, 179, 8, 0.8) 100%
            )`,
            filter: `blur(${glow.blur}px)`,
            opacity: glow.opacity,
            animation: `pulse ${glow.pulseSpeed}s ease-in-out infinite`,
          }}
        />

        {/* Needle indicator */}
        {animated > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] transition-all duration-[2000ms] ease-out"
            style={{ left: `${animated}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
          </div>
        )}
      </div>

      {/* Scale markers */}
      <div className="relative w-full h-5 mt-1">
        {MARKERS.map((m, i) => {
          const pos = m.value === 0 ? 0 : markerPercent(m.value);
          const isPast = percent >= pos;
          return (
            <div
              key={i}
              className="absolute text-[10px] -translate-x-1/2"
              style={{
                left: `${pos}%`,
                color: isPast ? 'var(--foreground)' : 'var(--muted-foreground)',
                fontWeight: isPast ? 600 : 400,
              }}
            >
              {m.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
