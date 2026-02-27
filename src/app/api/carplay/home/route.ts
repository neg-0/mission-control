/**
 * GET /api/carplay/home
 *
 * Returns the CarPlay home screen data — tiles + digests.
 * Cached for 30s with background refresh.
 */

import { verifyCarPlayToken, unauthorizedResponse } from '@/lib/carplay-auth';
import { getCarPlayHome, getCacheAge } from '@/lib/carplay-home';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const auth = await verifyCarPlayToken(request);
  if (!auth) return unauthorizedResponse();

  try {
    const data = await getCarPlayHome();
    const response = NextResponse.json(data);
    response.headers.set('X-Cache-Age', String(getCacheAge()));
    return response;
  } catch (e) {
    console.error('[CarPlay Home]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
