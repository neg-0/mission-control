import { buildSystemPrompt } from '../agent-runtime/system-prompt';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findUnique: jest.fn() },
  },
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

describe('buildSystemPrompt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns stored systemPrompt from DB when agentId is provided', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({
      systemPrompt: 'You are a robot.',
      soulContent: null,
    });

    const result = await buildSystemPrompt('/workspace', undefined, 'agent-1');

    expect(result).toBe('You are a robot.');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('appends mcContext after stored systemPrompt', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({
      systemPrompt: 'Stored prompt.',
      soulContent: null,
    });

    const result = await buildSystemPrompt('/workspace', 'some context', 'agent-1');

    expect(result).toContain('Stored prompt.');
    expect(result).toContain('some context');
  });

  it('falls back to building from filesystem when DB systemPrompt is null', async () => {
    (prisma.agent.findUnique as jest.Mock)
      .mockResolvedValueOnce({ systemPrompt: null }) // loadSystemPromptFromDb
      .mockResolvedValueOnce({ soulContent: 'DB soul content' }); // loadSoulContent

    (readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await buildSystemPrompt('/workspace', undefined, 'agent-1');

    expect(result).toContain('DB soul content');
    expect(result).toContain('Mission Control Integration');
  });

  it('uses DB soulContent when building from files and agentId is provided', async () => {
    (prisma.agent.findUnique as jest.Mock)
      .mockResolvedValueOnce({ systemPrompt: null }) // first call: loadSystemPromptFromDb
      .mockResolvedValueOnce({ soulContent: 'My soul from DB' }); // second: loadSoulContent

    (readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await buildSystemPrompt('/workspace', undefined, 'agent-1');

    expect(result).toContain('My soul from DB');
  });

  it('builds prompt from filesystem when no agentId is provided', async () => {
    (readFile as jest.Mock).mockImplementation((_path: string) => {
      if (_path.endsWith('SOUL.md')) return Promise.resolve('FS Soul');
      return Promise.reject(new Error('ENOENT'));
    });

    const result = await buildSystemPrompt('/workspace');

    expect(result).toContain('FS Soul');
    expect(result).toContain('Mission Control Integration');
    expect(prisma.agent.findUnique).not.toHaveBeenCalled();
  });

  it('includes mcContext when provided without agentId', async () => {
    (readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await buildSystemPrompt('/workspace', 'my context');

    expect(result).toContain('my context');
  });
});
