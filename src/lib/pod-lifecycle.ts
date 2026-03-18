/**
 * @module lib/pod-lifecycle
 * @description
 * CEO Pod lifecycle management — spawn, health check, and graceful shutdown.
 *
 * This module provides the TypeScript interface for managing Docker-based
 * CEO Pods from Mission Control. It wraps Docker CLI commands and integrates
 * with the fleet registry and project manifest systems.
 *
 * In production, these operations execute via `docker` CLI.
 * In development/testing, they can be mocked or run against a local Docker daemon.
 *
 * @see {@link module:api/fleet/registry} for pod registration
 * @see {@link module:lib/project-manifest} for manifest generation
 * @see {@link module:lib/boot-context} for boot validation
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// =============================================================================
// Types
// =============================================================================

export interface PodConfig {
  /** Agent ID (e.g., "rocket", "moose") */
  agentId: string;
  /** Project ID the pod is assigned to */
  projectId: string;
  /** MC URL for pod to phone home to */
  mcUrl?: string;
  /** Memory limit (e.g., "512m", "1g") */
  memoryLimit?: string;
  /** CPU limit (e.g., "0.5", "1.0") */
  cpuLimit?: string;
  /** Heartbeat interval in seconds */
  heartbeatInterval?: number;
  /** Path to project manifest file */
  manifestPath?: string;
  /** Path to context directory (SOUL.md, HEARTBEAT.md, GOALS.md) */
  contextDir?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Docker image tag (default: "mc-pod-{agentId}:latest") */
  imageTag?: string;
}

export interface PodStatus {
  containerId: string;
  agentId: string;
  status: 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'unknown';
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  uptime: string;
  memory: string;
  cpu: string;
  createdAt: string;
}

export interface PodSpawnResult {
  success: boolean;
  containerId?: string;
  error?: string;
}

export interface PodStopResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MEMORY_LIMIT = '512m';
const DEFAULT_CPU_LIMIT = '0.5';
const DEFAULT_HEARTBEAT_INTERVAL = 60;
const DEFAULT_MC_URL = 'http://host.docker.internal:3000';
const CONTAINER_PREFIX = 'mc-pod-';
const STOP_TIMEOUT_SECONDS = 30;

// =============================================================================
// Pod Operations
// =============================================================================

/**
 * Spawn a new CEO Pod as a Docker container.
 *
 * @param config - Pod configuration
 * @returns Spawn result with container ID or error
 */
