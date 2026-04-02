/**
 * @module session-store.test
 * @description
 * Unit tests for Postgres-backed session persistence.
 */

import type { ChatMessage } from '../agent-runtime/providers';
import {
  estimateTokenCount,
  loadSession,
  replaceSession,
  saveMessage,
  saveMessages,
} from '../agent-runtime/session-store';

// ---------------------------------------------------------------------------
// Mock Prisma client — factory form avoids jest hoisting issues
// ---------------------------------------------------------------------------

jest.mock('../prisma', () => ({
  prisma: {
    agentMessage: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Grab the mock references after hoisting has settled
import { prisma } from '../prisma';

const mockAgentMessage = prisma.agentMessage as jest.Mocked<typeof prisma.agentMessage>;
const mockTransaction = prisma.$transaction as jest.MockedFunction<typeof prisma.$transaction>;

// Transaction helper: simulate interactive-style tx (passes a mock tx object)
const mockTx = {
  agentMessage: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

const workspace = '/home/neg0/.openclaw/workspace-test';
const sessionId = 'sess-123';

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.agentMessage.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.agentMessage.createMany.mockResolvedValue({ count: 0 });
  // Default: interactive transaction delegates to mockTx
  mockTransaction.mockImplementation(
    (fn: Parameters<typeof prisma.$transaction>[0]) =>
      (fn as (tx: typeof mockTx) => Promise<unknown>)(mockTx),
  );
});

// =============================================================================
// loadSession
// =============================================================================

describe('loadSession', () => {
  it('returns empty array when no messages exist', async () => {
    mockAgentMessage.findMany.mockResolvedValueOnce([]);
    const messages = await loadSession(workspace, sessionId);
    expect(messages).toEqual([]);
    expect(mockAgentMessage.findMany).toHaveBeenCalledWith({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('parses rows back into ChatMessages', async () => {
    mockAgentMessage.findMany.mockResolvedValueOnce([
      { id: '1', sessionId, role: 'system', content: 'Hello', metadata: null, createdAt: new Date() },
      { id: '2', sessionId, role: 'user', content: 'Hi', metadata: null, createdAt: new Date() },
    ] as never);
    const messages = await loadSession(workspace, sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toBe('Hi');
  });

  it('restores metadata fields (toolCalls, toolCallId, name)', async () => {
    const toolCalls = [{ id: 'tc-1', name: 'file_read', arguments: '{}' }];
    mockAgentMessage.findMany.mockResolvedValueOnce([
      { id: '1', sessionId, role: 'assistant', content: null, metadata: { toolCalls }, createdAt: new Date() },
    ] as never);
    const [msg] = await loadSession(workspace, sessionId);
    expect(msg.toolCalls).toEqual(toolCalls);
    expect(msg.content).toBeNull();
  });

  it('returns empty array on DB error', async () => {
    mockAgentMessage.findMany.mockRejectedValueOnce(new Error('connection lost'));
    const messages = await loadSession(workspace, sessionId);
    expect(messages).toEqual([]);
  });
});

// =============================================================================
// saveMessage
// =============================================================================

describe('saveMessage', () => {
  it('inserts a row with role and content', async () => {
    mockAgentMessage.create.mockResolvedValueOnce({} as never);
    const msg: ChatMessage = { role: 'user', content: 'test message' };
    await saveMessage(workspace, sessionId, msg);

    expect(mockAgentMessage.create).toHaveBeenCalledWith({
      data: { sessionId, role: 'user', content: 'test message', metadata: null },
    });
  });

  it('stores extra fields in metadata', async () => {
    mockAgentMessage.create.mockResolvedValueOnce({} as never);
    const msg: ChatMessage = {
      role: 'tool',
      content: 'result',
      toolCallId: 'tc-1',
      name: 'file_read',
    };
    await saveMessage(workspace, sessionId, msg);

    const { data } = mockAgentMessage.create.mock.calls[0][0] as {
      data: { metadata: unknown };
    };
    expect(data.metadata).toMatchObject({ toolCallId: 'tc-1', name: 'file_read' });
  });

  it('does not throw on DB error', async () => {
    mockAgentMessage.create.mockRejectedValueOnce(new Error('DB down'));
    await expect(
      saveMessage(workspace, sessionId, { role: 'user', content: 'hi' }),
    ).resolves.toBeUndefined();
  });
});

// =============================================================================
// saveMessages
// =============================================================================

describe('saveMessages', () => {
  it('calls createMany with all messages', async () => {
    mockAgentMessage.createMany.mockResolvedValueOnce({ count: 2 });
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    await saveMessages(workspace, sessionId, msgs);

    const { data } = mockAgentMessage.createMany.mock.calls[0][0] as {
      data: Array<{ role: string }>;
    };
    expect(data).toHaveLength(2);
    expect(data[0].role).toBe('user');
    expect(data[1].role).toBe('assistant');
  });

  it('skips DB call for empty array', async () => {
    await saveMessages(workspace, sessionId, []);
    expect(mockAgentMessage.createMany).not.toHaveBeenCalled();
  });

  it('does not throw on DB error', async () => {
    mockAgentMessage.createMany.mockRejectedValueOnce(new Error('DB down'));
    await expect(
      saveMessages(workspace, sessionId, [{ role: 'user', content: 'x' }]),
    ).resolves.toBeUndefined();
  });
});

// =============================================================================
// replaceSession
// =============================================================================

describe('replaceSession', () => {
  it('deletes all messages then inserts new ones atomically', async () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'compacted' },
      { role: 'user', content: 'recent' },
    ];
    await replaceSession(workspace, sessionId, msgs);

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockTx.agentMessage.deleteMany).toHaveBeenCalledWith({ where: { sessionId } });
    expect(mockTx.agentMessage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: 'compacted' }),
        expect.objectContaining({ role: 'user', content: 'recent' }),
      ]),
    });
  });

  it('skips createMany when replacing with empty array', async () => {
    await replaceSession(workspace, sessionId, []);
    expect(mockTx.agentMessage.deleteMany).toHaveBeenCalled();
    expect(mockTx.agentMessage.createMany).not.toHaveBeenCalled();
  });

  it('does not throw on DB error', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('DB down'));
    await expect(replaceSession(workspace, sessionId, [])).resolves.toBeUndefined();
  });
});

// =============================================================================
// estimateTokenCount
// =============================================================================

describe('estimateTokenCount', () => {
  it('estimates ~4 chars per token', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(400) }, // ~100 tokens
    ];
    expect(estimateTokenCount(msgs)).toBe(100);
  });

  it('counts tool call arguments', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          { id: 'x', name: 'file_read', arguments: '{"path":"test.md"}' },
        ],
      },
    ];
    const tokens = estimateTokenCount(msgs);
    expect(tokens).toBeGreaterThan(0);
  });

  it('returns 0 for empty messages', () => {
    expect(estimateTokenCount([])).toBe(0);
  });
});
