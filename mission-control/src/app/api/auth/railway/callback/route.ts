import { discoverAndLinkRailwayProjects, distributeProjectTokens, distributeTokenToAgents, persistMCTokens } from '@/lib/token-utils';
import { NextRequest, NextResponse } from 'next/server';

const TOKEN_ENDPOINT = "https://backboard.railway.com/oauth/token";

const REDIRECT_URI = () => {
  return process.env.MISSION_CONTROL_URL
    ? `${process.env.MISSION_CONTROL_URL}/api/auth/railway/callback`
    : "http://localhost:3000/api/auth/railway/callback";
};

/** Use the public URL, not Next.js internal origin (which is localhost behind a proxy). */
const BASE_URL = () => process.env.MISSION_CONTROL_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  // Handle OAuth errors from Railway
  if (error) {
    const desc = searchParams.get('error_description') || 'Unknown error';
    // eslint-disable-next-line no-console
    console.error(`[Railway OAuth] Error: ${error} — ${desc}`);
    const settingsUrl = new URL('/?tab=settings&railway=error', BASE_URL());
    settingsUrl.searchParams.set('reason', desc);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code) {
    return NextResponse.json({ error: 'No authorization code provided' }, { status: 400 });
  }

  // Retrieve PKCE code_verifier and state from cookies (set by login route)
  const storedState = request.cookies.get('railway_oauth_state')?.value;
  const codeVerifier = request.cookies.get('railway_code_verifier')?.value;

  if (storedState && state !== storedState) {
    // eslint-disable-next-line no-console
    console.error(`[Railway OAuth] State mismatch: expected ${storedState}, got ${state}`);
    return NextResponse.json({ error: 'State mismatch — possible CSRF' }, { status: 403 });
  }

  const clientId = process.env.RAILWAY_CLIENT_ID;
  const clientSecret = process.env.RAILWAY_CLIENT_SECRET;

  if (!clientId) {
    return NextResponse.json({ error: 'RAILWAY_CLIENT_ID not configured' }, { status: 500 });
  }

  try {
    // Exchange authorization code for tokens
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI(),
      client_id: clientId,
    };
    if (clientSecret) {
      body.client_secret = clientSecret;
    }
    if (codeVerifier) {
      body.code_verifier = codeVerifier;
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // eslint-disable-next-line no-console
      console.error('[Railway OAuth] Token exchange failed:', errorText);
      const settingsUrl = new URL('/?tab=settings&railway=error', BASE_URL());
      settingsUrl.searchParams.set('reason', 'Token exchange failed');
      return NextResponse.redirect(settingsUrl);
    }

    const data = await response.json();

    // eslint-disable-next-line no-console
    console.log('[Railway OAuth] Token exchange successful. Persisting...');

    // 1. Persist tokens to Mission Control's .env
    await persistMCTokens(data.access_token, data.refresh_token);

    // 2. Distribute access token to all agent workspaces
    const distribution = await distributeTokenToAgents(data.access_token);

    // eslint-disable-next-line no-console
    console.log(`[Railway OAuth] Distributed to ${distribution.updated.length} workspaces`);

    // 3. Auto-discover and link Railway projects to MC projects
    const discovery = await discoverAndLinkRailwayProjects(data.access_token);
    // eslint-disable-next-line no-console
    console.log(`[Railway OAuth] Discovery: ${discovery.linked.length} linked, ${discovery.unmatched.length} unmatched`);

    // 4. Generate project tokens for all linked agents
    if (discovery.linked.length > 0) {
      const projectDist = await distributeProjectTokens(data.access_token);
      // eslint-disable-next-line no-console
      console.log(`[Railway OAuth] Project tokens: ${projectDist.generated.length} generated`);
    }

    // Redirect back to settings with success, clearing PKCE cookies
    const settingsUrl = new URL('/?tab=settings&railway=connected', BASE_URL());
    const redirectResponse = NextResponse.redirect(settingsUrl);

    // Clear the PKCE cookies
    redirectResponse.cookies.delete('railway_code_verifier');
    redirectResponse.cookies.delete('railway_oauth_state');

    return redirectResponse;

  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Railway OAuth] Error:', err);
    const settingsUrl = new URL('/?tab=settings&railway=error', BASE_URL());
    settingsUrl.searchParams.set('reason', 'Internal error during token exchange');
    return NextResponse.redirect(settingsUrl);
  }
}
