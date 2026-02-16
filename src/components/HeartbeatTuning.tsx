'use client';

import {
  Eye,
  FileText,
  Loader2,
  Minus,
  Plus,
  Save,
  Zap
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeartbeatTuningConfig {
  journalEntries: number;
  mdInjections: string[];
}

interface PreviewResult {
  agentId: string;
  scheduleName: string;
  message: string;
  tokens: number;
  characters: number;
  journalEntries: number;
  mdInjections: string[];
}

// ---------------------------------------------------------------------------
// Emoji map for agents
// ---------------------------------------------------------------------------
const AGENT_EMOJIS: Record<string, string> = {
  rocket: '🚀', captain: '🚢', warden: '🛡️', architect: '🏗️',
  envoy: '🕊️', gardener: '🌿', closer: '🤝', sarge: '🪖',
  accountant: '💼', prospector: '⛏️', refiner: '🔬', scribe: '📝',
};

// ---------------------------------------------------------------------------
// Token cost thresholds for color coding
// ---------------------------------------------------------------------------
function tokenColor(tokens: number): string {
  if (tokens < 500) return 'text-emerald-400';
  if (tokens < 1500) return 'text-yellow-400';
  if (tokens < 3000) return 'text-orange-400';
  return 'text-red-400';
}

function tokenBgColor(tokens: number): string {
  if (tokens < 500) return 'bg-emerald-500/15';
  if (tokens < 1500) return 'bg-yellow-500/15';
  if (tokens < 3000) return 'bg-orange-500/15';
  return 'bg-red-500/15';
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function HeartbeatTuning({
  agents,
  config,
  onSave,
  saving,
}: {
  agents: { id: string; role: string }[];
  config: HeartbeatTuningConfig;
  onSave: (updates: { journalEntries?: number; mdInjections?: string[] }) => void;
  saving: boolean;
}) {
  const [journalEntries, setJournalEntries] = useState(config.journalEntries);
  const [mdInjections, setMdInjections] = useState<string[]>(config.mdInjections);
  const [newMdPath, setNewMdPath] = useState('');
  const [previewAgent, setPreviewAgent] = useState(agents[0]?.id || '');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Sync state when config changes externally
  useEffect(() => {
    setJournalEntries(config.journalEntries);
    setMdInjections(config.mdInjections);
  }, [config.journalEntries, config.mdInjections]);

  const dirty =
    journalEntries !== config.journalEntries ||
    JSON.stringify(mdInjections) !== JSON.stringify(config.mdInjections);

  // Fetch preview
  const fetchPreview = useCallback(async (agentId: string) => {
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({
        agentId,
        scheduleName: 'Heartbeat',
        journalEntries: journalEntries.toString(),
      });
      if (mdInjections.length > 0) {
        params.set('mdInjections', mdInjections.join(','));
      }
      const res = await fetch(`/api/heartbeat-preview?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
      }
    } catch (e) {
      console.error('Preview failed:', e);
    } finally {
      setPreviewLoading(false);
    }
  }, [journalEntries, mdInjections]);

  const handlePreviewClick = () => {
    if (showPreview && preview?.agentId === previewAgent) {
      setShowPreview(false);
    } else {
      setShowPreview(true);
      fetchPreview(previewAgent);
    }
  };

  return (
    <div className="space-y-4">
      {/* --- Journal Entries Slider --- */}
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">
          Journal Entries in Context
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setJournalEntries(Math.max(0, journalEntries - 1))}
            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 border border-border hover:border-zinc-600 transition-colors"
          >
            <Minus className="w-3 h-3 text-zinc-400" />
          </button>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={20}
              value={journalEntries}
              onChange={e => setJournalEntries(parseInt(e.target.value))}
              className="w-32 accent-blue-500"
            />
            <span className="text-sm text-zinc-200 font-mono w-8 text-center">{journalEntries}</span>
          </div>
          <button
            onClick={() => setJournalEntries(Math.min(20, journalEntries + 1))}
            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 border border-border hover:border-zinc-600 transition-colors"
          >
            <Plus className="w-3 h-3 text-zinc-400" />
          </button>
          <span className="text-[10px] text-zinc-600">recent entries per agent</span>
        </div>
      </div>

      {/* --- Markdown File Injections --- */}
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1.5">
          <FileText className="w-3 h-3 inline mr-1" />
          Markdown Injections
        </label>
        <p className="text-[10px] text-zinc-600 mb-2">
          Inject markdown files into every heartbeat context (playbooks, SOPs, etc.)
        </p>
        {mdInjections.length > 0 && (
          <div className="space-y-1 mb-2">
            {mdInjections.map((path, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <code className="flex-1 text-zinc-400 bg-zinc-800/50 px-2 py-1 rounded truncate">
                  {path}
                </code>
                <button
                  onClick={() => setMdInjections(mdInjections.filter((_, j) => j !== i))}
                  className="text-red-400/60 hover:text-red-400 transition-colors text-[10px]"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMdPath}
            onChange={e => setNewMdPath(e.target.value)}
            placeholder="/path/to/PLAYBOOK.md"
            className="flex-1 bg-zinc-800 border border-border rounded px-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-600"
          />
          <button
            onClick={() => {
              if (newMdPath.trim()) {
                setMdInjections([...mdInjections, newMdPath.trim()]);
                setNewMdPath('');
              }
            }}
            disabled={!newMdPath.trim()}
            className="flex items-center gap-1 px-2 py-1.5 text-[10px] rounded bg-zinc-700 text-zinc-300 font-medium hover:bg-zinc-600 transition-colors disabled:opacity-30"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {/* --- Save + Preview Row --- */}
      <div className="flex items-center gap-2 flex-wrap">
        {dirty && (
          <button
            onClick={() => onSave({ journalEntries, mdInjections })}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-600 text-white font-medium hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save Changes
          </button>
        )}

        {/* Preview selector + button */}
        <div className="flex items-center gap-2 ml-auto">
          <select
            value={previewAgent}
            onChange={e => {
              setPreviewAgent(e.target.value);
              if (showPreview) fetchPreview(e.target.value);
            }}
            className="bg-zinc-800 border border-border rounded px-2 py-1.5 text-xs text-zinc-300"
          >
            {agents.map(a => (
              <option key={a.id} value={a.id}>
                {AGENT_EMOJIS[a.id] || '🤖'} {a.id}
              </option>
            ))}
          </select>
          <button
            onClick={handlePreviewClick}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded border border-border/40 text-zinc-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-colors"
          >
            {previewLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            {showPreview ? 'Hide Preview' : 'Preview Wake'}
          </button>
        </div>
      </div>

      {/* --- Wake Message Preview --- */}
      {showPreview && preview && (
        <div className="border border-border/30 rounded-lg overflow-hidden">
          {/* Preview header with stats */}
          <div className="flex items-center gap-3 px-4 py-2 bg-zinc-800/50 border-b border-border/20">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
              Wake Message Preview
            </span>
            <div className="ml-auto flex items-center gap-3">
              <span className={cn(
                'text-[10px] px-2 py-0.5 rounded-full font-mono font-medium',
                tokenBgColor(preview.tokens),
                tokenColor(preview.tokens)
              )}>
                ~{preview.tokens.toLocaleString()} tokens
              </span>
              <span className="text-[10px] text-zinc-600 font-mono">
                {preview.characters.toLocaleString()} chars
              </span>
            </div>
          </div>

          {/* The actual message */}
          <pre className="px-4 py-3 text-[11px] text-zinc-300 bg-zinc-900/80 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[400px] overflow-y-auto">
            {preview.message}
          </pre>

          {/* Token cost estimation */}
          <div className="flex items-center gap-3 px-4 py-2 bg-zinc-800/30 border-t border-border/20 text-[10px] text-zinc-600">
            <Zap className="w-3 h-3" />
            <span>
              Est. cost per wake: ~${((preview.tokens / 1000) * 0.003).toFixed(4)} (input) + output tokens
            </span>
            <span className="ml-auto">
              {journalEntries} journal entries · {mdInjections.length} file injection{mdInjections.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
