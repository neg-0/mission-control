'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface GatewayEvent {
  type: string;
  data: unknown;
  ts: number;
}

export interface UseGatewayStreamOptions {
  onEvent?: (event: GatewayEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  autoConnect?: boolean;
}

export interface GatewayStreamState {
  connected: boolean;
  connecting: boolean;
  lastEvent: GatewayEvent | null;
  error: string | null;
}

export function useGatewayStream(options: UseGatewayStreamOptions = {}) {
  const { autoConnect = true } = options;

  const [state, setState] = useState<GatewayStreamState>({
    connected: false,
    connecting: false,
    lastEvent: null,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Use refs for callbacks to keep the connect function stable across renders
  const onEventRef = useRef(options.onEvent);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);

  useEffect(() => { onEventRef.current = options.onEvent; }, [options.onEvent]);
  useEffect(() => { onConnectRef.current = options.onConnect; }, [options.onConnect]);
  useEffect(() => { onDisconnectRef.current = options.onDisconnect; }, [options.onDisconnect]);
  useEffect(() => { onErrorRef.current = options.onError; }, [options.onError]);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setState(s => ({ ...s, connecting: true, error: null }));

    const eventSource = new EventSource('/api/stream');
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const parsed: GatewayEvent = JSON.parse(event.data);

        setState(s => ({ ...s, lastEvent: parsed }));
        onEventRef.current?.(parsed);

        // Handle specific event types
        if (parsed.type === 'connected') {
          setState(s => ({ ...s, connected: true, connecting: false }));
          onConnectRef.current?.();
        } else if (parsed.type === 'disconnected') {
          setState(s => ({ ...s, connected: false }));
          onDisconnectRef.current?.();
        } else if (parsed.type === 'error') {
          const errorMsg = (parsed.data as { message?: string })?.message || 'Unknown error';
          setState(s => ({ ...s, error: errorMsg }));
          onErrorRef.current?.(errorMsg);
        }
      } catch (e) {
        console.error('[useGatewayStream] Failed to parse event:', e);
      }
    };

    eventSource.onerror = () => {
      // Avoid infinite error loop if closed
      if (eventSource.readyState === EventSource.CLOSED) return;

      eventSource.close();
      setState(s => ({ ...s, connected: false, connecting: false, error: 'Connection lost' }));
      onDisconnectRef.current?.();

      // Attempt reconnect after 5 seconds
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        if (autoConnect) {
          connect();
        }
      }, 5000);
    };
  }, [autoConnect]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState(s => ({ ...s, connected: false, connecting: false }));
  }, []);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
  };
}

// Event type helpers — matches actual gateway AgentEventPayload schema
export interface AgentRunEvent {
  runId: string;
  sessionKey?: string;
  seq: number;
  stream: 'lifecycle' | 'tool' | 'assistant' | 'compaction' | 'error' | (string & {});
  ts: number;
  data: Record<string, unknown>;
}

export interface TickEvent {
  ts: number;
}

export interface PresenceEvent {
  clients: Array<{
    id: string;
    displayName: string;
    mode: string;
  }>;
}

export function isAgentEvent(event: GatewayEvent): event is GatewayEvent & { data: AgentRunEvent } {
  return event.type === 'agent';
}

export function isTickEvent(event: GatewayEvent): event is GatewayEvent & { data: TickEvent } {
  return event.type === 'tick';
}

export function isPresenceEvent(event: GatewayEvent): event is GatewayEvent & { data: PresenceEvent } {
  return event.type === 'presence';
}
