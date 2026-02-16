import { distributeTokenToAgents, persistMCTokens } from '@/lib/token-utils';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Prevent static generation

const TOKEN_ENDPOINT = "https://backboard.railway.com/oauth/token";

export async function GET() {
  try {
    const refreshToken = process.env.RAILWAY_REFRESH_TOKEN;
    const clientId = process.env.RAILWAY_CLIENT_ID;
    const clientSecret = process.env.RAILWAY_CLIENT_SECRET;

    // During build time, env vars might be missing or refresh might fail.
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return NextResponse.json({ status: 'skipped', message: 'Build phase' });
    }

    if (!refreshToken || !clientId) {
      return NextResponse.json({ error: 'Missing refresh token or client ID' }, { status: 500 });
    }

    // eslint-disable-next-line no-console
    console.log('[Cron] Refreshing Railway token...');

    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    };
    if (clientSecret) {
      body.client_secret = clientSecret;
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // eslint-disable-next-line no-console
      console.error('[Cron] Refresh failed:', errorText);
      return NextResponse.json({ error: 'Refresh failed', details: errorText }, { status: 500 });
    }

    const data = await response.json();
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token; // Railway rotates refresh tokens

    // eslint-disable-next-line no-console
    console.log('[Cron] Token refreshed. Persisting...');

    // 1. Persist to Mission Control's .env and process.env
    await persistMCTokens(newAccessToken, newRefreshToken);

    // 2. Fan out access token to all agent workspaces
    const distribution = await distributeTokenToAgents(newAccessToken);

    // eslint-disable-next-line no-console
    console.log(`[Cron] Distributed to ${distribution.updated.length} workspaces, ${distribution.failed.length} failed`);

    return NextResponse.json({
      status: 'ok',
      message: 'Token refreshed and distributed',
      expires_in: data.expires_in,
      distributed: distribution.updated.length,
      failed: distribution.failed.length,
    });

  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Cron] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
