import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const REBUILD_SCRIPT = '/home/neg0/.openclaw/workspace-rocket/projects/mission-control/scripts/control-rebuild.sh';
const REBUILD_LOG = '/tmp/mission-control-rebuild.log';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body?.action;

    if (action === 'status') {
      // Return the rebuild log contents
      try {
        const log = await readFile(REBUILD_LOG, 'utf-8');
        const lines = log.trim().split('\n');
        const complete = log.includes('=== Rebuild complete ===');
        const failed = log.includes('ERR!') || log.includes('ELIFECYCLE') || log.includes('Error:');
        return NextResponse.json({
          ok: true,
          status: complete ? (failed ? 'failed' : 'complete') : 'building',
          lines: lines.slice(-30), // last 30 lines
        });
      } catch {
        return NextResponse.json({ ok: true, status: 'idle', lines: [] });
      }
    }

    if (action !== 'rebuild') {
      return NextResponse.json(
        { ok: false, message: 'Invalid action. Use "rebuild" or "status".' },
        { status: 400 }
      );
    }

    // Spawn the rebuild script detached so it survives server shutdown
    const child = exec(
      `nohup bash ${REBUILD_SCRIPT} &`,
      { timeout: 5000 },
    );
    child.unref();

    return NextResponse.json({
      ok: true,
      message: 'Rebuild started. The service will stop, build, and restart. Check status with action: "status".',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
