import path from 'path';

/**
 * Returns the OpenClaw home directory from the OPENCLAW_HOME environment variable.
 * Throws a clear error if the variable is not set, rather than silently falling back
 * to a hardcoded VPS path.
 *
 * Set OPENCLAW_HOME in your .env (e.g. OPENCLAW_HOME=/home/neg0/.openclaw).
 */
export function getOpenClawHome(): string {
  const home = process.env.OPENCLAW_HOME;
  if (!home) throw new Error('OPENCLAW_HOME environment variable is not set');
  return home;
}

/**
 * Returns the path to the main openclaw.json config file.
 */
export function getOpenClawConfigPath(): string {
  return path.join(getOpenClawHome(), 'openclaw.json');
}