export async function spawnPod(config: PodConfig): Promise<PodSpawnResult> {
  const {
    agentId,
    projectId,
    mcUrl = DEFAULT_MC_URL,
    memoryLimit = DEFAULT_MEMORY_LIMIT,
    cpuLimit = DEFAULT_CPU_LIMIT,
    heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL,
    manifestPath,
    env = {},
    imageTag,
  } = config;

  const containerName = `${CONTAINER_PREFIX}${agentId}`;
  const image = imageTag || `mc-pod-${agentId}:latest`;

  // Build docker run command
  const args: string[] = [
    'docker', 'run', '-d',
    '--name', containerName,
    '--restart', 'unless-stopped',
    '--memory', memoryLimit,
    '--cpus', cpuLimit,
    '-e', `AGENT_ID=${agentId}`,
    '-e', `PROJECT_ID=${projectId}`,
    '-e', `MC_URL=${mcUrl}`,
    '-e', `HEARTBEAT_INTERVAL=${heartbeatInterval}`,
  ];

  // Mount manifest read-only if provided
  if (manifestPath) {
    args.push('-v', `${manifestPath}:/pod/project.lock.json:ro`);
  }

  // Add extra environment variables
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`);
  }

  // Network
  args.push('--network', 'mc-fleet');

  // Image
  args.push(image);

  try {
    // Check if container already exists
    try {
      const { stdout } = await execAsync(
        `docker inspect --format='{{.State.Status}}' ${containerName}`
      );
      const existingStatus = stdout.trim().replace(/'/g, '');

      if (existingStatus === 'running') {
        return { success: false, error: `Pod ${agentId} is already running` };
      }

      // Remove stopped container before respawning
      await execAsync(`docker rm -f ${containerName}`);
    } catch {
      // Container doesn't exist — that's fine
    }

    const { stdout } = await execAsync(args.join(' '));
    const containerId = stdout.trim().substring(0, 12);

    return { success: true, containerId };
  } catch (e) {
    return {
      success: false,
      error: `Failed to spawn pod ${agentId}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Stop a running CEO Pod gracefully.
 *
 * Sends SIGTERM, waits for graceful shutdown, then forces if needed.
 *
 * @param agentId - Agent ID of the pod to stop
 * @param remove - Whether to remove the container after stopping (default: true)
 */
export async function stopPod(
  agentId: string,
  remove = true
): Promise<PodStopResult> {
  const containerName = `${CONTAINER_PREFIX}${agentId}`;

  try {
    // Graceful stop
    await execAsync(`docker stop -t ${STOP_TIMEOUT_SECONDS} ${containerName}`);

    // Remove if requested
    if (remove) {
      await execAsync(`docker rm ${containerName}`);
    }

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: `Failed to stop pod ${agentId}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Restart a CEO Pod.
 *
 * @param agentId - Agent ID of the pod to restart
 */
export async function restartPod(agentId: string): Promise<PodStopResult> {
  const containerName = `${CONTAINER_PREFIX}${agentId}`;

  try {
    await execAsync(`docker restart -t ${STOP_TIMEOUT_SECONDS} ${containerName}`);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: `Failed to restart pod ${agentId}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Get the status of a specific pod.
 *
 * @param agentId - Agent ID to check
 */
export async function getPodStatus(agentId: string): Promise<PodStatus | null> {
  const containerName = `${CONTAINER_PREFIX}${agentId}`;

  try {
    const format = [
      '{{.Id}}',
      '{{.State.Status}}',
      '{{.State.Health.Status}}',
      '{{.State.StartedAt}}',
      '{{.Created}}',
    ].join('|||');

    const { stdout } = await execAsync(
      `docker inspect --format='${format}' ${containerName}`
    );

    const parts = stdout.trim().replace(/'/g, '').split('|||');

    // Get resource usage
    let memory = 'N/A';
    let cpu = 'N/A';
    try {
      const { stdout: statsOut } = await execAsync(
        `docker stats ${containerName} --no-stream --format='{{.MemUsage}}|||{{.CPUPerc}}'`
      );
      const statsParts = statsOut.trim().replace(/'/g, '').split('|||');
      memory = statsParts[0] || 'N/A';
      cpu = statsParts[1] || 'N/A';
    } catch {
      // Stats may not be available for stopped containers
    }

    const startedAt = new Date(parts[3]).getTime();
    const uptimeMs = Date.now() - startedAt;
    const uptimeHours = Math.floor(uptimeMs / 3600000);
    const uptimeMin = Math.floor((uptimeMs % 3600000) / 60000);

    return {
      containerId: parts[0].substring(0, 12),
      agentId,
      status: (parts[1] as PodStatus['status']) || 'unknown',
      health: (parts[2] as PodStatus['health']) || 'none',
      uptime: uptimeHours > 0 ? `${uptimeHours}h ${uptimeMin}m` : `${uptimeMin}m`,
      memory,
      cpu,
      createdAt: parts[4],
    };
  } catch {
    return null;
  }
}

/**
 * List all running MC pods.
 */
export async function listPods(): Promise<PodStatus[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "name=${CONTAINER_PREFIX}" --format='{{.Names}}'`
    );

    const names = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((n) => n.replace(/'/g, ''));

    const statuses: PodStatus[] = [];
    for (const name of names) {
      const agentId = name.replace(CONTAINER_PREFIX, '');
      const status = await getPodStatus(agentId);
      if (status) statuses.push(status);
    }

    return statuses;
  } catch {
    return [];
  }
}

/**
 * Build the Docker image for a CEO Pod.
 *
 * @param agentId - Agent ID to build for
 * @param projectId - Project ID for the build
 * @param contextPath - Path to the build context (repo root)
 */
export async function buildPodImage(
  agentId: string,
  projectId: string,
  contextPath: string = '.'
): Promise<{ success: boolean; error?: string }> {
  const imageTag = `mc-pod-${agentId}:latest`;

  try {
    await execAsync(
      `docker build -f docker/Dockerfile.ceo-pod ` +
        `--build-arg AGENT_ID=${agentId} ` +
        `--build-arg PROJECT_ID=${projectId} ` +
        `-t ${imageTag} ${contextPath}`,
      { cwd: contextPath }
    );

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: `Failed to build image for ${agentId}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
