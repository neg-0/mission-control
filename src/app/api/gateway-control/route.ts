import { exec } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';

const execAsync = promisify(exec);

const ALLOWED_ACTIONS = ['start', 'stop', 'restart'] as const;
type Action = (typeof ALLOWED_ACTIONS)[number];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action: string = body?.action;

    if (!action || !ALLOWED_ACTIONS.includes(action as Action)) {
      return NextResponse.json(
        { ok: false, message: `Invalid action. Allowed: ${ALLOWED_ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }

    const { stdout, stderr } = await execAsync(
      `systemctl --user ${action} openclaw-gateway.service`,
      { timeout: 15000 }
    );

    return NextResponse.json({
      ok: true,
      message: `Gateway ${action} command sent`,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
