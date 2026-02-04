import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/kick-to-rocket
 * 
 * Sends a message to Rocket (main session) via OpenClaw hooks API
 * This triggers Rocket to take action on a PR, goal, or other item
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, context } = body;

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
    const hooksToken = process.env.OPENCLAW_HOOKS_TOKEN;

    if (!gatewayUrl || !hooksToken) {
      console.warn('OpenClaw hooks not configured, logging message locally');
      console.log('[Kick to Rocket]', message, context);
      return NextResponse.json({ 
        success: true, 
        mode: 'dry-run',
        message: 'Hooks not configured - logged locally' 
      });
    }

    // Call OpenClaw hooks/wake endpoint
    const response = await fetch(`${gatewayUrl}/hooks/wake`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hooksToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: message,
        mode: 'now', // Immediate wake
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenClaw hooks error:', response.status, errorText);
      return NextResponse.json({ 
        error: 'Failed to send to Rocket',
        details: errorText 
      }, { status: 500 });
    }

    const result = await response.json();
    
    return NextResponse.json({ 
      success: true,
      mode: 'live',
      result 
    });

  } catch (error) {
    console.error('Kick to Rocket error:', error);
    return NextResponse.json({ 
      error: 'Internal error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
