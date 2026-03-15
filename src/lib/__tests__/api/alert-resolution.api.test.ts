/**
 * Integration tests for alert-resolution.ts
 *
 * Tests condition-specific auto-resolution:
 * - CI failure resolves when pipeline passes
 * - Agent offline resolves when heartbeat resumes
 * - Escalation-sourced alerts resolve when escalation is resolved
 */
import { checkAutoResolutions } from '@/lib/alert-resolution';
import {
  createTestAgent,
  createTestCarPlayAlert,
  createTestEscalation,
  createTestProject,
} from '../helpers/factories';
import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('Alert Auto-Resolution', () => {
  // ── CI resolution ─────────────────────────────────────────────────

  it('auto-resolves CI alert when pipeline passes', async () => {
    const project = await createTestProject({ id: 'ci-test-project' });

    // Create a failing pipeline
    await testPrisma.pipeline.create({
      data: {
        projectId: project.id,
        stage: 'production',
        status: 'passing', // Now passing
      },
    });

    // Create alert for CI failure
    const alert = await createTestCarPlayAlert({
      type: 'ci',
      dedupeKey: `ci:${project.id}:production`,
      title: `CI failing: ${project.name}`,
    });

    const events = await checkAutoResolutions(testPrisma);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      alertId: alert.id,
      dedupeKey: `ci:${project.id}:production`,
    });
    expect(events[0].reason).toContain('passing');

    // Verify alert is resolved
    const updated = await testPrisma.carPlayAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.resolved).toBe(true);
    expect(updated?.resolvedAt).toBeTruthy();
  });

  it('does NOT resolve CI alert when pipeline is still failing', async () => {
    const project = await createTestProject();

    await testPrisma.pipeline.create({
      data: {
        projectId: project.id,
        stage: 'staging',
        status: 'failing',
      },
    });

    await createTestCarPlayAlert({
      type: 'ci',
      dedupeKey: `ci:${project.id}:staging`,
    });

    const events = await checkAutoResolutions(testPrisma);
    expect(events).toHaveLength(0);
  });

  // ── Agent offline resolution ──────────────────────────────────────

  it('auto-resolves agent offline alert when heartbeat resumes', async () => {
    const agent = await createTestAgent({
      status: 'active',
      lastHeartbeat: new Date(), // Recent heartbeat
    });

    const alert = await createTestCarPlayAlert({
      type: 'fleet',
      dedupeKey: `agent:${agent.id}:offline`,
      title: `Agent ${agent.id} offline >2h`,
    });

    const events = await checkAutoResolutions(testPrisma);

    expect(events).toHaveLength(1);
    expect(events[0].alertId).toBe(alert.id);
    expect(events[0].reason).toContain('back online');
  });

  it('auto-resolves agent error alert when journal status recovers', async () => {
    const agent = await createTestAgent();

    // Create a healthy journal entry
    await testPrisma.agentJournal.create({
      data: {
        agentId: agent.id,
        did: 'Recovered from error',
        status: 'healthy',
      },
    });

    const alert = await createTestCarPlayAlert({
      type: 'fleet',
      dedupeKey: `agent:${agent.id}:error`,
      title: `Agent ${agent.id} is error`,
    });

    const events = await checkAutoResolutions(testPrisma);

    expect(events).toHaveLength(1);
    expect(events[0].alertId).toBe(alert.id);
    expect(events[0].reason).toContain('healthy');
  });

  // ── Escalation-sourced resolution ─────────────────────────────────

  it('auto-resolves alert when source escalation is resolved', async () => {
    const escalation = await createTestEscalation({
      status: 'resolved',
      resolvedBy: 'dustin',
      resolution: 'Fixed manually',
    });

    const alert = await createTestCarPlayAlert({
      sourceType: 'escalation',
      sourceId: escalation.id,
    });

    const events = await checkAutoResolutions(testPrisma);

    expect(events).toHaveLength(1);
    expect(events[0].alertId).toBe(alert.id);
    expect(events[0].reason).toBe('Fixed manually');
  });

  it('auto-resolves alert when source escalation is dismissed', async () => {
    const escalation = await createTestEscalation({
      status: 'dismissed',
    });

    const alert = await createTestCarPlayAlert({
      sourceType: 'escalation',
      sourceId: escalation.id,
    });

    const events = await checkAutoResolutions(testPrisma);

    expect(events).toHaveLength(1);
    expect(events[0].reason).toContain('dismissed');
  });

  it('does NOT resolve alert when source escalation is still open', async () => {
    const escalation = await createTestEscalation({
      status: 'open',
    });

    await createTestCarPlayAlert({
      sourceType: 'escalation',
      sourceId: escalation.id,
    });

    const events = await checkAutoResolutions(testPrisma);
    expect(events).toHaveLength(0);
  });

  // ── Audit trail ───────────────────────────────────────────────────

  it('logs resolution to MessageLog with resolution time', async () => {
    const escalation = await createTestEscalation({ status: 'resolved', resolvedBy: 'dustin' });

    await createTestCarPlayAlert({
      sourceType: 'escalation',
      sourceId: escalation.id,
      triggeredAt: new Date(Date.now() - 3600000), // 1h ago
    });

    await checkAutoResolutions(testPrisma);

    const logs = await testPrisma.messageLog.findMany({
      where: { fromId: 'auto-resolution-engine' },
    });

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].subject).toContain('AUTO-RESOLVED');
    expect(logs[0].body).toContain('resolution time');
  });

  // ── Already resolved alerts are skipped ───────────────────────────

  it('does NOT process already-resolved alerts', async () => {
    const escalation = await createTestEscalation({ status: 'resolved' });

    await createTestCarPlayAlert({
      sourceType: 'escalation',
      sourceId: escalation.id,
      resolved: true,
      resolvedAt: new Date(),
    });

    const events = await checkAutoResolutions(testPrisma);
    expect(events).toHaveLength(0);
  });

  // ── Cross-resolves source escalation ──────────────────────────────

  it('cross-resolves the source escalation when alert auto-resolves', async () => {
    const project = await createTestProject({ id: 'cross-resolve-project' });

    const escalation = await createTestEscalation({
      status: 'open',
      category: 'ci-failure',
    });

    // Pipeline is now passing
    await testPrisma.pipeline.create({
      data: { projectId: project.id, stage: 'main', status: 'passing' },
    });

    await createTestCarPlayAlert({
      type: 'ci',
      dedupeKey: `ci:${project.id}:main`,
      sourceType: 'escalation',
      sourceId: escalation.id,
    });

    await checkAutoResolutions(testPrisma);

    const updatedEsc = await testPrisma.escalation.findUnique({ where: { id: escalation.id } });
    expect(updatedEsc?.status).toBe('resolved');
    expect(updatedEsc?.resolvedBy).toBe('auto-resolution-engine');
  });
});
