/**
 * @module api/fleet/pods
 * @description
 * Pod lifecycle management API — spawn, stop, restart, and list CEO Pods.
 *
 * **Endpoints:**
 * - GET  /api/fleet/pods — List all pods and their status
 * - POST /api/fleet/pods — Spawn a new pod or perform lifecycle action
 *
 * Actions (POST body `action` field):
 * - `spawn` — Create and start a new pod
 * - `stop` — Gracefully stop a pod
 * - `restart` — Restart a pod
 * - `build` — Build the Docker image for a pod
 *
 * @see {@link module:lib/pod-lifecycle} for implementation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  buildPodImage,
  getPodStatus,
  listPods,
  restartPod,
  spawnPod,
  stopPod,
} from '@/lib/pod-lifecycle';
import { generateManifest } from '@/lib/project-manifest';
import { formatZodError } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

// =============================================================================
// Validation Schemas
// =============================================================================

const SpawnSchema = z.object({
  action: z.literal('spawn'),
  agentId: z.string().min(1),
  projectId: z.string().min(1),
  mcUrl: z.string().url().optional(),
  memoryLimit: z.string().optional(),
  cpuLimit: z.string().optional(),
  heartbeatInterval: z.number().int().min(10).max(600).optional(),
});

const StopSchema = z.object({
  action: z.literal('stop'),
  agentId: z.string().min(1),
  remove: z.boolean().optional(),
});

const RestartSchema = z.object({
  action: z.literal('restart'),
  agentId: z.string().min(1),
});

const BuildSchema = z.object({
  action: z.literal('build'),
  agentId: z.string().min(1),
  projectId: z.string().min(1),
});

const PodActionSchema = z.discriminatedUnion('action', [
  SpawnSchema,
  StopSchema,
  RestartSchema,
  BuildSchema,
]);

// =============================================================================
// GET /api/fleet/pods — List all pods
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (agentId) {
      // Single pod status
      const status = await getPodStatus(agentId);
      if (!status) {
        return NextResponse.json(
          { error: `Pod not found: ${agentId}` },
          { status: 404 }
        );
      }
      return NextResponse.json(status);
    }

    // All pods
    const pods = await listPods();
    return NextResponse.json({
      pods,
      total: pods.length,
      running: pods.filter((p) => p.status === 'running').length,
    });
  } catch (e) {
    console.error('[Fleet Pods GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// POST /api/fleet/pods — Pod lifecycle actions
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = PodActionSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const data = result.data;

    switch (data.action) {
      case 'spawn': {
        // Generate manifest for the pod
        let manifestPath: string | undefined;
        try {
          const manifest = await generateManifest(data.agentId, data.projectId);
          // In production, write to docker/manifests/{agentId}.lock.json
          // For now, we pass the config and let the pod boot without a manifest file
          console.log(
            `[Fleet Pods] Generated manifest for ${data.agentId}:`,
            manifest.hash
          );
        } catch (e) {
          console.warn(
            `[Fleet Pods] Could not generate manifest for ${data.agentId}:`,
            e
          );
        }

        const spawnResult = await spawnPod({
          agentId: data.agentId,
          projectId: data.projectId,
          mcUrl: data.mcUrl,
          memoryLimit: data.memoryLimit,
          cpuLimit: data.cpuLimit,
          heartbeatInterval: data.heartbeatInterval,
          manifestPath,
        });

        if (!spawnResult.success) {
          return NextResponse.json(
            { error: spawnResult.error },
            { status: 409 }
          );
        }

        return NextResponse.json(
          {
            message: `Pod ${data.agentId} spawned`,
            containerId: spawnResult.containerId,
          },
          { status: 201 }
        );
      }

      case 'stop': {
        const stopResult = await stopPod(data.agentId, data.remove ?? true);
        if (!stopResult.success) {
          return NextResponse.json(
            { error: stopResult.error },
            { status: 500 }
          );
        }
        return NextResponse.json({
          message: `Pod ${data.agentId} stopped`,
        });
      }

      case 'restart': {
        const restartResult = await restartPod(data.agentId);
        if (!restartResult.success) {
          return NextResponse.json(
            { error: restartResult.error },
            { status: 500 }
          );
        }
        return NextResponse.json({
          message: `Pod ${data.agentId} restarted`,
        });
      }

      case 'build': {
        const buildResult = await buildPodImage(
          data.agentId,
          data.projectId
        );
        if (!buildResult.success) {
          return NextResponse.json(
            { error: buildResult.error },
            { status: 500 }
          );
        }
        return NextResponse.json({
          message: `Image built for ${data.agentId}`,
          imageTag: `mc-pod-${data.agentId}:latest`,
        });
      }
    }
  } catch (e) {
    console.error('[Fleet Pods POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
