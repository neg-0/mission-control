/**
 * @module action-validation
 * @description
 * Pre-action validation engine for the fleet authority system.
 *
 * Checks agent actions against:
 * 1. Project constraints (forbidden ops, deploy allowlist, protected files)
 * 2. Role capabilities (what can this role do?)
 * 3. Role boundaries (where can this role operate?)
 *
 * Design: follows drift-score.ts pattern — async, optional PrismaClient,
 * structured return, non-fatal (callers wrap in try/catch).
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

// =============================================================================
// Types
// =============================================================================

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  blocked?: boolean;   // hard block vs. soft warning
  escalate?: boolean;  // true = create P1 alert
  checkedAt: string;   // ISO timestamp for audit
}

export interface ActionDescriptor {
  type: string;        // "deploy", "bash_exec", "file_write", "schema_change", "purchase"
  command?: string;    // raw command string (for deploy/bash)
  filePath?: string;   // target file path (for file_write)
  details?: string;    // additional context
}

export interface EffectivePermissions {
  agentId: string;
  projectId: string | null;
  roles: Array<{ name: string; scope: string; capabilities: Record<string, string> }>;
  constraints: {
    forbiddenOps: string[];
    allowedDeployCommands: string[];
    protectedFiles: string[];
  } | null;
  credentials: Array<{ credentialKey: string; accessLevel: string }>;
}

// =============================================================================
// Main Validation
// =============================================================================

/**
 * Validate an agent action against project constraints and role permissions.
 *
 * Check chain (in order):
 * 1. Load agent roles (fleet + project-scoped)
 * 2. No roles → allow (backward compat)
 * 3. Forbidden ops (project constraint)
 * 4. Deploy allowlist (project constraint)
 * 5. Protected files (project constraint + role override)
 * 6. Role capabilities
 * 7. Role boundaries
 */
export async function validateAction(
  agentId: string,
  action: ActionDescriptor,
  projectId?: string,
  db: PrismaClient = defaultPrisma,
): Promise<ValidationResult> {
  const now = new Date().toISOString();

  // 1. Load agent's roles (fleet-scoped + project-scoped)
  const agentRoles = await db.agentRole.findMany({
    where: {
      agentId,
      OR: [
        ...(projectId ? [{ projectId }] : []),
        { projectId: null }, // fleet-scoped roles always apply
      ],
    },
    include: { role: true },
  });

  // 2. No roles assigned → backward compat: allow
  if (agentRoles.length === 0) {
    return { allowed: true, reason: 'no_roles_assigned', checkedAt: now };
  }

  // 3. Load project constraints if projectId provided
  let constraints: {
    forbiddenOps: string[];
    allowedDeployCommands: string[];
    protectedFiles: string[];
  } | null = null;

  if (projectId) {
    const pc = await db.projectConstraint.findUnique({
      where: { projectId },
    });
    if (pc) {
      constraints = {
        forbiddenOps: pc.forbiddenOps,
        allowedDeployCommands: pc.allowedDeployCommands,
        protectedFiles: pc.protectedFiles,
      };
    }
  }

  // 4. Check forbidden operations
  if (constraints && action.command) {
    const forbidden = checkForbiddenOps(action.command, constraints.forbiddenOps);
    if (forbidden) {
      return {
        allowed: false,
        blocked: true,
        escalate: true,
        reason: `Forbidden operation: "${forbidden}" matched in command`,
        checkedAt: now,
      };
    }
  }

  // 5. Check deploy commands against allowlist
  if (constraints && action.type === 'deploy' && action.command) {
    const deployAllowed = checkDeployCommand(action.command, constraints.allowedDeployCommands);
    if (!deployAllowed) {
      return {
        allowed: false,
        blocked: true,
        escalate: true,
        reason: `Deploy command not in allowlist. Allowed: [${constraints.allowedDeployCommands.join(', ')}]`,
        checkedAt: now,
      };
    }
  }

  // 6. Check protected files
  if (constraints && action.filePath) {
    const isProtected = constraints.protectedFiles.some(
      (pf) => action.filePath === pf || action.filePath!.startsWith(pf + '/'),
    );
    if (isProtected) {
      // Check if any role has explicit override
      const canOverride = agentRoles.some((ar) => {
        const caps = ar.role.capabilities as Record<string, string>;
        return caps.protected_file_write === 'execute';
      });
      if (!canOverride) {
        return {
          allowed: false,
          blocked: true,
          escalate: false,
          reason: `Protected file: ${action.filePath}`,
          checkedAt: now,
        };
      }
    }
  }

  // 7. Check role capabilities
  const capCheck = checkRoleCapabilities(agentRoles, action);
  if (!capCheck.allowed) {
    return { ...capCheck, checkedAt: now };
  }

  // 8. Check role boundaries
  const boundaryCheck = checkRoleBoundaries(agentRoles, action);
  if (!boundaryCheck.allowed) {
    return { ...boundaryCheck, checkedAt: now };
  }

  return { allowed: true, checkedAt: now };
}

// =============================================================================
// Sub-checkers
// =============================================================================

function checkForbiddenOps(command: string, forbiddenOps: string[]): string | null {
  const normalizedCmd = command.toLowerCase();
  for (const op of forbiddenOps) {
    if (normalizedCmd.includes(op.toLowerCase())) {
      return op;
    }
  }
  return null;
}

