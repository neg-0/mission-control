/**
 * API Integration Tests: Costs
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestCostEntry } from '../helpers/factories';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { GET, POST, DELETE } from '@/app/api/costs/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Costs API', () => {
  describe('GET /api/costs', () => {
    it('returns burn rate data', async () => {
      const res = await GET();
      const { status, data } = await parseResponse<{ total: number; history: unknown[] }>(res);
      expect(status).toBe(200);
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('history');
    });

    it('includes historical entries', async () => {
      await createTestCostEntry({ service: 'Railway', amount: 25.0 });
      await createTestCostEntry({ service: 'Vercel', amount: 0.0 });

      const res = await GET();
      const { data } = await parseResponse<{ history: unknown[] }>(res);
      expect(data.history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('POST /api/costs', () => {
    it('creates a cost entry', async () => {
      const req = createTestRequest('/api/costs', {
        method: 'POST',
        body: { service: 'NewService', amount: 15.50, category: 'infra' },
      });
      const res = await POST(req);
      const { status, data } = await parseResponse<{ service: string; amount: number }>(res);
      expect(status).toBe(201);
      expect(data.service).toBe('NewService');
      expect(data.amount).toBe(15.50);
    });

    it('returns 400 without required fields', async () => {
      const req = createTestRequest('/api/costs', {
        method: 'POST',
        body: { notes: 'Missing fields' },
      });
      const res = await POST(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('upserts by service+date', async () => {
      const date = new Date(2026, 2, 1).toISOString();
      const req1 = createTestRequest('/api/costs', {
        method: 'POST',
        body: { service: 'Upsert Test', amount: 10, date },
      });
      await POST(req1);

      // Same service+date should upsert
      const req2 = createTestRequest('/api/costs', {
        method: 'POST',
        body: { service: 'Upsert Test', amount: 20, date },
      });
      const res = await POST(req2);
      const { data } = await parseResponse<{ amount: number }>(res);
      expect(data.amount).toBe(20);
    });
  });

  describe('DELETE /api/costs', () => {
    it('deletes a cost entry', async () => {
      const entry = await createTestCostEntry();
      const req = createTestRequest(`/api/costs?id=${entry.id}`, { method: 'DELETE' });
      const res = await DELETE(req);
      const { data } = await parseResponse<{ ok: boolean }>(res);
      expect(data.ok).toBe(true);
    });

    it('returns 400 without id', async () => {
      const req = createTestRequest('/api/costs', { method: 'DELETE' });
      const res = await DELETE(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });
  });
});
