'use client';

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Square,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useState } from 'react';
import type { GatewayHealthState } from '../hooks/useGatewayHealth';

interface Props extends GatewayHealthState {
  checkHealth: () => Promise<void>;
  controlGateway: (action: 'start' | 'stop' | 'restart') => Promise<void>;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  running: { label: 'Running', color: 'text-emerald-400', bg: 'bg-emerald-500/20', icon: Wifi },
  failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/20', icon: AlertTriangle },
  stopped: { label: 'Stopped', color: 'text-zinc-400', bg: 'bg-zinc-500/20', icon: Power },
  restarting: { label: 'Restarting...', color: 'text-amber-400', bg: 'bg-amber-500/20', icon: Loader2 },
  unknown: { label: 'Unknown', color: 'text-zinc-500', bg: 'bg-zinc-500/20', icon: WifiOff },
};

export default function GatewayOfflineBanner({
  online,
  status,
  restartCount,
  uptime,
  logs,
  nextCheckIn,
  actionInProgress,
  checkHealth,
  controlGateway,
}: Props) {
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Don't show if online and running
  if (online && status === 'running') return null;

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  const StatusIcon = cfg.icon;

  return (
    <div className="mx-4 mt-4 rounded-xl border border-zinc-700/60 bg-zinc-900/80 backdrop-blur-md overflow-hidden shadow-lg shadow-black/20">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${cfg.bg}`}>
            <StatusIcon
              size={20}
              className={`${cfg.color} ${status === 'restarting' ? 'animate-spin' : ''}`}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Gateway {cfg.label}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {restartCount > 0 && (
                <span className="text-amber-500 mr-2">{restartCount} restarts</span>
              )}
              {uptime && <span>Uptime: {uptime} · </span>}
              Checking in {nextCheckIn}s
            </p>
          </div>
        </div>

        {/* Control buttons */}
        <div className="flex items-center gap-2">
          {(status === 'stopped' || status === 'failed') && (
            <button
              onClick={() => controlGateway('start')}
              disabled={!!actionInProgress}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 text-xs font-medium hover:bg-emerald-600/30 transition-colors disabled:opacity-50"
            >
              {actionInProgress === 'start' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Play size={13} />
              )}
              Start
            </button>
          )}
          {status === 'running' && (
            <button
              onClick={() => controlGateway('stop')}
              disabled={!!actionInProgress}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700/40 text-zinc-300 text-xs font-medium hover:bg-zinc-700/60 transition-colors disabled:opacity-50"
            >
              {actionInProgress === 'stop' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Square size={13} />
              )}
              Stop
            </button>
          )}
          <button
            onClick={() => controlGateway('restart')}
            disabled={!!actionInProgress}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 text-amber-400 text-xs font-medium hover:bg-amber-600/30 transition-colors disabled:opacity-50"
          >
            {actionInProgress === 'restart' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Restart
          </button>
          <button
            onClick={checkHealth}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="Check now"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Log viewer toggle */}
      <button
        onClick={() => setLogsExpanded(!logsExpanded)}
        className="w-full flex items-center gap-2 px-5 py-2.5 border-t border-zinc-800 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors"
      >
        <Terminal size={13} />
        <span>Gateway Logs ({logs.length} lines)</span>
        <span className="ml-auto">
          {logsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {/* Log content */}
      {logsExpanded && (
        <div className="border-t border-zinc-800 bg-black/40 px-4 py-3 max-h-72 overflow-y-auto">
          <pre className="text-[11px] leading-relaxed font-mono text-zinc-400 whitespace-pre-wrap break-all">
            {logs.length > 0
              ? logs.join('\n')
              : 'No logs available'}
          </pre>
        </div>
      )}
    </div>
  );
}
