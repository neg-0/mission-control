/**
 * @module api/schedules
 * @description
 * CRUD API for agent schedules managed by Mission Control.
 *
 * Schedules define when agents should be woken by the orchestrator tick.
 * Each schedule targets a specific agent and specifies either a cron expression
 * or a fixed interval, along with priority, payload message, and delivery routing.
 *
 * The orchestrator tick ({@link module:api/orchestrator/tick}) queries due schedules
 * and dispatches them via OpenClaw `/hooks/agent` in priority order with staggering.
 *
 * **Schedule types:**
 * - `"heartbeat"` — Managed by Mission Control's orchestrator timer
 * - `"cron"` — Managed by OpenClaw's native cron system (read-only in MC)
 *
 * **Endpoints:**
 * - `GET    /api/schedules` — List schedules (filter by agentId, enabled)
 * - `POST   /api/schedules` — Create a new schedule
 * - `PATCH  /api/schedules` — Update an existing schedule
 * - `DELETE /api/schedules` — Delete a schedule
 *
 * @see {@link module:schemas} for request body validation schemas
 */

import { prisma } from '@/lib/prisma';
import {
  CreateScheduleSchema,
  DeleteByIdSchema,
  formatZodError,
  UpdateScheduleSchema,
} from '@/lib/schemas';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/schedules
 *
 * Lists all schedules, optionally filtered by agent or enabled status.
 *
 * **Query params:**
 * - `agentId` — Filter by agent (e.g. `?agentId=rocket`)
 * - `enabled` — Filter by active status (`?enabled=true`)
 *
 * **Examples:**
 * ```bash
 * # All schedules
 * curl -s http://localhost:3000/api/schedules | jq
 *
 * # Only rocket's schedules
 * curl -s 'http://localhost:3000/api/schedules?agentId=rocket' | jq
 *
 * # Only enabled heartbeat schedules
 * curl -s 'http://localhost:3000/api/schedules?enabled=true' | jq
 * ```
 *
 * **Response shape:**
 * ```json
 * [
 *   {
 *     "id": "uuid",
 *     "agentId": "rocket",
 *     "type": "heartbeat",        // "heartbeat" | "cron"
 *     "name": "Heartbeat",
 *     "cronExpr": null,            // Cron expression (mutually exclusive with intervalMs)
 *     "intervalMs": 1800000,       // Interval in ms (mutually exclusive with cronExpr)
 *     "enabled": true,
 *     "priority": 1,               // Higher = processed first in tick (0–100)
 *     "payload": "🤖 Heartbeat: Read HEARTBEAT.md...",
 *     "channel": "discord",        // Delivery channel for /hooks/agent
 *     "deliverTo": "user:339585248826228749",  // Delivery target within channel
 *     "lastRunAt": "ISO8601",
 *     "nextRunAt": "ISO8601",
 *     "createdAt": "ISO8601",
 *     "updatedAt": "ISO8601",
 *     "agent": { "id": "rocket", "role": "CEO" }
 *   }
 * ]
 * ```
 *
 * @param request - Supports query params: `?agentId=rocket&enabled=true`
 * @returns JSON array of Schedule records with associated Agent info
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const enabled = searchParams.get('enabled');

    const where: Prisma.ScheduleWhereInput = {};
    if (agentId) where.agentId = agentId;
    if (enabled !== null && enabled !== undefined && enabled !== '') {
      where.enabled = enabled === 'true';
    }

    const schedules = await prisma.schedule.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        agent: { select: { id: true, role: true } },
      },
    });

    return NextResponse.json(schedules);
  } catch (e) {
    console.error('[Schedules GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/schedules
 *
 * Creates a new schedule. Validates request body with {@link CreateScheduleSchema}.
 *
 * **Business rules:**
 * - Exactly one of `cronExpr` or `intervalMs` must be provided
 * - `intervalMs` minimum is 10,000ms (10 seconds)
 * - `priority` range is 0–100 (higher = processed first in tick)
 * - `nextRunAt` is auto-calculated: interval → now + interval; cron → now
 * - `type` should be `"heartbeat"` for MC-managed wakes
 *
 * **Required fields:** `agentId`, `name`, one of (`cronExpr` | `intervalMs`)
 *
 * **Example:**
 * ```bash
 * curl -s -X POST http://localhost:3000/api/schedules \
 *   -H 'Content-Type: application/json' \
 *   -d '{
 *     "agentId": "rocket",
 *     "type": "heartbeat",
 *     "name": "Heartbeat",
 *     "intervalMs": 1800000,
 *     "priority": 1,
 *     "payload": "🤖 Heartbeat: Read HEARTBEAT.md, run roster_checkin, check task_list, report status.",
 *     "channel": "discord",
 *     "deliverTo": "user:339585248826228749",
 *     "enabled": true
 *   }' | jq
 * ```
 *
 * @param request - JSON body matching {@link CreateScheduleSchema}
 * @returns Created Schedule record (HTTP 201)
 */
export async function POST(request: NextRequest) {
  try {
    const result = CreateScheduleSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }
    const body = result.data;

    // Calculate first nextRunAt
    const now = new Date();
    let nextRunAt: Date | null = null;

    if (body.intervalMs) {
      nextRunAt = new Date(now.getTime() + body.intervalMs);
    } else if (body.cronExpr) {
      // Set to now so it fires on the very next tick
      nextRunAt = now;
    }

    const schedule = await prisma.schedule.create({
      data: {
        agentId: body.agentId,
        type: body.type,
        name: body.name,
        cronExpr: body.cronExpr || null,
        intervalMs: body.intervalMs || null,
        enabled: body.enabled,
        priority: body.priority,
        payload: body.payload || null,
        channel: body.channel || 'discord',
        deliverTo: body.deliverTo || null,
        nextRunAt,
      },
    });

    return NextResponse.json(schedule, { status: 201 });
  } catch (e) {
    console.error('[Schedules POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/schedules
 *
 * Updates an existing schedule. Only provided fields are modified.
 * If timing fields (`cronExpr` / `intervalMs`) change, `nextRunAt` is recalculated
 * and the mutually exclusive field is cleared.
 *
 * **Examples:**
 * ```bash
 * # Disable a schedule
 * curl -s -X PATCH http://localhost:3000/api/schedules \
 *   -H 'Content-Type: application/json' \
 *   -d '{"id": "<schedule-uuid>", "enabled": false}' | jq
 *
 * # Change interval to 45 minutes
 * curl -s -X PATCH http://localhost:3000/api/schedules \
 *   -H 'Content-Type: application/json' \
 *   -d '{"id": "<schedule-uuid>", "intervalMs": 2700000}' | jq
 *
 * # Update delivery target
 * curl -s -X PATCH http://localhost:3000/api/schedules \
 *   -H 'Content-Type: application/json' \
 *   -d '{"id": "<schedule-uuid>", "channel": "discord", "deliverTo": "user:123456"}' | jq
 * ```
 *
 * @param request - JSON body matching {@link UpdateScheduleSchema}
 * @returns Updated Schedule record
 */
export async function PATCH(request: NextRequest) {
  try {
    const result = UpdateScheduleSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }
    const body = result.data;

    const data: Prisma.ScheduleUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.cronExpr !== undefined) data.cronExpr = body.cronExpr;
    if (body.intervalMs !== undefined) data.intervalMs = body.intervalMs;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.payload !== undefined) data.payload = body.payload;
    if (body.channel !== undefined) data.channel = body.channel;
    if (body.deliverTo !== undefined) data.deliverTo = body.deliverTo;

    // If timing changed, recalculate nextRunAt
    if (body.intervalMs !== undefined || body.cronExpr !== undefined) {
      const now = new Date();
      if (body.intervalMs) {
        data.nextRunAt = new Date(now.getTime() + body.intervalMs);
        data.cronExpr = null;
      } else if (body.cronExpr) {
        data.nextRunAt = now;
        data.intervalMs = null;
      }
    }

    const schedule = await prisma.schedule.update({
      where: { id: body.id },
      data,
    });

    return NextResponse.json(schedule);
  } catch (e) {
    console.error('[Schedules PATCH]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/schedules
 *
 * Permanently removes a schedule. This is irreversible.
 *
 * **Example:**
 * ```bash
 * curl -s -X DELETE http://localhost:3000/api/schedules \
 *   -H 'Content-Type: application/json' \
 *   -d '{"id": "<schedule-uuid>"}' | jq
 * ```
 *
 * @param request - JSON body with `{ id: "uuid" }`
 * @returns `{ success: true }` on success
 */
export async function DELETE(request: NextRequest) {
  try {
    const result = DeleteByIdSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    await prisma.schedule.delete({
      where: { id: result.data.id },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[Schedules DELETE]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
