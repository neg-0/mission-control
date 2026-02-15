import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  // TODO: Exchange code for token
  // POST https://backboard.railway.com/oauth/token
  // body: { grant_type: 'authorization_code', code, redirect_uri, client_id, client_secret }

  return NextResponse.json({ 
    message: 'Authorization code received',
    code,
    state,
    action: 'Token exchange logic pending implementation.'
  });
}
