import { discoverAndLinkRailwayProjects, getFreshAccountToken, getProjectTokenForAgent } from '@/lib/token-utils';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tokens/railway?agentId=captain
 *
 * Self-service endpoint for agents to request their Railway project token.
 * The agent must own a project that has been linked to a Railway project.
 *
 * Query params:
 *   - agentId (required): The requesting agent's ID
 *   - writeEnv (optional): "false" to skip writing to agent's .env (default: true)
 */
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json(
      { error: 'agentId query parameter is required' },
      { status: 400 },
    );
  }

  const accountToken = await getFreshAccountToken();
  if (!accountToken) {
    return NextResponse.json(
      { error: 'Railway not connected. Ask the admin to re-authorize via Settings.' },
      { status: 503 },
    );
  }

  const writeToEnv = request.nextUrl.searchParams.get('writeEnv') !== 'false';

  const result = await getProjectTokenForAgent(accountToken, agentId, writeToEnv);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        hint: 'If your project is not linked, the admin can trigger auto-discovery or manually link it via PATCH /api/projects/:id/railway',
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    agentId,
    projectId: result.projectId,
    projectName: result.projectName,
    token: result.token,
    writtenToEnv: writeToEnv,
  });
}

/**
 * POST /api/tokens/railway
 *
 * Trigger Railway project auto-discovery.
 * Queries all Railway projects, matches them to MC projects by name,
 * and links them automatically.
 * 
 * Body (optional): { generateTokens: true } to also generate project tokens after discovery.
 */
export async function POST(request: NextRequest) {
  const accountToken = await getFreshAccountToken();
  if (!accountToken) {
    return NextResponse.json(
      { error: 'Railway not connected. Re-authorize via Settings → Integrations.' },
      { status: 503 },
    );
  }

  let generateTokens = false;
  try {
    const body = await request.json();
    generateTokens = body?.generateTokens === true;
  } catch {
    // No body is fine
  }

  const discovery = await discoverAndLinkRailwayProjects(accountToken);

  let tokenResult = null;
  if (generateTokens && discovery.linked.length > 0) {
    const { distributeProjectTokens } = await import('@/lib/token-utils');
    tokenResult = await distributeProjectTokens(accountToken);
  }

  return NextResponse.json({
    ok: true,
    discovery: {
      linked: discovery.linked,
      unmatched: discovery.unmatched,
    },
    tokens: tokenResult ? {
      generated: tokenResult.generated.length,
      failed: tokenResult.failed.length,
      skipped: tokenResult.skipped.length,
    } : null,
  });
}
