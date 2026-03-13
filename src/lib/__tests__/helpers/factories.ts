/**
 * Test data factory functions.
 *
 * Each factory creates a database record with sensible defaults.
 * Pass overrides to customize specific fields.
 *
 * Usage:
 *   const agent = await createTestAgent({ id: 'rocket', role: 'COO' });
 *   const idea = await createTestIdea({ status: 'validating', score: 85 });
 */
import { testPrisma } from './test-db';

let counter = 0;
function nextId(prefix: string): string {
  counter++;
  return `${prefix}-${counter}-${Date.now()}`;
}

// ── Agent ──────────────────────────────────────────────────────────────

export async function createTestAgent(overrides: Record<string, unknown> = {}) {
  return testPrisma.agent.create({
    data: {
      id: nextId('test-agent'),
      role: 'Test Agent',
      workspacePath: '/tmp/test-workspace',
      status: 'active',
      ...overrides,
    },
  });
}

// ── Idea ───────────────────────────────────────────────────────────────

export async function createTestIdea(overrides: Record<string, unknown> = {}) {
  return testPrisma.idea.create({
    data: {
      id: nextId('IDEA'),
      title: 'Test Idea',
      status: 'draft',
      stage: 'pain_audit',
      ...overrides,
    },
  });
}

// ── Project ────────────────────────────────────────────────────────────

export async function createTestProject(overrides: Record<string, unknown> = {}) {
  return testPrisma.project.create({
    data: {
      id: nextId('test-project'),
      name: 'Test Project',
      stage: 'building',
      ...overrides,
    },
  });
}

// ── Goal ───────────────────────────────────────────────────────────────

export async function createTestGoal(overrides: Record<string, unknown> = {}) {
  return testPrisma.goal.create({
    data: {
      id: nextId('G'),
      title: 'Test Goal',
      status: 'queued',
      ...overrides,
    },
  });
}

// ── Task ───────────────────────────────────────────────────────────────

export async function createTestTask(overrides: Record<string, unknown> = {}) {
  return testPrisma.task.create({
    data: {
      title: 'Test Task',
      status: 'todo',
      priority: 'medium',
      ...overrides,
    },
  });
}

// ── Escalation ─────────────────────────────────────────────────────────

export async function createTestEscalation(overrides: Record<string, unknown> = {}) {
  return testPrisma.escalation.create({
    data: {
      fromAgentId: 'test-agent',
      severity: 'warning',
      category: 'test',
      title: 'Test Escalation',
      ...overrides,
    },
  });
}

// ── Schedule ───────────────────────────────────────────────────────────

export async function createTestSchedule(agentId: string, overrides: Record<string, unknown> = {}) {
  return testPrisma.schedule.create({
    data: {
      agentId,
      name: 'Test Schedule',
      cronExpr: '0 9 * * *',
      enabled: true,
      ...overrides,
    },
  });
}

// ── CostEntry ──────────────────────────────────────────────────────────

export async function createTestCostEntry(overrides: Record<string, unknown> = {}) {
  return testPrisma.costEntry.create({
    data: {
      service: `test-service-${Date.now()}`,
      amount: 10.0,
      category: 'infra',
      ...overrides,
    },
  });
}

// ── OrchestratorConfig (singleton) ─────────────────────────────────────

export async function createTestOrchestratorConfig(overrides: Record<string, unknown> = {}) {
  return testPrisma.orchestratorConfig.create({
    data: {
      id: 'singleton',
      ...overrides,
    },
  });
}

// ── CarPlayAlert ───────────────────────────────────────────────────────

export async function createTestCarPlayAlert(overrides: Record<string, unknown> = {}) {
  return testPrisma.carPlayAlert.create({
    data: {
      severity: 2,
      type: 'ci',
      title: 'Test Alert',
      dedupeKey: nextId('alert'),
      ...overrides,
    },
  });
}
