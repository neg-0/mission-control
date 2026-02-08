'use client';

import { ChevronDown, ChevronRight, Code2, Eye, File, Folder, FolderOpen, Maximize2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';
import { MermaidChart } from './MermaidChart';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileBrowserProps {
  className?: string;
  initialFile?: string | null;
  workspace?: string | null;
  highlightQuery?: string | null;
}

// File extensions that should be rendered as markdown
const MARKDOWN_EXTS = new Set(['.md', '.mdx', '.markdown']);

function isMarkdownFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return MARKDOWN_EXTS.has(ext);
}

// Map file extensions to highlight.js language names
function extToLang(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    css: 'css', scss: 'scss', html: 'html', xml: 'xml',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql', graphql: 'graphql',
    dockerfile: 'dockerfile', makefile: 'makefile',
  };
  return map[ext] || 'plaintext';
}

// ---------------------------------------------------------------------------
// Tree node — defined outside FileBrowser so React keeps a stable component
// identity across re-renders, which preserves the tree pane scroll position.
// ---------------------------------------------------------------------------
interface TreeNodeProps {
  node: FileNode;
  depth?: number;
  expanded: Set<string>;
  selectedFile: string | null;
  modifiedFiles: Set<string>;
  onToggleExpand: (path: string) => void;
  onLoadFile: (path: string) => void;
}

