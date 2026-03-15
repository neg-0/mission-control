/**
 * Integration tests for the Fleet Authority & Constraint System.
 *
 * Tests validateAction(), getEffectivePermissions(), and logDecision()
 * against a real PostgreSQL test database.
 */

import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';
import {
  createTestAgent,
  createTestProject,
  createTestRole,
  createTestAgentRole,
  createTestProjectConstraint,
  createTestCredentialGrant,
} from '../helpers/factories';
import { validateAction, getEffectivePermissions, logDecision } from '../../action-validation';

beforeEach(resetDatabase);
afterAll(disconnectTestDb);

// =============================================================================
// Backward Compatibility (no roles)
// =============================================================================

describe('validateAction — no roles (backward compat)', () => {
  it('allows action when agent has no roles assigned', async () => {
    const agent = await createTestAgent();

    const result = await validateAction(
      agent.id,
      { type: 'deploy', command: 'vercel deploy' },
      undefined,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('no_roles_assigned');
  });
});

// =============================================================================
// Forbidden Operations
// =============================================================================

describe('validateAction — forbidden operations', () => {
  let agentId: string;
  let projectId: string;

  beforeEach(async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const role = await createTestRole({ capabilities: { deploy: 'execute', bash_exec: 'execute' } });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      forbiddenOps: ['DROP TABLE', 'rm -rf', 'force push'],
    });
    agentId = agent.id;
    projectId = project.id;
  });

  it('blocks exact match forbidden op', async () => {
    const result = await validateAction(
      agentId,
      { type: 'bash_exec', command: 'DROP TABLE users' },
      projectId,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.escalate).toBe(true);
    expect(result.reason).toContain('DROP TABLE');
  });

  it('blocks substring match forbidden op', async () => {
    const result = await validateAction(
      agentId,
      { type: 'bash_exec', command: 'sudo rm -rf /var/data' },
      projectId,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('rm -rf');
  });

  it('allows command not in forbidden list', async () => {
    const result = await validateAction(
      agentId,
      { type: 'bash_exec', command: 'npm run build' },
      projectId,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });

  it('is case-insensitive', async () => {
    const result = await validateAction(
      agentId,
      { type: 'bash_exec', command: 'drop table users' },
      projectId,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('DROP TABLE');
  });
});

// =============================================================================
// Deploy Command Validation
// =============================================================================

describe('validateAction — deploy commands', () => {
  it('allows deploy command in allowlist', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const role = await createTestRole({ capabilities: { deploy: 'execute' } });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      allowedDeployCommands: ['railway up', 'vercel deploy'],
    });

    const result = await validateAction(
      agent.id,
      { type: 'deploy', command: 'railway up' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });

  it('blocks deploy command not in allowlist', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const role = await createTestRole({ capabilities: { deploy: 'execute' } });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      allowedDeployCommands: ['railway up'],
    });

    const result = await validateAction(
      agent.id,
      { type: 'deploy', command: 'vercel deploy --prod' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.escalate).toBe(true);
    expect(result.reason).toContain('not in allowlist');
  });

  it('allows deploy when allowlist is empty (no restrictions)', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const role = await createTestRole({ capabilities: { deploy: 'execute' } });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      allowedDeployCommands: [],
    });

    const result = await validateAction(
      agent.id,
      { type: 'deploy', command: 'fly deploy' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });

  it('matches prefix (railway up --service x matches "railway up")', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const role = await createTestRole({ capabilities: { deploy: 'execute' } });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      allowedDeployCommands: ['railway up'],
    });

    const result = await validateAction(
      agent.id,
      { type: 'deploy', command: 'railway up --service web' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });
});

// =============================================================================
// Protected Files
// =============================================================================

describe('validateAction — protected files', () => {
  it('blocks write to protected file', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const role = await createTestRole({ capabilities: { file_write: 'execute' } });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      protectedFiles: ['.env', 'prisma/schema.prisma'],
    });

    const result = await validateAction(
      agent.id,
      { type: 'file_write', filePath: '.env' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('Protected file');
  });

  it('allows write to non-protected file', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const role = await createTestRole({ capabilities: { file_write: 'execute' } });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      protectedFiles: ['.env'],
    });

    const result = await validateAction(
      agent.id,
      { type: 'file_write', filePath: 'src/index.ts' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });

  it('allows write to protected file if role has override capability', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const role = await createTestRole({
      capabilities: { file_write: 'execute', protected_file_write: 'execute' },
    });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      protectedFiles: ['.env'],
    });

    const result = await validateAction(
      agent.id,
      { type: 'file_write', filePath: '.env' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });
});

