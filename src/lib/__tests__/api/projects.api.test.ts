/**
 * API Integration Tests: Projects
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestProject, createTestAgent } from '../helpers/factories';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { GET } from '@/app/api/projects/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Projects API', () => {
  describe('GET /api/projects', () => {
    it('returns empty array', async () => {
      const req = createTestRequest('/api/projects');
      const res = await GET(req);
      const { status, data } = await parseResponse<unknown[]>(res);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it('returns all projects with counts', async () => {
      await createTestProject({ name: 'Project A' });
      await createTestProject({ name: 'Project B' });

      const req = createTestRequest('/api/projects');
      const res = await GET(req);
      const { data } = await parseResponse<Array<{ name: string; counts: Record<string, number> }>>(res);
      expect(data).toHaveLength(2);
      expect(data[0].counts).toBeDefined();
    });

    it('filters by stage', async () => {
      await createTestProject({ stage: 'building' });
      await createTestProject({ stage: 'beta' });
      await createTestProject({ stage: 'launched' });

      const req = createTestRequest('/api/projects?stage=building,beta');
      const res = await GET(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(2);
    });

    it('includes owner agent info', async () => {
      const agent = await createTestAgent({ role: 'Frontend Dev' });
      await createTestProject({ ownerAgentId: agent.id });

      const req = createTestRequest('/api/projects');
      const res = await GET(req);
      const { data } = await parseResponse<Array<{ ownerAgent: { id: string } | null }>>(res);
      expect(data[0].ownerAgent?.id).toBe(agent.id);
    });

    it('includes checkpoint progress', async () => {
      await createTestProject();

      const req = createTestRequest('/api/projects');
      const res = await GET(req);
      const { data } = await parseResponse<Array<{ checkpointProgress: { total: number } }>>(res);
      expect(data[0].checkpointProgress).toEqual({ total: 0, passed: 0, blocked: 0 });
    });
  });
});
