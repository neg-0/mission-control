/**
 * @module api/heartbeat/status
 * @description
 * Live heartbeat orchestrator dashboard. Returns the internal timer state,
 * orchestrator config, per-agent heartbeat schedules, recent wake history,
 * and the full agent roster.
 *
 * This is the primary endpoint for monitoring the heartbeat system. It only
 * returns heartbeat-type schedules (not cron jobs managed by OpenClaw).
 *
 * **Endpoint:**
 * - `GET /api/heartbeat/status` — Full heartbeat dashboard snapshot
 *
 * **Example:**
 * ```bash
 * curl -s http://localhost:3000/api/heartbeat/status | jq
 * ```
 *
 * **Response shape:**
 * ```json
 * {
 *   "timer": {
 *     "running": true,          // Whether the internal setInterval timer is active
 *     "tickCount": 42,          // Total ticks since server boot
 *     "lastTickAt": "ISO8601"   // When the last tick executed
 *   },
 *   "config": {                 // OrchestratorConfig singleton (null if not yet created)
 *     "id": "singleton",
 *     "enabled": true,
 *     "maxWakesPerTick": 2,     // Max agents woken per tick cycle
 *     "minIntervalMs": 60000,   // Min spacing between tick cycles
 *     "staggerDelayMs": 30000,  // Gap between consecutive agent wakes within a tick
 *     "tickIntervalMs": 60000,  // How often the internal timer fires
 *     "tpmLimit": null,         // Tokens-per-minute budget (null = unlimited)
 *     "quotaResetHours": 1
 *   },
 *   "schedules": [              // Heartbeat-only schedules (type: "heartbeat")
 *     {
 *       "id": "uuid",
 *       "agentId": "rocket",
 *       "name": "Heartbeat",
 *       "intervalMs": 1800000,  // 30 minutes
 *       "cronExpr": null,
 *       "enabled": true,
 *       "priority": 1,
 *       "payload": "🤖 Heartbeat: Read HEARTBEAT.md...",
 *       "channel": "discord",                    // Delivery channel
 *       "deliverTo": "user:339585248826228749",   // Delivery target
 *       "lastRunAt": "ISO8601",
 *       "nextRunAt": "ISO8601",
 *       "agent": { "id": "rocket", "role": "CEO" }
 *     }
 *   ],
 *   "recentWakes": [            // Last hour of wake activity from MessageLog
 *     {
 *       "toId": "rocket",
 *       "subject": "Heartbeat",
 *       "status": "delivered",  // "delivered" | "failed" | "sent"
 *       "sentAt": "ISO8601"
 *     }
 *   ],
 *   "agents": [                 // All registered agents
 *     { "id": "rocket", "role": "CEO", "status": "active" }
 *   ],
 *   "timestamp": "ISO8601"      // Server time when response was generated
 * }
 * ```
 */

import { getTimerStatus } from '@/lib/orchestrator-timer';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/heartbeat/status
 *
 * Returns the full heartbeat orchestrator dashboard. Used by the Settings tab
 * for live status display and by agents for programmatic health checks.
 *
 * @returns JSON with timer, config, schedules, recentWakes, agents, timestamp
 */
export async function GET() {
  try {
    const config = await prisma.orchestratorConfig.findUnique({
      where: { id: 'singleton' },
    });

    const timer = getTimerStatus();
    const now = new Date();

    // Get heartbeat schedules only (not cron job entries)
    const schedules = await prisma.schedule.findMany({
      where: { type: 'heartbeat' },
      orderBy: [{ priority: 'desc' }, { agentId: 'asc' }],
      include: {
        agent: { select: { id: true, role: true } },
      },
    });

    // Recent wakes (last hour)
    const recentWakes = await prisma.messageLog.findMany({
      where: {
        channel: 'schedule',
        sentAt: { gte: new Date(now.getTime() - 3600000) },
      },
      orderBy: { sentAt: 'desc' },
      take: 20,
      select: {
        toId: true,
        subject: true,
        status: true,
        sentAt: true,
      },
    });

    // All agents for display
    const agents = await prisma.agent.findMany({
      select: { id: true, role: true, status: true },
      orderBy: { id: 'asc' },
    });

    return NextResponse.json({
      timer,
      config: config ?? null,
      schedules,
      recentWakes,
      agents,
      timestamp: now.toISOString(),
    });
  } catch (e) {
    console.error('[Heartbeat Status]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
