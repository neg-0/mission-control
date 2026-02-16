/**
 * @module api/orchestrator/config
 * @description
 * Configuration endpoint for the Mission Control orchestrator singleton.
 *
 * The orchestrator config controls global scheduling behavior:
 * - `enabled` — Global on/off switch for the orchestrator
 * - `maxWakesPerTick` — Max agents woken per tick cycle (1–20)
 * - `minIntervalMs` — Minimum ms between full tick cycles (≥10,000)
 * - `staggerDelayMs` — Gap in ms between consecutive agent wakes within a tick (≥5,000)
 * - `tickIntervalMs` — How often the internal timer fires in ms (≥10,000)
 * - `tpmLimit` — Optional tokens-per-minute budget cap (null = unlimited)
 * - `quotaResetHours` — Hours between quota resets (≥0.5)
 *
 * The config is stored as a singleton record (id: `"singleton"`) and auto-created
 * with defaults on first GET if missing.
 *
 * **Endpoints:**
 * - `GET   /api/orchestrator/config` — Read current config
 * - `PATCH /api/orchestrator/config` — Update config fields
 *
 * @see {@link module:schemas.UpdateOrchestratorConfigSchema} for validation
 */

import { prisma } from '@/lib/prisma';
import { UpdateOrchestratorConfigSchema, formatZodError } from '@/lib/schemas';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/orchestrator/config
 *
 * Returns the current orchestrator configuration. If no config exists yet,
 * auto-creates a singleton with default values.
 *
 * **Example:**
 * ```bash
 * curl -s http://localhost:3000/api/orchestrator/config | jq
 * ```
 *
 * **Response shape:**
 * ```json
 * {
 *   "id": "singleton",
 *   "enabled": true,
 *   "maxWakesPerTick": 2,       // Max agents woken per tick cycle
 *   "minIntervalMs": 60000,     // Min ms between tick cycles
 *   "staggerDelayMs": 30000,    // Gap between consecutive wakes in a tick
 *   "tickIntervalMs": 60000,    // Internal timer interval
 *   "tpmLimit": null,           // Tokens-per-minute cap (null = unlimited)
 *   "quotaResetHours": 1
 * }
 * ```
 *
 * @returns OrchestratorConfig record
 */
export async function GET() {
  try {
    let config = await prisma.orchestratorConfig.findUnique({
      where: { id: 'singleton' },
    });

    // Auto-create with defaults if missing
    if (!config) {
      config = await prisma.orchestratorConfig.create({
        data: { id: 'singleton' },
      });
    }

    return NextResponse.json(config);
  } catch (e) {
    console.error('[OrchestratorConfig GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/orchestrator/config
 *
 * Updates the orchestrator configuration. All fields are optional —
 * only provided fields will be changed.
 *
 * Uses upsert to handle the case where the singleton doesn't exist yet.
 *
 * **Validation ranges:**
 * - `maxWakesPerTick`: 1–20
 * - `minIntervalMs`: ≥ 10,000
 * - `staggerDelayMs`: ≥ 5,000
 * - `tickIntervalMs`: ≥ 10,000
 * - `quotaResetHours`: ≥ 0.5
 *
 * **Examples:**
 * ```bash
 * # Enable orchestrator + set tick interval to 2 minutes
 * curl -s -X PATCH http://localhost:3000/api/orchestrator/config \
 *   -H 'Content-Type: application/json' \
 *   -d '{"enabled": true, "tickIntervalMs": 120000}' | jq
 *
 * # Increase stagger delay to 60 seconds
 * curl -s -X PATCH http://localhost:3000/api/orchestrator/config \
 *   -H 'Content-Type: application/json' \
 *   -d '{"staggerDelayMs": 60000}' | jq
 *
 * # Disable orchestrator
 * curl -s -X PATCH http://localhost:3000/api/orchestrator/config \
 *   -H 'Content-Type: application/json' \
 *   -d '{"enabled": false}' | jq
 * ```
 *
 * @param request - JSON body matching {@link UpdateOrchestratorConfigSchema}
 * @returns Updated OrchestratorConfig record
 */
export async function PATCH(request: NextRequest) {
  try {
    const result = UpdateOrchestratorConfigSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }
    const body = result.data;

    const data: Prisma.OrchestratorConfigUpdateInput = {};
    if (body.maxWakesPerTick !== undefined) data.maxWakesPerTick = body.maxWakesPerTick;
    if (body.minIntervalMs !== undefined) data.minIntervalMs = body.minIntervalMs;
    if (body.staggerDelayMs !== undefined) data.staggerDelayMs = body.staggerDelayMs;
    if (body.tickIntervalMs !== undefined) data.tickIntervalMs = body.tickIntervalMs;
    if (body.tpmLimit !== undefined) data.tpmLimit = body.tpmLimit;
    if (body.quotaResetHours !== undefined) data.quotaResetHours = body.quotaResetHours;
    if (body.journalEntries !== undefined) data.journalEntries = body.journalEntries;
    if (body.mdInjections !== undefined) data.mdInjections = body.mdInjections;
    if (body.enabled !== undefined) data.enabled = body.enabled;

    const config = await prisma.orchestratorConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        ...(body.maxWakesPerTick !== undefined && { maxWakesPerTick: body.maxWakesPerTick }),
        ...(body.minIntervalMs !== undefined && { minIntervalMs: body.minIntervalMs }),
        ...(body.staggerDelayMs !== undefined && { staggerDelayMs: body.staggerDelayMs }),
        ...(body.tickIntervalMs !== undefined && { tickIntervalMs: body.tickIntervalMs }),
        ...(body.tpmLimit !== undefined && { tpmLimit: body.tpmLimit }),
        ...(body.quotaResetHours !== undefined && { quotaResetHours: body.quotaResetHours }),
        ...(body.journalEntries !== undefined && { journalEntries: body.journalEntries }),
        ...(body.mdInjections !== undefined && { mdInjections: body.mdInjections }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      },
      update: data,
    });

    return NextResponse.json(config);
  } catch (e) {
    console.error('[OrchestratorConfig PATCH]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
