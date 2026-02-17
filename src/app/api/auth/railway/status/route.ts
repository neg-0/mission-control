import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Lightweight Railway integration status check.
 * Returns token presence, last refresh time, and token age.
 */
export async function GET() {
  const hasToken = !!process.env.RAILWAY_API_TOKEN;
  const hasRefreshToken = !!process.env.RAILWAY_REFRESH_TOKEN;
  const lastRefreshAt = process.env.RAILWAY_LAST_REFRESH_AT || null;

  let tokenAgeMinutes: number | null = null;
  if (lastRefreshAt) {
    const age = Date.now() - new Date(lastRefreshAt).getTime();
    tokenAgeMinutes = Math.round(age / 60_000);
  }

  return NextResponse.json({
    connected: hasToken,
    hasRefreshToken,
    lastRefreshAt,
    tokenAgeMinutes,
    healthy: hasToken && hasRefreshToken && (tokenAgeMinutes === null || tokenAgeMinutes < 65),
  });
}
