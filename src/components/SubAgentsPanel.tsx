'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bot, Loader2, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { useGatewayStream, isAgentEvent, GatewayEvent } from '../hooks/useGatewayStream';

interface SubAgent {
  sessionKey: string;
  label?: string;
  task?: string;
  status: 'running' | 'completed' | 'failed' | 'idle';
  startedAt?: number;
  completedAt?: number;
  model?: string;
  thinking?: string;
  currentAction?: string;
  result?: string;
}

interface SubAgentsPanelProps {
  className?: string;
}

export function SubAgentsPanel({ className }: SubAgentsPanelProps) {
  const [agents, setAgents] = useState<Map<string, SubAgent>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Handle incoming gateway events
  const handleEvent = useCallback((event: GatewayEvent) => {
    if (isAgentEvent(event)) {
      const agentData = event.data;
      
      setAgents(prev => {
        const next = new Map(prev);
        const existing = next.get(agentData.sessionKey) || {
          sessionKey: agentData.sessionKey,
          status: 'idle' as const,
        };

        // Update agent based on event
        const updated: SubAgent = {
          ...existing,
          label: agentData.label || existing.label,
          task: agentData.task || existing.task,
          status: agentData.status === 'started' ? 'running' 
                : agentData.status === 'completed' ? 'completed'
                : agentData.status === 'failed' ? 'failed'
                : existing.status,
          thinking: agentData.thinking || existing.thinking,
          currentAction: agentData.toolCall?.name || existing.currentAction,
          result: typeof agentData.result === 'string' ? agentData.result : existing.result,
        };

        if (agentData.status === 'started') {
          updated.startedAt = Date.now();
        }
        if (agentData.status === 'completed' || agentData.status === 'failed') {
          updated.completedAt = Date.now();
        }

        next.set(agentData.sessionKey, updated);
        return next;
      });

      // Auto-expand running agents
      if (agentData.status === 'started') {
        setExpanded(prev => new Set([...prev, agentData.sessionKey]));
      }
    }
  }, []);

  // Connect to gateway stream
  const { connected, connecting, error } = useGatewayStream({
    onEvent: handleEvent,
    autoConnect: true,
  });

  // Also poll sessions API as fallback
  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch('/api/sessions');
        if (res.ok) {
          const data = await res.json();
          // Merge with existing agents (don't overwrite live data)
          setAgents(prev => {
            const next = new Map(prev);
            for (const session of data.sessions || []) {
              if (!next.has(session.sessionKey)) {
                next.set(session.sessionKey, {
                  sessionKey: session.sessionKey,
                  label: session.label,
                  status: session.status === 'active' ? 'running' : 'idle',
                  model: session.model,
                });
              }
            }
            return next;
          });
        }
      } catch (e) {
        console.error('Failed to fetch sessions:', e);
      }
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 30000); // Poll every 30s as backup
    return () => clearInterval(interval);
  }, []);

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function formatDuration(startMs: number, endMs?: number): string {
    const durationMs = (endMs || Date.now()) - startMs;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  const agentsList = Array.from(agents.values());
  const runningAgents = agentsList.filter(a => a.status === 'running');
  const completedAgents = agentsList.filter(a => a.status !== 'running' && a.status !== 'idle');

  function AgentRow({ agent }: { agent: SubAgent }) {
    const isExpanded = expanded.has(agent.sessionKey);
    const isRunning = agent.status === 'running';

    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleExpand(agent.sessionKey)}
          className={cn(
            'w-full flex items-center gap-2 p-3 hover:bg-accent/50 transition-colors text-left',
            isRunning && 'bg-primary/5'
          )}
        >
          {/* Status Icon */}
          {isRunning ? (
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
          ) : agent.status === 'completed' ? (
            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
          ) : agent.status === 'failed' ? (
            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          ) : (
            <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">
                {agent.label || agent.sessionKey}
              </span>
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {agent.model || 'gpt-5.2'}
              </span>
            </div>
            {agent.task && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {agent.task}
              </div>
            )}
          </div>

          {/* Duration */}
          {agent.startedAt && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatDuration(agent.startedAt, agent.completedAt)}
            </span>
          )}

          {/* Expand Chevron */}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
        </button>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="px-3 pb-3 pt-0 border-t border-border bg-muted/30">
            {isRunning && agent.thinking && (
              <div className="mt-2">
                <div className="text-xs text-muted-foreground mb-1">💭 Thinking:</div>
                <div className="text-sm italic text-muted-foreground bg-muted/50 rounded p-2 max-h-24 overflow-y-auto">
                  {agent.thinking}
                </div>
              </div>
            )}

            {isRunning && agent.currentAction && (
              <div className="mt-2 flex items-center gap-2">
                <div className="text-xs text-muted-foreground">🔧 Action:</div>
                <code className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                  {agent.currentAction}
                </code>
              </div>
            )}

            {agent.status === 'completed' && agent.result && (
              <div className="mt-2">
                <div className="text-xs text-muted-foreground mb-1">✅ Result:</div>
                <div className="text-sm bg-green-500/10 text-green-400 rounded p-2 max-h-32 overflow-y-auto">
                  {agent.result}
                </div>
              </div>
            )}

            {agent.status === 'failed' && (
              <div className="mt-2">
                <div className="text-xs text-red-400">❌ Agent failed</div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('bg-card border border-border rounded-lg overflow-hidden', className)}>
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Bot className="w-5 h-5 text-primary" />
        <h2 className="font-semibold">Sub-Agents</h2>
        
        {/* Connection Status */}
        <div className="flex items-center gap-1 ml-auto" title={connected ? 'Live updates' : error || 'Disconnected'}>
          {connected ? (
            <Zap className="w-3 h-3 text-green-400" />
          ) : connecting ? (
            <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-gray-500" />
          )}
        </div>

        {runningAgents.length > 0 && (
          <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full animate-pulse">
            {runningAgents.length} running
          </span>
        )}
        {completedAgents.length > 0 && (
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
            {completedAgents.length} done
          </span>
        )}
      </div>

      <div className="p-2 space-y-2 max-h-[400px] overflow-y-auto">
        {agentsList.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            No sub-agents active
            {!connected && <div className="text-xs mt-1">(Connecting to gateway...)</div>}
          </div>
        ) : (
          <>
            {runningAgents.map(agent => (
              <AgentRow key={agent.sessionKey} agent={agent} />
            ))}
            {completedAgents.length > 0 && runningAgents.length > 0 && (
              <div className="text-xs text-muted-foreground py-2">Recent</div>
            )}
            {completedAgents.slice(0, 5).map(agent => (
              <AgentRow key={agent.sessionKey} agent={agent} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
