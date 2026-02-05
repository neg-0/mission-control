import { NextRequest } from 'next/server';
import WebSocket from 'ws';

// Gateway connection configuration
// Support both http(s):// and ws(s):// URLs
const rawGatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_URL = rawGatewayUrl
  .replace(/^https:\/\//, 'wss://')
  .replace(/^http:\/\//, 'ws://');
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

interface GatewayMessage {
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

// Server-Sent Events endpoint that bridges Gateway WebSocket events to the browser
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      let ws: WebSocket | null = null;
      let messageId = 0;
      let connected = false;
      let closed = false; // Prevent double-close crashes
      let pingInterval: ReturnType<typeof setInterval> | null = null;

      function sendEvent(eventType: string, data: unknown) {
        const payload = JSON.stringify({ type: eventType, data, ts: Date.now() });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }

      function connect() {
        try {
          ws = new WebSocket(GATEWAY_URL);

          ws.on('open', () => {
            console.log('[SSE Bridge] Connected to gateway');
            // Send connect handshake
            const connectMsg: GatewayMessage = {
              type: 'req',
              id: `m${++messageId}`,
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                auth: GATEWAY_TOKEN ? { mode: 'token', token: GATEWAY_TOKEN } : undefined,
                client: {
                  id: 'mission-control-sse',
                  displayName: 'Mission Control SSE Bridge',
                  version: '1.0.0',
                  platform: 'node',
                  mode: 'ui',
                },
              },
            };
            ws?.send(JSON.stringify(connectMsg));
          });

          ws.on('message', (rawData: WebSocket.RawData) => {
            try {
              const msg: GatewayMessage = JSON.parse(rawData.toString());
              
              if (msg.type === 'res' && !connected) {
                // Check for successful connect
                const payload = msg.payload as { type?: string } | undefined;
                if (msg.ok && payload?.type === 'hello-ok') {
                  connected = true;
                  sendEvent('connected', { gateway: GATEWAY_URL });
                  
                  // Start ping interval to keep connection alive
                  pingInterval = setInterval(() => {
                    sendEvent('ping', { ts: Date.now() });
                  }, 15000);
                } else if (!msg.ok) {
                  sendEvent('error', { message: 'Gateway connection failed', error: msg.error });
                }
              } else if (msg.type === 'event') {
                // Forward all gateway events to the browser
                sendEvent(msg.event || 'unknown', msg.payload);
              }
            } catch (e) {
              console.error('[SSE Bridge] Failed to parse message:', e);
            }
          });

          ws.on('close', () => {
            console.log('[SSE Bridge] Disconnected from gateway');
            connected = false;
            
            // Don't reconnect or send events if already closed
            if (closed || request.signal.aborted) {
              return;
            }
            
            sendEvent('disconnected', {});
            
            // Attempt reconnect after 5 seconds
            setTimeout(() => {
              if (!closed && !request.signal.aborted) {
                connect();
              }
            }, 5000);
          });

          ws.on('error', (err: Error) => {
            console.error('[SSE Bridge] WebSocket error:', err.message);
            if (!closed) {
              sendEvent('error', { message: err.message });
            }
          });
        } catch (e) {
          console.error('[SSE Bridge] Failed to connect:', e);
          if (!closed) {
            sendEvent('error', { message: 'Failed to connect to gateway' });
          }
        }
      }

      // Start connection
      connect();

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        console.log('[SSE Bridge] Client disconnected');
        closed = true;
        if (pingInterval) clearInterval(pingInterval);
        
        // Only close if WebSocket is open
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        ws = null;
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Force dynamic rendering
export const dynamic = 'force-dynamic';
