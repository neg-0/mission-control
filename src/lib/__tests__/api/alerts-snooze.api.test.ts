/**
 * API Integration Tests: Alert Snooze + Metrics
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestCarPlayAlert, createTestEscalation } from '../helpers/factories';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { testPrisma } from '../helpers/test-db';
import { POST as postSnooze } from '@/app/api/alerts/snooze/route';
import { GET as getMetrics } from '@/app/api/alerts/metrics/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Alerts Snooze API', () => {
  describe('POST /api/alerts/snooze', () => {
    it('snoozes an alert for 1 hour', async () => {
      const alert = await createTestCarPlayAlert();

      const req = createTestRequest('/api/alerts/snooze', {
        method: 'POST',
        body: { alertId: alert.id, hours: 1 },
      });
      const res = await postSnooze(req);
      const { status, data } = await parseResponse<{ ok: boolean; snoozedUntil: string }>(res);
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.snoozedUntil).toBeDefined();

      // Verify snooze is ~1h from now
      const snoozedUntil = new Date(data.snoozedUntil).getTime();
      const expected = Date.now() + 60 * 60 * 1000;
      expect(Math.abs(snoozedUntil - expected)).toBeLessThan(5000);
    });

    it('snoozes for 4 hours', async () => {
      const alert = await createTestCarPlayAlert();
      const req = createTestRequest('/api/alerts/snooze', {
        method: 'POST',
        body: { alertId: alert.id, hours: 4 },
      });
      const res = await postSnooze(req);
      const { data } = await parseResponse<{ ok: boolean }>(res);
      expect(data.ok).toBe(true);
    });

    it('snoozes for 24 hours', async () => {
      const alert = await createTestCarPlayAlert();
      const req = createTestRequest('/api/alerts/snooze', {
        method: 'POST',
        body: { alertId: alert.id, hours: 24 },
      });
      const res = await postSnooze(req);
      const { data } = await parseResponse<{ ok: boolean }>(res);
      expect(data.ok).toBe(true);
    });

    it('rejects invalid hours', async () => {
      const alert = await createTestCarPlayAlert();
      const req = createTestRequest('/api/alerts/snooze', {
        method: 'POST',
        body: { alertId: alert.id, hours: 999 },
      });
      const res = await postSnooze(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('rejects missing alertId', async () => {
      const req = createTestRequest('/api/alerts/snooze', {
        method: 'POST',
        body: { hours: 1 },
      });
      const res = await postSnooze(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });
  });
});

describe('Alerts Metrics API', () => {
  describe('GET /api/alerts/metrics', () => {
    it('returns metrics for default period', async () => {
      const req = createTestRequest('/api/alerts/metrics');
      const res = await getMetrics(req);
      const { status, data } = await parseResponse<{ week: unknown; month: unknown }>(res);
      expect(status).toBe(200);
      expect(data.week).toBeDefined();
      expect(data.month).toBeDefined();
    });

    it('returns metrics for specific period', async () => {
      const req = createTestRequest('/api/alerts/metrics?days=14');
      const res = await getMetrics(req);
      const { status, data } = await parseResponse<{ bySeverity: unknown }>(res);
      expect(status).toBe(200);
      expect(data).toHaveProperty('bySeverity');
    });

    it('rejects invalid days', async () => {
      const req = createTestRequest('/api/alerts/metrics?days=0');
      const res = await getMetrics(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('rejects days over 365', async () => {
      const req = createTestRequest('/api/alerts/metrics?days=500');
      const res = await getMetrics(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });
  });
});
