import { readdir, readFile } from 'fs/promises';
import Fuse from 'fuse.js';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

interface Workspace {
  id: string;
  label: string;
  path: string;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', '__pycache__', '.venv', 'dist', 'build']);

interface DocChunk {
  filePath: string;       // relative path from workspace root
  fileName: string;       // basename
  title: string;          // first heading or filename
  content: string;        // chunk text
  lineStart: number;      // line offset in file
  workspaceId: string;
  workspaceLabel: string;
  workspacePath: string;
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

// Scan for all .md files recursively
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findMarkdownFiles(fullPath));
      } else if (entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return files;
}

function extractTitle(content: string, fileName: string): string {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : fileName.replace(/\.md$/, '');
}

function chunkByHeadings(content: string, filePath: string, fileName: string, ws: Workspace): DocChunk[] {
  const lines = content.split('\n');
  const chunks: DocChunk[] = [];
  let currentChunk: string[] = [];
  let currentTitle = extractTitle(content, fileName);
  let chunkLineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);

    if (headingMatch && currentChunk.length > 0) {
      const text = currentChunk.join('\n').trim();
      if (text.length > 20) {
        chunks.push({
          filePath, fileName, title: currentTitle,
          content: text.slice(0, 1000),
          lineStart: chunkLineStart,
          workspaceId: ws.id,
          workspaceLabel: ws.label,
          workspacePath: ws.path,
        });
      }
      currentChunk = [line];
      currentTitle = headingMatch[1].trim();
      chunkLineStart = i;
    } else {
      currentChunk.push(line);
    }
  }

  const text = currentChunk.join('\n').trim();
  if (text.length > 20) {
    chunks.push({
      filePath, fileName, title: currentTitle,
      content: text.slice(0, 1000),
      lineStart: chunkLineStart,
      workspaceId: ws.id,
      workspaceLabel: ws.label,
      workspacePath: ws.path,
    });
  }

  return chunks;
}

// Cache the index
let cachedFuse: Fuse<DocChunk> | null = null;
let cachedChunks: DocChunk[] = [];
let cacheTime = 0;
let cacheKey = '';
const CACHE_TTL = 60_000;

async function getIndex(): Promise<{ fuse: Fuse<DocChunk>; chunks: DocChunk[] }> {
  const workspaces = await loadWorkspaces();
  const key = workspaces.map(w => w.path).sort().join('|');

  if (cachedFuse && Date.now() - cacheTime < CACHE_TTL && cacheKey === key) {
    return { fuse: cachedFuse, chunks: cachedChunks };
  }

  const allChunks: DocChunk[] = [];

  for (const ws of workspaces) {
    const mdFiles = await findMarkdownFiles(ws.path);
    for (const filePath of mdFiles) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const relPath = path.relative(ws.path, filePath);
        const fileName = path.basename(filePath);
        allChunks.push(...chunkByHeadings(content, relPath, fileName, ws));
      } catch {
        // skip unreadable files
      }
    }
  }

  const fuse = new Fuse(allChunks, {
    keys: [
      { name: 'title', weight: 3 },
      { name: 'fileName', weight: 2 },
      { name: 'content', weight: 1 },
      { name: 'filePath', weight: 0.5 },
    ],
    threshold: 0.4,
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 2,
    ignoreLocation: true,
  });

  cachedFuse = fuse;
  cachedChunks = allChunks;
  cacheTime = Date.now();
  cacheKey = key;

  return { fuse, chunks: allChunks };
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ results: [], total: 0 });
  }

  try {
    const { fuse } = await getIndex();
    const results = fuse.search(q, { limit: 50 });

    return NextResponse.json({
      results: results.map(r => ({
        filePath: r.item.filePath,
        fileName: r.item.fileName,
        title: r.item.title,
        snippet: r.item.content.slice(0, 200),
        score: r.score,
        lineStart: r.item.lineStart,
        workspaceId: r.item.workspaceId,
        workspaceLabel: r.item.workspaceLabel,
        workspacePath: r.item.workspacePath,
      })),
      total: results.length,
    });
  } catch (error) {
    console.error('Search failed:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
