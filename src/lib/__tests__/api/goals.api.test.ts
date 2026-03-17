/**
 * API Integration Tests: Goals
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestAgent, createTestGoal } from '../helpers/factories';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { GET, PATCH, POST } from '@/app/api/goals/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Goals API', () => {
  describe('GET /api/goals', () => {
    it('returns empty goals array', async () => {
      const req = createTestRequest('/api/goals');
      const res = await GET(req);
      const { status, data } = await parseResponse<{ goals: unknown[] }>(res);
      expect(status).toBe(200);
      expect(data.goals).toEqual([]);
    });

    it('returns all goals', async () => {
      const agent = await createTestAgent();
      await createTestGoal({ ownerAgentId: agent.id, title: 'Goal 1' });
      await createTestGoal({ ownerAgentId: agent.id, title: 'Goal 2' });

      const req = createTestRequest('/api/goals');
      const res = await GET(req);
      const { data } = await parseResponse<{ goals: unknown[] }>(res);
      expect(data.goals).toHaveLength(2);
    });

    it('filters by agentId', async () => {
      const a1 = await createTestAgent();
      const a2 = await createTestAgent();
      await createTestGoal({ ownerAgentId: a1.id });
      await createTestGoal({ ownerAgentId: a2.id });

      const req = createTestRequest(`/api/goals?agentId=${a1.id}`);
      const res = await GET(req);
      const { data } = await parseResponse<{ goals: unknown[] }>(res);
      expect(data.goals).toHaveLength(1);
    });

    it('filters by status', async () => {
      const agent = await createTestAgent();
      await createTestGoal({ ownerAgentId: agent.id, status: 'in_progress' });
      await createTestGoal({ ownerAgentId: agent.id, status: 'complete' });

      const req = createTestRequest('/api/goals?status=complete');
      const res = await GET(req);
      const { data } = await parseResponse<{ goals: unknown[] }>(res);
      expect(data.goals).toHaveLength(1);
    });
  });

  describe('POST /api/goals', () => {
    it('creates a new goal', async () => {
      const agent = await createTestAgent();
      const req = createTestRequest('/api/goals', {
        method: 'POST',
        body: { id: 'G-1', title: 'Ship v1', ownerAgentId: agent.id },
      });
      const res = await POST(req);
      const { status, data } = await parseResponse<{ goal: { title: string; status: string } }>(res);
      expect(status).toBe(201);
      expect(data.goal.title).toBe('Ship v1');
      expect(data.goal.status).toBe('queued');
    });

    it('returns 400 when required fields missing', async () => {
      const req = createTestRequest('/api/goals', {
        method: 'POST',
        body: { title: 'No ID' },
      });
      const res = await POST(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });
  });

  describe('PATCH /api/goals', () => {
    it('updates goal status', async () => {
      const agent = await createTestAgent();
      const goal = await createTestGoal({ ownerAgentId: agent.id });

      const req = createTestRequest('/api/goals', {
        method: 'PATCH',
        body: { id: goal.id, status: 'in_progress' },
      });
      const res = await PATCH(req);
      const { data } = await parseResponse<{ goal: { status: string } }>(res);
      expect(data.goal.status).toBe('in_progress');
    });

    it('updates goal progress', async () => {
      const agent = await createTestAgent();
      const goal = await createTestGoal({ ownerAgentId: agent.id });

      const req = createTestRequest('/api/goals', {
        method: 'PATCH',
        body: { id: goal.id, progress: 75 },
      });
      const res = await PATCH(req);
      const { data } = await parseResponse<{ goal: { progress: number } }>(res);
      expect(data.goal.progress).toBe(75);
    });

    it('rejects invalid status', async () => {
      const agent = await createTestAgent();
      const goal = await createTestGoal({ ownerAgentId: agent.id });

      const req = createTestRequest('/api/goals', {
        method: 'PATCH',
        body: { id: goal.id, status: 'invalid' },
      });
      const res = await PATCH(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('rejects progress out of range', async () => {
      const agent = await createTestAgent();
      const goal = await createTestGoal({ ownerAgentId: agent.id });

      const req = createTestRequest('/api/goals', {
        method: 'PATCH',
        body: { id: goal.id, progress: 150 },
      });
      const res = await PATCH(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('returns 400 when id is missing', async () => {
      const req = createTestRequest('/api/goals', {
        method: 'PATCH',
        body: { status: 'complete' },
      });
      const res = await PATCH(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });
  });
});
