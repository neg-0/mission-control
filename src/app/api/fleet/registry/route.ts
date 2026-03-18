/**
 * @module api/fleet/registry
 * @description
 * Fleet registry for managing connected pods in Mission Control.
 *
 * The registry provides:
 * - Discovery of active pods and their endpoints
 * - Status tracking and heartbeat monitoring
 * - Pod registration and deregistration
 * - Runtime mode and configuration tracking
 *
 * **Endpoints:**
 * - GET /api/fleet/registry — Get connected pods
 * - POST /api/fleet/registry — Register/update a pod
 *
 * Each pod registers its:
 * - Agent ID (e.g., "sarge", "rocket")
 * - Port (internal listening port)
 * - Status (active, paused, spawned)
 * - Runtime mode (gateway, native)
 *
 * The registry periodically marks agents as inactive if heartbeats stop.
 */

import { prisma } from '@/lib/prisma';
import { formatZodError } from '@/lib/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// =============================================================================
// Validation Schemas
// =============================================================================

/**
 * Schema for registering or updating a pod in the registry.
 *
 * @example
 * ```json
 * {
 *   "agentId": "sarge",
 *   "port": 8001,
 *   "status": "active"
 * }
 * ```
 */
const RegisterPodSchema = z.object({
  /** Agent ID (e.g., "sarge", "rocket", "captain") */
  agentId: z.string().min(1, 'agentId is required'),
  /** Internal listening port */
  port: z.number().int().min(1024).max(65535),
  /** Pod status: active | paused | spawned */
  status: z.enum(['active', 'paused', 'spawned']).default('active'),
  /** Runtime mode: gateway (OpenClaw) or native (MC runtime) */
  runtimeMode: z.enum(['gateway', 'native']).default('gateway'),
});

type _RegisterPodInput = z.infer<typeof RegisterPodSchema>;

// =============================================================================
// GET /api/fleet/registry — Get connected pods
// =============================================================================

/**
 * Returns all pods currently registered in the fleet.
 *
 * Response includes:
 * - pods: Array of active pod information
 * - totalActive: Count of active pods
 * - totalPaused: Count of paused pods
 * - totalSpawned: Count of spawned pods
 * - timestamp: When the registry was queried
 *
 * @example Response:
 * ```json
 * {
 *   "pods": [
 *     {
 *       "agentId": "sarge",
 *       "status": "active",
 *       "port": 8001,
 *       "lastHeartbeat": "2026-02-27T17:30:45Z",
 *       "runtimeMode": "gateway"
 *     }
 *   ],
 *   "totalActive": 5,
 *   "totalPaused": 1,
 *   "totalSpawned": 0,
 *   "timestamp": "2026-02-27T17:31:00Z"
 * }
 * ```
 */
export async function GET(_request: NextRequest) {
  try {
    // Query all agents (they're the "pods" in the registry)
    const agents = await prisma.agent.findMany({
      select: {
        id: true,
        status: true,
        port: true,
        lastHeartbeat: true,
        runtimeMode: true,
      },
      orderBy: { id: 'asc' },
    });

    // Count by status
    const statusCounts = {
      active: 0,
      paused: 0,
      spawned: 0,
    };

    agents.forEach((agent) => {
      if (agent.status === 'active') statusCounts.active++;
      else if (agent.status === 'paused') statusCounts.paused++;
      else if (agent.status === 'spawned') statusCounts.spawned++;
    });

    // Transform for response
    const pods = agents.map((agent) => ({
      agentId: agent.id,
      status: agent.status,
      port: agent.port,
      lastHeartbeat: agent.lastHeartbeat,
      runtimeMode: agent.runtimeMode,
    }));

    return NextResponse.json({
      pods,
      totalActive: statusCounts.active,
      totalPaused: statusCounts.paused,
      totalSpawned: statusCounts.spawned,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[FleetRegistry GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// POST /api/fleet/registry — Register/update a pod
// =============================================================================

/**
 * Registers a new pod or updates an existing one in the registry.
 *
 * When a pod starts, it calls this endpoint to register itself.
 * Pods also call this periodically as a heartbeat mechanism.
 *
 * If the agent doesn't exist, returns 404. The Agent record
 * must be created separately (e.g., via the agent bootstrap flow).
 *
 * @param request - JSON body matching RegisterPodSchema
 * @returns Updated Agent record with registration info
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = RegisterPodSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const { agentId, port, status, runtimeMode } = result.data;

    // Verify agent exists
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return NextResponse.json(
        {
          error: `Agent not found: ${agentId}. Create the agent via /api/agents first.`,
        },
        { status: 404 }
      );
    }

    // Update agent with port, status, and heartbeat timestamp
    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        port,
        status,
        runtimeMode,
        lastHeartbeat: new Date(),
      },
    });

    return NextResponse.json(
      {
        agentId: updated.id,
        status: updated.status,
        port: updated.port,
        lastHeartbeat: updated.lastHeartbeat,
        runtimeMode: updated.runtimeMode,
        message: `Pod registered: ${agentId}`,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error('[FleetRegistry POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
