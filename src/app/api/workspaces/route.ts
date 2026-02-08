import { readFile, writeFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export interface Workspace {
  id: string;
  label: string;
  path: string;
}

const CONFIG_PATH = path.join(process.cwd(), 'workspaces.json');

async function loadWorkspaces(): Promise<Workspace[]> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(content) as Workspace[];
  } catch {
    return [];
  }
}

export async function GET() {
  const workspaces = await loadWorkspaces();
  return NextResponse.json(workspaces);
}

export async function PUT(request: NextRequest) {
  try {
    const workspaces: Workspace[] = await request.json();

    // Validate
    if (!Array.isArray(workspaces)) {
      return NextResponse.json({ error: 'Expected an array of workspaces' }, { status: 400 });
    }

    for (const ws of workspaces) {
      if (!ws.id || !ws.label || !ws.path) {
        return NextResponse.json({ error: 'Each workspace needs id, label, and path' }, { status: 400 });
      }
    }

    await writeFile(CONFIG_PATH, JSON.stringify(workspaces, null, 2) + '\n', 'utf-8');
    return NextResponse.json(workspaces);
  } catch (error) {
    console.error('Failed to save workspaces:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
