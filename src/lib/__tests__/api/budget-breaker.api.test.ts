/**
 * Integration tests for budget-breaker.ts
 *
 * Tests the budget circuit breaker: 80% warning, 100% auto-pause.
 */
import { checkAgentBudget } from '@/lib/budget-breaker';
import { createTestAgent, createTestAgentSession } from '../helpers/factories';
import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('Budget Circuit Breaker', () => {
  it('returns ok when agent is under budget', async () => {
    const agent = await createTestAgent();

    await createTestAgentSession(agent.id, {
      tokensSent: 100,
      tokensRecv: 50,
      startedAt: new Date(),
    });

    const result = await checkAgentBudget(agent.id, 1_000_000, testPrisma);

    expect(result.status).toBe('ok');
    expect(result.dailyTokens).toBe(150);
    expect(result.paused).toBe(false);
  });

  it('returns warning at 80% usage', async () => {
    const agent = await createTestAgent();

    // Create sessions totaling 850k tokens (85% of 1M)
    await createTestAgentSession(agent.id, {
      tokensSent: 500000,
      tokensRecv: 350000,
      startedAt: new Date(),
    });

    const result = await checkAgentBudget(agent.id, 1_000_000, testPrisma);

    expect(result.status).toBe('warning');
    expect(result.percentUsed).toBe(85);
    expect(result.paused).toBe(false);
  });

  it('trips breaker and pauses agent at 100% usage', async () => {
    const agent = await createTestAgent();

    await createTestAgentSession(agent.id, {
      tokensSent: 600000,
      tokensRecv: 500000,
      startedAt: new Date(),
    });

    const result = await checkAgentBudget(agent.id, 1_000_000, testPrisma);

    expect(result.status).toBe('breaker_tripped');
    expect(result.paused).toBe(true);
    expect(result.dailyTokens).toBe(1100000);

    // Verify agent is paused
    const updated = await testPrisma.agent.findUnique({ where: { id: agent.id } });
    expect(updated?.status).toBe('paused');
  });

  it('creates escalation when breaker trips', async () => {
    const agent = await createTestAgent();

    await createTestAgentSession(agent.id, {
      tokensSent: 1000000,
      tokensRecv: 500000,
      startedAt: new Date(),
    });

    await checkAgentBudget(agent.id, 1_000_000, testPrisma);

    const escalation = await testPrisma.escalation.findFirst({
      where: {
        fromAgentId: agent.id,
        category: 'budget',
      },
    });

    expect(escalation).toBeTruthy();
    expect(escalation?.severity).toBe('critical');
    expect(escalation?.title).toContain('exceeded daily token limit');
  });

  it('creates recovery log when breaker trips', async () => {
    const agent = await createTestAgent();

    await createTestAgentSession(agent.id, {
      tokensSent: 1100000,
      tokensRecv: 0,
      startedAt: new Date(),
    });

    await checkAgentBudget(agent.id, 1_000_000, testPrisma);

    const log = await testPrisma.recoveryLog.findFirst({
      where: {
        agentId: agent.id,
        trigger: 'token_burn',
      },
    });

    expect(log).toBeTruthy();
    expect(log?.action).toBe('auto_pause');
  });

  it('only counts tokens from today (UTC)', async () => {
    const agent = await createTestAgent();

    // Yesterday's session (should not count)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await createTestAgentSession(agent.id, {
      tokensSent: 999999,
      tokensRecv: 0,
      startedAt: yesterday,
    });

    // Today's small session
    await createTestAgentSession(agent.id, {
      tokensSent: 100,
      tokensRecv: 50,
      startedAt: new Date(),
    });

    const result = await checkAgentBudget(agent.id, 1_000_000, testPrisma);

    expect(result.dailyTokens).toBe(150);
    expect(result.status).toBe('ok');
  });

  it('returns ok with 0 tokens when agent has no sessions', async () => {
    const agent = await createTestAgent();

    const result = await checkAgentBudget(agent.id, 1_000_000, testPrisma);

    expect(result.dailyTokens).toBe(0);
    expect(result.status).toBe('ok');
  });
});
