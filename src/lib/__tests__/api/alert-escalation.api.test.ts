/**
 * Integration tests for alert-escalation.ts
 *
 * Tests the escalation ladder: P2→P1 (2h) and P1→P0 (2h or 3x repeat).
 * Also tests snooze behavior and acknowledge-stops-escalation.
 */
import { runEscalationLadder, snoozeAlert } from '@/lib/alert-escalation';
import { createTestCarPlayAlert } from '../helpers/factories';
import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

describe('Alert Escalation Ladder', () => {
  // ── P2 → P1 escalation ────────────────────────────────────────────

  it('escalates P2 to P1 after 2 hours', async () => {
    const alert = await createTestCarPlayAlert({
      severity: 2,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000), // 2h + 1min ago
    });

    const events = await runEscalationLadder(testPrisma);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      alertId: alert.id,
      from: 2,
      to: 1,
    });

    const updated = await testPrisma.carPlayAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.severity).toBe(1);
    expect(updated?.promotedFrom).toBe(2);
    expect(updated?.escalatedAt).toBeTruthy();
  });

  it('does NOT escalate P2 under 2 hours', async () => {
    await createTestCarPlayAlert({
      severity: 2,
      triggeredAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    });

    const events = await runEscalationLadder(testPrisma);
    expect(events).toHaveLength(0);
  });

  // ── P1 → P0 escalation ────────────────────────────────────────────

  it('escalates P1 to P0 after 2 hours', async () => {
    const alert = await createTestCarPlayAlert({
      severity: 1,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000),
    });

    const events = await runEscalationLadder(testPrisma);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      alertId: alert.id,
      from: 1,
      to: 0,
    });

    const updated = await testPrisma.carPlayAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.severity).toBe(0);
    expect(updated?.promotedFrom).toBe(1);
  });

  it('escalates P1 to P0 with 3+ repeats (even if young)', async () => {
    const alert = await createTestCarPlayAlert({
      severity: 1,
      triggeredAt: new Date(), // just created
      repeatCount: 3,
    });

    const events = await runEscalationLadder(testPrisma);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      alertId: alert.id,
      from: 1,
      to: 0,
    });
    expect(events[0].reason).toContain('repeated');
  });

  it('does NOT escalate P1 under 2 hours with < 3 repeats', async () => {
    await createTestCarPlayAlert({
      severity: 1,
      triggeredAt: new Date(),
      repeatCount: 2,
    });

    const events = await runEscalationLadder(testPrisma);
    expect(events).toHaveLength(0);
  });

  // ── P0 alerts are terminal ────────────────────────────────────────

  it('does NOT escalate P0 alerts (already at max)', async () => {
    await createTestCarPlayAlert({
      severity: 0,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS * 10),
      repeatCount: 100,
    });

    const events = await runEscalationLadder(testPrisma);
    expect(events).toHaveLength(0);
  });

  // ── Acknowledge stops escalation ──────────────────────────────────

  it('does NOT escalate acknowledged alerts', async () => {
    await createTestCarPlayAlert({
      severity: 2,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000),
      acknowledgedAt: new Date(),
      acknowledgedBy: 'dustin',
    });

    const events = await runEscalationLadder(testPrisma);
    expect(events).toHaveLength(0);
  });

  // ── Snooze pauses escalation ──────────────────────────────────────

  it('does NOT escalate snoozed alerts', async () => {
    await createTestCarPlayAlert({
      severity: 2,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000),
      snoozedUntil: new Date(Date.now() + 3600000), // snoozed for 1h
    });

    const events = await runEscalationLadder(testPrisma);
    expect(events).toHaveLength(0);
  });

  it('un-snoozes expired snoozes and allows escalation', async () => {
    const alert = await createTestCarPlayAlert({
      severity: 2,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000),
      snoozedUntil: new Date(Date.now() - 60000), // snooze expired 1min ago
    });

    const events = await runEscalationLadder(testPrisma);

    // Should escalate since snooze has expired
    expect(events).toHaveLength(1);
    expect(events[0].alertId).toBe(alert.id);

    // Snooze should be cleared
    const updated = await testPrisma.carPlayAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.snoozedUntil).toBeNull();
  });

  // ── Resolved alerts are skipped ───────────────────────────────────

  it('does NOT escalate resolved alerts', async () => {
    await createTestCarPlayAlert({
      severity: 2,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000),
      resolved: true,
      resolvedAt: new Date(),
    });

    const events = await runEscalationLadder(testPrisma);
    expect(events).toHaveLength(0);
  });

  // ── Full ladder test: P2 → P1 → P0 ───────────────────────────────

  it('escalates through full ladder: P2 → P1 → P0 across cycles', async () => {
    // Create a P2 alert that's > 2h old
    const alert = await createTestCarPlayAlert({
      severity: 2,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000),
    });

    // First cycle: P2 → P1
    const events1 = await runEscalationLadder(testPrisma);
    expect(events1).toHaveLength(1);
    expect(events1[0]).toMatchObject({ from: 2, to: 1 });

    // Update triggeredAt to simulate the P1 alert persisting another 2h+
    await testPrisma.carPlayAlert.update({
      where: { id: alert.id },
      data: { triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000) },
    });

    // Second cycle: P1 → P0
    const events2 = await runEscalationLadder(testPrisma);
    expect(events2).toHaveLength(1);
    expect(events2[0]).toMatchObject({ from: 1, to: 0 });

    // Verify final state
    const final = await testPrisma.carPlayAlert.findUnique({ where: { id: alert.id } });
    expect(final?.severity).toBe(0);
    expect(final?.promotedFrom).toBe(2); // preserves original severity
  });

  // ── Audit trail ───────────────────────────────────────────────────

  it('creates MessageLog entries for escalation events', async () => {
    await createTestCarPlayAlert({
      severity: 2,
      triggeredAt: new Date(Date.now() - TWO_HOURS_MS - 60000),
    });

    await runEscalationLadder(testPrisma);

    const logs = await testPrisma.messageLog.findMany({
      where: { fromId: 'alert-escalation-engine' },
    });

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].subject).toContain('AUTO-ESCALATE');
    expect(logs[0].subject).toContain('P2→P1');
  });

  // ── Snooze function ───────────────────────────────────────────────

  it('snoozeAlert sets snoozedUntil correctly', async () => {
    const alert = await createTestCarPlayAlert({ severity: 1 });

    const snoozed = await snoozeAlert(alert.id, 4 * 3600000, 'dustin', testPrisma);

    expect(snoozed.snoozedUntil).toBeTruthy();
    const until = new Date(snoozed.snoozedUntil!).getTime();
    const expected = Date.now() + 4 * 3600000;
    expect(until).toBeGreaterThan(expected - 5000);
    expect(until).toBeLessThan(expected + 5000);
  });
});
