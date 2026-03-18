/**
 * @module trial-preflight
 * @description
 * Automated readiness validation before the 48h autonomous trial.
 *
 * Each check returns pass/fail/warn with a message. The overall result
 * is `ready: true` only if zero checks fail.
 */

import { prisma } from './prisma';

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface PreflightCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

export interface PreflightResult {
  ready: boolean;
  checks: PreflightCheck[];
  summary: string;
}

/**
 * Run all preflight checks and return aggregate result.
 */
export async function runPreflight(): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  checks.push(await checkDatabase());
  checks.push(await checkEnvVars());
  checks.push(await checkNativeAgents());
  checks.push(checkAnthropicKey());
  checks.push(await checkOrchestratorEnabled());
  checks.push(await checkCriticalEscalations());
  checks.push(await checkRailwayToken());

  const failures = checks.filter((c) => c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warn');
  const ready = failures.length === 0;

  const summary = ready
    ? `Ready: ${checks.length} checks passed${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''}`
    : `Not ready: ${failures.length} check(s) failed — ${failures.map((f) => f.name).join(', ')}`;

  return { ready, checks, summary };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<PreflightCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { name: 'database', status: 'pass', message: 'Database is reachable' };
  } catch (err) {
    return {
      name: 'database',
      status: 'fail',
      message: `Database unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkEnvVars(): Promise<PreflightCheck> {
  const required = ['DATABASE_URL', 'NEXTAUTH_SECRET'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    return {
      name: 'env_vars',
      status: 'fail',
      message: `Missing required env vars: ${missing.join(', ')}`,
    };
  }

  return { name: 'env_vars', status: 'pass', message: 'All required env vars present' };
}

async function checkNativeAgents(): Promise<PreflightCheck> {
  const nativeAgents = await prisma.agent.count({
    where: {
      runtimeMode: 'native',
      providerPrimary: { not: null },
      modelPrimary: { not: null },
    },
  });

  if (nativeAgents === 0) {
    // With model tier routing, agents don't strictly need provider/model set,
    // but warn if no agents are configured at all
    const totalAgents = await prisma.agent.count({
      where: { runtimeMode: 'native' },
    });

    if (totalAgents === 0) {
      return {
        name: 'native_agents',
        status: 'warn',
        message: 'No native-mode agents found. Tier defaults will be used for any agents added.',
      };
    }

    return {
      name: 'native_agents',
      status: 'pass',
      message: `${totalAgents} native-mode agent(s) found. Provider will use tier defaults.`,
    };
  }

  return {
    name: 'native_agents',
    status: 'pass',
    message: `${nativeAgents} native-mode agent(s) with explicit provider/model configured`,
  };
}

function checkAnthropicKey(): PreflightCheck {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'anthropic_key',
      status: 'fail',
      message: 'ANTHROPIC_API_KEY is not set. Required for default model tiers.',
    };
  }
  return { name: 'anthropic_key', status: 'pass', message: 'ANTHROPIC_API_KEY is set' };
}

async function checkOrchestratorEnabled(): Promise<PreflightCheck> {
  const config = await prisma.orchestratorConfig.findUnique({
    where: { id: 'singleton' },
  });

  if (!config) {
    return {
      name: 'orchestrator',
      status: 'fail',
      message: 'OrchestratorConfig not found. Create it via PATCH /api/orchestrator/config.',
    };
  }

  if (!config.enabled) {
    return {
      name: 'orchestrator',
      status: 'fail',
      message: 'Orchestrator is disabled. Enable via PATCH /api/orchestrator/config { "enabled": true }.',
    };
  }

  return { name: 'orchestrator', status: 'pass', message: 'Orchestrator is enabled' };
}

async function checkCriticalEscalations(): Promise<PreflightCheck> {
  const criticalCount = await prisma.escalation.count({
    where: {
      severity: { in: ['critical', 'blocker'] },
      resolvedAt: null,
    },
  });

  if (criticalCount > 0) {
    return {
      name: 'escalations',
      status: 'warn',
      message: `${criticalCount} unresolved critical/blocker escalation(s). Consider resolving before trial.`,
    };
  }

  return { name: 'escalations', status: 'pass', message: 'No unresolved critical escalations' };
}

async function checkRailwayToken(): Promise<PreflightCheck> {
  // Only relevant if Railway projects exist
  const railwayProjects = await prisma.project.count({
    where: { railwayProjectId: { not: null } },
  });

  if (railwayProjects === 0) {
    return { name: 'railway_token', status: 'pass', message: 'No Railway projects — token check skipped' };
  }

  const lastRefresh = process.env.RAILWAY_LAST_REFRESH_AT;
  if (!lastRefresh) {
    return {
      name: 'railway_token',
      status: 'warn',
      message: 'RAILWAY_LAST_REFRESH_AT not set. Token may be expired.',
    };
  }

  const ageMs = Date.now() - new Date(lastRefresh).getTime();
  const ageHours = ageMs / (60 * 60 * 1000);

  if (ageHours > 2) {
    return {
      name: 'railway_token',
      status: 'warn',
      message: `Railway token last refreshed ${ageHours.toFixed(1)}h ago (>2h). May be expired.`,
    };
  }

  return {
    name: 'railway_token',
    status: 'pass',
    message: `Railway token refreshed ${ageHours.toFixed(1)}h ago`,
  };
}
