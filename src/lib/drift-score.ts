/**
 * @module drift-score
 * @description
 * Lightweight drift detection for autonomous agents.
 *
 * Three additive detectors, each contributing points to a 0-100 score:
 *
 * 1. Consecutive Failures — recent sessions all failed/timeout
 * 2. Journal Staleness    — no journal entry relative to heartbeat interval
 * 3. Token Burn           — high token usage with zero tool calls (spinning)
 *
 * Thresholds:
 *   0-30  → healthy (green)
 *   31-50 → warning (yellow)
 *   51-80 → elevated (orange)
 *   81+   → auto-pause (red) — requires 2+ concurrent problems
 *
 * Design informed by:
 * - Anthropic "Building Effective Agents": simplicity wins
 * - Atlas quarantine pattern: simple consecutive-failure detection
 * - SOTA: detection is cheaper than prevention; 3 cheap checks catch ~80% of drift
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

export interface DriftResult {
  score: number;
  signals: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours fallback
const TOKEN_BURN_THRESHOLD = 50_000; // tokens

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Calculate the drift score for an agent.
 *
 * Returns a score (0-100) and human-readable signal descriptions.
 * Accepts an optional PrismaClient for testing.
 */
export async function calculateDriftScore(
  agentId: string,
  db: PrismaClient = defaultPrisma,
): Promise<DriftResult> {
  let score = 0;
  const signals: string[] = [];

  // Run all three detectors in parallel
  const [failureResult, stalenessResult, tokenBurnResult] = await Promise.all([
    detectConsecutiveFailures(agentId, db),
    detectJournalStaleness(agentId, db),
    detectTokenBurn(agentId, db),
  ]);

  if (failureResult) {
    score += failureResult.points;
    signals.push(failureResult.signal);
  }

  if (stalenessResult) {
    score += stalenessResult.points;
    signals.push(stalenessResult.signal);
  }

  if (tokenBurnResult) {
    score += tokenBurnResult.points;
    signals.push(tokenBurnResult.signal);
  }

  return { score: Math.min(score, 100), signals };
}

// ---------------------------------------------------------------------------
// Detector 1: Consecutive Session Failures
// ---------------------------------------------------------------------------

interface DetectorResult {
  points: number;
  signal: string;
}

/**
 * Check the most recent sessions for consecutive failures.
 *
 * Points:
 *   1 failure  = +15
 *   2 failures = +30
 *   3+ failures = +50
 */
async function detectConsecutiveFailures(
  agentId: string,
  db: PrismaClient,
): Promise<DetectorResult | null> {
  const recentSessions = await db.agentSession.findMany({
    where: { agentId },
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: { status: true },
  });

  if (recentSessions.length === 0) return null;

  // Count consecutive failures from the most recent session
  let consecutiveFailures = 0;
  for (const session of recentSessions) {
    if (session.status === 'failed' || session.status === 'timeout') {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  if (consecutiveFailures === 0) return null;

  const points = consecutiveFailures >= 3 ? 50 : consecutiveFailures === 2 ? 30 : 15;

  return {
    points,
    signal: `${consecutiveFailures} consecutive session failure${consecutiveFailures > 1 ? 's' : ''}`,
  };
}

// ---------------------------------------------------------------------------
// Detector 2: Journal Staleness
// ---------------------------------------------------------------------------

/**
 * Check if the agent's last journal entry is stale relative to its heartbeat
 * interval. If no heartbeat schedule exists, uses a 2-hour fallback.
 *
 * Points: +30 if stale
 */
async function detectJournalStaleness(
  agentId: string,
  db: PrismaClient,
): Promise<DetectorResult | null> {
  // Get the latest journal entry
  const latestJournal = await db.agentJournal.findFirst({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  // No journal entry ever → not enough data to judge staleness
  if (!latestJournal) return null;

  // Get heartbeat schedule to determine expected interval
  const heartbeatSchedule = await db.schedule.findFirst({
    where: {
      agentId,
      type: 'heartbeat',
      enabled: true,
    },
    select: { intervalMs: true, cronExpr: true },
  });

  // Determine the stale threshold: 3× heartbeat interval, or 2h fallback
  let staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS;
  if (heartbeatSchedule?.intervalMs) {
    staleThresholdMs = heartbeatSchedule.intervalMs * 3;
  }

  const timeSinceJournal = Date.now() - latestJournal.createdAt.getTime();

  if (timeSinceJournal <= staleThresholdMs) return null;

  const hoursStale = (timeSinceJournal / (60 * 60 * 1000)).toFixed(1);

  return {
    points: 30,
    signal: `No journal entry in ${hoursStale} hours`,
  };
}

// ---------------------------------------------------------------------------
// Detector 3: Token Burn (spinning detection)
// ---------------------------------------------------------------------------

/**
 * Check if the most recent session burned a lot of tokens with zero tool calls.
 * This catches agents that are "spinning" — generating output but not taking
 * any actions.
 *
 * Points: +30 if detected
 */
async function detectTokenBurn(
  agentId: string,
  db: PrismaClient,
): Promise<DetectorResult | null> {
  const lastSession = await db.agentSession.findFirst({
    where: { agentId },
    orderBy: { startedAt: 'desc' },
    select: { tokensSent: true, tokensRecv: true, toolCalls: true },
  });

  if (!lastSession) return null;

  const totalTokens = lastSession.tokensSent + lastSession.tokensRecv;

  if (totalTokens > TOKEN_BURN_THRESHOLD && lastSession.toolCalls === 0) {
    const tokensK = Math.round(totalTokens / 1000);
    return {
      points: 30,
      signal: `Last session burned ${tokensK}k tokens with 0 tool calls`,
    };
  }

  return null;
}
