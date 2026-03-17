/**
 * API Integration Tests: Schedules
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestAgent, createTestSchedule } from '../helpers/factories';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { GET, POST, PATCH, DELETE } from '@/app/api/schedules/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Schedules API', () => {
  describe('GET /api/schedules', () => {
    it('returns empty array', async () => {
      const req = createTestRequest('/api/schedules');
      const res = await GET(req);
      const { status, data } = await parseResponse<unknown[]>(res);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it('returns all schedules with agent info', async () => {
      const agent = await createTestAgent();
      await createTestSchedule(agent.id, { name: 'Schedule 1' });
      await createTestSchedule(agent.id, { name: 'Schedule 2' });

      const req = createTestRequest('/api/schedules');
      const res = await GET(req);
      const { data } = await parseResponse<Array<{ agent: { id: string } }>>(res);
      expect(data).toHaveLength(2);
      expect(data[0].agent.id).toBe(agent.id);
    });

    it('filters by agentId', async () => {
      const a1 = await createTestAgent();
      const a2 = await createTestAgent();
      await createTestSchedule(a1.id);
      await createTestSchedule(a2.id);

      const req = createTestRequest(`/api/schedules?agentId=${a1.id}`);
      const res = await GET(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(1);
    });

    it('filters by enabled', async () => {
      const agent = await createTestAgent();
      await createTestSchedule(agent.id, { enabled: true });
      await createTestSchedule(agent.id, { enabled: false });

      const req = createTestRequest('/api/schedules?enabled=true');
      const res = await GET(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(1);
    });
  });

  describe('POST /api/schedules', () => {
    it('creates a schedule with interval', async () => {
      const agent = await createTestAgent();
      const req = createTestRequest('/api/schedules', {
        method: 'POST',
        body: {
          agentId: agent.id,
          type: 'heartbeat',
          name: 'Test Heartbeat',
          intervalMs: 1800000,
          priority: 5,
          enabled: true,
        },
      });
      const res = await POST(req);
      const { status, data } = await parseResponse<{ name: string; intervalMs: number }>(res);
      expect(status).toBe(201);
      expect(data.name).toBe('Test Heartbeat');
      expect(data.intervalMs).toBe(1800000);
    });

    it('creates a schedule with cron', async () => {
      const agent = await createTestAgent();
      const req = createTestRequest('/api/schedules', {
        method: 'POST',
        body: {
          agentId: agent.id,
          type: 'heartbeat',
          name: 'Cron Schedule',
          cronExpr: '0 9 * * *',
          priority: 1,
          enabled: true,
        },
      });
      const res = await POST(req);
      const { status, data } = await parseResponse<{ cronExpr: string }>(res);
      expect(status).toBe(201);
      expect(data.cronExpr).toBe('0 9 * * *');
    });

    it('rejects invalid body', async () => {
      const req = createTestRequest('/api/schedules', {
        method: 'POST',
        body: { name: 'Missing agent' },
      });
      const res = await POST(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });
  });

  describe('PATCH /api/schedules', () => {
    it('updates schedule fields', async () => {
      const agent = await createTestAgent();
      const schedule = await createTestSchedule(agent.id);

      const req = createTestRequest('/api/schedules', {
        method: 'PATCH',
        body: { id: schedule.id, enabled: false, priority: 10 },
      });
      const res = await PATCH(req);
      const { data } = await parseResponse<{ enabled: boolean; priority: number }>(res);
      expect(data.enabled).toBe(false);
      expect(data.priority).toBe(10);
    });

    it('recalculates nextRunAt when interval changes', async () => {
      const agent = await createTestAgent();
      const schedule = await createTestSchedule(agent.id);

      const before = Date.now();
      const req = createTestRequest('/api/schedules', {
        method: 'PATCH',
        body: { id: schedule.id, intervalMs: 60000 },
      });
      const res = await PATCH(req);
      const { data } = await parseResponse<{ nextRunAt: string; cronExpr: string | null }>(res);
      expect(data.cronExpr).toBeNull(); // Cleared when switching to interval
      expect(new Date(data.nextRunAt).getTime()).toBeGreaterThan(before);
    });
  });

  describe('DELETE /api/schedules', () => {
    it('deletes a schedule', async () => {
      const agent = await createTestAgent();
      const schedule = await createTestSchedule(agent.id);

      const req = createTestRequest('/api/schedules', {
        method: 'DELETE',
        body: { id: schedule.id },
      });
      const res = await DELETE(req);
      const { data } = await parseResponse<{ success: boolean }>(res);
      expect(data.success).toBe(true);
    });

    it('rejects missing id', async () => {
      const req = createTestRequest('/api/schedules', {
        method: 'DELETE',
        body: {},
      });
      const res = await DELETE(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });
  });
});
