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
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setShow(true);
      fetchContent();
    }, 300);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShow(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="text-[11px] px-2 py-1 rounded-md bg-card/60 border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/10 transition-all font-medium"
      >
        {label}
      </button>

      {show && (
        <div
          className="absolute z-50 top-full left-0 mt-1 w-[420px] max-h-[350px] overflow-y-auto glass-card p-3 shadow-2xl shadow-black/40 text-[11px] font-mono whitespace-pre-wrap text-foreground/80 leading-relaxed"
          onMouseEnter={() => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }}
          onMouseLeave={handleMouseLeave}
        >
          {loading ? (
            <div className="text-muted-foreground animate-pulse">Loading...</div>
          ) : (
            <div>{content}</div>
          )}
        </div>
      )}
    </div>
  );
}
