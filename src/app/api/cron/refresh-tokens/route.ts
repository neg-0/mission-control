import { distributeProjectTokens, distributeTokenToAgents, persistMCTokens } from '@/lib/token-utils';
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
      // eslint-disable-next-line no-console
      console.log('[Cron] No refresh token or client ID — skipping refresh');
      return NextResponse.json({
        status: 'skipped',
        message: 'No refresh token or client ID configured. Re-authorize via Settings → Integrations.',
      });
    }

    // eslint-disable-next-line no-console
    console.log(`[Cron] Refreshing Railway token at ${new Date().toISOString()}...`);

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
      console.error(`[Cron] Refresh failed at ${new Date().toISOString()}:`, errorText);

      // If the refresh token is invalid/expired, clear it to avoid future noise
      const parsed = JSON.parse(errorText).error ?? '';
      if (parsed === 'invalid_grant') {
        // eslint-disable-next-line no-console
        console.error('[Cron] Refresh token is stale. Please re-authorize via Settings → Integrations.');
      }

      return NextResponse.json({
        error: 'Refresh failed',
        details: errorText,
        hint: 'If invalid_grant, re-authorize via Settings → Integrations → Railway → Reconnect',
      }, { status: 502 });
    }

    const data = await response.json();
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token; // Railway rotates refresh tokens

    // eslint-disable-next-line no-console
    console.log(`[Cron] Token refreshed at ${new Date().toISOString()}. Persisting...`);

    // 1. Persist to Mission Control's .env and process.env
    await persistMCTokens(newAccessToken, newRefreshToken);

    // 2. Fan out account access token to all agent workspaces
    const distribution = await distributeTokenToAgents(newAccessToken);

    // 3. Generate and distribute project-scoped tokens
    let projectDistribution = { generated: [] as string[], failed: [] as string[], skipped: [] as string[] };
    try {
      projectDistribution = await distributeProjectTokens(newAccessToken);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Cron] Project token distribution error (non-fatal):', err);
    }

    // eslint-disable-next-line no-console
    console.log(`[Cron] Distributed account token to ${distribution.updated.length} workspaces, ${distribution.failed.length} failed`);
    // eslint-disable-next-line no-console
    console.log(`[Cron] Project tokens: ${projectDistribution.generated.length} generated, ${projectDistribution.failed.length} failed, ${projectDistribution.skipped.length} skipped`);

    return NextResponse.json({
      status: 'ok',
      message: 'Token refreshed and distributed',
      expires_in: data.expires_in,
      accountToken: {
        distributed: distribution.updated.length,
        failed: distribution.failed.length,
      },
      projectTokens: {
        generated: projectDistribution.generated.length,
        failed: projectDistribution.failed.length,
        skipped: projectDistribution.skipped.length,
      },
      refreshedAt: new Date().toISOString(),
    });

  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Cron] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
