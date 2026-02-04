'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

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
  const { onEvent, onConnect, onDisconnect, onError, autoConnect = true } = options;
  
  const [state, setState] = useState<GatewayStreamState>({
    connected: false,
    connecting: false,
    lastEvent: null,
    error: null,
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
        onEvent?.(parsed);

        // Handle specific event types
        if (parsed.type === 'connected') {
          setState(s => ({ ...s, connected: true, connecting: false }));
          onConnect?.();
        } else if (parsed.type === 'disconnected') {
          setState(s => ({ ...s, connected: false }));
          onDisconnect?.();
        } else if (parsed.type === 'error') {
          const errorMsg = (parsed.data as { message?: string })?.message || 'Unknown error';
          setState(s => ({ ...s, error: errorMsg }));
          onError?.(errorMsg);
        }
      } catch (e) {
        console.error('[useGatewayStream] Failed to parse event:', e);
      }
    };

    eventSource.onerror = () => {
      setState(s => ({ ...s, connected: false, connecting: false, error: 'Connection lost' }));
      onDisconnect?.();
      
      // Attempt reconnect after 3 seconds
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        if (autoConnect) {
          connect();
        }
      }, 3000);
    };
  }, [onEvent, onConnect, onDisconnect, onError, autoConnect]);

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

// Event type helpers
export interface AgentRunEvent {
  runId: string;
  sessionKey: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  label?: string;
  task?: string;
  thinking?: string;
  toolCall?: { name: string; args: unknown };
  result?: unknown;
  error?: string;
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
