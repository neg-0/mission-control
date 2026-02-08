import { NextRequest } from 'next/server';
import WebSocket from 'ws';

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';

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
      let connectSent = false;
      let closed = false; // Prevent double-close crashes
      let pingInterval: ReturnType<typeof setInterval> | null = null;

      function sendEvent(eventType: string, data: unknown) {
        if (closed || controller.desiredSize === null) return;
        try {
          const payload = JSON.stringify({ type: eventType, data, ts: Date.now() });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch (e) {
          // Controller might be closed
          closed = true;
        }
      }

      async function readMessageText(data: unknown) {
        if (typeof data === 'string') return data;
        if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
        if (ArrayBuffer.isView(data)) {
          return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString();
        }
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
          return await data.text();
        }
        if (data && typeof (data as { text?: () => Promise<string> }).text === 'function') {
          return await (data as { text: () => Promise<string> }).text();
        }
        return String(data ?? '');
      }

      // Send the connect handshake after receiving a challenge nonce
      function sendConnect() {
        if (connectSent) return;
        connectSent = true;

        const connectMsg: GatewayMessage = {
          type: 'req',
          id: `m${++messageId}`,
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            auth: GATEWAY_TOKEN ? { token: GATEWAY_TOKEN } : undefined,
            client: {
              id: 'gateway-client',
              displayName: 'Mission Control',
              version: '1.0.0',
              platform: process.platform,
              mode: 'backend',
            },
            role: 'operator',
            scopes: ['operator.admin'],
          },
        };
        console.log('[SSE Bridge] Sending connect handshake');
        ws?.send(JSON.stringify(connectMsg));
      }

      function connect() {
        connectSent = false;
        try {
          ws = new WebSocket(GATEWAY_URL, {
            headers: {
              Origin: 'http://127.0.0.1:18789'
            }
          });

          ws.addEventListener('open', () => {
            console.log('[SSE Bridge] WebSocket open, waiting for challenge...');
            // Don't send connect yet — wait for the connect.challenge event
          });

          ws.addEventListener('message', (event) => {
            void (async () => {
              try {
                const text = await readMessageText(event.data);
                const msg: GatewayMessage = JSON.parse(text);

                // Handle connect.challenge: extract nonce and send connect request
                if (msg.type === 'event' && msg.event === 'connect.challenge') {
                  console.log('[SSE Bridge] Received challenge, sending connect');
                  sendConnect();
                  return;
                }

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
            })();
          });

          ws.addEventListener('close', () => {
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

          ws.addEventListener('error', (event) => {
            const eventMessage = (event as unknown as { message?: string }).message;
            const message = typeof eventMessage === 'string' ? eventMessage : 'WebSocket error';
            console.error('[SSE Bridge] WebSocket error:', message);
            if (!closed) {
              sendEvent('error', { message });
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
