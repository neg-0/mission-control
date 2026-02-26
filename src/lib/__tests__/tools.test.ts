/**
 * @module tools.test
 * @description
 * Unit tests for the tool executor. Tests file I/O scoping,
 * bash command allowlist, web fetch, and MC API tools.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { executeTool, getToolDefinitions, type ToolContext } from '../agent-runtime/tools';

// Mock node:fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  appendFile: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('util', () => ({
  promisify: jest.fn((fn) => fn),
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockExec = exec as unknown as jest.MockedFunction<(cmd: string, opts: unknown) => Promise<{ stdout: string; stderr: string }>>;

const ctx: ToolContext = {
  agentId: 'test-agent',
  workspacePath: '/home/neg0/.openclaw/workspace-test',
  mcBaseUrl: 'http://localhost:3000',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
});

// =============================================================================
// Tool Definitions
// =============================================================================

describe('getToolDefinitions', () => {
  it('returns all 8 tools', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(8);
    const names = defs.map((d) => d.name);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('bash_exec');
    expect(names).toContain('web_fetch');
    expect(names).toContain('mc_journal');
    expect(names).toContain('mc_escalate');
    expect(names).toContain('mc_delegate');
    expect(names).toContain('mc_message');
  });

  it('all tools have name, description, and parameters', () => {
    const defs = getToolDefinitions();
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.parameters).toBeDefined();
      expect(def.parameters.type).toBe('object');
    }
  });
});

// =============================================================================
// file_read
// =============================================================================

describe('file_read', () => {
  it('reads a file within workspace', async () => {
    mockReadFile.mockResolvedValueOnce('file content here' as never);

    const result = await executeTool('file_read', { path: 'README.md' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toBe('file content here');
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('workspace-test/README.md'),
      'utf-8',
    );
  });

  it('rejects paths outside workspace', async () => {
    const result = await executeTool(
      'file_read',
      { path: '/etc/passwd' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('rejects path traversal', async () => {
    const result = await executeTool(
      'file_read',
      { path: '../../etc/shadow' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('truncates large files', async () => {
    const largeContent = 'x'.repeat(60000);
    mockReadFile.mockResolvedValueOnce(largeContent as never);

    const result = await executeTool('file_read', { path: 'big.log' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output.length).toBeLessThan(60000);
    expect(result.output).toContain('truncated');
  });

  it('handles file not found', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));

    const result = await executeTool('file_read', { path: 'missing.txt' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOENT');
  });
});

// =============================================================================
// file_write
// =============================================================================

describe('file_write', () => {
  it('writes a file within workspace', async () => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await executeTool(
      'file_write',
      { path: 'output.md', content: 'hello world' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('11 chars');
  });

  it('creates parent directories if missing', async () => {
    mockExistsSync.mockReturnValue(false);
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await executeTool(
      'file_write',
      { path: 'deep/nested/file.txt', content: 'data' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('rejects writes outside workspace', async () => {
    const result = await executeTool(
      'file_write',
      { path: '/etc/crontab', content: 'evil' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });
});

// =============================================================================
// bash_exec
// =============================================================================

describe('bash_exec', () => {
  it('allows git commands', async () => {
    mockExec.mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });

    const result = await executeTool(
      'bash_exec',
      { command: 'git branch --show-current' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('main');
  });

  it('allows npm commands', async () => {
    mockExec.mockResolvedValueOnce({ stdout: '10.8.0\n', stderr: '' });

    const result = await executeTool(
      'bash_exec',
      { command: 'npm --version' },
      ctx,
    );

    expect(result.success).toBe(true);
  });

  it('blocks disallowed commands', async () => {
    const result = await executeTool(
      'bash_exec',
      { command: 'reboot' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not in allowlist');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('blocks sudo', async () => {
    const result = await executeTool(
      'bash_exec',
      { command: 'sudo rm -rf /' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not in allowlist');
  });

  it('blocks systemctl', async () => {
    const result = await executeTool(
      'bash_exec',
      { command: 'systemctl stop openssh' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not in allowlist');
  });

  it('handles command execution errors', async () => {
    mockExec.mockRejectedValueOnce({
      stdout: '',
      stderr: 'Permission denied',
      message: 'Command failed: exit code 1',
    });

    const result = await executeTool(
      'bash_exec',
      { command: 'git push' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Command failed');
  });
});

// =============================================================================
// web_fetch
// =============================================================================

describe('web_fetch', () => {
  it('makes GET request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '{"data":"test"}',
    });

    const result = await executeTool(
      'web_fetch',
      { url: 'https://api.example.com/data' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('200');
    expect(result.output).toContain('test');
  });

  it('makes POST request with body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => 'Created',
    });

    const result = await executeTool(
      'web_fetch',
      {
        url: 'https://api.example.com/data',
        method: 'POST',
        body: '{"key":"value"}',
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('201');
  });

  it('handles non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    const result = await executeTool(
      'web_fetch',
      { url: 'https://example.com/missing' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await executeTool(
      'web_fetch',
      { url: 'http://localhost:9999' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});

// =============================================================================
// MC tools (journal, escalate, delegate, message)
// =============================================================================

describe('mc_journal', () => {
  it('posts journal entry to MC API', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await executeTool(
      'mc_journal',
      { did: 'Fixed bug', next: 'Deploy', status: 'healthy' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Journal entry saved');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agentId).toBe('test-agent');
    expect(body.did).toBe('Fixed bug');
    expect(body.status).toBe('healthy');
  });
});

describe('mc_escalate', () => {
  it('posts escalation to MC API', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await executeTool(
      'mc_escalate',
      { severity: 'critical', category: 'security', title: 'API key exposed' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('API key exposed');
  });
});

describe('mc_delegate', () => {
  it('creates task for target agent', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await executeTool(
      'mc_delegate',
      {
        targetAgentId: 'captain',
        title: 'Fix login page',
        priority: 'high',
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('delegated to captain');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.assigneeId).toBe('captain');
    expect(body.priority).toBe('high');
    expect(body.taskType).toBe('one_off');
  });
});

describe('mc_message', () => {
  it('sends message to another agent', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await executeTool(
      'mc_message',
      { toId: 'rocket', body: 'Status update: all clear' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Message sent to rocket');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.fromId).toBe('test-agent');
    expect(body.toId).toBe('rocket');
    expect(body.channel).toBe('agent_message');
  });
});

// =============================================================================
// Unknown tool
// =============================================================================

describe('unknown tool', () => {
  it('returns error for unknown tool name', async () => {
    const result = await executeTool('nonexistent_tool', {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });
});
