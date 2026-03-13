/**
 * Integration Tests: Drift Recovery Playbooks
 *
 * Tests missed heartbeat recovery and consecutive failure quarantine
 * against a real test database.
 */
import { recoverMissedHeartbeats, recoverFailedSessions } from '@/lib/drift-recovery';
import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';
import {
  createTestAgent,
  createTestAgentSession,
  createTestJournal,
  createTestSchedule,
  createTestRecoveryLog,
} from '../helpers/factories';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

// ---------------------------------------------------------------------------
// Playbook 1: Missed Heartbeat Recovery
// ---------------------------------------------------------------------------

describe('recoverMissedHeartbeats', () => {
  it('resets schedule when journal is overdue by 3× heartbeat interval', async () => {
    const agent = await createTestAgent({ status: 'active' });
    const schedule = await createTestSchedule(agent.id, {
      type: 'heartbeat',
      intervalMs: 30 * 60 * 1000, // 30 min
      enabled: true,
      nextRunAt: new Date(Date.now() + 60 * 60 * 1000), // 1h from now
    });
    // Journal from 2 hours ago (> 3 × 30min = 90min)
    await createTestJournal(agent.id, {
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const results = await recoverMissedHeartbeats(testPrisma);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      agentId: agent.id,
      trigger: 'missed_heartbeat',
      action: 'schedule_reset',
      outcome: 'success',
    });

    // Verify the schedule was reset to approximately now
    const updated = await testPrisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated!.nextRunAt).not.toBeNull();
    const diff = Math.abs(updated!.nextRunAt!.getTime() - Date.now());
    expect(diff).toBeLessThan(5000); // Within 5 seconds of now

    // Verify recovery was logged
    const logs = await testPrisma.recoveryLog.findMany({ where: { agentId: agent.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].trigger).toBe('missed_heartbeat');
  });

  it('skips agents with fresh journals', async () => {
    const agent = await createTestAgent({ status: 'active' });
    await createTestSchedule(agent.id, {
      type: 'heartbeat',
      intervalMs: 60 * 60 * 1000, // 1 hour
      enabled: true,
    });
    // Journal from 10 minutes ago (< 3 × 1h = 3h)
    await createTestJournal(agent.id, {
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const results = await recoverMissedHeartbeats(testPrisma);

    expect(results).toHaveLength(0);
  });

  it('skips paused agents', async () => {
    const agent = await createTestAgent({ status: 'paused' });
    await createTestSchedule(agent.id, {
      type: 'heartbeat',
      intervalMs: 30 * 60 * 1000,
      enabled: true,
    });
    await createTestJournal(agent.id, {
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    const results = await recoverMissedHeartbeats(testPrisma);

    expect(results).toHaveLength(0);
  });

  it('skips agents with no journal entries (new agents)', async () => {
    const agent = await createTestAgent({ status: 'active' });
    await createTestSchedule(agent.id, {
      type: 'heartbeat',
      intervalMs: 30 * 60 * 1000,
      enabled: true,
    });

    const results = await recoverMissedHeartbeats(testPrisma);

    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Playbook 2: Consecutive Failure Quarantine
// ---------------------------------------------------------------------------

describe('recoverFailedSessions', () => {
  it('creates recovery + escalation when 3 consecutive sessions failed', async () => {
    const agent = await createTestAgent({ status: 'active' });
    const schedule = await createTestSchedule(agent.id, {
      type: 'heartbeat',
      enabled: true,
    });

    // Create 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      await createTestAgentSession(agent.id, {
        status: 'failed',
        startedAt: new Date(Date.now() - (3 - i) * 60000),
      });
    }

    const results = await recoverFailedSessions(testPrisma);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      agentId: agent.id,
      trigger: 'consecutive_failures',
      action: 'cooldown_retry',
      outcome: 'success',
    });

    // Verify schedule was reset with cooldown
    const updated = await testPrisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated!.nextRunAt).not.toBeNull();
    // Should be approximately 60s from now
    const diff = updated!.nextRunAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(50000); // At least 50s
    expect(diff).toBeLessThan(70000); // At most 70s

    // Verify warning escalation was created
    const escalations = await testPrisma.escalation.findMany({
      where: { fromAgentId: agent.id },
    });
    expect(escalations).toHaveLength(1);
    expect(escalations[0].severity).toBe('warning');
    expect(escalations[0].title).toContain('3 consecutive session failures');

    // Verify recovery log
    const logs = await testPrisma.recoveryLog.findMany({ where: { agentId: agent.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].trigger).toBe('consecutive_failures');
  });

  it('skips recovery (cooldown guard) when recovered within the last hour', async () => {
    const agent = await createTestAgent({ status: 'active' });
    await createTestSchedule(agent.id, { type: 'heartbeat', enabled: true });

    // Create 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      await createTestAgentSession(agent.id, {
        status: 'failed',
        startedAt: new Date(Date.now() - (3 - i) * 60000),
      });
    }

    // Simulate a recent recovery attempt (30 min ago)
    await createTestRecoveryLog(agent.id, {
      trigger: 'consecutive_failures',
      action: 'cooldown_retry',
      outcome: 'success',
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    });

    const results = await recoverFailedSessions(testPrisma);

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('skipped');
    expect(results[0].details).toEqual({ reason: 'cooldown_active' });

    // Verify critical escalation was created (not warning)
    const escalations = await testPrisma.escalation.findMany({
      where: { fromAgentId: agent.id, severity: 'critical' },
    });
    expect(escalations).toHaveLength(1);
    expect(escalations[0].title).toContain('repeated failures despite recovery');
  });

  it('does not skip when previous recovery was over 1 hour ago', async () => {
    const agent = await createTestAgent({ status: 'active' });
    await createTestSchedule(agent.id, { type: 'heartbeat', enabled: true });

    for (let i = 0; i < 3; i++) {
      await createTestAgentSession(agent.id, {
        status: 'failed',
        startedAt: new Date(Date.now() - (3 - i) * 60000),
      });
    }

    // Recovery from 2 hours ago — cooldown expired
    await createTestRecoveryLog(agent.id, {
      trigger: 'consecutive_failures',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const results = await recoverFailedSessions(testPrisma);

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('success'); // Cooldown expired, retry allowed
  });

  it('skips agents with fewer than 3 sessions', async () => {
    const agent = await createTestAgent({ status: 'active' });
    await createTestAgentSession(agent.id, { status: 'failed' });
    await createTestAgentSession(agent.id, { status: 'failed' });

    const results = await recoverFailedSessions(testPrisma);

    expect(results).toHaveLength(0);
  });

  it('skips agents when not all 3 recent sessions failed', async () => {
    const agent = await createTestAgent({ status: 'active' });
    await createTestAgentSession(agent.id, {
      status: 'failed',
      startedAt: new Date(Date.now() - 3000),
    });
    await createTestAgentSession(agent.id, {
      status: 'completed', // success breaks the streak
      startedAt: new Date(Date.now() - 2000),
    });
    await createTestAgentSession(agent.id, {
      status: 'failed',
      startedAt: new Date(Date.now() - 1000),
    });

    const results = await recoverFailedSessions(testPrisma);

    expect(results).toHaveLength(0);
  });

  it('skips paused agents', async () => {
    const agent = await createTestAgent({ status: 'paused' });
    for (let i = 0; i < 3; i++) {
      await createTestAgentSession(agent.id, { status: 'failed' });
    }

    const results = await recoverFailedSessions(testPrisma);

    expect(results).toHaveLength(0);
  });
});
