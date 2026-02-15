/**
 * @module orchestrator-timer
 * @description
 * Internal setInterval-based tick timer for the orchestrator.
 *
 * Since Mission Control runs as a permanent systemd service (not serverless),
 * we use a Node.js setInterval instead of an external cron job. The timer
 * calls executeTick() on each cycle, respecting the OrchestratorConfig.
 *
 * The timer is a singleton — calling startTimer() multiple times is safe.
 * It reads tickIntervalMs from the config on each tick to support dynamic
 * reconfiguration without restart.
 */

import { executeTick } from '@/lib/orchestrator-tick';
import { prisma } from '@/lib/prisma';

let timerHandle: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let lastTickAt: Date | null = null;
let isRunning = false;

/**
 * Start the orchestrator timer. Safe to call multiple times — will be a no-op
 * if already running.
 */
export function startTimer() {
  if (timerHandle) {
    console.log('[Orchestrator Timer] Already running, skipping duplicate start');
    return;
  }

  isRunning = true;
  console.log('[Orchestrator Timer] Starting internal tick timer (60s default)');

  // Initial tick after 10 seconds (let the server fully boot)
  setTimeout(async () => {
    if (!isRunning) return;
    await runTick();
    // Then start the recurring interval
    scheduleNextTick();
  }, 10_000);
}

async function scheduleNextTick() {
  if (!isRunning) return;

  // Read current config to get the tick interval (supports dynamic changes)
  let intervalMs = 60_000; // default
  try {
    const config = await prisma.orchestratorConfig.findUnique({
      where: { id: 'singleton' },
    });
    if (config?.tickIntervalMs) {
      intervalMs = config.tickIntervalMs;
    }
  } catch {
    // DB not ready or config missing — use default
  }

  timerHandle = setTimeout(async () => {
    if (!isRunning) return;
    await runTick();
    scheduleNextTick(); // Schedule next tick after this one completes
  }, intervalMs);
}

async function runTick() {
  try {
    const result = await executeTick();
    tickCount++;
    lastTickAt = new Date();

    if (result.status === 'completed' && result.processed > 0) {
      console.log(
        `[Orchestrator Timer] Tick #${tickCount}: ${result.processed} wakes, ${result.errored} errors, ${result.queued} queued`
      );
    }
    // Don't log idle ticks to avoid spam
  } catch (e) {
    console.error('[Orchestrator Timer] Tick error:', e);
  }
}

/**
 * Stop the orchestrator timer.
 */
export function stopTimer() {
  isRunning = false;
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
    console.log('[Orchestrator Timer] Stopped');
  }
}

/**
 * Get the current timer status (for the status API).
 */
export function getTimerStatus() {
  return {
    running: isRunning,
    tickCount,
    lastTickAt: lastTickAt?.toISOString() ?? null,
  };
}
