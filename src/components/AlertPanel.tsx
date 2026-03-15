'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle, Bell, BellOff, Check, Clock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface CarPlayAlert {
  id: string;
  severity: number;
  type: string;
  title: string;
  detail: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  repeatCount: number;
  promotedFrom: number | null;
  resolved: boolean;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  escalatedAt: string | null;
}

const severityConfig: Record<number, { label: string; color: string; bg: string; border: string }> = {
  0: { label: 'P0', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  1: { label: 'P1', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  2: { label: 'P2', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function AlertPanel() {
  const [alerts, setAlerts] = useState<CarPlayAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/carplay/alerts?resolved=false');
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || data || []);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleAcknowledge = async (alertId: string) => {
    setActionLoading(alertId);
    try {
      const res = await fetch('/api/carplay/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });
      if (!res.ok) throw new Error('Failed to acknowledge');
      setError(null);
      await fetchAlerts();
    } catch {
      setError('Failed to acknowledge alert');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSnooze = async (alertId: string, hours: number) => {
    setActionLoading(alertId);
    try {
      const res = await fetch('/api/alerts/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, hours }),
      });
      if (!res.ok) throw new Error('Failed to snooze');
      setError(null);
      await fetchAlerts();
    } catch {
      setError('Failed to snooze alert');
    } finally {
      setActionLoading(null);
    }
  };

  // Filter out snoozed alerts (they're hidden until snooze expires)
  const visibleAlerts = alerts.filter((a) => {
    if (a.snoozedUntil && new Date(a.snoozedUntil).getTime() > Date.now()) return false;
    return true;
  });

  const p0Count = visibleAlerts.filter((a) => a.severity === 0).length;
  const p1Count = visibleAlerts.filter((a) => a.severity === 1).length;

  if (loading) {
    return (
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="w-4 h-4" />
          Alerts
        </div>
        <div className="text-xs text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="w-4 h-4" />
          Alerts
          {p0Count > 0 && (
            <span className="text-[10px] font-mono bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">
              {p0Count} P0
            </span>
          )}
          {p1Count > 0 && (
            <span className="text-[10px] font-mono bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
              {p1Count} P1
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {visibleAlerts.length} active
        </span>
      </div>

      {error && (
        <div className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
          {error}
        </div>
      )}

      {visibleAlerts.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-emerald-400/80">
          <Check className="w-3 h-3" />
          All clear — no active alerts
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {visibleAlerts.map((alert) => {
            const config = severityConfig[alert.severity] || severityConfig[2];
            const isLoading = actionLoading === alert.id;

            return (
              <div
                key={alert.id}
                className={cn(
                  'p-2.5 rounded-lg border space-y-1.5',
                  config.bg, config.border,
                  isLoading && 'opacity-50',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-[10px] font-mono font-bold', config.color)}>
                        {config.label}
                      </span>
                      {alert.promotedFrom != null && (
                        <span className="text-[9px] text-muted-foreground">
                          ↑ from P{alert.promotedFrom}
                        </span>
                      )}
                      {alert.repeatCount > 1 && (
                        <span className="text-[9px] text-muted-foreground">
                          ×{alert.repeatCount}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-medium mt-0.5 leading-snug">{alert.title}</div>
                    {alert.detail && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                        {alert.detail}
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                    {formatTimeAgo(alert.triggeredAt)}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  {!alert.acknowledgedAt && (
                    <button
                      onClick={() => handleAcknowledge(alert.id)}
                      disabled={isLoading}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Check className="w-3 h-3" />
                      Ack
                    </button>
                  )}
                  {alert.acknowledgedAt && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
                      <Check className="w-3 h-3" />
                      Acked
                    </span>
                  )}
                  <button
                    onClick={() => handleSnooze(alert.id, 1)}
                    disabled={isLoading}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <BellOff className="w-3 h-3" />
                    1h
                  </button>
                  <button
                    onClick={() => handleSnooze(alert.id, 4)}
                    disabled={isLoading}
                    className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    4h
                  </button>
                  <button
                    onClick={() => handleSnooze(alert.id, 24)}
                    disabled={isLoading}
                    className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    24h
                  </button>
                  {alert.escalatedAt && (
                    <span className="flex items-center gap-1 text-[9px] text-orange-400/60 ml-auto">
                      <AlertTriangle className="w-3 h-3" />
                      Escalated
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Top Priority CTA — shows the single highest-leverage action right now (US-101).
 * Displays the most critical alert, or the most impactful pending decision.
 */
export function TopPriorityCTA() {
  const [cta, setCta] = useState<{ type: string; title: string; detail: string; action?: string; actionUrl?: string } | null>(null);

  const fetchCta = useCallback(async () => {
    try {
      // Fetch P0, P1, and escalations in parallel
      const [p0Res, p1Res, escRes] = await Promise.all([
        fetch('/api/carplay/alerts?resolved=false&severity=0'),
        fetch('/api/carplay/alerts?resolved=false&severity=1'),
        fetch('/api/escalations?status=open'),
      ]);

      // Check P0 alerts first
      if (p0Res.ok) {
        const data = await p0Res.json();
        const alerts = data.alerts || data || [];
        if (alerts.length > 0) {
          const top = alerts[0];
          setCta({
            type: `P${top.severity}`,
            title: top.title,
            detail: top.detail || `${top.type} alert — triggered ${formatTimeAgo(top.triggeredAt)}`,
            action: top.acknowledgedAt ? 'Resolve' : 'Acknowledge',
          });
          return;
        }
      }

      // Fall back to P1 alerts
      if (p1Res.ok) {
        const p1Data = await p1Res.json();
        const p1Alerts = p1Data.alerts || p1Data || [];
        if (p1Alerts.length > 0) {
          const top = p1Alerts[0];
          setCta({
            type: `P${top.severity}`,
            title: top.title,
            detail: top.detail || `${top.type} alert — ${top.repeatCount > 1 ? `${top.repeatCount}× ` : ''}triggered ${formatTimeAgo(top.triggeredAt)}`,
            action: 'Review',
          });
          return;
        }
      }

      // Fall back to open escalations
      if (escRes.ok) {
        const escalations = await escRes.json();
        if (escalations.length > 0) {
          const top = escalations[0];
          setCta({
            type: top.severity === 'blocker' ? 'P0' : top.severity === 'critical' ? 'P1' : 'P2',
            title: top.title,
            detail: top.description || `${top.category} escalation from ${top.fromAgentId}`,
            action: 'Review',
          });
          return;
        }
      }

      setCta(null);
    } catch {
      // Silent — CTA is best-effort UI enhancement
    }
  }, []);

  useEffect(() => {
    fetchCta();
    const interval = setInterval(fetchCta, 30000);
    return () => clearInterval(interval);
  }, [fetchCta]);

  if (!cta) return null;

  const isP0 = cta.type === 'P0';

  return (
    <div
      className={cn(
        'rounded-lg border p-3 flex items-center gap-3',
        isP0
          ? 'bg-red-500/10 border-red-500/30'
          : 'bg-yellow-500/10 border-yellow-500/30',
      )}
    >
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
        isP0 ? 'bg-red-500/20' : 'bg-yellow-500/20',
      )}>
        {isP0 ? (
          <AlertTriangle className="w-4 h-4 text-red-400" />
        ) : (
          <Clock className="w-4 h-4 text-yellow-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-[10px] font-mono font-bold',
            isP0 ? 'text-red-400' : 'text-yellow-400',
          )}>
            {cta.type}
          </span>
          <span className="text-xs font-semibold truncate">{cta.title}</span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{cta.detail}</div>
      </div>
      {cta.action && (
        <button className={cn(
          'text-[10px] font-medium px-3 py-1 rounded-md transition-colors',
          isP0
            ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300'
            : 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300',
        )}>
          {cta.action}
        </button>
      )}
    </div>
  );
}