function TreeNode({
  node, depth = 0, expanded, selectedFile, modifiedFiles, onToggleExpand, onLoadFile,
}: TreeNodeProps) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedFile === node.path;
  const isModified = modifiedFiles.has(node.path);
  const dirPadding = depth * 16 + 8;
  const filePadding = depth * 16 + 20;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => onToggleExpand(node.path)}
          className="w-full flex items-center gap-1 py-1 pr-2 text-sm hover:bg-accent/50 rounded transition-colors text-left"
          style={{ paddingLeft: `${dirPadding}px` }}
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
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                selectedFile={selectedFile}
                modifiedFiles={modifiedFiles}
                onToggleExpand={onToggleExpand}
                onLoadFile={onLoadFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onLoadFile(node.path)}
      className={cn(
        'w-full flex items-center gap-1 py-1 pr-2 text-sm hover:bg-accent/50 rounded transition-colors text-left',
        isSelected && 'bg-primary/20 text-primary'
      )}
      style={{ paddingLeft: `${filePadding}px` }}
    >
      <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span className="truncate">{node.name}</span>
      {isModified && (
        <span className="w-2 h-2 led led-blue flex-shrink-0 ml-auto" title="Modified" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// FileBrowser
// ---------------------------------------------------------------------------
export function FileBrowser({ className, initialFile, workspace, highlightQuery }: FileBrowserProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [fullscreen, setFullscreen] = useState(false);
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [viewRaw, setViewRaw] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Highlight helper — splits text and wraps matches in <mark>
  function highlightText(text: string): ReactNode {
    if (!highlightQuery || highlightQuery.length < 2) return text;
    const escaped = highlightQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(re);
    if (parts.length === 1) return text;
    return parts.map((part, i) =>
      re.test(part)
        ? <mark key={i} className="bg-yellow-400/30 text-yellow-200 rounded-sm px-0.5">{part}</mark>
        : part
    );
  }

  // Auto-scroll to first highlight after content renders
  useEffect(() => {
    if (!highlightQuery || !contentRef.current) return;
    const timer = setTimeout(() => {
      const firstMark = contentRef.current?.querySelector('mark');
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [fileContent, highlightQuery, selectedFile]);

  // Refetch tree when workspace changes
  useEffect(() => {
    if (workspace) {
      setTree([]);
      setSelectedFile(null);
      setFileContent('');
      setExpanded(new Set(['']));
      setLoading(true);
      fetchTree();
    }
  }, [workspace]);

  // Navigate to file from external source (e.g. search)
  useEffect(() => {
    if (initialFile) {
      const parts = initialFile.split('/');
      const newExpanded = new Set(expanded);
      let path = '';
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        newExpanded.add(path);
      }
      setExpanded(newExpanded);
      loadFile(initialFile);
    }
  }, [initialFile]);

  async function fetchTree() {
    if (!workspace) return;
    try {
      const res = await fetch(`/api/files/tree?workspace=${encodeURIComponent(workspace)}`);
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
    if (!workspace) return;
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}&workspace=${encodeURIComponent(workspace)}`);
      if (res.ok) {
        const data = await res.json();
        setFileContent(data.content);
        setSelectedFile(path);
        setViewRaw(false);
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

  // ---------------------------------------------------------------------------
  // Custom code block — renders mermaid blocks as diagrams
  // ---------------------------------------------------------------------------
  function CodeBlock({ className: codeClassName, children, ...props }: ComponentPropsWithoutRef<'code'>) {
    const match = /language-(\w+)/.exec(codeClassName || '');
    const lang = match?.[1];
    const codeString = String(children).replace(/\n$/, '');

    if (lang === 'mermaid') {
      return <MermaidChart chart={codeString} className="my-4" />;
    }

    if (!match) {
      return (
        <code className="bg-muted/60 px-1.5 py-0.5 rounded text-[0.85em] text-primary/90" {...props}>
          {children}
        </code>
      );
    }

    return (
      <code className={codeClassName} {...props}>
        {children}
      </code>
    );
  }

  // ---------------------------------------------------------------------------
  // Content area — smart rendering based on file type
  // ---------------------------------------------------------------------------
  function FileContentView() {
    if (!selectedFile) {
      return (
        <div className="text-sm text-muted-foreground">
          Select a file from the tree to view its contents.
        </div>
      );
    }

    const isMd = isMarkdownFile(selectedFile);

    if (!isMd || viewRaw) {
      const lang = extToLang(selectedFile);
      return (
        <div className="code-view relative" ref={contentRef}>
          <pre className="text-sm leading-relaxed overflow-x-auto">
            <code className={`language-${lang} hljs`}>
              {fileContent.split('\n').map((line, i) => (
                <div key={i} className="code-line flex">
                  <span className="code-line-number select-none text-muted-foreground/40 text-right pr-4 min-w-[3rem] flex-shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="code-line-content flex-1">{highlightText(line) || '\n'}</span>
                </div>
              ))}
            </code>
          </pre>
        </div>
      );
    }

    return (
      <article ref={contentRef} className="prose prose-invert prose-sm max-w-none markdown-rendered">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            code: CodeBlock,
            // Wrap text nodes in paragraphs, list items, etc. with highlights
            p: ({ children, ...props }) => <p {...props}>{typeof children === 'string' ? highlightText(children) : children}</p>,
            li: ({ children, ...props }) => <li {...props}>{typeof children === 'string' ? highlightText(children) : children}</li>,
            td: ({ children, ...props }) => <td {...props}>{typeof children === 'string' ? highlightText(children) : children}</td>,
          }}
        >
          {fileContent}
        </ReactMarkdown>
      </article>
    );
  }

  // ---------------------------------------------------------------------------
  // No workspace guard
  // ---------------------------------------------------------------------------
  if (!workspace) {
    return (
      <div className={cn('glass-card overflow-hidden flex items-center justify-center', className)}>
        <div className="text-sm text-muted-foreground p-8 text-center">
          No workspace selected. Add one in Settings ⚙
        </div>
      </div>
    );
  }

  const isMd = selectedFile ? isMarkdownFile(selectedFile) : false;

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
            tree.map(node => (
              <TreeNode
                key={node.path}
                node={node}
                expanded={expanded}
                selectedFile={selectedFile}
                modifiedFiles={modifiedFiles}
                onToggleExpand={toggleExpand}
                onLoadFile={loadFile}
              />
            ))
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
            {isMd && selectedFile && (
              <button
                onClick={() => setViewRaw(!viewRaw)}
                className={cn(
                  'p-1 rounded transition-colors flex items-center gap-1 text-xs',
                  viewRaw
                    ? 'bg-accent text-accent-foreground hover:bg-accent/80'
                    : 'hover:bg-accent text-muted-foreground'
                )}
                title={viewRaw ? 'Show rendered' : 'Show source'}
              >
                {viewRaw ? (
                  <><Eye className="w-3.5 h-3.5" /> Preview</>
                ) : (
                  <><Code2 className="w-3.5 h-3.5" /> Source</>
                )}
              </button>
            )}
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
          <FileContentView />
        </div>
      </div>
    </div>
  );

  if (fullscreen) {
    return content;
  }

  return (
    <div className={cn('glass-card overflow-hidden', className)}>
      {content}
    </div>
  );
}
