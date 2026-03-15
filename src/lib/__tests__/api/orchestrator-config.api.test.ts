/**
 * API Integration Tests: Orchestrator Config
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestOrchestratorConfig } from '../helpers/factories';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { GET, PATCH } from '@/app/api/orchestrator/config/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Orchestrator Config API', () => {
  describe('GET /api/orchestrator/config', () => {
    it('returns existing config', async () => {
      await createTestOrchestratorConfig({ enabled: true, maxWakesPerTick: 5 });

      const res = await GET();
      const { status, data } = await parseResponse<{ enabled: boolean; maxWakesPerTick: number }>(res);
      expect(status).toBe(200);
      expect(data.enabled).toBe(true);
      expect(data.maxWakesPerTick).toBe(5);
    });

    it('auto-creates singleton with defaults if missing', async () => {
      const res = await GET();
      const { status, data } = await parseResponse<{ id: string; enabled: boolean }>(res);
      expect(status).toBe(200);
      expect(data.id).toBe('singleton');
      expect(data.enabled).toBe(true); // Default
    });
  });

  describe('PATCH /api/orchestrator/config', () => {
    it('updates enabled status', async () => {
      await createTestOrchestratorConfig();

      const req = createTestRequest('/api/orchestrator/config', {
        method: 'PATCH',
        body: { enabled: false },
      });
      const res = await PATCH(req);
      const { data } = await parseResponse<{ enabled: boolean }>(res);
      expect(data.enabled).toBe(false);
    });

    it('updates multiple fields', async () => {
      await createTestOrchestratorConfig();

      const req = createTestRequest('/api/orchestrator/config', {
        method: 'PATCH',
        body: { maxWakesPerTick: 10, staggerDelayMs: 15000, tickIntervalMs: 120000 },
      });
      const res = await PATCH(req);
      const { data } = await parseResponse<{
        maxWakesPerTick: number;
        staggerDelayMs: number;
        tickIntervalMs: number;
      }>(res);
      expect(data.maxWakesPerTick).toBe(10);
      expect(data.staggerDelayMs).toBe(15000);
      expect(data.tickIntervalMs).toBe(120000);
    });

    it('rejects invalid maxWakesPerTick', async () => {
      const req = createTestRequest('/api/orchestrator/config', {
        method: 'PATCH',
        body: { maxWakesPerTick: 100 },
      });
      const res = await PATCH(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('upserts if singleton does not exist', async () => {
      const req = createTestRequest('/api/orchestrator/config', {
        method: 'PATCH',
        body: { enabled: true },
      });
      const res = await PATCH(req);
      const { status, data } = await parseResponse<{ id: string; enabled: boolean }>(res);
      expect(status).toBe(200);
      expect(data.id).toBe('singleton');
    });
  });
});
