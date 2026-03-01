/**
 * @module carplay-home
 * @description
 * Home screen data aggregator for CarPlay.
 *
 * Produces a glanceable, car-safe data payload by aggregating fleet health,
 * MRR gauge, burning tasks, PR/CI status, latest Rocket digest, and top
 * project cards from existing Mission Control data sources.
 *
 * Includes a 30-second in-memory cache to keep CarPlay latency <2s while
 * background-refreshing data.
 */

import type { CarPlayHomeData } from '@/types/carplay';
import { calculateBurnRate } from './burn-rate';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// In-memory cache (30s TTL)
// ---------------------------------------------------------------------------

let cachedData: CarPlayHomeData | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getCarPlayHome(): Promise<CarPlayHomeData> {
  if (cachedData && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedData;
  }

  const data = await buildHomeData();
  cachedData = data;
  cachedAt = Date.now();
  return data;
}

/** Returns how old the cache is in seconds (for X-Cache-Age header). */
export function getCacheAge(): number {
  return cachedData ? Math.round((Date.now() - cachedAt) / 1000) : -1;
}

// ---------------------------------------------------------------------------
// Data assembly
// ---------------------------------------------------------------------------

async function buildHomeData(): Promise<CarPlayHomeData> {
  const [burnRate, fleet, projects, burningTasks, rocketDigest] =
    await Promise.all([
      calculateBurnRate(),
      buildFleetHealth(),
      buildTopProjects(),
      buildBurningTasks(),
      getLatestRocketDigest(),
    ]);

  // PR/CI status from pipeline gates
  const prCiStatus = await buildPrCiStatus();

  // MRR gauge with log-scale
  const mrrGauge = {
    current: burnRate.mrr,
    burnRate: burnRate.total,
    runway: burnRate.runway,
    logScalePercent: mrrToLogPercent(burnRate.mrr),
  };

  return {
    rocketDigest,
    topProjects: projects,
    fleetHealth: fleet,
    burningTasks,
    prCiStatus,
    mrrGauge,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fleet health (reuses dashboard pattern lines 96-143)
// ---------------------------------------------------------------------------

async function buildFleetHealth() {
  const agents = await prisma.agent.findMany();
  const latestJournals = await prisma.agentJournal.findMany({
    where: { agentId: { in: agents.map((a) => a.id) } },
    orderBy: { createdAt: 'desc' },
    distinct: ['agentId'],
  });
  const journalMap = new Map(latestJournals.map((j) => [j.agentId, j]));

  let active = 0;
  let blocked = 0;

  for (const agent of agents) {
    const journal = journalMap.get(agent.id);
    if (journal) {
      const age = Date.now() - journal.createdAt.getTime();
      if (age < 7_200_000) {
        // Within 2h
        if (journal.status === 'healthy') active++;
        else if (journal.status === 'blocked') blocked++;
        else active++; // idle/error still counts as active
      }
    } else if (agent.lastHeartbeat) {
      const diff = Date.now() - agent.lastHeartbeat.getTime();
      if (diff < 86_400_000) active++;
    }
  }

  const healthColor =
    blocked > 0 ? 'red' : active === 0 ? 'yellow' : 'green';

  return {
    active,
    total: agents.length,
    blocked,
    healthColor: healthColor as 'green' | 'yellow' | 'red',
  };
}

// ---------------------------------------------------------------------------
// Top 3 projects
// ---------------------------------------------------------------------------

async function buildTopProjects() {
  const projects = await prisma.project.findMany({
    where: { stage: { in: ['building', 'beta', 'launched'] } },
    include: {
      tasks: {
        where: { status: { notIn: ['done'] } },
      },
      checkpoints: {
        where: { status: { in: ['fail', 'blocked'] } },
      },
    },
    take: 3,
    orderBy: { updatedAt: 'desc' },
  });

  return projects.map((p) => {
    const blockersCount = p.checkpoints.length;
    const hasCriticalTask = p.tasks.some((t) => t.priority === 'critical');

    let statusColor: 'green' | 'yellow' | 'red' | 'gray' = 'green';
    if (blockersCount > 0) statusColor = 'red';
    else if (hasCriticalTask) statusColor = 'yellow';
    else if (p.stage === 'building') statusColor = 'yellow';

    // Next action: first pending task title, or stage name
    const nextTask = p.tasks.find(
      (t) => t.status === 'todo' || t.status === 'in_progress'
    );

    return {
      id: p.id,
      name: p.name,
      statusColor,
      nextAction: nextTask?.title ?? `Stage: ${p.stage}`,
      blockersCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Burning tasks (critical + high priority, not done)
// ---------------------------------------------------------------------------

async function buildBurningTasks() {
  const tasks = await prisma.task.findMany({
    where: {
      priority: { in: ['critical', 'high'] },
      status: { notIn: ['done'] },
    },
    include: { project: true },
    orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    take: 5,
  });

  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    projectName: t.project?.name ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Latest Rocket digest from MessageLog
// ---------------------------------------------------------------------------

async function getLatestRocketDigest(): Promise<string | null> {
  // Check for carplay-formatted responses first
  const carplayMsg = await prisma.messageLog.findFirst({
    where: {
      fromId: 'rocket',
      channel: { in: ['carplay', 'kick'] },
    },
    orderBy: { sentAt: 'desc' },
  });

  if (carplayMsg) {
    // Check metadata for carplay_digest
    const meta = carplayMsg.metadata as Record<string, unknown> | null;
    if (meta?.carplay_digest && typeof meta.carplay_digest === 'string') {
      return meta.carplay_digest;
    }
    // Fallback: truncate body
    return carplayMsg.body.length > 480
      ? carplayMsg.body.slice(0, 477) + '...'
      : carplayMsg.body;
  }

  // Fall back to any recent Rocket message
  const anyMsg = await prisma.messageLog.findFirst({
    where: { fromId: 'rocket' },
    orderBy: { sentAt: 'desc' },
  });

  if (anyMsg) {
    return anyMsg.body.length > 480
      ? anyMsg.body.slice(0, 477) + '...'
      : anyMsg.body;
  }

  return null;
}

// ---------------------------------------------------------------------------
// PR/CI status from pipelines
// ---------------------------------------------------------------------------

async function buildPrCiStatus() {
  const pipelines = await prisma.pipeline.findMany({
    where: {
      stage: { in: ['development', 'staging', 'production'] },
    },
  });

  let passing = 0;
  let failing = 0;
  let pending = 0;

  for (const pl of pipelines) {
    if (pl.status === 'passing') passing++;
    else if (pl.status === 'failing') failing++;
    else pending++;
  }

  return {
    total: pipelines.length,
    passing,
    failing,
    pending,
  };
}

// ---------------------------------------------------------------------------
// MRR log-scale calculation
// ---------------------------------------------------------------------------

/**
 * Convert MRR to a 0-100 percentage on a log10 scale.
 * Scale: $0 = 0%, $10 = ~17%, $100 = ~33%, $1k = ~50%, $10k = ~67%, $100k = ~83%, $1M = 100%
 */
function mrrToLogPercent(mrr: number): number {
  if (mrr <= 0) return 0;
  // log10(1M) = 6, so we normalize to 6 decades
  const logVal = Math.log10(mrr);
  const percent = (logVal / 6) * 100;
  return Math.min(100, Math.max(0, Math.round(percent * 10) / 10));
}
