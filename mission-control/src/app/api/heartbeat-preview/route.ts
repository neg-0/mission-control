/**
 * @module /api/heartbeat-preview
 * @description
 * Preview the wake message that would be sent to an agent during a heartbeat.
 * Used by the Settings UI to show exactly what context an agent receives,
 * with token count estimation.
 */

import { buildHeartbeatContext, estimateTokens } from '@/lib/build-heartbeat-context';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/heartbeat-preview?agentId=captain&scheduleName=Work%20Session&journalEntries=5
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const scheduleName = searchParams.get('scheduleName') || 'Heartbeat';
    const journalEntries = parseInt(searchParams.get('journalEntries') || '5', 10);
    const mdInjectionsRaw = searchParams.get('mdInjections');
    const mdInjections = mdInjectionsRaw ? mdInjectionsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    if (!agentId) {
      return NextResponse.json({ error: 'agentId required' }, { status: 400 });
    }

    const message = await buildHeartbeatContext(agentId, scheduleName, {
      journalEntries,
      mdInjections,
    });

    const tokens = estimateTokens(message);

    return NextResponse.json({
      agentId,
      scheduleName,
      message,
      tokens,
      characters: message.length,
      journalEntries,
      mdInjections: mdInjections || [],
    });
  } catch (error) {
    console.error('[heartbeat-preview] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
