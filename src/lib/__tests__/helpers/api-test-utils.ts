/**
 * Utilities for testing Next.js App Router API route handlers.
 *
 * Route handlers export named functions (GET, POST, PATCH, DELETE).
 * These utilities build NextRequest objects and parse NextResponse bodies
 * so tests can call handlers directly without spinning up a server.
 *
 * Usage:
 *   import { GET, POST } from '@/app/api/escalations/route';
 *   import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
 *
 *   const req = createTestRequest('/api/escalations', { method: 'POST', body: { ... } });
 *   const res = await POST(req);
 *   const { status, data } = await parseResponse(res);
 */
import { NextRequest } from 'next/server';

/**
 * Build a NextRequest for testing a route handler.
 *
 * @param path - URL path (e.g., '/api/escalations?status=open')
 * @param options - HTTP method, body, and headers
 */
export function createTestRequest(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }
): NextRequest {
  const { method = 'GET', body, headers = {} } = options ?? {};

  const url = new URL(path, 'http://localhost:3000');

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, init as any);
}

/**
 * Parse a NextResponse (or standard Response) to extract status and JSON body.
 */
export async function parseResponse<T = unknown>(
  response: Response
): Promise<{ status: number; data: T }> {
  const data = (await response.json()) as T;
  return { status: response.status, data };
}
