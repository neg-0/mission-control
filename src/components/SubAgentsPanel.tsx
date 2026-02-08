'use client';

import {
  Bot, Brain, CheckCircle2, ChevronDown, ChevronRight, Clock, Eye,
  FileText, GitBranch, Globe, Loader2, Pencil, Search, Sparkles,
  Terminal, XCircle, Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GatewayEvent, isAgentEvent, useGatewayStream } from '../hooks/useGatewayStream';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolHistoryEntry {
  label: string;     // human-readable, e.g. "Reading goals.md"
  iconKey: string;
  ts: number;
  isError?: boolean;
}

interface SubAgent {
  sessionKey: string;
  runId?: string;
  label?: string;
  status: 'running' | 'completed' | 'failed' | 'idle';
  startedAt?: number;
  completedAt?: number;
  currentAction?: string;       // human-readable current action
  currentActionIcon?: string;   // icon key for the current action
  streamingText?: string;       // live assistant text
  toolHistory: ToolHistoryEntry[];
  result?: string;
  agentName?: string;
  kind?: string;                // main / cron / subagent
  model?: string;
  lastActivityMs?: number;
}

// ---------------------------------------------------------------------------
// Tool → human-readable mapping
// ---------------------------------------------------------------------------

function toolToIcon(name: string): string {
  const n = name.toLowerCase().replace(/_/g, '');
  if (n === 'read' || n === 'fileread') return 'FileText';
  if (n === 'write' || n === 'filewrite') return 'Pencil';
  if (n === 'exec' || n === 'bash' || n === 'shell') return 'Terminal';
  if (n === 'websearch' || n === 'search') return 'Search';
  if (n === 'webfetch' || n === 'fetch') return 'Globe';
  if (n === 'memorysearch' || n === 'memoryget') return 'Brain';
  if (n === 'sessionsspawn' || n === 'sessionssend') return 'GitBranch';
  if (n === 'sessionstatus') return 'Eye';
  return 'Sparkles';
}

function toolToLabel(name: string, args?: Record<string, unknown>, meta?: string): string {
  const n = name.toLowerCase().replace(/_/g, '');
  const path = typeof args?.path === 'string' ? shortPath(args.path) : '';
  const query = typeof args?.query === 'string' ? args.query : '';
  const command = typeof args?.command === 'string' ? shortCommand(args.command) : '';
  const url = typeof args?.url === 'string' ? shortUrl(args.url) : '';

  if (meta) {
    // The gateway already computes a nice human-readable meta for many tools
    return meta;
  }

  if (n === 'read' || n === 'fileread') return path ? `Reading ${path}` : 'Reading file';
  if (n === 'write' || n === 'filewrite') return path ? `Writing ${path}` : 'Writing file';
  if (n === 'exec' || n === 'bash' || n === 'shell') return command ? `Running ${command}` : 'Running command';
  if (n === 'websearch' || n === 'search') return query ? `Searching: "${query}"` : 'Searching';
  if (n === 'webfetch' || n === 'fetch') return url ? `Fetching ${url}` : 'Fetching URL';
  if (n === 'memorysearch') return query ? `Searching memory: "${query}"` : 'Searching memory';
  if (n === 'memoryget') return 'Recalling memory';
  if (n === 'sessionsspawn') return 'Spawning sub-agent';
  if (n === 'sessionssend') return 'Messaging session';
  if (n === 'sessionstatus') return 'Checking status';
  return name;
}

function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}

function shortCommand(cmd: string): string {
  const first = cmd.split('\n')[0].trim();
  return first.length > 40 ? first.slice(0, 37) + '…' : first;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 20) : '');
  } catch { return url.slice(0, 30); }
}

// ---------------------------------------------------------------------------
// Icon renderer
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText, Pencil, Terminal, Search, Globe, Brain, GitBranch,
  Eye, Sparkles, CheckCircle2, XCircle, Clock, Loader2,
};