// =============================================================================
// Role Capabilities
// =============================================================================

describe('validateAction — role capabilities', () => {
  it('allows action when role has execute capability', async () => {
    const agent = await createTestAgent();
    const role = await createTestRole({ capabilities: { deploy: 'execute' } });
    await createTestAgentRole(agent.id, role.id);

    const result = await validateAction(
      agent.id,
      { type: 'deploy', command: 'railway up' },
      undefined,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });

  it('blocks action when no role grants the capability', async () => {
    const agent = await createTestAgent();
    const role = await createTestRole({ capabilities: { deploy: 'none', code_write: 'execute' } });
    await createTestAgentRole(agent.id, role.id);

    const result = await validateAction(
      agent.id,
      { type: 'purchase', command: 'buy domain example.com' },
      undefined,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('No role grants');
  });

  it('returns request_only when role permits at lower level', async () => {
    const agent = await createTestAgent();
    const role = await createTestRole({ capabilities: { purchase: 'request_only' } });
    await createTestAgentRole(agent.id, role.id);

    const result = await validateAction(
      agent.id,
      { type: 'purchase' },
      undefined,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(false); // soft block, not hard
    expect(result.reason).toContain('request_only');
  });

  it('checks all assigned roles (any role granting execute is sufficient)', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const restrictedRole = await createTestRole({
      name: 'restricted-role',
      capabilities: { deploy: 'none' },
    });
    const deployRole = await createTestRole({
      name: 'deploy-role',
      capabilities: { deploy: 'execute' },
    });
    await createTestAgentRole(agent.id, restrictedRole.id, { projectId: project.id });
    await createTestAgentRole(agent.id, deployRole.id, { projectId: project.id });

    const result = await validateAction(
      agent.id,
      { type: 'deploy', command: 'railway up' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });
});

// =============================================================================
// Role Boundaries
// =============================================================================

describe('validateAction — role boundaries', () => {
  it('blocks file write in forbidden directory', async () => {
    const agent = await createTestAgent();
    const role = await createTestRole({
      capabilities: { file_write: 'execute' },
      boundaries: { forbiddenDirs: ['prisma/', 'src/lib/agent-runtime/'] },
    });
    await createTestAgentRole(agent.id, role.id);

    const result = await validateAction(
      agent.id,
      { type: 'file_write', filePath: 'prisma/schema.prisma' },
      undefined,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('forbidden directory');
  });

  it('blocks file write outside allowed directories', async () => {
    const agent = await createTestAgent();
    const role = await createTestRole({
      capabilities: { file_write: 'execute' },
      boundaries: { allowedDirs: ['src/__tests__/', 'e2e/'] },
    });
    await createTestAgentRole(agent.id, role.id);

    const result = await validateAction(
      agent.id,
      { type: 'file_write', filePath: 'src/lib/index.ts' },
      undefined,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('outside allowed directories');
  });

  it('allows file write in allowed directory', async () => {
    const agent = await createTestAgent();
    const role = await createTestRole({
      capabilities: { file_write: 'execute' },
      boundaries: { allowedDirs: ['src/__tests__/', 'e2e/'] },
    });
    await createTestAgentRole(agent.id, role.id);

    const result = await validateAction(
      agent.id,
      { type: 'file_write', filePath: 'src/__tests__/new-test.ts' },
      undefined,
      testPrisma,
    );

    expect(result.allowed).toBe(true);
  });
});

// =============================================================================
// Combined Checks
// =============================================================================

describe('validateAction — combined checks', () => {
  it('project constraint (forbidden op) blocks before role capability check', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    // Role grants bash_exec, but project forbids DROP TABLE
    const role = await createTestRole({ capabilities: { bash_exec: 'execute' } });
    await createTestAgentRole(agent.id, role.id, { projectId: project.id });
    await createTestProjectConstraint(project.id, {
      forbiddenOps: ['DROP TABLE'],
    });

    const result = await validateAction(
      agent.id,
      { type: 'bash_exec', command: 'psql -c "DROP TABLE users"' },
      project.id,
      testPrisma,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Forbidden operation');
    expect(result.escalate).toBe(true);
  });
});

// =============================================================================
// Effective Permissions
// =============================================================================

describe('getEffectivePermissions', () => {
  it('merges fleet-scoped and project-scoped roles', async () => {
    const agent = await createTestAgent();
    const project = await createTestProject();
    const fleetRole = await createTestRole({
      name: 'fleet-role',
      scope: 'fleet',
      capabilities: { credentials: 'admin' },
    });
    const projectRole = await createTestRole({
      name: 'project-role',
      scope: 'project',
      capabilities: { deploy: 'execute' },
    });
    await createTestAgentRole(agent.id, fleetRole.id); // fleet-scoped (projectId = null)
    await createTestAgentRole(agent.id, projectRole.id, { projectId: project.id });

    const perms = await getEffectivePermissions(agent.id, project.id, testPrisma);

    expect(perms.roles).toHaveLength(2);
    expect(perms.roles.map((r) => r.name).sort()).toEqual(['fleet-role', 'project-role']);
  });

  it('includes active credential grants', async () => {
    const agent = await createTestAgent();
    await createTestCredentialGrant({
      grantedToAgent: agent.id,
      credentialKey: 'github_pat',
      accessLevel: 'read_only',
    });

    const perms = await getEffectivePermissions(agent.id, undefined, testPrisma);

    expect(perms.credentials).toHaveLength(1);
    expect(perms.credentials[0].credentialKey).toBe('github_pat');
    expect(perms.credentials[0].accessLevel).toBe('read_only');
  });

  it('excludes expired credential grants', async () => {
    const agent = await createTestAgent();
    await createTestCredentialGrant({
      grantedToAgent: agent.id,
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
    });

    const perms = await getEffectivePermissions(agent.id, undefined, testPrisma);

    expect(perms.credentials).toHaveLength(0);
  });

  it('excludes revoked credential grants', async () => {
    const agent = await createTestAgent();
    await createTestCredentialGrant({
      grantedToAgent: agent.id,
      revokedAt: new Date(),
    });

    const perms = await getEffectivePermissions(agent.id, undefined, testPrisma);

    expect(perms.credentials).toHaveLength(0);
  });
});

// =============================================================================
// Decision Log
// =============================================================================

describe('logDecision', () => {
  it('creates a decision log entry with all fields', async () => {
    const id = await logDecision(
      'project_constraint',
      'project-123',
      'infrastructure.hosting',
      { hosting: 'vercel' },
      { hosting: 'railway' },
      'Need persistent workers for background jobs',
      'dustin',
      [{ option: 'fly.io', reason: 'considered but too expensive' }],
      testPrisma,
    );

    const entry = await testPrisma.decisionLog.findUnique({ where: { id } });

    expect(entry).not.toBeNull();
    expect(entry!.entityType).toBe('project_constraint');
    expect(entry!.entityId).toBe('project-123');
    expect(entry!.field).toBe('infrastructure.hosting');
    expect(entry!.previousValue).toEqual({ hosting: 'vercel' });
    expect(entry!.newValue).toEqual({ hosting: 'railway' });
    expect(entry!.rationale).toBe('Need persistent workers for background jobs');
    expect(entry!.decidedBy).toBe('dustin');
    expect(entry!.alternatives).toEqual([{ option: 'fly.io', reason: 'considered but too expensive' }]);
  });

  it('records entry with null previousValue and alternatives', async () => {
    const id = await logDecision(
      'role',
      'role-456',
      'capabilities.deploy',
      null,
      { deploy: 'execute' },
      'Initial role setup',
      'system',
      undefined,
      testPrisma,
    );

    const entry = await testPrisma.decisionLog.findUnique({ where: { id } });

    expect(entry).not.toBeNull();
    expect(entry!.previousValue).toBeNull();
    expect(entry!.alternatives).toBeNull();
  });
});

// =============================================================================
// Singleton Role Enforcement
// =============================================================================

describe('singleton role enforcement', () => {
  it('DB unique constraint prevents duplicate agent-role-project assignment', async () => {
    const agent = await createTestAgent();
    const role = await createTestRole();
    const project = await createTestProject();

    await createTestAgentRole(agent.id, role.id, { projectId: project.id });

    // Attempting to assign the same role to the same agent for the same project should fail
    await expect(
      createTestAgentRole(agent.id, role.id, { projectId: project.id }),
    ).rejects.toThrow();
  });
});
