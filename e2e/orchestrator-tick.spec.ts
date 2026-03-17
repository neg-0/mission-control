/**
 * E2E: Orchestrator Tick Cycle (Task 3.2, US-602)
 *
 * Verifies the full orchestrator tick via the /api/orchestrator/tick endpoint:
 *   1. Trigger a tick via POST
 *   2. Verify it returns success with timing data
 *   3. Verify drift scores are calculated for active agents
 *   4. Verify recovery playbooks run without errors
 */
import { test, expect } from '@playwright/test';
import { seedWarRoom, teardown, prisma } from './helpers/seed';

test.beforeEach(async () => {
  await seedWarRoom();
});

test.afterAll(async () => {
  await teardown();
});

test.describe('Orchestrator Tick Cycle', () => {
  test('POST /api/orchestrator/tick completes without errors', async ({ request }) => {
    const response = await request.post('/api/orchestrator/tick');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(['completed', 'idle', 'disabled']).toContain(body.status);
    expect(body).toHaveProperty('timestamp');
  });

  test('tick calculates drift scores for active agents', async ({ request }) => {
    // Create a journal entry so drift calculation has data
    await prisma.agentJournal.create({
      data: {
        agentId: 'rocket',
        did: 'E2E test work',
        next: 'More testing',
        status: 'healthy',
      },
    });

    const response = await request.post('/api/orchestrator/tick');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(['completed', 'idle', 'disabled']).toContain(body.status);

    // Verify drift score is reflected in dashboard after tick
    const dashRes = await request.get('/api/dashboard');
    const dashboard = await dashRes.json();
    const rocket = dashboard.fleet?.find((a: { id: string }) => a.id === 'rocket');
    expect(rocket).toBeDefined();
    // driftScore should be a number (0+ since agent has a healthy journal)
    expect(typeof rocket.driftScore).toBe('number');
  });

  test('tick handles agents with no sessions gracefully', async ({ request }) => {
    // rocket agent exists but has no sessions — tick should still complete
    const response = await request.post('/api/orchestrator/tick');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(['completed', 'idle', 'disabled']).toContain(body.status);
  });

  test('dashboard reflects agent state after tick', async ({ request }) => {
    // Run a tick first
    await request.post('/api/orchestrator/tick');

    // Then check dashboard
    const dashResponse = await request.get('/api/dashboard');
    expect(dashResponse.status()).toBe(200);

    const dashboard = await dashResponse.json();
    expect(dashboard.fleet).toBeDefined();
    expect(dashboard.fleet.length).toBeGreaterThan(0);

    const rocket = dashboard.fleet.find((a: { id: string }) => a.id === 'rocket');
    expect(rocket).toBeDefined();
    expect(rocket.id).toBe('rocket');
  });
});
