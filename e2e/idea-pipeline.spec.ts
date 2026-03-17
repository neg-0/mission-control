/**
 * E2E: Idea Pipeline — create → validate → verdict (Task 3.3, US-602)
 *
 * Tests the full idea lifecycle:
 *   1. Create a new idea via POST /api/ideas
 *   2. Start a validation sprint via PATCH /api/ideas/[id]
 *   3. Capture signups via POST /api/webhooks/refinery/[ideaId]
 *   4. Issue verdict via GET /api/cron-jobs/refinery-verdict
 *   5. Verify final status is correct based on signup count
 */
import { test, expect } from '@playwright/test';
import { seedWarRoom, teardown, prisma } from './helpers/seed';

test.beforeEach(async () => {
  await seedWarRoom();
});

test.afterAll(async () => {
  await teardown();
});

test.describe('Idea Pipeline', () => {
  test('full lifecycle: create → sprint → signups → PASS verdict', async ({ request }) => {
    // 1. Create idea
    const createRes = await request.post('/api/ideas', {
      data: { title: 'E2E Test Idea', description: 'Testing the full pipeline', source: 'e2e-test' },
    });
    expect(createRes.status()).toBe(201);
    const idea = await createRes.json();
    expect(idea.status).toBe('draft');

    // 2. Start validation sprint
    const sprintRes = await request.patch(`/api/ideas/${idea.id}`, {
      data: { action: 'start_sprint' },
    });
    expect(sprintRes.status()).toBe(200);
    const sprinting = await sprintRes.json();
    expect(sprinting.status).toBe('validating');
    expect(sprinting.validationTarget).toBe(10);

    // 3. Capture 10 signups to meet the target
    for (let i = 0; i < 10; i++) {
      const signupRes = await request.post(`/api/webhooks/refinery/${idea.id}`, {
        data: { email: `user${i}@test.com`, source: 'e2e' },
      });
      expect(signupRes.status()).toBe(200);
    }

    // 4. Expire the deadline so verdict can process it
    await prisma.idea.update({
      where: { id: idea.id },
      data: { validationDeadline: new Date(Date.now() - 1000) },
    });

    // 5. Trigger verdict (Phase 1 — marks as review_failed with pending verdict)
    const verdictRes = await request.get('/api/cron-jobs/refinery-verdict');
    expect(verdictRes.status()).toBe(200);
    const verdict = await verdictRes.json();
    expect(verdict.processed).toBe(1);
    expect(verdict.results[0].decision).toBe('PASS');

    // Phase 1 sets review_failed with override window
    const midRes = await request.get(`/api/ideas/${idea.id}`);
    const midIdea = await midRes.json();
    expect(midIdea.status).toBe('review_failed');

    // 6. Expire override window and trigger Phase 2 auto-execution
    await prisma.idea.update({
      where: { id: idea.id },
      data: {
        refineryData: {
          ...((midIdea.refineryData as Record<string, unknown>) || {}),
          overrideWindowEndsAt: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });

    const phase2Res = await request.get('/api/cron-jobs/refinery-verdict');
    expect(phase2Res.status()).toBe(200);
    const phase2 = await phase2Res.json();
    const autoExec = phase2.results.find((r: { autoExecuted: boolean }) => r.autoExecuted);
    expect(autoExec).toBeDefined();

    // 7. Verify idea is now validated
    const finalRes = await request.get(`/api/ideas/${idea.id}`);
    const finalIdea = await finalRes.json();
    expect(finalIdea.status).toBe('validated');
  });

  test('FAIL verdict when signups are insufficient', async ({ request }) => {
    // Create and start sprint
    const createRes = await request.post('/api/ideas', {
      data: { title: 'Low Interest Idea', source: 'e2e-test' },
    });
    const idea = await createRes.json();

    await request.patch(`/api/ideas/${idea.id}`, {
      data: { action: 'start_sprint' },
    });

    // Only 2 signups (target is 10, threshold is 80% = 8)
    for (let i = 0; i < 2; i++) {
      await request.post(`/api/webhooks/refinery/${idea.id}`, {
        data: { email: `low${i}@test.com` },
      });
    }

    // Expire deadline and trigger verdict
    await prisma.idea.update({
      where: { id: idea.id },
      data: { validationDeadline: new Date(Date.now() - 1000) },
    });

    const verdictRes = await request.get('/api/cron-jobs/refinery-verdict');
    const verdict = await verdictRes.json();
    expect(verdict.results[0].decision).toBe('FAIL');

    // Verify status
    const finalRes = await request.get(`/api/ideas/${idea.id}`);
    const finalIdea = await finalRes.json();
    expect(finalIdea.status).toBe('review_failed');
  });

  test('NEAR_MISS verdict when signups are close', async ({ request }) => {
    const createRes = await request.post('/api/ideas', {
      data: { title: 'Almost There Idea', source: 'e2e-test' },
    });
    const idea = await createRes.json();

    await request.patch(`/api/ideas/${idea.id}`, {
      data: { action: 'start_sprint' },
    });

    // 8 signups (exactly 80% of target 10)
    for (let i = 0; i < 8; i++) {
      await request.post(`/api/webhooks/refinery/${idea.id}`, {
        data: { email: `near${i}@test.com` },
      });
    }

    await prisma.idea.update({
      where: { id: idea.id },
      data: { validationDeadline: new Date(Date.now() - 1000) },
    });

    const verdictRes = await request.get('/api/cron-jobs/refinery-verdict');
    const verdict = await verdictRes.json();
    expect(verdict.results[0].decision).toBe('NEAR_MISS');
  });

  test('duplicate signup returns success without error', async ({ request }) => {
    const createRes = await request.post('/api/ideas', {
      data: { title: 'Dedup Test', source: 'e2e-test' },
    });
    const idea = await createRes.json();

    // First signup
    const first = await request.post(`/api/webhooks/refinery/${idea.id}`, {
      data: { email: 'dupe@test.com' },
    });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.success).toBe(true);

    // Duplicate signup
    const second = await request.post(`/api/webhooks/refinery/${idea.id}`, {
      data: { email: 'dupe@test.com' },
    });
    expect(second.status()).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.status).toBe('duplicate');
  });

  test('kill and archive idea', async ({ request }) => {
    const createRes = await request.post('/api/ideas', {
      data: { title: 'Kill Me', source: 'e2e-test' },
    });
    const idea = await createRes.json();

    // Kill
    const killRes = await request.patch(`/api/ideas/${idea.id}`, {
      data: { action: 'kill' },
    });
    expect(killRes.status()).toBe(200);
    const killed = await killRes.json();
    expect(killed.status).toBe('killed');

    // Archive
    const archiveRes = await request.patch(`/api/ideas/${idea.id}`, {
      data: { action: 'archive' },
    });
    expect(archiveRes.status()).toBe(200);
    const archived = await archiveRes.json();
    expect(archived.status).toBe('archived');
  });
});
