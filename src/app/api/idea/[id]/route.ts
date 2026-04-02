import { readFile, readdir } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';

import { getOpenClawHome } from '@/lib/config';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const ideaId = params.id; // e.g. "IDEA-001"
  const IDEAS_DIR = path.join(getOpenClawHome(), 'workspace-rocket', 'projects', 'ideas');

  try {
    // Find the directory matching the idea ID
    const dirs = await readdir(IDEAS_DIR);
    const ideaDir = dirs.find((d) => d.startsWith(ideaId));

    if (!ideaDir) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }

    const ideaPath = `${IDEAS_DIR}/${ideaDir}/idea.json`;
    const raw = await readFile(ideaPath, 'utf-8');
    const idea = JSON.parse(raw);

    return NextResponse.json(idea);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return NextResponse.json({ error: 'idea.json not found', id: ideaId }, { status: 404 });
    }
    console.error(`Failed to read idea ${ideaId}:`, e);
    return NextResponse.json({ error: 'Failed to load idea' }, { status: 500 });
  }
}
