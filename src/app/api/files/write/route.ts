import { writeFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

/**
 * POST /api/files/write
 * Writes content to a file within a workspace.
 * Used by GoalsTracker for reordering and editing GOALS.md.
 *
 * Body: { path: string, content: string, workspace: string }
 */

function validatePath(filePath: string, workspaceRoot: string): boolean {
  const normalized = path.normalize(filePath).replace(/\.\./g, '');
  const fullPath = filePath.startsWith('/') ? normalized : path.join(workspaceRoot, normalized);
  return fullPath.startsWith(workspaceRoot);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: filePath, content, workspace } = body;

    if (!workspace || typeof workspace !== 'string') {
      return NextResponse.json({ error: 'workspace param required' }, { status: 400 });
    }

    if (!filePath || typeof filePath !== 'string') {
      return NextResponse.json({ error: 'path param required' }, { status: 400 });
    }

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content param required' }, { status: 400 });
    }

    const fullPath = filePath.startsWith('/') ? filePath : path.join(workspace, filePath);

    if (!validatePath(fullPath, workspace)) {
      return NextResponse.json({ error: 'Invalid path — must be within workspace' }, { status: 403 });
    }

    await writeFile(fullPath, content, 'utf-8');

    return NextResponse.json({ ok: true, path: filePath });
  } catch (error) {
    console.error('Failed to write file:', error);
    return NextResponse.json({ error: 'Failed to write file' }, { status: 500 });
  }
}
