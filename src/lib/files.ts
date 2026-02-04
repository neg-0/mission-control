// File operations API for Mission Control
// Reads/writes workspace files via API routes

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  modifiedAt?: string;
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`Failed to list directory: ${res.statusText}`);
  return res.json();
}

export async function readFile(path: string): Promise<FileContent> {
  const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
  return res.json();
}

export async function writeFile(path: string, content: string): Promise<void> {
  const res = await fetch('/api/files/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(`Failed to write file: ${res.statusText}`);
}

export async function getFileTree(rootPath: string, maxDepth = 3): Promise<FileNode[]> {
  const res = await fetch(`/api/files/tree?path=${encodeURIComponent(rootPath)}&depth=${maxDepth}`);
  if (!res.ok) throw new Error(`Failed to get file tree: ${res.statusText}`);
  return res.json();
}

// Quick access files with their purposes
export const QUICK_ACCESS_FILES = [
  { name: 'Goals', path: 'GOALS.md', icon: '🎯', description: 'Active objectives' },
  { name: 'Playbook', path: 'PLAYBOOK.md', icon: '📖', description: 'Operating procedures' },
  { name: 'Memory', path: 'MEMORY.md', icon: '🧠', description: 'Long-term learnings' },
  { name: 'Heartbeat', path: 'HEARTBEAT.md', icon: '💓', description: 'Cron tasks' },
  { name: 'Decisions', path: 'ops/decisions.md', icon: '📝', description: 'Decision log' },
  { name: 'Backlog', path: 'BACKLOG.md', icon: '📋', description: 'Ideas queue' },
] as const;

// Get today's memory file path
export function getTodayMemoryPath(): string {
  const today = new Date().toISOString().split('T')[0];
  return `memory/${today}.md`;
}
