/**
 * @module burn-rate
 * @description
 * Hybrid burn-rate calculator.
 *
 * Two sources:
 *   1. CostEntry table  — manual ledger (date, service, amount, category, notes)
 *   2. stats.json files — auto-gathered per-agent costs from workspace dirs
 *
 * The calculator reads both sources, deduplicates, and returns a monthly
 * burn rate with full breakdown.
 */

import { prisma } from '@/lib/prisma';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

import { getOpenClawHome } from './config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostLineItem {
  service: string;
  amount: number;
  category: string;
  notes: string | null;
  source: 'manual' | 'auto:stats' | 'auto:github';
  recurring: boolean;
}

export interface AgentCostSummary {
  agentId: string;
  cost: number;
  traffic: number;
  users: number;
  mrr: number;
}

export interface BurnRateResult {
  total: number;          // Total monthly burn rate
  fixedCosts: number;     // Sum of recurring CostEntry items
  dynamicCosts: number;   // Sum from stats.json agent costs
  breakdown: CostLineItem[];
  agentCosts: AgentCostSummary[];
  mrr: number;            // Total MRR across all agents
  totalUsers: number;     // Total users across all agents
  totalTraffic: number;   // Total traffic across all agents
  runway: number | null;  // Months of runway (null = infinite / MRR > burn)
}

// Default fixed costs to seed when the CostEntry table is empty.
// These are initial values — edit via Mission Control UI or directly in DB.
export const DEFAULT_FIXED_COSTS: Array<{
  service: string;
  amount: number;
  category: string;
  notes: string;
}> = [
    { service: 'Hetzner VPS', amount: 6.29, category: 'infra', notes: 'Server srv1313394, Ubuntu 24.04' },
    { service: 'Railway Postgres', amount: 5.00, category: 'infra', notes: 'Mission Control database' },
    { service: 'Cloudflare', amount: 0, category: 'infra', notes: 'Free tier — DNS for neg0.cloud' },
    { service: 'Tailscale', amount: 0, category: 'infra', notes: 'Free personal plan (3 devices)' },
    { service: 'GitHub', amount: 0, category: 'tools', notes: 'Free tier — update if Pro' },
    { service: 'Gemini API', amount: 0, category: 'ai', notes: 'Free tier — track when costs begin' },
    { service: 'Domains', amount: 2.00, category: 'infra', notes: 'neg0.cloud — estimate' },
  ];

// ---------------------------------------------------------------------------
// Auto-gather: Read stats.json from all agent workspaces
// ---------------------------------------------------------------------------

async function readAgentStats(): Promise<AgentCostSummary[]> {
  const results: AgentCostSummary[] = [];
  const OPENCLAW_ROOT = getOpenClawHome();

  try {
    const entries = await readdir(OPENCLAW_ROOT);
    const workspaceDirs = entries.filter(e => e.startsWith('workspace-'));

    for (const dir of workspaceDirs) {
      const agentId = dir.replace('workspace-', '');
      const statsPath = join(OPENCLAW_ROOT, dir, 'stats.json');

      try {
        const raw = await readFile(statsPath, 'utf-8');
        const stats = JSON.parse(raw);
        results.push({
          agentId,
          cost: stats.cost ?? 0,
          traffic: stats.traffic ?? 0,
          users: stats.users ?? 0,
          mrr: stats.mrr ?? 0,
        });
      } catch {
        // No stats.json for this agent — skip
      }

      // Also check subdirs (e.g., workspace-rocket/ric-flare)
      try {
        const subEntries = await readdir(join(OPENCLAW_ROOT, dir));
        for (const sub of subEntries) {
          const subStatsPath = join(OPENCLAW_ROOT, dir, sub, 'stats.json');
          try {
            const raw = await readFile(subStatsPath, 'utf-8');
            const stats = JSON.parse(raw);
            if (stats.cost || stats.traffic || stats.users || stats.mrr) {
              results.push({
                agentId: sub,
                cost: stats.cost ?? 0,
                traffic: stats.traffic ?? 0,
                users: stats.users ?? 0,
                mrr: stats.mrr ?? 0,
              });
            }
          } catch {
            // Not a workspace subdir or no stats.json
          }
        }
      } catch {
        // Can't read subdir
      }
    }
  } catch (e) {
    console.error('[burn-rate] Failed to read workspaces:', e);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Manual Ledger: Read from CostEntry table
// ---------------------------------------------------------------------------

async function getManualCosts(): Promise<CostLineItem[]> {
  // Get the most recent entry per service (latest month's data)
  const entries = await prisma.costEntry.findMany({
    orderBy: { date: 'desc' },
    distinct: ['service'],
  });

  return entries.map(e => ({
    service: e.service,
    amount: e.amount,
    category: e.category,
    notes: e.notes,
    source: e.source as CostLineItem['source'],
    recurring: e.recurring,
  }));
}

// ---------------------------------------------------------------------------
// Seed: Populate initial costs if table is empty
// ---------------------------------------------------------------------------

export async function seedDefaultCosts(): Promise<number> {
  const count = await prisma.costEntry.count();
  if (count > 0) return 0;

  const now = new Date();
  // Set to first of current month for clean monthly tracking
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let created = 0;
  for (const cost of DEFAULT_FIXED_COSTS) {
    await prisma.costEntry.create({
      data: {
        date: monthStart,
        service: cost.service,
        amount: cost.amount,
        category: cost.category,
        notes: cost.notes,
        source: 'manual',
        recurring: true,
      },
    });
    created++;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Main Calculator
// ---------------------------------------------------------------------------

export async function calculateBurnRate(): Promise<BurnRateResult> {
  // 1. Auto-seed if empty
  await seedDefaultCosts();

  // 2. Get manual ledger costs
  const manualCosts = await getManualCosts();
  const fixedTotal = manualCosts
    .filter(c => c.recurring)
    .reduce((sum, c) => sum + c.amount, 0);

  // 3. Get auto-gathered agent costs
  const agentCosts = await readAgentStats();
  const dynamicTotal = agentCosts.reduce((sum, a) => sum + a.cost, 0);

  // 4. Aggregate stats
  const totalMrr = agentCosts.reduce((sum, a) => sum + a.mrr, 0);
  const totalUsers = agentCosts.reduce((sum, a) => sum + a.users, 0);
  const totalTraffic = agentCosts.reduce((sum, a) => sum + a.traffic, 0);

  // Also check DB metrics for MRR (from Metric table)
  const dbMrr = await prisma.metric.findFirst({
    where: { type: 'mrr' },
    orderBy: { recordedAt: 'desc' },
  });
  const effectiveMrr = Math.max(totalMrr, dbMrr?.value ?? 0);

  // 5. Build breakdown
  const breakdown: CostLineItem[] = [
    ...manualCosts,
    ...agentCosts
      .filter(a => a.cost > 0)
      .map(a => ({
        service: `Agent: ${a.agentId}`,
        amount: a.cost,
        category: 'ai' as const,
        notes: `Auto-gathered from stats.json`,
        source: 'auto:stats' as const,
        recurring: false,
      })),
  ];

  // 6. Total burn
  const total = fixedTotal + dynamicTotal;

  // 7. Runway
  const runway = effectiveMrr > total ? null : (total > 0 ? 0 : null);
  // Note: Without a cash balance, runway is either "infinite" (MRR covers burn)
  // or we just show the burn rate. True runway needs a balance input.

  return {
    total,
    fixedCosts: fixedTotal,
    dynamicCosts: dynamicTotal,
    breakdown,
    agentCosts,
    mrr: effectiveMrr,
    totalUsers,
    totalTraffic,
    runway,
  };
}
