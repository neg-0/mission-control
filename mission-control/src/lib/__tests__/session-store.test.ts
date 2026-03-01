/**
 * @module session-store.test
 * @description
 * Unit tests for JSONL session persistence.
 */

import { existsSync } from 'fs';
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import type { ChatMessage } from '../agent-runtime/providers';
import {
  estimateTokenCount,
  loadSession,
  replaceSession,
  saveMessage,
  saveMessages,
} from '../agent-runtime/session-store';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  appendFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockAppendFile = appendFile as jest.MockedFunction<typeof appendFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

const workspace = '/home/neg0/.openclaw/workspace-test';
const sessionId = 'sess-123';

beforeEach(() => jest.clearAllMocks());

// =============================================================================
// loadSession
// =============================================================================

describe('loadSession', () => {
  it('returns empty array when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const messages = await loadSession(workspace, sessionId);
    expect(messages).toEqual([]);
  });

  it('parses JSONL correctly', async () => {
    mockExistsSync.mockReturnValue(true);
    const lines = [
      JSON.stringify({ role: 'system', content: 'Hello' }),
      JSON.stringify({ role: 'user', content: 'Hi' }),
      '', // empty line
    ].join('\n');
    mockReadFile.mockResolvedValueOnce(lines as never);

    const messages = await loadSession(workspace, sessionId);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toBe('Hi');
  });

  it('skips malformed lines', async () => {
    mockExistsSync.mockReturnValue(true);
    const lines = [
      JSON.stringify({ role: 'user', content: 'ok' }),
      'NOT_VALID_JSON',
      JSON.stringify({ role: 'assistant', content: 'fine' }),
    ].join('\n');
    mockReadFile.mockResolvedValueOnce(lines as never);

    const messages = await loadSession(workspace, sessionId);
    expect(messages).toHaveLength(2);
  });

  it('returns empty on read error', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockRejectedValueOnce(new Error('EACCES'));

    const messages = await loadSession(workspace, sessionId);
    expect(messages).toEqual([]);
  });
});

// =============================================================================
// saveMessage
// =============================================================================

describe('saveMessage', () => {
  it('appends JSON line to file', async () => {
    mockExistsSync.mockReturnValue(true);
    mockAppendFile.mockResolvedValueOnce(undefined);

    const msg: ChatMessage = { role: 'user', content: 'test message' };
    await saveMessage(workspace, sessionId, msg);

    expect(mockAppendFile).toHaveBeenCalledWith(
      expect.stringContaining(`${sessionId}.jsonl`),
      expect.stringContaining('"role":"user"'),
      'utf-8',
    );
  });

  it('creates directory if missing', async () => {
    mockExistsSync.mockReturnValue(false);
    mockMkdir.mockResolvedValueOnce(undefined);
    mockAppendFile.mockResolvedValueOnce(undefined);

    await saveMessage(workspace, sessionId, { role: 'user', content: 'hi' });

    expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });
});

// =============================================================================
// saveMessages
// =============================================================================

describe('saveMessages', () => {
  it('appends multiple messages in one write', async () => {
    mockExistsSync.mockReturnValue(true);
    mockAppendFile.mockResolvedValueOnce(undefined);

    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    await saveMessages(workspace, sessionId, msgs);

    const written = mockAppendFile.mock.calls[0][1] as string;
    const lines = written.trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});

// =============================================================================
// replaceSession
// =============================================================================

describe('replaceSession', () => {
  it('overwrites session file entirely', async () => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFile.mockResolvedValueOnce(undefined);

    const msgs: ChatMessage[] = [
      { role: 'system', content: 'compacted' },
      { role: 'user', content: 'recent' },
    ];
    await replaceSession(workspace, sessionId, msgs);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining(`${sessionId}.jsonl`),
      expect.any(String),
      'utf-8',
    );

    const written = mockWriteFile.mock.calls[0][1] as string;
    const lines = written.trim().split('\n');
    expect(lines).toHaveLength(2);
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
