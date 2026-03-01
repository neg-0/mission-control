import { readFile, stat } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

// Validate path is within the given workspace root
function validatePath(filePath: string, workspaceRoot: string): boolean {
  const normalized = path.normalize(filePath).replace(/\.\./g, '');
  const fullPath = filePath.startsWith('/') ? normalized : path.join(workspaceRoot, normalized);
  return fullPath.startsWith(workspaceRoot);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get('path') || '';
  const workspace = searchParams.get('workspace') || '';

  if (!workspace) {
    return NextResponse.json({ error: 'workspace param required' }, { status: 400 });
  }

  if (!filePath) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  const fullPath = filePath.startsWith('/') ? filePath : path.join(workspace, filePath);

  if (!validatePath(fullPath, workspace)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const content = await readFile(fullPath, 'utf-8');
    const stats = await stat(fullPath);

    return NextResponse.json({
      path: filePath,
      content,
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found', path: fullPath }, { status: 404 });
    }
    if (err.code === 'EACCES') {
      return NextResponse.json({ error: 'Permission denied', path: fullPath }, { status: 403 });
    }
    console.error('Failed to read file:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
