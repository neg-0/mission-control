'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Maximize2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileBrowserProps {
  className?: string;
}

export function FileBrowser({ className }: FileBrowserProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [fullscreen, setFullscreen] = useState(false);
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());

  // Fetch file tree on mount
  useEffect(() => {
    fetchTree();
  }, []);

  async function fetchTree() {
    try {
      const res = await fetch('/api/files/tree');
      if (res.ok) {
        const data = await res.json();
        setTree(data);
      }
    } catch (e) {
      console.error('Failed to fetch tree:', e);
    } finally {
      setLoading(false);
    }
  }

  async function loadFile(path: string) {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setFileContent(data.content);
        setSelectedFile(path);
        // Clear modified indicator when viewing
        setModifiedFiles(prev => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    } catch (e) {
      console.error('Failed to load file:', e);
    }
  }

  function toggleExpand(path: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
    const isExpanded = expanded.has(node.path);
    const isSelected = selectedFile === node.path;
    const isModified = modifiedFiles.has(node.path);
    
    if (node.type === 'directory') {
      return (
        <div>
          <button
            onClick={() => toggleExpand(node.path)}
            className={cn(
              'w-full flex items-center gap-1 px-2 py-1 text-sm hover:bg-accent/50 rounded transition-colors text-left',
              depth > 0 && 'ml-4'
            )}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {isExpanded && node.children && (
            <div>
              {node.children.map(child => (
                <TreeNode key={child.path} node={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        onClick={() => loadFile(node.path)}
        className={cn(
          'w-full flex items-center gap-1 px-2 py-1 text-sm hover:bg-accent/50 rounded transition-colors text-left',
          depth > 0 && 'ml-4',
          isSelected && 'bg-primary/20 text-primary'
        )}
        style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
      >
        <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="truncate">{node.name}</span>
        {isModified && (
          <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 ml-auto" title="Modified" />
        )}
      </button>
    );
  }

  const content = (
    <div className={cn('flex h-full', fullscreen && 'fixed inset-0 z-50 bg-background')}>
      {/* File Tree */}
      <div className={cn(
        'border-r border-border overflow-y-auto',
        fullscreen ? 'w-64' : 'w-48'
      )}>
        <div className="p-2 border-b border-border flex items-center justify-between sticky top-0 bg-card">
          <span className="text-sm font-medium">📁 Files</span>
          <button onClick={() => fetchTree()} className="p-1 hover:bg-accent rounded" title="Refresh">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="p-1">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading...</div>
          ) : (
            tree.map(node => <TreeNode key={node.path} node={node} />)
          )}
        </div>
      </div>

      {/* File Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-2 border-b border-border flex items-center justify-between sticky top-0 bg-card">
          <span className="text-sm font-medium truncate">
            {selectedFile || 'Select a file'}
          </span>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setFullscreen(!fullscreen)} 
              className="p-1 hover:bg-accent rounded"
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? <X className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {selectedFile ? (
            <article className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{fileContent}</ReactMarkdown>
            </article>
          ) : (
            <div className="text-sm text-muted-foreground">
              Select a file from the tree to view its contents.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (fullscreen) {
    return content;
  }

  return (
    <div className={cn('bg-card border border-border rounded-lg overflow-hidden', className)}>
      {content}
    </div>
  );
}
