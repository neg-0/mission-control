import { getFreshAccountToken, getFreshEnvVar } from '@/lib/token-utils';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Railway integration status check.
 *
 * Reads ALL values from .env (not process.env) for consistency.
 * Validates the access token against Railway's GraphQL API
 * by running a lightweight `{ me { name } }` query.
 */
export async function GET() {
  const token = await getFreshAccountToken();
  const refreshToken = await getFreshEnvVar('RAILWAY_REFRESH_TOKEN');
  const hasRefreshToken = !!refreshToken;
  const lastRefreshAt = await getFreshEnvVar('RAILWAY_LAST_REFRESH_AT');

  let tokenAgeMinutes: number | null = null;
  if (lastRefreshAt) {
    const age = Date.now() - new Date(lastRefreshAt).getTime();
    tokenAgeMinutes = Math.round(age / 60_000);
  }

  // Actually validate the token against Railway's API
  let tokenValid = false;
  if (token) {
    try {
      const resp = await fetch('https://backboard.railway.com/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ query: '{ me { name } }' }),
        // Prevent Next.js from caching this response
        cache: 'no-store',
      });
      if (resp.ok) {
        const data = await resp.json();
        tokenValid = !!data?.data?.me?.name;
        if (!tokenValid) {
          // eslint-disable-next-line no-console
          console.log('[RailwayStatus] Token present but API returned:', JSON.stringify(data).slice(0, 200));
        }
      } else {
        // eslint-disable-next-line no-console
        console.log(`[RailwayStatus] Railway API returned HTTP ${resp.status}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[RailwayStatus] Fetch error:', err);
      tokenValid = false;
    }
  }

  return NextResponse.json({
    connected: !!token,
    hasRefreshToken,
    lastRefreshAt,
    tokenAgeMinutes,
    tokenValid,
    healthy: tokenValid && hasRefreshToken,
  });
}
