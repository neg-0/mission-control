/**
 * GET /api/trial/preflight
 *
 * Run all preflight checks for the 48h autonomous trial.
 * Returns 200 if ready, 503 if not.
 */

import { runPreflight } from '@/lib/trial-preflight';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await runPreflight();
    return NextResponse.json(result, {
      status: result.ready ? 200 : 503,
    });
  } catch (e) {
    console.error('[Preflight]', e);
    return NextResponse.json(
      { ready: false, error: String(e) },
      { status: 500 },
    );
  }
}
