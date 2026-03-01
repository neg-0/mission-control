/**
 * @module api/orchestrator/tick
 * @description
 * HTTP interface for the orchestrator tick cycle. The core logic lives in
 * {@link module:orchestrator-tick} (`executeTick()`) and is shared with the
 * internal `setInterval` timer.
 *
 * Each tick:
 * 1. Loads `OrchestratorConfig` to check if enabled
 * 2. Queries due heartbeat schedules (`enabled=true`, `nextRunAt <= now`)
 * 3. Enforces `maxWakesPerTick` — excess schedules wait for the next tick
 * 4. Wakes agents via OpenClaw `/hooks/agent` with stagger delay between each
 * 5. Logs each wake to `MessageLog` for audit trail
 * 6. Recalculates `nextRunAt` for each processed schedule
 *
 * **Endpoints:**
 * - `POST /api/orchestrator/tick` — Manually trigger one tick cycle
 * - `GET  /api/orchestrator/tick` — Lightweight orchestrator status
 *
 * @see {@link module:orchestrator-tick} for the shared `executeTick()` logic
 * @see {@link module:api/heartbeat/status} for the full dashboard endpoint
 */

import { executeTick } from '@/lib/orchestrator-tick';
import { getTimerStatus, startTimer } from '@/lib/orchestrator-timer';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/orchestrator/tick
 *
 * Manually triggers one tick of the scheduling loop. Useful for testing or
 * as an external cron fallback. The internal timer calls `executeTick()`
 * directly (bypassing HTTP) for better performance.
 *
 * No request body is needed.
 *
 * **Example:**
 * ```bash
 * curl -s -X POST http://localhost:3000/api/orchestrator/tick | jq
 * ```
 *
 * **Response shape (TickSummary):**
 * ```json
 * {
 *   "status": "completed",    // "disabled" | "idle" | "completed"
 *   "timestamp": "ISO8601",
 *   "processed": 2,           // Agents successfully woken
 *   "errored": 0,             // Wakes that failed (gateway error, etc.)
 *   "queued": 1,              // Due schedules deferred to next tick (exceeded maxWakesPerTick)
 *   "skipped": 0,
 *   "results": [
 *     {
 *       "scheduleId": "uuid",
 *       "scheduleName": "Heartbeat",
 *       "agentId": "rocket",
 *       "status": "ok",       // "ok" | "error" | "dry-run"
 *       "error": null
 *     }
 *   ],
 *   "message": "No schedules due"  // Only present when status is "disabled" or "idle"
 * }
 * ```
 */
export async function POST(_request: NextRequest) {
  try {
    const result = await executeTick();
    return NextResponse.json(result);
  } catch (e) {
    console.error('[Orchestrator tick]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/orchestrator/tick
 *
 * Lightweight orchestrator status check. Returns whether the orchestrator is
 * enabled, the internal timer state, and a snapshot of current activity.
 *
 * For the full dashboard with per-agent schedules, use
 * `GET /api/heartbeat/status` instead.
 *
 * **Example:**
 * ```bash
 * curl -s http://localhost:3000/api/orchestrator/tick | jq
 * ```
 *
 * **Response shape:**
 * ```json
 * {
 *   "enabled": true,
 *   "config": { ... },         // Full OrchestratorConfig (see /api/orchestrator/config)
 *   "timer": {
 *     "running": true,
 *     "tickCount": 42,
 *     "lastTickAt": "ISO8601"
 *   },
 *   "dueNow": 1,               // Schedules with nextRunAt <= now
 *   "totalEnabled": 7,          // Total active schedules
 *   "wakesLastHour": 14,        // MessageLog entries in the last 60 minutes
 *   "timestamp": "ISO8601"
 * }
 * ```
 */
export async function GET() {
  try {
    const config = await prisma.orchestratorConfig.findUnique({
      where: { id: 'singleton' },
    });

    const now = new Date();

    const dueCount = await prisma.schedule.count({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
      },
    });

    const totalSchedules = await prisma.schedule.count({
      where: { enabled: true },
    });

    // Recent activity (last hour)
    const recentWakes = await prisma.messageLog.count({
      where: {
        channel: 'schedule',
        sentAt: { gte: new Date(now.getTime() - 3600000) },
      },
    });

    const timer = getTimerStatus();

    // Self-healing: if instrumentation.ts didn't fire, auto-start the timer
    if (!timer.running && config?.enabled) {
      console.log('[Orchestrator] Timer not running — auto-starting from status endpoint');
      startTimer();
      timer.running = true; // Reflect in this response
    }

    return NextResponse.json({
      enabled: config?.enabled ?? false,
      config: config ?? null,
      timer,
      dueNow: dueCount,
      totalEnabled: totalSchedules,
      wakesLastHour: recentWakes,
      timestamp: now.toISOString(),
    });
  } catch (e) {
    console.error('[Orchestrator status]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
