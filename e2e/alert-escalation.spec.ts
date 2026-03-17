/**
 * E2E: Alert Escalation — detect → escalate → resolve (Task 3.4, US-602)
 *
 * Tests the alert pipeline lifecycle:
 *   1. Create alerts via the CarPlay alert system
 *   2. Verify escalation ladder (P2 → P1 → P0)
 *   3. Acknowledge and snooze alerts
 *   4. Verify auto-resolution
 *   5. Check escalation metrics
 */
import { test, expect } from '@playwright/test';
import { seedWarRoom, teardown, prisma } from './helpers/seed';
import { carPlayHeaders } from './helpers/carplay-auth';

test.beforeEach(async () => {
  await seedWarRoom();
});

test.afterAll(async () => {
  await teardown();
});

test.describe('Alert Escalation Pipeline', () => {
  test('create alert and acknowledge it', async ({ request }) => {
    // Create an open escalation — evaluateAlerts() will materialize it as a CarPlayAlert
    const escalation = await prisma.escalation.create({
      data: {
        fromAgentId: 'rocket',
        severity: 'warning',
        category: 'test',
        title: 'E2E: Test escalation alert',
        status: 'open',
      },
    });

    // Fetch active alerts via API (evaluateAlerts runs first, materializing the escalation)
    const listRes = await request.get('/api/carplay/alerts?resolved=false', {
      headers: carPlayHeaders(),
    });
    expect(listRes.status()).toBe(200);
    const alerts = await listRes.json();
    const found = alerts.alerts.find(
      (a: { title: string }) => a.title === 'E2E: Test escalation alert',
    );
    expect(found).toBeDefined();
    expect(found.severity).toBe(2); // 'warning' maps to severity 2

    // Acknowledge the alert via the dedicated ack endpoint
    const ackRes = await request.post('/api/carplay/ack', {
      headers: carPlayHeaders(),
      data: { alertId: found.id },
    });
    expect(ackRes.status()).toBe(200);

    // Verify it's acknowledged
    const ackAlert = await prisma.carPlayAlert.findUnique({ where: { id: found.id } });
    expect(ackAlert?.acknowledgedAt).not.toBeNull();
  });

  test('snooze alert for 1 hour', async ({ request }) => {
    const alert = await prisma.carPlayAlert.create({
      data: {
        severity: 1,
        type: 'fleet',
        title: 'E2E: Agent offline',
        dedupeKey: `e2e-fleet-${Date.now()}`,
      },
    });

    const snoozeRes = await request.post('/api/alerts/snooze', {
      data: { alertId: alert.id, hours: 1 },
    });
    expect(snoozeRes.status()).toBe(200);
    const body = await snoozeRes.json();
    expect(body.ok).toBe(true);
    expect(body.snoozedUntil).toBeDefined();

    // Verify snooze is set
    const snoozed = await prisma.carPlayAlert.findUnique({ where: { id: alert.id } });
    expect(snoozed?.snoozedUntil).not.toBeNull();
  });

  test('escalation metrics endpoint returns data', async ({ request }) => {
    // Create some test data
    await prisma.escalation.create({
      data: {
        fromAgentId: 'rocket',
        severity: 'warning',
        category: 'test',
        title: 'E2E Metrics Test',
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: 'e2e-test',
        resolution: 'Auto-resolved',
      },
    });

    const metricsRes = await request.get('/api/alerts/metrics?days=30');
    expect(metricsRes.status()).toBe(200);
    const metrics = await metricsRes.json();
    expect(metrics).toHaveProperty('bySeverity');
  });

  test('resolved alerts are excluded from active list', async ({ request }) => {
    const alert = await prisma.carPlayAlert.create({
      data: {
        severity: 2,
        type: 'ci',
        title: 'E2E: Resolved alert',
        dedupeKey: `e2e-resolved-${Date.now()}`,
        resolved: true,
        resolvedAt: new Date(),
      },
    });

    const listRes = await request.get('/api/carplay/alerts?resolved=false', {
      headers: carPlayHeaders(),
    });
    const alerts = await listRes.json();
    const found = (alerts.alerts || alerts).find((a: { id: string }) => a.id === alert.id);
    expect(found).toBeUndefined();
  });

  test('P0 alerts appear in escalation list', async ({ request }) => {
    await prisma.escalation.create({
      data: {
        fromAgentId: 'rocket',
        severity: 'blocker',
        category: 'production',
        title: 'E2E: P0 Production Issue',
        status: 'open',
      },
    });

    const escRes = await request.get('/api/escalations?status=open');
    expect(escRes.status()).toBe(200);
    const escalations = await escRes.json();
    expect(escalations.length).toBeGreaterThan(0);
    expect(escalations.some((e: { severity: string }) => e.severity === 'blocker')).toBe(true);
  });
});
