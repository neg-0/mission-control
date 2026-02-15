/**
 * @module instrumentation
 * @description
 * Next.js instrumentation hook. Starts the orchestrator timer when the
 * server boots. This replaces the need for an external cron job — MC is
 * a permanent systemd service, so the timer lives in the Node.js process.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on the server (not in edge runtime or client)
  if (typeof window === 'undefined') {
    const { startTimer } = await import('@/lib/orchestrator-timer');
    startTimer();
    console.log('[Instrumentation] Orchestrator timer registered');
  }
}
