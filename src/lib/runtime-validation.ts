/**
 * @module lib/runtime-validation
 * @description
 * Runtime validation layer for Mission Control Phase 3.
 *
 * Implements a policy engine that evaluates agent actions against
 * security boundaries, budget constraints, and deployment rules.
 *
 * Rules are evaluated in order:
 * 1. Protected Files Check — prevent modifications to critical files
 * 2. Scope Check — enforce workspace boundaries
 * 3. Budget Check — enforce project spending limits
 * 4. Deploy Check — gate deployments by project stage
 * 5. Default Allow
 *
 * All validations are audited to MessageLog for compliance tracking.
 */

import { prisma } from '@/lib/prisma';
import { minimatch } from 'minimatch';

/**
 * Validation context — describes the action being checked
 */
export interface ValidationContext {
  /** The agent requesting the action */
  agentId: string;
  /** Action type: "file_write", "deploy", "api_call", "budget_spend", "git_commit" */
  action: 'file_write' | 'deploy' | 'api_call' | 'budget_spend' | 'git_commit';
  /** Target: file path, deploy target, API domain, etc. */
  target?: string;
  /** Cost in USD (for budget_spend actions) */
  amount?: number;
  /** Arbitrary metadata attached to the validation */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a validation check
 */
export interface ValidationResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Reason for the decision (for audit) */
  reason?: string;
  /** Which rule made the decision */
  rule: string;
}

/**
 * File patterns that cannot be modified by agents.
 *
 * Protected files include:
 * - SOUL.md — system constitution
 * - project.lock.json — dependency lock files
 * - .env* — environment configuration
 * - package-lock.json — npm lock files
 */
export const PROTECTED_FILE_PATTERNS = [
  '**/SOUL.md',
  '**/project.lock.json',
  '**/.env*',
  '**/package-lock.json',
  '**/.env.local',
  '**/.env.production',
  '**/.env.development',
  '**/.env.*.local',
  '**/mission-control/**', // Mission Control source
  '**/.git/**', // Git internals
  '**/.github/**', // GitHub workflows
];

/**
 * Checks if a file path matches any protected pattern.
 */
function isProtectedFile(targetPath: string): boolean {
  return PROTECTED_FILE_PATTERNS.some((pattern) =>
    minimatch(targetPath, pattern, { matchBase: true })
  );
}

/**
 * Main validation function — evaluates an action against all rules.
 *
 * Rules are applied in order:
 * 1. Protected Files Check
 * 2. Scope Check (workspace boundaries)
 * 3. Budget Check
 * 4. Deploy Check (by project stage)
 * 5. Default Allow
 *
 * @param ctx The validation context
 * @returns Whether the action is allowed, along with audit info
 */
export async function validateAction(
  ctx: ValidationContext
): Promise<ValidationResult> {
  // Rule 1: Protected Files Check
  if (
    (ctx.action === 'file_write' || ctx.action === 'git_commit') &&
    ctx.target &&
    isProtectedFile(ctx.target)
  ) {
    return {
      allowed: false,
      reason: `Protected file pattern: ${ctx.target}`,
      rule: 'protected_files',
    };
  }

  // Rule 2: Scope Check — file writes must be within agent's workspace
  if (ctx.action === 'file_write' && ctx.target) {
    const agent = await prisma.agent.findUnique({
      where: { id: ctx.agentId },
    });

    if (!agent) {
      return {
        allowed: false,
        reason: `Agent not found: ${ctx.agentId}`,
        rule: 'agent_not_found',
      };
    }

    // Check if target is within workspace path
    const normalizedTarget = ctx.target.replace(/\\/g, '/');
    const normalizedWorkspace = agent.workspacePath.replace(/\\/g, '/');

    if (!normalizedTarget.startsWith(normalizedWorkspace)) {
      return {
        allowed: false,
        reason: `Target outside workspace: ${ctx.target} (workspace: ${agent.workspacePath})`,
        rule: 'scope_violation',
      };
    }
  }

  // Rule 3: Budget Check — enforce project spending limits
  if (ctx.action === 'budget_spend' && ctx.amount !== undefined) {
    const agent = await prisma.agent.findUnique({
      where: { id: ctx.agentId },
      include: {
        projects: {
          select: { id: true },
        },
      },
    });

    if (!agent || agent.projects.length === 0) {
      return {
        allowed: false,
        reason: `Agent has no projects assigned`,
        rule: 'no_projects',
      };
    }

    // Get current month's spending across all agent's projects
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Query cost entries for current month
    const costEntries = await prisma.costEntry.findMany({
      where: {
        date: {
          gte: monthStart,
          lte: monthEnd,
        },
        // For now, aggregate across all costs (simpler model)
        // In production, could add projectId to CostEntry
      },
    });

    const currentSpend = costEntries.reduce((sum, entry) => sum + entry.amount, 0);
    const projectBudget = 100; // Default budget per project: $100/month
    const totalBudget = projectBudget * agent.projects.length;

    if (currentSpend + ctx.amount > totalBudget) {
      return {
        allowed: false,
        reason: `Budget exceeded: ${currentSpend + ctx.amount}/$${totalBudget} (current: $${currentSpend}, request: $${ctx.amount})`,
        rule: 'budget_exceeded',
      };
    }
  }

  // Rule 4: Deploy Check — only "beta" or "launched" projects can deploy
  if (ctx.action === 'deploy' && ctx.target) {
    const project = await prisma.project.findUnique({
      where: { id: ctx.target },
    });

    if (!project) {
      return {
        allowed: false,
        reason: `Project not found: ${ctx.target}`,
        rule: 'project_not_found',
      };
    }

    const deployableStages = ['beta', 'launched'];
    if (!deployableStages.includes(project.stage)) {
      return {
        allowed: false,
        reason: `Cannot deploy from stage "${project.stage}" (allowed: ${deployableStages.join(', ')})`,
        rule: 'deploy_stage_blocked',
      };
    }
  }

  // Rule 5: Default Allow
  return {
    allowed: true,
    rule: 'default_allow',
  };
}

/**
 * Audit function — logs validation decisions to MessageLog.
 *
 * Creates a permanent audit trail of all validation checks in the
 * MessageLog with channel="audit".
 *
 * @param ctx The original validation context
 * @param result The validation result
 */
export async function auditValidation(
  ctx: ValidationContext,
  result: ValidationResult
): Promise<void> {
  try {
    await prisma.messageLog.create({
      data: {
        fromId: ctx.agentId,
        toId: 'validation-engine',
        channel: 'audit',
        subject: `[${result.allowed ? 'ALLOW' : 'DENY'}] ${ctx.action}`,
        body: JSON.stringify({
          target: ctx.target,
          reason: result.reason,
          rule: result.rule,
          metadata: ctx.metadata,
        }),
      },
    });
  } catch (e) {
    // If auditing fails, log to console but don't throw
    console.error('[auditValidation] Failed to log validation:', e);
  }
}
