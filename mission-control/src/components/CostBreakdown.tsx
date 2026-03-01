'use client';

import { Calculator, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostEntry {
  id: string;
  date: string;
  service: string;
  amount: number;
  category: string;
  notes: string | null;
  source: string;
  recurring: boolean;
}

interface CostData {
  total: number;
  fixedCosts: number;
  dynamicCosts: number;
  breakdown: Array<{
    service: string;
    amount: number;
    category: string;
    notes: string | null;
    source: string;
    recurring: boolean;
  }>;
  mrr: number;
  totalUsers: number;
  totalTraffic: number;
  runway: number | null;
  history: CostEntry[];
}

const categoryConfig: Record<string, { label: string; color: string; emoji: string }> = {
  infra: { label: 'Infrastructure', color: 'text-blue-400', emoji: '🏗️' },
  ai: { label: 'AI / LLMs', color: 'text-violet-400', emoji: '🤖' },
  tools: { label: 'Dev Tools', color: 'text-emerald-400', emoji: '🔧' },
  saas: { label: 'SaaS', color: 'text-amber-400', emoji: '☁️' },
  other: { label: 'Other', color: 'text-gray-400', emoji: '📦' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CostBreakdown({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add/Edit form state
  const [newService, setNewService] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState('infra');
  const [newNotes, setNewNotes] = useState('');
  const [newRecurring, setNewRecurring] = useState(true);

  const fetchData = () => {
    setLoading(true);
    fetch('/api/costs')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleAdd = async () => {
    if (!newService || !newAmount) return;
    await fetch('/api/costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: newService,
        amount: parseFloat(newAmount),
        category: newCategory,
        notes: newNotes || null,
        recurring: newRecurring,
      }),
    });
    setNewService('');
    setNewAmount('');
    setNewNotes('');
    setShowAddForm(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/costs?id=${id}`, { method: 'DELETE' });
    fetchData();
  };

  const startEdit = (entry: CostEntry) => {
    setEditingId(entry.id);
    setNewService(entry.service);
    setNewAmount(String(entry.amount));
    setNewCategory(entry.category);
    setNewNotes(entry.notes || '');
    setNewRecurring(entry.recurring);
    setShowAddForm(false);
  };

  const handleEdit = async () => {
    if (!editingId || !newService || !newAmount) return;
    await fetch('/api/costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingId,
        service: newService,
        amount: parseFloat(newAmount),
        category: newCategory,
        notes: newNotes || null,
        recurring: newRecurring,
      }),
    });
    cancelEdit();
    fetchData();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNewService('');
    setNewAmount('');
    setNewNotes('');
  };

  // Group breakdown by category
  const grouped = data?.breakdown.reduce((acc, item) => {
    const cat = item.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, typeof data.breakdown>) ?? {};

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="glass-card w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-red-400" />
            <h2 className="font-semibold text-lg">Cost Ledger</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading costs...</div>
        ) : data ? (
          <div className="overflow-y-auto flex-1 p-4 space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="glass-card p-3 text-center">
                <div className="text-xl font-bold font-mono text-red-400">
                  ${data.total.toFixed(2)}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">Burn/mo</div>
              </div>
              <div className="glass-card p-3 text-center">
                <div className="text-xl font-bold font-mono text-emerald-400">
                  ${data.mrr.toFixed(2)}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">MRR</div>
              </div>
              <div className="glass-card p-3 text-center">
                <div className={cn(
                  'text-xl font-bold font-mono',
                  data.mrr >= data.total ? 'text-emerald-400' : 'text-orange-400',
                )}>
                  {data.mrr >= data.total ? '∞' : data.runway !== null ? `${data.runway}mo` : '—'}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">Runway</div>
              </div>
            </div>

            {/* Category Breakdown */}
            {Object.entries(grouped).map(([cat, items]) => {
              const cfg = categoryConfig[cat] || categoryConfig.other;
              const catTotal = items.reduce((s, i) => s + i.amount, 0);
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between text-xs px-1">
                    <span className={cn('font-semibold uppercase tracking-wider', cfg.color)}>
                      {cfg.emoji} {cfg.label}
                    </span>
                    <span className="font-mono text-muted-foreground">${catTotal.toFixed(2)}</span>
                  </div>
                  {items.map((item, i) => (
                    <div key={i} className="glass-card px-3 py-2 flex items-center justify-between group">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{item.service}</div>
                        {item.notes && (
                          <div className="text-[10px] text-muted-foreground truncate">{item.notes}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded',
                          item.source === 'manual'
                            ? 'bg-card/50 text-muted-foreground'
                            : 'bg-blue-500/10 text-blue-400',
                        )}>
                          {item.source === 'manual' ? 'manual' : 'auto'}
                        </span>
                        <span className="font-mono text-sm font-semibold w-16 text-right">
                          ${item.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Ledger History — editable */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs px-1">
                <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                  📒 Ledger Entries
                </span>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add Cost
                </button>
              </div>

              {/* Add form */}
              {showAddForm && (
                <div className="glass-card p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Service name"
                      value={newService}
                      onChange={e => setNewService(e.target.value)}
                      className="bg-card/50 border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="$/month"
                      value={newAmount}
                      onChange={e => setNewAmount(e.target.value)}
                      className="bg-card/50 border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                      className="bg-card/50 border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    >
                      {Object.entries(categoryConfig).map(([k, v]) => (
                        <option key={k} value={k}>{v.emoji} {v.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Notes (optional)"
                      value={newNotes}
                      onChange={e => setNewNotes(e.target.value)}
                      className="bg-card/50 border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newRecurring}
                        onChange={e => setNewRecurring(e.target.checked)}
                        className="rounded"
                      />
                      Recurring monthly
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowAddForm(false)}
                        className="text-xs px-3 py-1 rounded bg-card/50 hover:bg-accent"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleAdd}
                        disabled={!newService || !newAmount}
                        className="text-xs px-3 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Existing entries */}
              {data.history.map(entry => (
                <div key={entry.id}>
                  {editingId === entry.id ? (
                    <div className="glass-card p-3 space-y-2 ring-1 ring-blue-500/30">
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" value={newService} onChange={e => setNewService(e.target.value)}
                          className="bg-card/50 border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
                        <input type="number" step="0.01" value={newAmount} onChange={e => setNewAmount(e.target.value)}
                          className="bg-card/50 border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                          className="bg-card/50 border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500">
                          {Object.entries(categoryConfig).map(([k, v]) => (
                            <option key={k} value={k}>{v.emoji} {v.label}</option>
                          ))}
                        </select>
                        <input type="text" placeholder="Notes (optional)" value={newNotes} onChange={e => setNewNotes(e.target.value)}
                          className="bg-card/50 border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                          <input type="checkbox" checked={newRecurring} onChange={e => setNewRecurring(e.target.checked)} className="rounded" />
                          Recurring monthly
                        </label>
                        <div className="flex gap-2">
                          <button onClick={cancelEdit} className="text-xs px-3 py-1 rounded bg-card/50 hover:bg-accent">Cancel</button>
                          <button onClick={handleEdit} disabled={!newService || !newAmount}
                            className="text-xs px-3 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50">Save</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-card px-3 py-2 flex items-center justify-between group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{entry.service}</span>
                          <span className={cn(
                            'text-[9px] px-1 rounded',
                            entry.recurring ? 'bg-blue-500/10 text-blue-400' : 'bg-card/50 text-muted-foreground'
                          )}>
                            {entry.recurring ? 'recurring' : 'one-time'}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(entry.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                          {entry.notes ? ` · ${entry.notes}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="font-mono text-sm font-semibold">${entry.amount.toFixed(2)}</span>
                        <button
                          onClick={() => startEdit(entry)}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-blue-500/20 text-blue-400 transition-all"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-red-400">Failed to load cost data</div>
        )}
      </div>
    </div>
  );
}
