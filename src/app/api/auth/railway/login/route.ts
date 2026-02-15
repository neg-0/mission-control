import { NextRequest, NextResponse } from 'next/server';

const RAILWAY_AUTH_ENDPOINT = "https://backboard.railway.com/oauth/auth";
const CLIENT_ID = process.env.RAILWAY_CLIENT_ID;
// Ensure this matches what is configured in Railway's developer portal
const REDIRECT_URI = process.env.MISSION_CONTROL_URL 
  ? `${process.env.MISSION_CONTROL_URL}/api/auth/railway/callback`
  : "http://localhost:3000/api/auth/railway/callback";

export async function GET(_request: NextRequest) {
  if (!CLIENT_ID) {
    return NextResponse.json({ error: 'RAILWAY_CLIENT_ID not configured' }, { status: 500 });
  }

  const state = Math.random().toString(36).substring(7); // Simple state for now
  
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile offline_access workspace:admin project:member",
    state: state,
    prompt: "consent"
  });

  const authUrl = `${RAILWAY_AUTH_ENDPOINT}?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}
