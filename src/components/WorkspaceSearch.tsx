'use client';

import { FileText, Loader2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/utils';

interface SearchResult {
  filePath: string;
  fileName: string;
  title: string;
  snippet: string;
  score: number;
  lineStart: number;
  workspaceId: string;
  workspaceLabel: string;
  workspacePath: string;
}

interface WorkspaceSearchProps {
  onSelectFile?: (filePath: string, workspacePath: string, query: string) => void;
  initialQuery?: string;
  className?: string;
}

// Stable color per workspace id
const WS_COLORS: Record<string, string> = {
  rocket: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  captain: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  warden: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  shared: 'bg-green-500/20 text-green-300 border-green-500/30',
};
const DEFAULT_WS_COLOR = 'bg-gray-500/20 text-gray-300 border-gray-500/30';

export function WorkspaceSearch({ onSelectFile, initialQuery, className }: WorkspaceSearchProps) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const isMac = useMemo(() => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent), []);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [visibleCount, setVisibleCount] = useState(10);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Sync external initialQuery changes (e.g. URL param on mount)
  useEffect(() => {
    if (initialQuery && initialQuery !== query) {
      setQuery(initialQuery);
      doSearch(initialQuery);
    }
  }, [initialQuery]);

  // Global "/" and Ctrl/Cmd-F shortcut to focus search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
        setOpen(data.results?.length > 0);
        setSelectedIdx(0);
        setVisibleCount(10);
      }
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 250);
  }

  function handleSelect(result: SearchResult) {
    setOpen(false);
    setResults([]);
    // Keep query for highlight, pass it along
    onSelectFile?.(result.filePath, result.workspacePath, query);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, Math.min(visibleCount, results.length) - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function relevanceBadge(score: number) {
    if (score < 0.1) return { label: 'exact', color: 'text-green-400' };
    if (score < 0.25) return { label: 'strong', color: 'text-blue-400' };
    if (score < 0.35) return { label: 'good', color: 'text-yellow-400' };
    return { label: 'fuzzy', color: 'text-muted-foreground' };
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Search Input */}
      <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2 focus-within:border-primary/50 transition-colors">
        {loading ? (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        ) : (
          <Search className="w-4 h-4 text-primary" />
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder="Search all workspaces... (goals, playbook, architecture)"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          value={query}
          onChange={e => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setOpen(false); }}
            className="p-0.5 hover:bg-accent rounded"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
        <kbd className="hidden sm:inline-flex text-[10px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
          {isMac ? '⌘F' : 'Ctrl+F'}
        </kbd>
      </div>

      {/* Results Dropdown */}
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 glass-card shadow-xl z-50 max-h-[420px] overflow-y-auto">
          <div className="p-2 border-b border-border">
            <span className="text-xs text-muted-foreground">
              {results.length} result{results.length !== 1 ? 's' : ''} across all workspaces
            </span>
          </div>
          {results.slice(0, visibleCount).map((result, idx) => {
            const badge = relevanceBadge(result.score);
            const wsColor = WS_COLORS[result.workspaceId] || DEFAULT_WS_COLOR;
            return (
              <button
                key={`${result.workspacePath}-${result.filePath}-${result.lineStart}`}
                className={cn(
                  'w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors',
                  idx === selectedIdx ? 'bg-accent' : 'hover:bg-accent/50'
                )}
                onClick={() => handleSelect(result)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{result.title}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', wsColor)}>
                      {result.workspaceLabel}
                    </span>
                    <span className={cn('text-[10px]', badge.color)}>{badge.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {result.filePath}
                  </div>
                  <div className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                    {result.snippet}
                  </div>
                </div>
              </button>
            );
          })}
          {visibleCount < results.length && (
            <button
              className="w-full text-center py-2 text-xs text-primary hover:bg-accent/50 transition-colors border-t border-border"
              onClick={(e) => { e.stopPropagation(); setVisibleCount(v => v + 10); }}
            >
              Show {Math.min(10, results.length - visibleCount)} more result{results.length - visibleCount !== 1 ? 's' : ''} ({results.length - visibleCount} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
