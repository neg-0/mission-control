import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const WORKSPACE_ROOT = process.env.OPENCLAW_WORKSPACE || '/home/node/.openclaw/workspace';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rootPath = searchParams.get('path') || WORKSPACE_ROOT;
  const depth = parseInt(searchParams.get('depth') || '3');

  try {
    // Get file tree using find, excluding node_modules and .git
    const { stdout } = await execAsync(
      `find "${rootPath}" -maxdepth ${depth} \\( -name "node_modules" -o -name ".git" -o -name ".next" \\) -prune -o -type f -name "*.md" -print | head -100`
    );
    
    const files = stdout.trim().split('\n').filter(Boolean);
    
    // Build tree structure
    const tree = buildTree(files, rootPath);
    
    return NextResponse.json(tree);
  } catch (error) {
    console.error('Failed to get file tree:', error);
    return NextResponse.json({ error: 'Failed to get file tree' }, { status: 500 });
  }
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

function buildTree(files: string[], rootPath: string): TreeNode[] {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  // Create root node
  nodeMap.set('', { name: 'workspace', path: '', type: 'directory', children: [] });

  for (const filePath of files) {
    const relativePath = filePath.replace(rootPath + '/', '');
    const parts = relativePath.split('/');
    
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (!nodeMap.has(currentPath)) {
        const isFile = i === parts.length - 1;
        const node: TreeNode = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          children: isFile ? undefined : [],
        };
        nodeMap.set(currentPath, node);
        
        // Add to parent
        const parent = nodeMap.get(parentPath);
        if (parent?.children) {
          parent.children.push(node);
        } else {
          root.push(node);
        }
      }
    }
  }

  // Sort children: directories first, then alphabetically
  function sortChildren(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach(node => {
      if (node.children) sortChildren(node.children);
    });
  }

  sortChildren(root);
  return root;
}
