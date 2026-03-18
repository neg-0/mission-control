/**
 * Railway Token Refresh Cron Endpoint
 *
 * Called by crontab every hour at :45 (`45 * * * *`).
 * This is the **sole writer** for Railway OAuth tokens — see critical rules
 * in `src/lib/token-utils.ts` module JSDoc.
 *
 * Flow:
 *   1. Read refresh token from .env (NOT process.env — see getFreshEnvVar)
 *   2. POST to Railway's /oauth/token with grant_type=refresh_token
 *   3. Railway returns: { access_token, refresh_token, expires_in: 3600 }
 *      - access_token is valid for 1 hour
 *      - refresh_token may be the same or rotated (Railway docs: "may
 *        initially contain the same value, but will eventually return
 *        a new token")
 *   4. persistMCTokens() writes BOTH tokens to .env AND process.env
 *   5. Distribute account token to all 12 agent workspace .env files
 *   6. Generate per-project RAILWAY_TOKEN for each linked Railway project
 *
 * ⚠️ DO NOT manually call Railway's /oauth/token outside of this endpoint.
 *    It will rotate the refresh token and desync our stored value.
 */
import { distributeProjectTokens, getFreshAccountToken, refreshRailwayToken } from '@/lib/token-utils';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Prevent static generation

export async function GET() {
  try {
    // During build time, env vars might be missing or refresh might fail.
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return NextResponse.json({ status: 'skipped', message: 'Build phase' });
    }

    // eslint-disable-next-line no-console
    console.log(`[Cron] Refreshing Railway token at ${new Date().toISOString()}...`);

    // Core refresh + distribute (shared with recovery playbook)
    const result = await refreshRailwayToken();

    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error(`[Cron] Refresh failed at ${new Date().toISOString()}:`, result.error);
      return NextResponse.json({
        error: 'Refresh failed',
        details: result.error,
        hint: 'If invalid_grant, re-authorize via Settings → Integrations → Railway → Reconnect',
      }, { status: 502 });
    }

    // eslint-disable-next-line no-console
    console.log(`[Cron] Token refreshed. Distributed to ${result.distributedTo} workspaces.`);

    // Validate the new token immediately to detect bad responses
    try {
      const validateResp = await fetch('https://backboard.railway.com/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${result.accessToken}`,
        },
        body: JSON.stringify({ query: '{ me { name } }' }),
        cache: 'no-store',
      });
      const validateData = await validateResp.json();
      const valid = !!validateData?.data?.me?.name;
      // eslint-disable-next-line no-console
      console.log(`[Cron] New token validation: ${valid ? 'VALID' : 'INVALID'} — ${JSON.stringify(validateData).slice(0, 100)}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Cron] New token validation failed:', err);
    }

    // Generate and distribute project-scoped tokens
    let projectDistribution = { generated: [] as string[], failed: [] as string[], skipped: [] as string[] };
    try {
      const accountToken = await getFreshAccountToken();
      if (accountToken) {
        projectDistribution = await distributeProjectTokens(accountToken);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Cron] Project token distribution error (non-fatal):', err);
    }

    // eslint-disable-next-line no-console
    console.log(`[Cron] Project tokens: ${projectDistribution.generated.length} generated, ${projectDistribution.failed.length} failed, ${projectDistribution.skipped.length} skipped`);

    return NextResponse.json({
      status: 'ok',
      message: 'Token refreshed and distributed',
      expires_in: result.expiresIn,
      accountToken: {
        distributed: result.distributedTo,
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
