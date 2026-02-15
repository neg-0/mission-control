import { readFile, readdir } from 'fs/promises';
import { NextResponse } from 'next/server';

const IDEAS_DIR = '/home/neg0/.openclaw/workspace-rocket/projects/ideas';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const ideaId = params.id; // e.g. "IDEA-001"

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