function checkDeployCommand(command: string, allowedCommands: string[]): boolean {
  if (allowedCommands.length === 0) return true; // no allowlist = allow all
  const normalizedCmd = command.toLowerCase().trim();
  return allowedCommands.some((allowed) =>
    normalizedCmd.startsWith(allowed.toLowerCase()),
  );
}

function checkRoleCapabilities(
  agentRoles: Array<{ role: { capabilities: unknown } }>,
  action: ActionDescriptor,
): Omit<ValidationResult, 'checkedAt'> {
  const capKey = action.type;

  // Check if any role grants execute/admin level
  for (const ar of agentRoles) {
    const caps = ar.role.capabilities as Record<string, string>;
    const level = caps[capKey];
    if (level === 'execute' || level === 'admin') {
      return { allowed: true };
    }
  }

  // Check if any role has the capability at a lower level (request_only)
  const hasRequestOnly = agentRoles.some((ar) => {
    const caps = ar.role.capabilities as Record<string, string>;
    return caps[capKey] === 'request_only';
  });

  if (hasRequestOnly) {
    return {
      allowed: false,
      blocked: false,
      escalate: false,
      reason: `Role permits "${capKey}" at request_only level — escalation required`,
    };
  }

  // No role grants this capability
  return {
    allowed: false,
    blocked: true,
    escalate: false,
    reason: `No role grants "${capKey}" capability`,
  };
}

function checkRoleBoundaries(
  agentRoles: Array<{ role: { boundaries: unknown } }>,
  action: ActionDescriptor,
): Omit<ValidationResult, 'checkedAt'> {
  if (!action.filePath) return { allowed: true };

  for (const ar of agentRoles) {
    const bounds = ar.role.boundaries as {
      allowedDirs?: string[];
      forbiddenDirs?: string[];
    } | null;

    if (!bounds) continue;

    // Check forbidden dirs
    if (bounds.forbiddenDirs) {
      for (const dir of bounds.forbiddenDirs) {
        if (action.filePath.startsWith(dir)) {
          return {
            allowed: false,
            blocked: true,
            reason: `File "${action.filePath}" is in forbidden directory "${dir}"`,
          };
        }
      }
    }

    // Check allowed dirs (if specified, file must be within one)
    if (bounds.allowedDirs && bounds.allowedDirs.length > 0) {
      const inAllowed = bounds.allowedDirs.some((dir) =>
        action.filePath!.startsWith(dir),
      );
      if (!inAllowed) {
        return {
          allowed: false,
          blocked: true,
          reason: `File "${action.filePath}" is outside allowed directories`,
        };
      }
    }
  }

  return { allowed: true };
}

// =============================================================================
// Effective Permissions
// =============================================================================

/**
 * Get the merged effective permissions for an agent in a project context.
 * Combines fleet roles + project roles + project constraints + active credentials.
 */
export async function getEffectivePermissions(
  agentId: string,
  projectId?: string,
  db: PrismaClient = defaultPrisma,
): Promise<EffectivePermissions> {
  const [agentRoles, constraints, credentials] = await Promise.all([
    db.agentRole.findMany({
      where: {
        agentId,
        OR: [
          ...(projectId ? [{ projectId }] : []),
          { projectId: null },
        ],
      },
      include: { role: true },
    }),
    projectId
      ? db.projectConstraint.findUnique({ where: { projectId } })
      : Promise.resolve(null),
    db.credentialGrant.findMany({
      where: {
        grantedToAgent: agentId,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
        ...(projectId ? { projectId } : {}),
      },
    }),
  ]);

  return {
    agentId,
    projectId: projectId ?? null,
    roles: agentRoles.map((ar) => ({
      name: ar.role.name,
      scope: ar.role.scope,
      capabilities: ar.role.capabilities as Record<string, string>,
    })),
    constraints: constraints
      ? {
          forbiddenOps: constraints.forbiddenOps,
          allowedDeployCommands: constraints.allowedDeployCommands,
          protectedFiles: constraints.protectedFiles,
        }
      : null,
    credentials: credentials.map((c) => ({
      credentialKey: c.credentialKey,
      accessLevel: c.accessLevel,
    })),
  };
}

// =============================================================================
// Decision Log
// =============================================================================

/**
 * Record a constraint/role change with rationale for audit trail.
 */
export async function logDecision(
  entityType: string,
  entityId: string,
  field: string,
  previousValue: unknown,
  newValue: unknown,
  rationale: string,
  decidedBy: string,
  alternatives?: unknown,
  db: PrismaClient = defaultPrisma,
): Promise<string> {
  const entry = await db.decisionLog.create({
    data: {
      entityType,
      entityId,
      field,
      previousValue: (previousValue ?? undefined) as Parameters<typeof db.decisionLog.create>[0]['data']['previousValue'],
      newValue: newValue as Parameters<typeof db.decisionLog.create>[0]['data']['newValue'],
      rationale,
      alternatives: (alternatives ?? undefined) as Parameters<typeof db.decisionLog.create>[0]['data']['alternatives'],
      decidedBy,
    },
  });
  return entry.id;
}
