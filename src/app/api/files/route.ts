import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const WORKSPACE_ROOT = process.env.WORKSPACE_PATH || '/home/node/.openclaw/workspace';

// Validate path is within workspace
function validatePath(path: string): boolean {
  const normalized = path.replace(/\.\./g, '');
  return normalized.startsWith(WORKSPACE_ROOT) || !normalized.startsWith('/');
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get('path') || '';
  
  // Security: ensure path is within workspace
  const fullPath = path.startsWith('/') ? path : `${WORKSPACE_ROOT}/${path}`;
  if (!validatePath(fullPath)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    // List directory contents
    const { stdout } = await execAsync(`ls -la "${fullPath}" | tail -n +2`);
    const lines = stdout.trim().split('\n').filter(Boolean);
    
    const files = lines.map(line => {
      const parts = line.split(/\s+/);
      const isDir = parts[0].startsWith('d');
      const name = parts.slice(8).join(' ');
      
      return {
        name,
        path: `${fullPath}/${name}`.replace(WORKSPACE_ROOT + '/', ''),
        type: isDir ? 'directory' : 'file',
        size: parseInt(parts[4]) || 0,
        modifiedAt: `${parts[5]} ${parts[6]} ${parts[7]}`,
      };
    }).filter(f => f.name && f.name !== '.' && f.name !== '..');

    return NextResponse.json(files);
  } catch (error) {
    console.error('Failed to list directory:', error);
    return NextResponse.json({ error: 'Failed to list directory' }, { status: 500 });
  }
}
