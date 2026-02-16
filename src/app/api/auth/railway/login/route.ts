import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Must generate fresh state + PKCE per request

const RAILWAY_AUTH_ENDPOINT = "https://backboard.railway.com/oauth/auth";

/**
 * Generate a cryptographically random code_verifier (43-128 chars, URL-safe).
 */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Derive code_challenge from code_verifier using S256 method.
 */
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export async function GET(_request: NextRequest) {
  const clientId = process.env.RAILWAY_CLIENT_ID;
  const redirectUri = process.env.MISSION_CONTROL_URL
    ? `${process.env.MISSION_CONTROL_URL}/api/auth/railway/callback`
    : "http://localhost:3000/api/auth/railway/callback";

  if (!clientId) {
    return NextResponse.json({ error: 'RAILWAY_CLIENT_ID not configured' }, { status: 500 });
  }

  const state = crypto.randomBytes(16).toString('base64url');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile offline_access workspace:admin project:member",
    state: state,
    prompt: "consent",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${RAILWAY_AUTH_ENDPOINT}?${params.toString()}`;

  // Store code_verifier in a secure, HttpOnly cookie so the callback can use it.
  // It's tied to this specific OAuth flow via the state parameter.
  const response = NextResponse.redirect(authUrl);
  response.cookies.set('railway_code_verifier', codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/auth/railway',
    maxAge: 600, // 10 minutes — plenty of time to complete the flow
  });
  response.cookies.set('railway_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/auth/railway',
    maxAge: 600,
  });

  return response;
}
