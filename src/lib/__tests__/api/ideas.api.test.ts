/**
 * API Integration Tests: Ideas Pipeline
 *
 * Tests the full idea CRUD lifecycle, validation sprints,
 * waitlist signups, verdicts, and post-mortems.
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestIdea } from '../helpers/factories';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { testPrisma } from '../helpers/test-db';

// Route handlers
import { GET as getIdeas, POST as postIdeas } from '@/app/api/ideas/route';
import { GET as getIdea, PATCH as patchIdea, DELETE as deleteIdea } from '@/app/api/ideas/[id]/route';
import { POST as postWebhook } from '@/app/api/webhooks/refinery/[ideaId]/route';
import { GET as getVerdict } from '@/app/api/cron-jobs/refinery-verdict/route';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Ideas API', () => {
  // ── GET /api/ideas ──────────────────────────────────────────────────
  describe('GET /api/ideas', () => {
    it('returns empty array when no ideas exist', async () => {
      const req = createTestRequest('/api/ideas');
      const res = await getIdeas(req);
      const { status, data } = await parseResponse<unknown[]>(res);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it('returns all non-archived ideas', async () => {
      await createTestIdea({ title: 'Idea A' });
      await createTestIdea({ title: 'Idea B' });
      await createTestIdea({ title: 'Archived', status: 'archived' });

      const req = createTestRequest('/api/ideas');
      const res = await getIdeas(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(2);
    });

    it('filters by status', async () => {
      await createTestIdea({ status: 'draft' });
      await createTestIdea({ status: 'validating' });

      const req = createTestRequest('/api/ideas?status=validating');
      const res = await getIdeas(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(1);
    });

    it('includes archived when requested', async () => {
      await createTestIdea({ status: 'archived' });

      const req = createTestRequest('/api/ideas?includeArchived=true');
      const res = await getIdeas(req);
      const { data } = await parseResponse<unknown[]>(res);
      expect(data).toHaveLength(1);
    });
  });

  // ── POST /api/ideas ─────────────────────────────────────────────────
  describe('POST /api/ideas', () => {
    it('creates a new idea with defaults', async () => {
      const req = createTestRequest('/api/ideas', {
        method: 'POST',
        body: { title: 'New Idea', description: 'A test idea' },
      });
      const res = await postIdeas(req);
      const { status, data } = await parseResponse<{ title: string; status: string; stage: string }>(res);
      expect(status).toBe(201);
      expect(data.title).toBe('New Idea');
      expect(data.status).toBe('draft');
      expect(data.stage).toBe('pain_audit');
    });

    it('returns 400 when title is missing', async () => {
      const req = createTestRequest('/api/ideas', {
        method: 'POST',
        body: { description: 'No title' },
      });
      const res = await postIdeas(req);
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('bulk archives killed ideas older than N days', async () => {
      await createTestIdea({
        status: 'killed',
        updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });
      await createTestIdea({ status: 'killed' }); // Recent — should NOT be archived

      const req = createTestRequest('/api/ideas', {
        method: 'POST',
        body: { action: 'bulk_archive', olderThanDays: 3 },
      });
      const res = await postIdeas(req);
      const { data } = await parseResponse<{ archived: number }>(res);
      expect(data.archived).toBe(1);
    });
  });

  // ── GET /api/ideas/[id] ─────────────────────────────────────────────
  describe('GET /api/ideas/[id]', () => {
    it('returns idea by id', async () => {
      const idea = await createTestIdea({ title: 'Specific Idea' });
      const req = createTestRequest(`/api/ideas/${idea.id}`);
      const res = await getIdea(req, { params: { id: idea.id } });
      const { status, data } = await parseResponse<{ title: string }>(res);
      expect(status).toBe(200);
      expect(data.title).toBe('Specific Idea');
    });

    it('returns 404 for non-existent idea', async () => {
      const req = createTestRequest('/api/ideas/nonexistent');
      const res = await getIdea(req, { params: { id: 'nonexistent' } });
      const { status } = await parseResponse(res);
      expect(status).toBe(404);
    });
  });

  // ── PATCH /api/ideas/[id] ───────────────────────────────────────────
  describe('PATCH /api/ideas/[id]', () => {
    it('starts a validation sprint', async () => {
      const idea = await createTestIdea({ status: 'refining' });
      const req = createTestRequest(`/api/ideas/${idea.id}`, {
        method: 'PATCH',
        body: { action: 'start_sprint' },
      });
      const res = await patchIdea(req, { params: { id: idea.id } });
      const { status, data } = await parseResponse<{ status: string; validationTarget: number }>(res);
      expect(status).toBe(200);
      expect(data.status).toBe('validating');
      expect(data.validationTarget).toBe(10);
    });

    it('kills an idea', async () => {
      const idea = await createTestIdea();
      const req = createTestRequest(`/api/ideas/${idea.id}`, {
        method: 'PATCH',
        body: { action: 'kill' },
      });
      const res = await patchIdea(req, { params: { id: idea.id } });
      const { data } = await parseResponse<{ status: string }>(res);
      expect(data.status).toBe('killed');
    });

    it('archives an idea', async () => {
      const idea = await createTestIdea({ status: 'killed' });
      const req = createTestRequest(`/api/ideas/${idea.id}`, {
        method: 'PATCH',
        body: { action: 'archive' },
      });
      const res = await patchIdea(req, { params: { id: idea.id } });
      const { data } = await parseResponse<{ status: string }>(res);
      expect(data.status).toBe('archived');
    });

    it('graduates an idea to a project', async () => {
      const idea = await createTestIdea({ status: 'validated', title: 'Graduate Me' });
      const req = createTestRequest(`/api/ideas/${idea.id}`, {
        method: 'PATCH',
        body: { action: 'graduate' },
      });
      const res = await patchIdea(req, { params: { id: idea.id } });
      const { data } = await parseResponse<{ ideaId: string; projectId: string }>(res);
      expect(data.ideaId).toBe(idea.id);
      expect(data.projectId).toBeDefined();

      // Verify project was created
      const project = await testPrisma.project.findUnique({ where: { id: data.projectId } });
      expect(project?.name).toBe('Graduate Me');
    });

    it('updates standard fields', async () => {
      const idea = await createTestIdea();
      const req = createTestRequest(`/api/ideas/${idea.id}`, {
        method: 'PATCH',
        body: { title: 'Updated Title', score: 85 },
      });
      const res = await patchIdea(req, { params: { id: idea.id } });
      const { data } = await parseResponse<{ title: string; score: number }>(res);
      expect(data.title).toBe('Updated Title');
      expect(data.score).toBe(85);
    });
  });

  // ── DELETE /api/ideas/[id] ──────────────────────────────────────────
  describe('DELETE /api/ideas/[id]', () => {
    it('deletes an idea', async () => {
      const idea = await createTestIdea();
      const req = createTestRequest(`/api/ideas/${idea.id}`, { method: 'DELETE' });
      const res = await deleteIdea(req, { params: { id: idea.id } });
      const { status } = await parseResponse(res);
      expect(status).toBe(200);

      const deleted = await testPrisma.idea.findUnique({ where: { id: idea.id } });
      expect(deleted).toBeNull();
    });
  });

  // ── POST /api/webhooks/refinery/[ideaId] ────────────────────────────
  describe('POST /api/webhooks/refinery/[ideaId]', () => {
    it('records a waitlist signup', async () => {
      const idea = await createTestIdea({ status: 'validating' });
      const req = createTestRequest(`/api/webhooks/refinery/${idea.id}`, {
        method: 'POST',
        body: { email: 'test@example.com', source: 'api-test' },
      });
      const res = await postWebhook(req, { params: { ideaId: idea.id } });
      const { status, data } = await parseResponse<{ success: boolean; count: number }>(res);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.count).toBe(1);
    });

    it('deduplicates by email', async () => {
      const idea = await createTestIdea({ status: 'validating' });

      // First signup
      const req1 = createTestRequest(`/api/webhooks/refinery/${idea.id}`, {
        method: 'POST',
        body: { email: 'dupe@example.com' },
      });
      await postWebhook(req1, { params: { ideaId: idea.id } });

      // Duplicate
      const req2 = createTestRequest(`/api/webhooks/refinery/${idea.id}`, {
        method: 'POST',
        body: { email: 'dupe@example.com' },
      });
      const res = await postWebhook(req2, { params: { ideaId: idea.id } });
      const { data } = await parseResponse<{ status: string }>(res);
      expect(data.status).toBe('duplicate');
    });

    it('returns 400 without email', async () => {
      const idea = await createTestIdea();
      const req = createTestRequest(`/api/webhooks/refinery/${idea.id}`, {
        method: 'POST',
        body: { source: 'test' },
      });
      const res = await postWebhook(req, { params: { ideaId: idea.id } });
      const { status } = await parseResponse(res);
      expect(status).toBe(400);
    });

    it('returns 404 for non-existent idea', async () => {
      const req = createTestRequest('/api/webhooks/refinery/fake-id', {
        method: 'POST',
        body: { email: 'test@example.com' },
      });
      const res = await postWebhook(req, { params: { ideaId: 'fake-id' } });
      const { status } = await parseResponse(res);
      expect(status).toBe(404);
    });
  });

  // ── GET /api/cron-jobs/refinery-verdict ──────────────────────────────
  // The cron route now uses processVerdicts() which implements a two-phase
  // verdict with override window. Phase 1 marks as pending (review_failed),
  // Phase 2 auto-executes after override window expires.
  describe('GET /api/cron-jobs/refinery-verdict', () => {
    it('marks expired sprint as pending verdict (Phase 1)', async () => {
      const idea = await createTestIdea({
        status: 'validating',
        validationTarget: 3,
        validationDeadline: new Date(Date.now() - 1000),
      });

      for (let i = 0; i < 3; i++) {
        await testPrisma.waitlistSignup.create({
          data: { ideaId: idea.id, email: `pass${i}@test.com` },
        });
      }

      const res = await getVerdict();
      const { data } = await parseResponse<{
        processed: number;
        results: Array<{ decision: string; autoExecuted: boolean }>;
      }>(res);
      expect(data.processed).toBe(1);
      expect(data.results[0].decision).toBe('PASS');
      expect(data.results[0].autoExecuted).toBe(false); // Pending override window
    });

    it('calculates FAIL verdict when signups are below threshold', async () => {
      const idea = await createTestIdea({
        status: 'validating',
        validationTarget: 10,
        validationDeadline: new Date(Date.now() - 1000),
      });

      await testPrisma.waitlistSignup.create({
        data: { ideaId: idea.id, email: 'fail@test.com' },
      });

      const res = await getVerdict();
      const { data } = await parseResponse<{
        results: Array<{ decision: string }>;
      }>(res);
      expect(data.results[0].decision).toBe('FAIL');
    });

    it('skips ideas still within deadline', async () => {
      await createTestIdea({
        status: 'validating',
        validationDeadline: new Date(Date.now() + 86400000),
      });

      const res = await getVerdict();
      const { data } = await parseResponse<{ processed: number }>(res);
      expect(data.processed).toBe(0);
    });

    it('auto-executes PASS verdicts past override window (Phase 2)', async () => {
      const idea = await createTestIdea({
        status: 'review_failed',
        refineryData: {
          pendingVerdict: 'PASS',
          verdictSignups: 12,
          verdictTarget: 10,
          overrideWindowEndsAt: new Date(Date.now() - 1000).toISOString(),
          verdictCalculatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        },
      });

      const res = await getVerdict();
      const { data } = await parseResponse<{
        results: Array<{ decision: string; autoExecuted: boolean }>;
      }>(res);
      const autoExec = data.results.find(r => r.autoExecuted);
      expect(autoExec).toBeDefined();
      expect(autoExec?.decision).toBe('PASS');

      // Verify idea promoted to validated
      const updated = await testPrisma.idea.findUnique({ where: { id: idea.id } });
      expect(updated?.status).toBe('validated');
    });
  });
});
