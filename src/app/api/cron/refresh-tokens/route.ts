import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Prevent static generation

const TOKEN_ENDPOINT = "https://backboard.railway.com/oauth/token";

export async function GET() {
  try {
    const refreshToken = process.env.RAILWAY_REFRESH_TOKEN;
    const clientId = process.env.RAILWAY_CLIENT_ID;

    // During build time, env vars might be missing or refresh might fail.
    // We should skip execution if we are in a build environment or missing credentials.
    if (process.env.NEXT_PHASE === 'phase-production-build') {
       return NextResponse.json({ status: 'skipped', message: 'Build phase' });
    }

    if (!refreshToken || !clientId) {
      return NextResponse.json({ error: 'Missing refresh token or client ID' }, { status: 500 });
    }

    // eslint-disable-next-line no-console
    console.log('[Cron] Refreshing Railway token...');

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // eslint-disable-next-line no-console
      console.error('[Cron] Refresh failed:', errorText);
      return NextResponse.json({ error: 'Refresh failed', details: errorText }, { status: 500 });
    }

    const data = await response.json();
    const newAccessToken = data.access_token;
    
    // eslint-disable-next-line no-console
    console.log('[Cron] SUCCESS! New Access Token:', newAccessToken.substring(0, 10) + '...');
    
    // TODO: Persist new tokens to DB/Env

    return NextResponse.json({ 
      status: 'ok', 
      message: 'Token refreshed successfully',
      expires_in: data.expires_in
    });

  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Cron] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
