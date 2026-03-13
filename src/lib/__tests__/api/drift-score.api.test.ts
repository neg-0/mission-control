/**
 * Integration Tests: Drift Score Engine
 *
 * Tests each detector independently and combined scoring against a real
 * test database. Validates the additive scoring model and edge cases.
 */
import { calculateDriftScore } from '@/lib/drift-score';
import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';
import {
  createTestAgent,
  createTestAgentSession,
  createTestJournal,
  createTestSchedule,
} from '../helpers/factories';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

// ---------------------------------------------------------------------------
// Edge cases: no data
// ---------------------------------------------------------------------------

describe('calculateDriftScore — edge cases', () => {
  it('returns score 0 for a new agent with no sessions or journals', async () => {
    const agent = await createTestAgent();
    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it('returns score 0 for an agent with only successful sessions and fresh journal', async () => {
    const agent = await createTestAgent();
    await createTestAgentSession(agent.id, { status: 'completed', toolCalls: 5 });
    await createTestJournal(agent.id);

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(0);
    expect(result.signals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Detector 1: Consecutive Failures
// ---------------------------------------------------------------------------

describe('Detector: Consecutive Failures', () => {
  it('scores +15 for 1 consecutive failure', async () => {
    const agent = await createTestAgent();
    await createTestAgentSession(agent.id, { status: 'failed' });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(15);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toContain('1 consecutive session failure');
  });

  it('scores +30 for 2 consecutive failures', async () => {
    const agent = await createTestAgent();
    // Older session first (lower startedAt), then newer
    await createTestAgentSession(agent.id, {
      status: 'failed',
      startedAt: new Date(Date.now() - 60000),
    });
    await createTestAgentSession(agent.id, {
      status: 'failed',
      startedAt: new Date(),
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(30);
    expect(result.signals[0]).toContain('2 consecutive session failures');
  });

  it('scores +50 for 3+ consecutive failures', async () => {
    const agent = await createTestAgent();
    for (let i = 0; i < 4; i++) {
      await createTestAgentSession(agent.id, {
        status: i % 2 === 0 ? 'failed' : 'timeout',
        startedAt: new Date(Date.now() - (4 - i) * 60000),
      });
    }

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(50);
    expect(result.signals[0]).toContain('4 consecutive session failures');
  });

  it('resets on a successful session in between', async () => {
    const agent = await createTestAgent();
    // failed, failed, completed, failed (only 1 consecutive from most recent)
    await createTestAgentSession(agent.id, {
      status: 'failed',
      startedAt: new Date(Date.now() - 4000),
    });
    await createTestAgentSession(agent.id, {
      status: 'failed',
      startedAt: new Date(Date.now() - 3000),
    });
    await createTestAgentSession(agent.id, {
      status: 'completed',
      startedAt: new Date(Date.now() - 2000),
    });
    await createTestAgentSession(agent.id, {
      status: 'failed',
      startedAt: new Date(Date.now() - 1000),
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(15); // Only the most recent 1 failure counts
  });

  it('includes timeout sessions in failure count', async () => {
    const agent = await createTestAgent();
    await createTestAgentSession(agent.id, {
      status: 'timeout',
      startedAt: new Date(Date.now() - 2000),
    });
    await createTestAgentSession(agent.id, {
      status: 'timeout',
      startedAt: new Date(Date.now() - 1000),
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Detector 2: Journal Staleness
// ---------------------------------------------------------------------------

describe('Detector: Journal Staleness', () => {
  it('scores +30 when journal is stale relative to heartbeat schedule', async () => {
    const agent = await createTestAgent();
    // Heartbeat every 30 minutes
    await createTestSchedule(agent.id, {
      type: 'heartbeat',
      intervalMs: 30 * 60 * 1000,
    });
    // Journal from 2 hours ago (> 3 × 30min = 90min threshold)
    await createTestJournal(agent.id, {
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(30);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toContain('No journal entry in');
  });

  it('scores 0 when journal is fresh relative to heartbeat schedule', async () => {
    const agent = await createTestAgent();
    await createTestSchedule(agent.id, {
      type: 'heartbeat',
      intervalMs: 60 * 60 * 1000, // 1 hour
    });
    // Journal from 30 minutes ago (< 3 × 1h = 3h threshold)
    await createTestJournal(agent.id, {
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(0);
  });

  it('uses 2h fallback when no heartbeat schedule exists', async () => {
    const agent = await createTestAgent();
    // Journal from 3 hours ago (> 2h fallback)
    await createTestJournal(agent.id, {
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(30);
    expect(result.signals[0]).toContain('No journal entry in');
  });

  it('returns null (no points) when agent has no journal entries', async () => {
    const agent = await createTestAgent();

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Detector 3: Token Burn
// ---------------------------------------------------------------------------

describe('Detector: Token Burn', () => {
  it('scores +30 when last session had high tokens and zero tool calls', async () => {
    const agent = await createTestAgent();
    await createTestAgentSession(agent.id, {
      status: 'completed',
      tokensSent: 30000,
      tokensRecv: 25000, // total 55k > 50k threshold
      toolCalls: 0,
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(30);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toContain('burned');
    expect(result.signals[0]).toContain('0 tool calls');
  });

  it('scores 0 when tokens are high but tool calls exist', async () => {
    const agent = await createTestAgent();
    await createTestAgentSession(agent.id, {
      status: 'completed',
      tokensSent: 30000,
      tokensRecv: 25000,
      toolCalls: 3, // has tool calls → not spinning
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(0);
  });

  it('scores 0 when tokens are low even with zero tool calls', async () => {
    const agent = await createTestAgent();
    await createTestAgentSession(agent.id, {
      status: 'completed',
      tokensSent: 5000,
      tokensRecv: 3000, // total 8k < 50k threshold
      toolCalls: 0,
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Combined scoring
// ---------------------------------------------------------------------------

describe('Combined scoring', () => {
  it('adds points from multiple detectors', async () => {
    const agent = await createTestAgent();
    // 3 consecutive failures (+50)
    for (let i = 0; i < 3; i++) {
      await createTestAgentSession(agent.id, {
        status: 'failed',
        startedAt: new Date(Date.now() - (3 - i) * 60000),
      });
    }
    // Stale journal (+30)
    await createTestJournal(agent.id, {
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(80); // 50 + 30
    expect(result.signals).toHaveLength(2);
  });

  it('caps score at 100', async () => {
    const agent = await createTestAgent();
    // 3 consecutive failures (+50)
    for (let i = 0; i < 3; i++) {
      await createTestAgentSession(agent.id, {
        status: 'failed',
        tokensSent: 30000,
        tokensRecv: 25000,
        toolCalls: 0,
        startedAt: new Date(Date.now() - (3 - i) * 60000),
      });
    }
    // Stale journal (+30)
    await createTestJournal(agent.id, {
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });
    // Token burn is also triggered on last session (+30)
    // Total would be 50 + 30 + 30 = 110 → capped at 100

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(100);
    expect(result.signals).toHaveLength(3);
  });

  it('auto-pause threshold (>80) requires 2+ concurrent problems', async () => {
    const agent = await createTestAgent();
    // Only consecutive failures — max +50, not enough for auto-pause
    for (let i = 0; i < 5; i++) {
      await createTestAgentSession(agent.id, {
        status: 'failed',
        startedAt: new Date(Date.now() - (5 - i) * 60000),
      });
    }
    // Fresh journal — no staleness points
    await createTestJournal(agent.id);

    const result = await calculateDriftScore(agent.id, testPrisma);

    expect(result.score).toBe(50); // Only consecutive failures
    expect(result.score).toBeLessThanOrEqual(80); // Not auto-pause territory
  });
});