function ActionIcon({ iconKey, className }: { iconKey: string; className?: string }) {
  const Icon = ICON_MAP[iconKey] || Sparkles;
  return <Icon className={className} />;
}

// ---------------------------------------------------------------------------
// SubAgentsPanel
// ---------------------------------------------------------------------------

interface SubAgentsPanelProps {
  className?: string;
}

export function SubAgentsPanel({ className }: SubAgentsPanelProps) {
  const [agents, setAgents] = useState<Map<string, SubAgent>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showIdle, setShowIdle] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, setTick] = useState(0);

  // Force re-render every 5s to update elapsed times
  useEffect(() => {
    tickRef.current = setInterval(() => setTick(t => t + 1), 5000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  // ---------------------------------------------------------------------------
  // Gateway event handler — with throttled state updates
  // ---------------------------------------------------------------------------
  const pendingUpdates = useRef<Map<string, Partial<SubAgent>>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persistent tool history — survives flush cycles
  const toolHistoryRef = useRef<Map<string, ToolHistoryEntry[]>>(new Map());

  // Flush buffered updates to React state (max ~3x/sec)
  const flushUpdates = useCallback(() => {
    flushTimer.current = null;
    const pending = pendingUpdates.current;
    if (pending.size === 0) return;
    const snapshot = new Map(pending);
    pending.clear();

    setAgents(prev => {
      const next = new Map(prev);
      for (const [key, patch] of snapshot) {
        const existing = next.get(key) || {
          sessionKey: key,
          status: 'idle' as const,
          toolHistory: [],
        };
        // Always read tool history from the persistent ref
        const history = toolHistoryRef.current.get(key) || existing.toolHistory || [];
        next.set(key, { ...existing, ...patch, toolHistory: history });
      }
      return next;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!flushTimer.current) {
      flushTimer.current = setTimeout(flushUpdates, 300);
    }
  }, [flushUpdates]);

  const handleEvent = useCallback((event: GatewayEvent) => {
    if (!isAgentEvent(event)) return;

    const evt = event.data;
    const runId = evt.runId as string;
    const sessionKey = (evt.sessionKey as string) || runId;
    const stream = evt.stream as string;
    const data = (evt.data || {}) as Record<string, unknown>;
    const phase = data.phase as string | undefined;

    // Build patch from existing pending state or current agent state
    const existingPatch = pendingUpdates.current.get(sessionKey);

    // We'll merge into this patch object
    const patch: Partial<SubAgent> = { ...(existingPatch || {}), lastActivityMs: Date.now() };

    if (stream === 'lifecycle') {
      if (phase === 'start') {
        patch.status = 'running';
        patch.runId = runId;
        patch.startedAt = Date.now();
        patch.completedAt = undefined;
        patch.streamingText = undefined;
        patch.currentAction = 'Starting…';
        patch.currentActionIcon = 'Sparkles';
        // Reset persistent tool history for this session
        toolHistoryRef.current.set(sessionKey, []);
        patch.result = undefined;

        // Lifecycle events should flush immediately
        pendingUpdates.current.set(sessionKey, patch);
        if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
        flushUpdates();

        // Auto-expand on start
        setExpanded(prev => new Set([...prev, sessionKey]));
        return;
      } else if (phase === 'end') {
        patch.status = 'completed';
        patch.completedAt = Date.now();
        patch.currentAction = undefined;
        patch.currentActionIcon = undefined;
        // Keep streamingText so chain-of-thought remains visible after completion

        // Lifecycle events flush immediately
        pendingUpdates.current.set(sessionKey, patch);
        if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
        flushUpdates();
        return;
      } else if (phase === 'error') {
        patch.status = 'failed';
        patch.completedAt = Date.now();
        patch.currentAction = undefined;
        patch.currentActionIcon = undefined;

        pendingUpdates.current.set(sessionKey, patch);
        if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
        flushUpdates();
        return;
      }
    } else if (stream === 'tool') {
      // Tool events: always record in history and update current action
      const toolName = (data.name as string) || '';
      const args = (data.args as Record<string, unknown>) || {};
      const meta = typeof data.meta === 'string' ? data.meta : undefined;
      const isError = Boolean(data.isError);
      const label = toolToLabel(toolName, args, meta);

      if (phase === 'start' || !phase) {
        patch.currentAction = label;
        patch.currentActionIcon = toolToIcon(toolName);
        patch.streamingText = undefined;
      }

      if (phase === 'result' || phase === 'end' || !phase) {
        // Push to persistent history ref (survives flush cycles)
        const history = toolHistoryRef.current.get(sessionKey) || [];
        history.push({ label, iconKey: toolToIcon(toolName), ts: Date.now(), isError });
        if (history.length > 30) history.shift();
        toolHistoryRef.current.set(sessionKey, history);

        // If there's a phase, show "Thinking…" between tools
        if (phase) {
          patch.currentAction = 'Thinking…';
          patch.currentActionIcon = 'Sparkles';
        }
      }

      pendingUpdates.current.set(sessionKey, patch);
      scheduleFlush();
      return;
    } else if (stream === 'assistant') {
      const text = data.text as string | undefined;
      if (text) {
        patch.streamingText = text;
        // Show snippet of thinking text
        const firstLine = text.split('\n').pop()?.trim() || text.trim();
        patch.currentAction = firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;
      }

      pendingUpdates.current.set(sessionKey, patch);
      scheduleFlush();
      return;
    }

    // Fallback: buffer and schedule
    pendingUpdates.current.set(sessionKey, patch);
    scheduleFlush();
  }, [flushUpdates, scheduleFlush]);

  // Connect to gateway stream
  const { connected, connecting, error } = useGatewayStream({
    onEvent: handleEvent,
    autoConnect: true,
  });

  // Poll sessions API as fallback
  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch('/api/sessions');
        if (!res.ok) return;
        const data = await res.json();
        setAgents(prev => {
          const next = new Map(prev);
          for (const session of data.sessions || []) {
            if (!next.has(session.sessionKey)) {
              next.set(session.sessionKey, {
                sessionKey: session.sessionKey,
                label: session.label,
                status: session.status === 'active' ? 'running' : 'idle',
                agentName: session.agentName,
                kind: session.kind,
                model: session.model,
                lastActivityMs: session.lastActivityMs,
                toolHistory: [],
              });
            } else {
              // Enrich existing entries with API metadata
              const existing = next.get(session.sessionKey)!;
              if (!existing.agentName) existing.agentName = session.agentName;
              if (!existing.kind) existing.kind = session.kind;
              if (!existing.model) existing.model = session.model;
              if (!existing.label) existing.label = session.label;
              if (!existing.lastActivityMs) existing.lastActivityMs = session.lastActivityMs;
            }
          }
          return next;
        });
      } catch (e) {
        console.error('Failed to fetch sessions:', e);
      }
    }
    fetchSessions();
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function formatDuration(startMs: number, endMs?: number): string {
    const durationMs = (endMs || Date.now()) - startMs;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatRelative(ms: number): string {
    const ago = Date.now() - ms;
    if (ago < 60_000) return 'just now';
    if (ago < 3600_000) return `${Math.floor(ago / 60_000)}m ago`;
    return `${Math.floor(ago / 3600_000)}h ago`;
  }

  // ---------------------------------------------------------------------------
  // Filtering & sorting
  // ---------------------------------------------------------------------------

  const allAgents = Array.from(agents.values());
  const IDLE_THRESHOLD = 5 * 60 * 1000;

  const runningAgents = allAgents
    .filter(a => a.status === 'running')
    .sort((a, b) => (b.lastActivityMs || 0) - (a.lastActivityMs || 0));

  const recentCompleted = allAgents
    .filter(a => (a.status === 'completed' || a.status === 'failed') &&
      a.completedAt && (Date.now() - a.completedAt < IDLE_THRESHOLD))
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  const idleAgents = allAgents
    .filter(a => {
      if (a.status === 'running') return false;
      if (a.status === 'completed' || a.status === 'failed') {
        return a.completedAt ? (Date.now() - a.completedAt >= IDLE_THRESHOLD) : true;
      }
      return true; // idle status
    })
    .sort((a, b) => (b.lastActivityMs || 0) - (a.lastActivityMs || 0));

  // ---------------------------------------------------------------------------
  // Row component
  // ---------------------------------------------------------------------------

  function AgentRow({ agent }: { agent: SubAgent }) {
    const isExpanded = expanded.has(agent.sessionKey);
    const isRunning = agent.status === 'running';
    const detailRef = useRef<HTMLDivElement>(null);

    // Auto-scroll streaming text
    useEffect(() => {
      if (isExpanded && detailRef.current) {
        const el = detailRef.current.querySelector('[data-stream]');
        if (el) el.scrollTop = el.scrollHeight;
      }
    }, [isExpanded, agent.streamingText]);

    // Pick the right icon for current state
    let iconKey = 'Clock';
    let iconColor = 'text-muted-foreground';
    if (isRunning) {
      iconKey = agent.currentActionIcon || 'Sparkles';
      iconColor = 'text-primary';
    } else if (agent.status === 'completed') {
      iconKey = 'CheckCircle2';
      iconColor = 'text-green-400';
    } else if (agent.status === 'failed') {
      iconKey = 'XCircle';
      iconColor = 'text-red-400';
    }

    // Build the one-liner action summary
    let actionSummary = '';
    if (isRunning) {
      actionSummary = agent.currentAction || 'Working…';
    } else if (agent.status === 'completed') {
      const toolCount = agent.toolHistory?.length || 0;
      const dur = agent.startedAt ? formatDuration(agent.startedAt, agent.completedAt) : '';
      actionSummary = `Done${toolCount ? ` · ${toolCount} tools` : ''}${dur ? ` · ${dur}` : ''}`;
    } else if (agent.status === 'failed') {
      actionSummary = 'Failed';
    } else {
      actionSummary = agent.lastActivityMs ? formatRelative(agent.lastActivityMs) : 'Idle';
    }

    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleExpand(agent.sessionKey)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left',
            isRunning && 'bg-primary/5'
          )}
        >
          {/* Action icon */}
          <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
            {isRunning && iconKey === 'Sparkles' ? (
              <Loader2 className={cn('w-4 h-4 animate-spin', iconColor)} />
            ) : (
              <ActionIcon iconKey={iconKey} className={cn('w-4 h-4', iconColor)} />
            )}
          </div>

          {/* Label + action summary — auto-truncates */}
          <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
            <span className="font-medium text-sm truncate flex-shrink-0 max-w-[40%]">
              {agent.label || agent.agentName || extractLabel(agent.sessionKey)}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {actionSummary}
            </span>
          </div>

          {/* Elapsed time */}
          {isRunning && agent.startedAt && (
            <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
              {formatDuration(agent.startedAt)}
            </span>
          )}

          {/* Chevron */}
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
        </button>

        {/* Expanded details */}
        {isExpanded && (
          <div ref={detailRef} className="px-3 pb-3 pt-1 border-t border-border bg-muted/30 space-y-2">
            {/* Streaming text / chain of thought */}
            {agent.streamingText && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  {isRunning ? '💭 Chain of Thought' : '💭 Last Thoughts'}
                </div>
                <div
                  data-stream
                  className="text-xs text-muted-foreground italic bg-muted/50 rounded p-2 max-h-28 overflow-y-auto leading-relaxed"
                >
                  {agent.streamingText.length > 500
                    ? '…' + agent.streamingText.slice(-500)
                    : agent.streamingText}
                </div>
              </div>
            )}

            {/* Tool timeline */}
            {agent.toolHistory && agent.toolHistory.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  🔧 Activity ({agent.toolHistory.length})
                </div>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {agent.toolHistory.slice(-15).map((t, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                        {formatTime(t.ts)}
                      </span>
                      <ActionIcon
                        iconKey={t.iconKey}
                        className={cn('w-3 h-3 flex-shrink-0',
                          t.isError ? 'text-red-400' : 'text-muted-foreground')}
                      />
                      <span className={cn(
                        'truncate',
                        t.isError ? 'text-red-400' : 'text-foreground/80'
                      )}>
                        {t.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Result */}
            {agent.status === 'completed' && agent.result && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  ✅ Result
                </div>
                <div className="text-xs bg-green-500/10 text-green-400 rounded p-2 max-h-28 overflow-y-auto">
                  {agent.result}
                </div>
              </div>
            )}

            {/* Failed */}
            {agent.status === 'failed' && (
              <div className="text-xs text-red-400">❌ Agent failed</div>
            )}

            {/* Metadata */}
            <div className="text-[10px] text-muted-foreground flex items-center gap-2 pt-1 border-t border-border/50">
              {agent.agentName && <span>{agent.agentName}</span>}
              {agent.model && (
                <span className="bg-muted px-1 py-0.5 rounded">{agent.model}</span>
              )}
              {agent.kind && <span className="capitalize">{agent.kind}</span>}
              {agent.startedAt && agent.completedAt && (
                <span>Duration: {formatDuration(agent.startedAt, agent.completedAt)}</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={cn('glass-card overflow-hidden', className)}>
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Bot className="w-5 h-5 text-primary" />
        <h2 className="font-semibold">Sub-Agents</h2>

        {/* Connection status */}
        <div className="flex items-center gap-1 ml-auto" title={connected ? 'Live updates' : error || 'Disconnected'}>
          {connected ? (
            <Zap className="w-3 h-3 text-green-400" />
          ) : connecting ? (
            <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
          ) : (
            <span className="w-2 h-2 led led-gray" />
          )}
        </div>

        {runningAgents.length > 0 && (
          <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full animate-pulse">
            {runningAgents.length} running
          </span>
        )}
        {recentCompleted.length > 0 && (
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
            {recentCompleted.length} done
          </span>
        )}
      </div>

      <div className="p-2 space-y-1.5 max-h-[400px] overflow-y-auto">
        {runningAgents.length === 0 && recentCompleted.length === 0 && idleAgents.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            No sub-agents active
            {!connected && <div className="text-xs mt-1">(Connecting to gateway…)</div>}
          </div>
        ) : (
          <>
            {/* Running agents */}
            {runningAgents.map(agent => (
              <AgentRow key={agent.sessionKey} agent={agent} />
            ))}

            {/* Recently completed */}
            {recentCompleted.length > 0 && runningAgents.length > 0 && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
                Recent
              </div>
            )}
            {recentCompleted.map(agent => (
              <AgentRow key={agent.sessionKey} agent={agent} />
            ))}

            {/* Idle toggle */}
            {idleAgents.length > 0 && (
              <button
                onClick={() => setShowIdle(!showIdle)}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 flex items-center justify-center gap-1 transition-colors"
              >
                {showIdle ? (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    Hide {idleAgents.length} idle
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-3 h-3" />
                    Show {idleAgents.length} idle
                  </>
                )}
              </button>
            )}
            {showIdle && idleAgents.map(agent => (
              <AgentRow key={agent.sessionKey} agent={agent} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// Extract a short label from a session key like "agent:rocket:subagent:abc-123"
function extractLabel(key: string): string {
  const parts = key.split(':');
  // Try to find the most meaningful part
  if (parts.includes('subagent')) return 'Sub-Agent';
  if (parts.includes('cron')) return 'Cron Job';
  if (parts.includes('discord')) return 'Discord';
  if (parts.includes('slack')) return 'Slack';
  if (parts.includes('main')) return 'Main Session';
  return parts.slice(0, 2).join(':');
}
