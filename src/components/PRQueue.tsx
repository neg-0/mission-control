'use client';

import { useState, useEffect } from 'react';
import { 
  GitPullRequest, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Send, 
  Copy, 
  RefreshCw,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { cn } from '../lib/utils';

interface PR {
  id: number;
  title: string;
  branch?: string;
  target: string;
  ci: 'passing' | 'failed' | 'pending' | 'skipped';
  reviewState: 'approved' | 'changes_requested' | 'pending' | 'dismissed';
  owner: string;
  unresolvedComments: number;
  url?: string;
  author?: string;
  updatedAt?: string;
  isDraft?: boolean;
}

interface PRQueueProps {
  className?: string;
  repo?: string;
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    passing: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Passing' },
    failed: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Failed' },
    pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pending' },
    skipped: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Skipped' },
    approved: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Approved' },
    changes_requested: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Changes' },
    dismissed: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Dismissed' },
  };
  const c = config[status] || { bg: 'bg-gray-500/20', text: 'text-gray-400', label: status };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', c.bg, c.text)}>
      {c.label}
    </span>
  );
}

// Owner badge
function OwnerBadge({ owner }: { owner: string }) {
  const config: Record<string, { bg: string; emoji: string }> = {
    dustin: { bg: 'bg-purple-500/20 text-purple-400', emoji: '👤' },
    rocket: { bg: 'bg-blue-500/20 text-blue-400', emoji: '🚀' },
    jules: { bg: 'bg-pink-500/20 text-pink-400', emoji: '🤖' },
    gemini: { bg: 'bg-cyan-500/20 text-cyan-400', emoji: '✨' },
    ci: { bg: 'bg-yellow-500/20 text-yellow-400', emoji: '⏳' },
  };
  const c = config[owner] || { bg: 'bg-gray-500/20 text-gray-400', emoji: '❓' };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', c.bg)}>
      {c.emoji} {owner}
    </span>
  );
}

function PRRow({ pr, onKick }: { pr: PR; onKick?: (pr: PR) => void }) {
  const prUrl = pr.url || `https://github.com/neg-0/comp-iq/pull/${pr.id}`;
  
  return (
    <div className="flex items-center gap-3 p-3 hover:bg-accent/50 rounded-lg transition-colors group">
      {/* CI Status Icon */}
      <div className="flex-shrink-0">
        {pr.ci === 'passing' && <CheckCircle2 className="w-5 h-5 text-green-400" />}
        {pr.ci === 'failed' && <XCircle className="w-5 h-5 text-red-400" />}
        {pr.ci === 'pending' && <Clock className="w-5 h-5 text-yellow-400 animate-pulse" />}
        {pr.ci === 'skipped' && <Clock className="w-5 h-5 text-gray-400" />}
      </div>
      
      {/* PR Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <a 
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm hover:text-primary hover:underline flex items-center gap-1"
          >
            #{pr.id}
            <ExternalLink className="w-3 h-3 opacity-50" />
          </a>
          <span className="text-sm text-muted-foreground truncate">{pr.title}</span>
          {pr.isDraft && (
            <span className="text-xs bg-gray-500/20 text-gray-400 px-1.5 py-0.5 rounded">Draft</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">→ {pr.target}</span>
          {pr.unresolvedComments > 0 && (
            <span className="text-xs text-orange-400">💬 {pr.unresolvedComments} comments</span>
          )}
        </div>
      </div>
      
      {/* Status & Owner */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <StatusBadge status={pr.reviewState} />
        <OwnerBadge owner={pr.owner} />
      </div>
      
      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          className="p-1.5 hover:bg-primary/20 rounded" 
          title="Kick to Rocket"
          onClick={() => onKick?.(pr)}
        >
          <Send className="w-4 h-4 text-primary" />
        </button>
        <button 
          className="p-1.5 hover:bg-muted rounded" 
          title="Copy PR link"
          onClick={() => navigator.clipboard.writeText(prUrl)}
        >
          <Copy className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

export function PRQueue({ className, repo = 'neg-0/comp-iq' }: PRQueueProps) {
  const [prs, setPRs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'needs-action' | 'ready'>('all');

  async function fetchPRs() {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/github/prs?repo=${encodeURIComponent(repo)}`);
      if (res.ok) {
        const data = await res.json();
        setPRs(data.prs || []);
        if (data.error) {
          setError(data.error);
        }
      } else {
        throw new Error('Failed to fetch PRs');
      }
    } catch (e) {
      setError('Failed to load PRs');
      console.error('Failed to fetch PRs:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPRs();
    // Refresh every 2 minutes
    const interval = setInterval(fetchPRs, 120000);
    return () => clearInterval(interval);
  }, [repo]);

  async function handleKick(pr: PR) {
    const message = `[Mission Control] PR #${pr.id} needs attention:
- Title: ${pr.title}
- CI: ${pr.ci}
- Review: ${pr.reviewState}
- Unresolved comments: ${pr.unresolvedComments}
- Owner: ${pr.owner}
- URL: ${pr.url || `https://github.com/neg-0/comp-iq/pull/${pr.id}`}

Please review and take action.`;

    try {
      const res = await fetch('/api/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message,
          context: { type: 'pr', prId: pr.id, repo }
        }),
      });
      
      const result = await res.json();
      
      if (result.success) {
        alert(`Sent PR #${pr.id} to Rocket! ${result.mode === 'dry-run' ? '(dry run - hooks not configured)' : ''}`);
      } else {
        alert(`Failed to send: ${result.error}`);
      }
    } catch (e) {
      console.error('Kick error:', e);
      alert('Failed to send to Rocket');
    }
  }

  // Filter PRs
  const filteredPRs = prs.filter(pr => {
    if (filter === 'needs-action') {
      return pr.owner === 'dustin' || pr.reviewState === 'changes_requested';
    }
    if (filter === 'ready') {
      return pr.reviewState === 'approved' && pr.ci === 'passing';
    }
    return true;
  });

  // Compute stats
  const stats = {
    total: prs.length,
    readyToMerge: prs.filter(p => p.reviewState === 'approved' && p.ci === 'passing').length,
    blocked: prs.filter(p => p.ci === 'failed' || p.reviewState === 'changes_requested').length,
  };

  return (
    <div className={cn('bg-card border border-border rounded-lg overflow-hidden', className)}>
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitPullRequest className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">PR Queue</h2>
          <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
            {stats.total}
          </span>
          {stats.readyToMerge > 0 && (
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
              {stats.readyToMerge} ready
            </span>
          )}
          {stats.blocked > 0 && (
            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
              {stats.blocked} blocked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select 
            className="text-xs bg-accent border border-border rounded px-2 py-1"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">All PRs</option>
            <option value="needs-action">Needs Action</option>
            <option value="ready">Ready to Merge</option>
          </select>
          <button 
            onClick={fetchPRs} 
            className="p-1.5 hover:bg-accent rounded"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>
      
      <div className="p-2 max-h-[400px] overflow-y-auto">
        {loading && prs.length === 0 ? (
          <div className="p-4 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading PRs...</span>
          </div>
        ) : error && prs.length === 0 ? (
          <div className="p-4 text-sm text-red-400 text-center">{error}</div>
        ) : filteredPRs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            No PRs match this filter
          </div>
        ) : (
          filteredPRs.map((pr) => (
            <PRRow key={pr.id} pr={pr} onKick={handleKick} />
          ))
        )}
      </div>
    </div>
  );
}
