/**
 * Integration tests for escalation-metrics.ts
 *
 * Tests MTTA, MTTR, volume by severity, and false positive rate.
 */
import { getEscalationMetrics } from '@/lib/escalation-metrics';
import { createTestCarPlayAlert, createTestEscalation } from '../helpers/factories';
import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('Escalation Metrics', () => {
  it('returns zeroed metrics when no alerts exist', async () => {
    const metrics = await getEscalationMetrics(7, testPrisma);

    expect(metrics.totalAlerts).toBe(0);
    expect(metrics.acknowledged).toBe(0);
    expect(metrics.resolved).toBe(0);
    expect(metrics.mttaMs).toBeNull();
    expect(metrics.mttrMs).toBeNull();
    expect(metrics.mttaFormatted).toBe('N/A');
    expect(metrics.mttrFormatted).toBe('N/A');
    expect(metrics.slowResolutions).toBe(0);
    expect(metrics.period).toBe('7d');
  });

  it('calculates MTTA correctly', async () => {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const thirtyMinAgo = new Date(Date.now() - 1800000);

    await createTestCarPlayAlert({
      triggeredAt: oneHourAgo,
      acknowledgedAt: thirtyMinAgo, // 30min to ack
    });

    const metrics = await getEscalationMetrics(7, testPrisma);

    expect(metrics.acknowledged).toBe(1);
    expect(metrics.mttaMs).toBeGreaterThan(0);
    // MTTA should be ~30 min
    expect(metrics.mttaMs).toBeGreaterThan(1700000);
    expect(metrics.mttaMs).toBeLessThan(1900000);
  });

  it('calculates MTTR correctly', async () => {
    const twoHoursAgo = new Date(Date.now() - 7200000);
    const oneHourAgo = new Date(Date.now() - 3600000);

    await createTestCarPlayAlert({
      triggeredAt: twoHoursAgo,
      resolved: true,
      resolvedAt: oneHourAgo, // 1h to resolve
    });

    const metrics = await getEscalationMetrics(7, testPrisma);

    expect(metrics.resolved).toBe(1);
    expect(metrics.mttrMs).toBeGreaterThan(0);
    // MTTR should be ~1h
    expect(metrics.mttrMs).toBeGreaterThan(3500000);
    expect(metrics.mttrMs).toBeLessThan(3700000);
  });

  it('counts volume by severity', async () => {
    await createTestCarPlayAlert({ severity: 0 });
    await createTestCarPlayAlert({ severity: 0 });
    await createTestCarPlayAlert({ severity: 1 });
    await createTestCarPlayAlert({ severity: 2 });
    await createTestCarPlayAlert({ severity: 2 });
    await createTestCarPlayAlert({ severity: 2 });

    const metrics = await getEscalationMetrics(7, testPrisma);

    expect(metrics.totalAlerts).toBe(6);
    expect(metrics.bySeverity.P0).toBe(2);
    expect(metrics.bySeverity.P1).toBe(1);
    expect(metrics.bySeverity.P2).toBe(3);
  });

  it('flags slow resolutions (MTTR > 24h)', async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 3600000);
    const oneDayAgo = new Date(Date.now() - 24 * 3600000);

    // Slow resolution (took 48h — well over 24h threshold)
    await createTestCarPlayAlert({
      triggeredAt: threeDaysAgo,
      resolved: true,
      resolvedAt: oneDayAgo,
    });

    // Fast resolution (took 10min)
    await createTestCarPlayAlert({
      triggeredAt: new Date(Date.now() - 3600000),
      resolved: true,
      resolvedAt: new Date(Date.now() - 3000000),
    });

    const metrics = await getEscalationMetrics(30, testPrisma);

    expect(metrics.slowResolutions).toBe(1);
  });

  it('calculates false positive rate from escalations', async () => {
    // 2 resolved, 1 dismissed
    await createTestEscalation({ status: 'resolved' });
    await createTestEscalation({ status: 'resolved' });
    await createTestEscalation({ status: 'dismissed' });

    const metrics = await getEscalationMetrics(7, testPrisma);

    // FP rate = 1/3 = 33%
    expect(metrics.falsePositiveRate).toBe(33);
  });

  it('respects the time window filter', async () => {
    // Alert from 10 days ago (outside 7-day window)
    await createTestCarPlayAlert({
      triggeredAt: new Date(Date.now() - 10 * 24 * 3600000),
    });

    // Alert from today
    await createTestCarPlayAlert({
      triggeredAt: new Date(),
    });

    const metrics7d = await getEscalationMetrics(7, testPrisma);
    const metrics30d = await getEscalationMetrics(30, testPrisma);

    expect(metrics7d.totalAlerts).toBe(1);
    expect(metrics30d.totalAlerts).toBe(2);
  });
});
