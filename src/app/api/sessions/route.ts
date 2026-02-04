import { NextResponse } from 'next/server';

// For now, return mock data. Will integrate with OpenClaw gateway later.
export async function GET() {
  // TODO: Connect to OpenClaw gateway WebSocket and fetch real sessions
  // const gateway = getGatewayClient();
  // const sessions = await gateway.listSessions();
  
  // Mock data for initial development
  const sessions = [
    {
      sessionKey: 'main',
      label: 'Main Session',
      status: 'active',
      lastActivityMs: Date.now(),
      model: 'claude-opus-4-5-thinking',
      kind: 'main',
    },
  ];

  return NextResponse.json({ sessions });
}
