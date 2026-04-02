import { buildHeartbeatContext } from '../build-heartbeat-context';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    orchestratorConfig: { findUnique: jest.fn() },
    agentJournal: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    goal: { findMany: jest.fn() },
    escalation: { findMany: jest.fn() },
    agent: { findUnique: jest.fn() },
  },
}));

// Mock global fetch
global.fetch = jest.fn();

function mockEmptyDb() {
  (prisma.orchestratorConfig.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.agentJournal.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.goal.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.escalation.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.agent.findUnique as jest.Mock).mockResolvedValue(null);
}

describe('buildHeartbeatContext — SOUL.md injection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmptyDb();
  });

  it('uses DB soulContent for SOUL.md injections instead of fetching from filesystem', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({
      soulContent: 'My soul from DB',
    });

    const result = await buildHeartbeatContext('agent-1', 'test-schedule', {
      mdInjections: ['/workspace/SOUL.md'],
    });

    expect(result).toContain('My soul from DB');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches non-SOUL.md files from the filesystem API as before', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: null });
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'HEARTBEAT content' }),
    });

    const result = await buildHeartbeatContext('agent-1', 'test-schedule', {
      mdInjections: ['/workspace/HEARTBEAT.md'],
    });

    expect(result).toContain('HEARTBEAT content');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to fetching SOUL.md when DB soulContent is null', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: null });
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'FS soul content' }),
    });

    const result = await buildHeartbeatContext('agent-1', 'test-schedule', {
      mdInjections: ['/workspace/SOUL.md'],
    });

    expect(result).toContain('FS soul content');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not query agent DB if no SOUL.md in mdInjections', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'goals content' }),
    });

    await buildHeartbeatContext('agent-1', 'test-schedule', {
      mdInjections: ['/workspace/GOALS.md'],
    });

    // agent.findUnique should NOT be called for soulContent resolution
    // (it may still be called for the DB soul lookup but only if SOUL.md is in paths)
    const soulCalls = (prisma.agent.findUnique as jest.Mock).mock.calls.filter(
      (call) => call[0]?.select?.soulContent
    );
    expect(soulCalls).toHaveLength(0);
  });

  it('truncates long DB soul content to 2000 chars', async () => {
    const longSoul = 'x'.repeat(3000);
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: longSoul });

    const result = await buildHeartbeatContext('agent-1', 'test-schedule', {
      mdInjections: ['/workspace/SOUL.md'],
    });

    expect(result).toContain('... (truncated)');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('builds context with no mdInjections', async () => {
    const result = await buildHeartbeatContext('agent-1', 'daily', {});

    expect(result).toContain('MC Heartbeat: daily');
    expect(result).toContain('agent-1');
  });
});
