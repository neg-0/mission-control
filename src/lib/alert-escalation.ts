/**
 * @module alert-escalation
 * @description
 * Alert escalation ladder — automatic severity promotion for persistent alerts.
 *
 * Escalation rules (from US-401):
 *   P2 → P1: alert persists > 2 hours without acknowledgement
 *   P1 → P0: alert persists > 2 hours OR repeats ≥ 3 times
 *
 * Guards:
 *   - Acknowledged alerts do NOT escalate (ack stops the timer)
 *   - Snoozed alerts do NOT escalate while snoozed
 *   - Already-escalated alerts are not re-escalated (idempotent)
 *   - Each escalation logs to MessageLog for audit trail
 *
 * Called by evaluateAlerts() on every evaluation cycle.
 */

import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export interface EscalationEvent {
  alertId: string;
  from: number;
  to: number;
  reason: string;
}

/**
 * Run the full escalation ladder on all unresolved alerts.
 * Returns a list of alerts that were escalated this cycle.
 */
export async function runEscalationLadder(
  db: PrismaClient = defaultPrisma,
): Promise<EscalationEvent[]> {
  const events: EscalationEvent[] = [];
  const now = Date.now();

  // Fetch all unresolved, un-acknowledged alerts that could escalate
  const candidates = await db.carPlayAlert.findMany({
    where: {
      resolved: false,
      acknowledgedAt: null, // Acknowledged alerts don't escalate
    },
  });

  for (const alert of candidates) {
    // Skip snoozed alerts (snooze pauses escalation)
    if (alert.snoozedUntil && alert.snoozedUntil.getTime() > now) {
      continue;
    }

    // Un-snooze expired snoozes (wake the alert back up)
    if (alert.snoozedUntil && alert.snoozedUntil.getTime() <= now) {
      await db.carPlayAlert.update({
        where: { id: alert.id },
        data: { snoozedUntil: null },
      });
    }

    const age = now - alert.triggeredAt.getTime();

    // P2 → P1: persists > 2 hours
    if (alert.severity === 2 && age > TWO_HOURS_MS) {
      await db.carPlayAlert.update({
        where: { id: alert.id },
        data: {
          severity: 1,
          promotedFrom: alert.promotedFrom ?? 2,
          escalatedAt: new Date(),
        },
      });

      const reason = `P2 alert persisted for ${Math.round(age / 3600000)}h without acknowledgement`;
      await logEscalation(db, alert.id, 2, 1, reason, alert.title);
      events.push({ alertId: alert.id, from: 2, to: 1, reason });
    }

    // P1 → P0: persists > 2 hours OR repeats ≥ 3
    if (alert.severity === 1 && (age > TWO_HOURS_MS || alert.repeatCount >= 3)) {
      await db.carPlayAlert.update({
        where: { id: alert.id },
        data: {
          severity: 0,
          promotedFrom: alert.promotedFrom ?? 1,
          escalatedAt: new Date(),
        },
      });

      const reason = alert.repeatCount >= 3
        ? `P1 alert repeated ${alert.repeatCount} times`
        : `P1 alert persisted for ${Math.round(age / 3600000)}h`;
      await logEscalation(db, alert.id, 1, 0, reason, alert.title);
      events.push({ alertId: alert.id, from: 1, to: 0, reason });
    }
  }

  return events;
}

/**
 * Log an escalation event to MessageLog for audit trail.
 */
async function logEscalation(
  db: PrismaClient,
  alertId: string,
  from: number,
  to: number,
  reason: string,
  title: string,
) {
  try {
    await db.messageLog.create({
      data: {
        fromId: 'alert-escalation-engine',
        toId: 'dustin',
        channel: 'escalation',
        subject: `[AUTO-ESCALATE P${from}→P${to}] ${title}`,
        body: reason,
        status: 'sent',
        metadata: { alertId, from, to, reason },
      },
    });
  } catch (err) {
    console.warn(`[AlertEscalation] Failed to log escalation for alert ${alertId}:`, err);
  }
}

/**
 * Snooze an alert for a given duration. Stops escalation while snoozed.
 * When the snooze expires, the alert returns at its current severity
 * (does NOT re-escalate from original level per US-403).
 */
export async function snoozeAlert(
  alertId: string,
  durationMs: number,
  by: string,
  db: PrismaClient = defaultPrisma,
) {
  const snoozedUntil = new Date(Date.now() + durationMs);

  const alert = await db.carPlayAlert.update({
    where: { id: alertId },
    data: { snoozedUntil },
  });

  // Audit log
  try {
    await db.messageLog.create({
      data: {
        fromId: by,
        toId: 'system',
        channel: 'escalation',
        subject: `[SNOOZE] ${alert.title}`,
        body: `Alert snoozed until ${snoozedUntil.toISOString()} by ${by}`,
        status: 'sent',
        metadata: { alertId, durationMs, snoozedUntil: snoozedUntil.toISOString() },
      },
    });
  } catch {
    // Best-effort audit
  }

  return alert;
}
