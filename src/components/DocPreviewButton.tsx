'use client';

import { useEffect, useRef, useState } from 'react';

interface DocPreviewButtonProps {
  label: string;
  workspace: string;
  filename: string;
}

export function DocPreviewButton({ label, workspace, filename }: DocPreviewButtonProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchContent = async () => {
    if (content !== null) return; // already fetched
    setLoading(true);
    try {
      const filePath = filename;
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}&workspace=${encodeURIComponent(workspace)}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content || '(empty file)');
      } else {
        setContent('(file not found)');
      }
    } catch {
      setContent('(failed to load)');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchContent();
  };

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`text-[11px] px-2 py-1 rounded-md border font-medium transition-all ${open
            ? 'bg-primary/20 border-primary/40 text-foreground'
            : 'bg-card/60 border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/10'
          }`}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: 'none' }}>
          {/* Backdrop — catches clicks outside */}
          <div
            className="absolute inset-0"
            style={{ pointerEvents: 'auto' }}
            onClick={() => setOpen(false)}
          />
          {/* Panel — positioned near the button */}
          <div
            ref={panelRef}
            className="absolute w-[500px] max-h-[60vh] overflow-y-auto glass-card p-4 shadow-2xl shadow-black/60 border border-border/60 text-[11px] font-mono whitespace-pre-wrap text-foreground/80 leading-relaxed"
            style={{
              pointerEvents: 'auto',
              top: buttonRef.current
                ? buttonRef.current.getBoundingClientRect().bottom + 8
                : 100,
              left: buttonRef.current
                ? Math.min(
                  buttonRef.current.getBoundingClientRect().left,
                  window.innerWidth - 520
                )
                : 100,
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground text-sm leading-none px-1"
            >
              ✕
            </button>
            <div className="text-xs font-semibold text-primary/80 mb-2 tracking-wide uppercase">
              {label}
            </div>
            {loading ? (
              <div className="text-muted-foreground animate-pulse">Loading...</div>
            ) : (
              <div>{content}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
