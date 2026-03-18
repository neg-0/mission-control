/**
 * API Integration Tests: Tasks
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestAgent, createTestGoal, createTestTask } from '../helpers/factories';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { testPrisma } from '../helpers/test-db';
import { GET, POST, PATCH } from '@/app/api/tasks/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Tasks API', () => {
  describe('GET /api/tasks', () => {
    it('returns empty array', async () => {
      const req = createTestRequest('/api/tasks');
      const res = await GET(req);
      const { status, data } = await parseResponse<unknown[]>(res);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it('returns all tasks', async () => {
      await createTestTask({ title: 'Task A' });
      await createTestTask({ title: 'Task B' });

      const req = createTestRequest('/api/tasks');
      const res = await GET(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(2);
    });

    it('filters by status', async () => {
      await createTestTask({ status: 'todo' });
      await createTestTask({ status: 'done', completedAt: new Date() });

      const req = createTestRequest('/api/tasks?status=done');
      const res = await GET(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(1);
    });

    it('excludes by status', async () => {
      await createTestTask({ status: 'todo' });
      await createTestTask({ status: 'done', completedAt: new Date() });

      const req = createTestRequest('/api/tasks?excludeStatus=done');
      const res = await GET(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(1);
    });

    it('filters by goalId', async () => {
      const agent = await createTestAgent();
      const goal = await createTestGoal({ ownerAgentId: agent.id });
      await createTestTask({ goalId: goal.id });
      await createTestTask(); // No goal

      const req = createTestRequest(`/api/tasks?goalId=${goal.id}`);
      const res = await GET(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(1);
    });
  });

  describe('POST /api/tasks', () => {
    it('creates a task with defaults', async () => {
      const req = createTestRequest('/api/tasks', {
        method: 'POST',
        body: { title: 'New Task' },
      });
      const res = await POST(req);
      const { status, data } = await parseResponse<{ title: string; status: string; priority: string }>(res);
      expect(status).toBe(200);
      expect(data.title).toBe('New Task');
      expect(data.status).toBe('todo');
      expect(data.priority).toBe('medium');
    });

    it('returns 400 without title', async () => {
      const req = createTestRequest('/api/tasks', {
        method: 'POST',
        body: { description: 'No title' },
      });
      const res = await POST(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('recalculates goal progress when adding task to goal', async () => {
      const agent = await createTestAgent();
      const goal = await createTestGoal({ ownerAgentId: agent.id, progress: 100, status: 'complete' });

      const req = createTestRequest('/api/tasks', {
        method: 'POST',
        body: { title: 'New Task', goalId: goal.id },
      });
      await POST(req);

      // Goal should no longer be 100% complete
      const updatedGoal = await testPrisma.goal.findUnique({ where: { id: goal.id } });
      expect(updatedGoal?.progress).toBe(0);
    });
  });

  describe('PATCH /api/tasks', () => {
    it('updates task status', async () => {
      const task = await createTestTask();
      const req = createTestRequest('/api/tasks', {
        method: 'PATCH',
        body: { id: task.id, status: 'done' },
      });
      const res = await PATCH(req);
      const { data } = await parseResponse<{ status: string; completedAt: string }>(res);
      expect(data.status).toBe('done');
      expect(data.completedAt).toBeDefined();
    });

    it('returns 400 without id', async () => {
      const req = createTestRequest('/api/tasks', {
        method: 'PATCH',
        body: { status: 'done' },
      });
      const res = await PATCH(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('recalculates goal progress when completing task', async () => {
      const agent = await createTestAgent();
      const goal = await createTestGoal({ ownerAgentId: agent.id });
      const _task1 = await createTestTask({ goalId: goal.id, status: 'done', completedAt: new Date() });
      const task2 = await createTestTask({ goalId: goal.id, status: 'todo' });

      // Complete the second task
      const req = createTestRequest('/api/tasks', {
        method: 'PATCH',
        body: { id: task2.id, status: 'done' },
      });
      await PATCH(req);

      const updatedGoal = await testPrisma.goal.findUnique({ where: { id: goal.id } });
      expect(updatedGoal?.progress).toBe(100);
      expect(updatedGoal?.status).toBe('complete');
    });
  });
});
