'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface GatewayHealthState {
  online: boolean;
  status: 'running' | 'failed' | 'stopped' | 'restarting' | 'unknown';
  restartCount: number;
  uptime: string | null;
  logs: string[];
  lastChecked: number | null;
  nextCheckIn: number;
  loading: boolean;
  actionInProgress: string | null;
}

const POLL_INTERVAL_MS = 30_000;

export function useGatewayHealth() {
  const [state, setState] = useState<GatewayHealthState>({
    online: true, // optimistic
    status: 'unknown',
    restartCount: 0,
    uptime: null,
    logs: [],
    lastChecked: null,
    nextCheckIn: POLL_INTERVAL_MS / 1000,
    loading: true,
    actionInProgress: null,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway-status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState((s) => ({
        ...s,
        online: data.online,
        status: data.status,
        restartCount: data.restartCount,
        uptime: data.uptime,
        logs: data.logs,
        lastChecked: Date.now(),
        nextCheckIn: POLL_INTERVAL_MS / 1000,
        loading: false,
      }));
    } catch {
      setState((s) => ({
        ...s,
        online: false,
        status: 'unknown',
        lastChecked: Date.now(),
        nextCheckIn: POLL_INTERVAL_MS / 1000,
        loading: false,
      }));
    }
  }, []);

  const controlGateway = useCallback(
    async (action: 'start' | 'stop' | 'restart') => {
      setState((s) => ({ ...s, actionInProgress: action }));
      try {
        const res = await fetch('/api/gateway-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (!data.ok) {
          console.error('[Gateway Control]', data.message);
        }
        // Wait a moment for systemd to act, then re-check
        await new Promise((r) => setTimeout(r, 2000));
        await checkHealth();
      } catch (e) {
        console.error('[Gateway Control] Failed:', e);
      } finally {
        setState((s) => ({ ...s, actionInProgress: null }));
      }
    },
    [checkHealth]
  );

  // Initial check + polling
  useEffect(() => {
    checkHealth();
    timerRef.current = setInterval(checkHealth, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkHealth]);

  // Countdown ticker
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setState((s) => ({
        ...s,
        nextCheckIn: Math.max(0, s.nextCheckIn - 1),
      }));
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  return { ...state, checkHealth, controlGateway };
}
