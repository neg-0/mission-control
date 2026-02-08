'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface MermaidChartProps {
  chart: string;
  className?: string;
}

export function MermaidChart({ chart, className }: MermaidChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId().replace(/:/g, '-');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        // Dynamic import to avoid SSR issues
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: 'transparent',
            primaryColor: '#3b82f6',
            primaryTextColor: '#e2e8f0',
            primaryBorderColor: '#475569',
            lineColor: '#64748b',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '14px',
          },
          flowchart: { curve: 'basis' },
          sequence: { actorMargin: 50 },
        });

        const { svg: rendered } = await mermaid.render(
          `mermaid-${uniqueId}`,
          chart.trim()
        );

        if (!cancelled) {
          setSvg(rendered);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setLoading(false);
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [chart, uniqueId]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 rounded-lg bg-muted/30 border border-border ${className || ''}`}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Rendering diagram…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg border border-red-500/30 bg-red-500/10 p-4 ${className || ''}`}>
        <div className="text-xs text-red-400 mb-1 font-medium">⚠ Mermaid Error</div>
        <div className="text-xs text-red-300/70 mb-2">{error}</div>
        <pre className="text-xs text-muted-foreground bg-muted/30 rounded p-2 overflow-x-auto">
          <code>{chart}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`mermaid-container rounded-lg bg-muted/20 border border-border p-4 overflow-x-auto ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
