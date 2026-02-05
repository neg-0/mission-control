import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { stat } from 'fs/promises';
import path from 'path';

const WORKSPACE_ROOT = process.env.WORKSPACE_PATH || '/home/node/.openclaw/workspace';

// Validate path is within workspace
function validatePath(filePath: string): boolean {
  const normalized = path.normalize(filePath).replace(/\.\./g, '');
  const fullPath = filePath.startsWith('/') ? normalized : path.join(WORKSPACE_ROOT, normalized);
  return fullPath.startsWith(WORKSPACE_ROOT);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get('path') || '';
  
  if (!filePath) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  const fullPath = filePath.startsWith('/') ? filePath : path.join(WORKSPACE_ROOT, filePath);
  
  if (!validatePath(fullPath)) {
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
  } catch (error) {
    console.error('Failed to read file:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
