// Gateway WebSocket client for Mission Control
// Connects to OpenClaw gateway and subscribes to real-time events

export interface GatewayConfig {
  url: string;
  token: string;
}

export interface GatewayMessage {
  type: 'req' | 'res' | 'event';
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
  event?: string;
  seq?: number;
}

export interface AgentEvent {
  runId: string;
  sessionKey: string;
  status: 'running' | 'completed' | 'failed';
  label?: string;
  task?: string;
  progress?: string;
  thinking?: string;
  toolCall?: { name: string; args: unknown };
  result?: unknown;
  error?: string;
}

export interface SessionInfo {
  sessionKey: string;
  label?: string;
  status: 'active' | 'idle' | 'completed';
  lastActivityMs: number;
  model?: string;
  kind?: string;
}

type EventHandler<T> = (data: T) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private messageId = 0;
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Set<EventHandler<unknown>>>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private connected = false;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);
        
        this.ws.onopen = () => {
          console.log('[Gateway] Connected, sending handshake...');
          this.sendHandshake();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg: GatewayMessage = JSON.parse(event.data as string);
            this.handleMessage(msg, resolve, reject);
          } catch (e) {
            console.error('[Gateway] Failed to parse message:', e);
          }
        };

        this.ws.onclose = () => {
          console.log('[Gateway] Disconnected');
          this.connected = false;
          this.emit('disconnect', {});
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[Gateway] WebSocket error:', error);
          reject(new Error('WebSocket connection failed'));
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  private sendHandshake() {
    this.send({
      type: 'req',
      id: this.nextId(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        auth: {
          mode: 'token',
          token: this.config.token,
        },
        client: {
          id: 'mission-control',
          displayName: 'Mission Control',
          version: '1.0.0',
          platform: 'web',
          mode: 'ui',
        },
      },
    });
  }

  private handleMessage(
    msg: GatewayMessage,
    connectResolve?: () => void,
    connectReject?: (e: Error) => void
  ) {
    if (msg.type === 'res') {
      // Handle connect response
      if (msg.id === 'c1' || (msg.payload as { type?: string })?.type === 'hello-ok') {
        if (msg.ok) {
          console.log('[Gateway] Handshake successful');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connect', msg.payload);
          connectResolve?.();
        } else {
          console.error('[Gateway] Handshake failed:', msg.error);
          connectReject?.(new Error(msg.error?.message || 'Handshake failed'));
        }
        return;
      }

      // Handle other responses
      const pending = this.pendingRequests.get(msg.id!);
      if (pending) {
        this.pendingRequests.delete(msg.id!);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error(msg.error?.message || 'Request failed'));
        }
      }
    } else if (msg.type === 'event') {
      this.emit(msg.event!, msg.payload);
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Gateway] Max reconnect attempts reached');
      this.emit('reconnect-failed', {});
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  }

  private nextId(): string {
    return `m${++this.messageId}`;
  }

  private send(msg: GatewayMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId();
      this.pendingRequests.set(id, { 
        resolve: resolve as (v: unknown) => void, 
        reject 
      });
      
      this.send({
        type: 'req',
        id,
        method,
        params,
      });

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
    });
  }

  on<T = unknown>(event: string, handler: EventHandler<T>) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<T = unknown>(event: string, handler: EventHandler<T>) {
    this.eventHandlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit(event: string, data: unknown) {
    this.eventHandlers.get(event)?.forEach(handler => handler(data));
    this.eventHandlers.get('*')?.forEach(handler => handler({ event, data }));
  }

  async listSessions(): Promise<SessionInfo[]> {
    const result = await this.call<{ sessions: SessionInfo[] }>('sessions.list');
    return result.sessions || [];
  }

  async getHealth(): Promise<{ ok: boolean }> {
    return this.call('health');
  }

  async getStatus(): Promise<unknown> {
    return this.call('status');
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// Singleton instance
let gatewayClient: GatewayClient | null = null;

export function getGatewayClient(config?: GatewayConfig): GatewayClient {
  if (!gatewayClient && config) {
    gatewayClient = new GatewayClient(config);
  }
  if (!gatewayClient) {
    throw new Error('Gateway client not initialized');
  }
  return gatewayClient;
}
