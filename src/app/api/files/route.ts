import { readdir, stat } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

// Validate path is within workspace
function validatePath(filePath: string, workspaceRoot: string): boolean {
  const normalized = path.normalize(filePath).replace(/\.\./g, '');
  return normalized.startsWith(workspaceRoot) || !normalized.startsWith('/');
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const dirPath = searchParams.get('path') || '';
  const workspace = searchParams.get('workspace') || '';

  if (!workspace) {
    return NextResponse.json({ error: 'workspace param required' }, { status: 400 });
  }

  const fullPath = dirPath.startsWith('/') ? dirPath : path.join(workspace, dirPath);
  if (!validatePath(fullPath, workspace)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const entries = await readdir(fullPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      const entryPath = path.join(fullPath, entry.name);
      const relPath = path.relative(workspace, entryPath);
      try {
        const stats = await stat(entryPath);
        files.push({
          name: entry.name,
          path: relPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      } catch {
        // skip unreadable entries
      }
    }

    return NextResponse.json(files);
  } catch (error) {
    console.error('Failed to list directory:', error);
    return NextResponse.json({ error: 'Failed to list directory' }, { status: 500 });
  }
}
