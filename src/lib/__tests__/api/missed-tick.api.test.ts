/**
 * Integration tests for missed-tick.ts
 *
 * Tests missed tick detection, catch-up determination, and escalation.
 */
import { detectMissedTicks } from '@/lib/missed-tick';
import { createTestOrchestratorConfig } from '../helpers/factories';
import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('Missed Tick Detection', () => {
  beforeEach(async () => {
    await createTestOrchestratorConfig({ tickIntervalMs: 60000 });
  });

  it('returns 0 missed ticks when no ticks recorded yet', async () => {
    const result = await detectMissedTicks(testPrisma);

    expect(result.missedCount).toBe(0);
    expect(result.catchUpNeeded).toBe(false);
    expect(result.lastTickAt).toBeNull();
  });

  it('returns 0 missed ticks when last tick is recent', async () => {
    // Create a recent tick log
    await testPrisma.messageLog.create({
      data: {
        fromId: 'orchestrator',
        toId: 'test-agent',
        channel: 'schedule',
        body: 'Heartbeat',
        sentAt: new Date(Date.now() - 30000), // 30s ago
      },
    });

    const result = await detectMissedTicks(testPrisma);

    expect(result.missedCount).toBe(0);
    expect(result.catchUpNeeded).toBe(false);
  });

  it('detects missed ticks when gap > 2x interval', async () => {
    // Tick was 5 minutes ago (5x the 60s interval)
    await testPrisma.messageLog.create({
      data: {
        fromId: 'orchestrator',
        toId: 'test-agent',
        channel: 'schedule',
        body: 'Heartbeat',
        sentAt: new Date(Date.now() - 300000), // 5min ago
      },
    });

    const result = await detectMissedTicks(testPrisma);

    expect(result.missedCount).toBeGreaterThanOrEqual(3);
    expect(result.catchUpNeeded).toBe(true);
  });

  it('escalates after 3+ consecutive missed ticks', async () => {
    // Tick was 10 minutes ago (10x the 60s interval)
    await testPrisma.messageLog.create({
      data: {
        fromId: 'orchestrator',
        toId: 'test-agent',
        channel: 'schedule',
        body: 'Heartbeat',
        sentAt: new Date(Date.now() - 600000), // 10min ago
      },
    });

    const result = await detectMissedTicks(testPrisma);

    expect(result.missedCount).toBeGreaterThanOrEqual(3);
    expect(result.escalated).toBe(true);

    // Check escalation was created
    const escalation = await testPrisma.escalation.findFirst({
      where: {
        fromAgentId: 'orchestrator',
        category: 'orchestrator',
      },
    });

    expect(escalation).toBeTruthy();
    expect(escalation?.severity).toBe('critical');
    expect(escalation?.title).toContain('missed ticks');
  });

  it('does NOT create duplicate escalations', async () => {
    await testPrisma.messageLog.create({
      data: {
        fromId: 'orchestrator',
        toId: 'test-agent',
        channel: 'schedule',
        body: 'Heartbeat',
        sentAt: new Date(Date.now() - 600000),
      },
    });

    // Run twice
    await detectMissedTicks(testPrisma);
    await detectMissedTicks(testPrisma);

    const escalations = await testPrisma.escalation.findMany({
      where: {
        fromAgentId: 'orchestrator',
        category: 'orchestrator',
      },
    });

    expect(escalations.length).toBe(1);
  });

  it('creates recovery log for missed ticks', async () => {
    await testPrisma.messageLog.create({
      data: {
        fromId: 'orchestrator',
        toId: 'test-agent',
        channel: 'schedule',
        body: 'Heartbeat',
        sentAt: new Date(Date.now() - 300000),
      },
    });

    await detectMissedTicks(testPrisma);

    const log = await testPrisma.recoveryLog.findFirst({
      where: {
        agentId: 'orchestrator',
        trigger: 'missed_ticks',
      },
    });

    expect(log).toBeTruthy();
    expect(log?.action).toBe('catch_up');
  });
});
