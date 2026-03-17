/**
 * API Integration Tests: Dashboard
 *
 * Note: The dashboard route reads openclaw.json and cron/jobs.json from the filesystem.
 * In the test environment these don't exist — the route handles this gracefully
 * (syncAgentsFromConfig returns [] on ENOENT, cron section defaults to empty).
 * We test the DB-driven parts of the response.
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestAgent, createTestOrchestratorConfig } from '../helpers/factories';
import { parseResponse } from '../helpers/api-test-utils';
import { GET } from '@/app/api/dashboard/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Dashboard API', () => {
  describe('GET /api/dashboard', () => {
    it('returns fleet and global stats', async () => {
      await createTestAgent({ id: 'rocket', role: 'COO' });

      const res = await GET();
      const { status, data } = await parseResponse<{
        fleet: Array<{ id: string }>;
        global: { active_agents: number };
      }>(res);
      expect(status).toBe(200);
      expect(data.fleet).toHaveLength(1);
      expect(data.fleet[0].id).toBe('rocket');
      expect(typeof data.global.active_agents).toBe('number');
    });

    it('returns empty fleet when no agents exist', async () => {
      const res = await GET();
      const { data } = await parseResponse<{ fleet: unknown[] }>(res);
      expect(data.fleet).toEqual([]);
    });

    it('includes agent health status', async () => {
      await createTestAgent({
        id: 'healthy-agent',
        lastHeartbeat: new Date(),
      });

      const res = await GET();
      const { data } = await parseResponse<{
        fleet: Array<{ id: string; health: string }>;
      }>(res);
      const agent = data.fleet.find(a => a.id === 'healthy-agent');
      expect(agent?.health).toBe('green');
    });

    it('marks inactive agents as stale/offline', async () => {
      await createTestAgent({
        id: 'stale-agent',
        lastHeartbeat: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h ago — past 24h threshold
      });

      const res = await GET();
      const { data } = await parseResponse<{
        fleet: Array<{ id: string; health: string }>;
      }>(res);
      const agent = data.fleet.find(a => a.id === 'stale-agent');
      expect(['yellow', 'red']).toContain(agent?.health);
    });

    it('includes pipeline and goals', async () => {
      const res = await GET();
      const { data } = await parseResponse<{
        pipeline: unknown[];
        goals: unknown[];
      }>(res);
      expect(Array.isArray(data.pipeline)).toBe(true);
      expect(Array.isArray(data.goals)).toBe(true);
    });
  });
});
