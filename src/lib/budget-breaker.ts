/**
 * @module budget-breaker
 * @description
 * Budget circuit breaker — auto-pause agents exceeding token/cost limits (US-502).
 *
 * Rules:
 *   - Each agent has a configurable daily token limit (stored in Agent model or config)
 *   - At 80% usage → log a warning
 *   - At 100% usage → auto-pause agent + send P1 alert
 *   - Dustin can override (increase limit or resume) from War Room
 *
 * Token usage is calculated from AgentSession records within the current day.
 *
 * Called during the orchestrator tick, before waking an agent.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

/** Default daily token limit if none configured per-agent */
const DEFAULT_DAILY_LIMIT = 1_000_000;

/** Warning threshold (80% of limit) */
const WARNING_THRESHOLD = 0.8;

export interface BudgetCheckResult {
  agentId: string;
  dailyTokens: number;
  limit: number;
  percentUsed: number;
  status: 'ok' | 'warning' | 'breaker_tripped';
  paused: boolean;
}

/**
 * Check an agent's daily token usage against their budget.
 * Returns the check result. If the breaker trips, the agent is auto-paused.
 */
export async function checkAgentBudget(
  agentId: string,
  dailyLimitOverride?: number,
  db: PrismaClient = defaultPrisma,
): Promise<BudgetCheckResult> {
  // Calculate start of current UTC day
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  // Sum tokens from today's sessions
  const sessions = await db.agentSession.findMany({
    where: {
      agentId,
      startedAt: { gte: startOfDay },
    },
    select: { tokensSent: true, tokensRecv: true },
  });

  const dailyTokens = sessions.reduce(
    (sum, s) => sum + (s.tokensSent || 0) + (s.tokensRecv || 0),
    0,
  );

  const limit = dailyLimitOverride ?? DEFAULT_DAILY_LIMIT;
  const percentUsed = limit > 0 ? (dailyTokens / limit) * 100 : 0;

  // Under warning threshold — all good
  if (percentUsed < WARNING_THRESHOLD * 100) {
    return {
      agentId,
      dailyTokens,
      limit,
      percentUsed: Math.round(percentUsed),
      status: 'ok',
      paused: false,
    };
  }

  // Between 80-100% — warning
  if (percentUsed < 100) {
    console.warn(
      `[BudgetBreaker] Agent ${agentId} at ${Math.round(percentUsed)}% of daily token limit (${dailyTokens}/${limit})`,
    );

    return {
      agentId,
      dailyTokens,
      limit,
      percentUsed: Math.round(percentUsed),
      status: 'warning',
      paused: false,
    };
  }

  // 100%+ — trip the circuit breaker
  console.warn(
    `[BudgetBreaker] TRIPPED for agent ${agentId}: ${dailyTokens} tokens exceeds limit of ${limit}`,
  );

  let paused = false;

  try {
    // Auto-pause the agent
    await db.agent.update({
      where: { id: agentId },
      data: { status: 'paused' },
    });
    paused = true;

    // Create P1 escalation
    await db.escalation.create({
      data: {
        fromAgentId: agentId,
        severity: 'critical',
        category: 'budget',
        title: `Budget breaker: ${agentId} exceeded daily token limit`,
        description: `Agent used ${dailyTokens.toLocaleString()} tokens today (limit: ${limit.toLocaleString()}). Auto-paused to prevent further API spend. Resume from War Room after reviewing usage.`,
      },
    });

    // Recovery log
    await db.recoveryLog.create({
      data: {
        agentId,
        trigger: 'token_burn',
        action: 'auto_pause',
        outcome: 'success',
        details: { dailyTokens, limit, percentUsed: Math.round(percentUsed) },
      },
    });
  } catch (err) {
    console.warn(`[BudgetBreaker] Failed to pause agent ${agentId}:`, err);
  }

  return {
    agentId,
    dailyTokens,
    limit,
    percentUsed: Math.round(percentUsed),
    status: 'breaker_tripped',
    paused,
  };
}

/**
 * Check budgets for all active agents. Used by the orchestrator tick.
 */
export async function checkAllBudgets(
  db: PrismaClient = defaultPrisma,
): Promise<BudgetCheckResult[]> {
  const agents = await db.agent.findMany({
    where: { status: 'active' },
    select: { id: true },
  });

  const results: BudgetCheckResult[] = [];
  for (const agent of agents) {
    try {
      const result = await checkAgentBudget(agent.id, undefined, db);
      results.push(result);
    } catch (err) {
      console.warn(`[BudgetBreaker] Check failed for ${agent.id}:`, err);
    }
  }

  return results;
}
