import { readdir } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', '__pycache__', '.venv', 'dist', 'build']);

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

async function scanDir(dirPath: string, relativePath: string, depth: number, maxDepth: number): Promise<TreeNode[]> {
  if (depth > maxDepth) return [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const nodes: TreeNode[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const children = await scanDir(
          path.join(dirPath, entry.name),
          entryRelPath,
          depth + 1,
          maxDepth
        );
        if (children.length > 0) {
          nodes.push({
            name: entry.name,
            path: entryRelPath,
            type: 'directory',
            children,
          });
        }
      } else if (entry.name.endsWith('.md')) {
        nodes.push({
          name: entry.name,
          path: entryRelPath,
          type: 'file',
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return nodes;
  } catch (error) {
    console.error(`Failed to scan directory ${dirPath}:`, error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspace = searchParams.get('workspace') || '';
  const depth = parseInt(searchParams.get('depth') || '3');

  if (!workspace) {
    return NextResponse.json({ error: 'workspace param required' }, { status: 400 });
  }

  try {
    const tree = await scanDir(workspace, '', 0, depth);
    return NextResponse.json(tree);
  } catch (error) {
    console.error('Failed to read directory:', error);
    return NextResponse.json({ error: 'Failed to read directory' }, { status: 500 });
  }
}
