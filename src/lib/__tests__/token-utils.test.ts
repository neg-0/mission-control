/**
 * @module token-utils.test
 * @description
 * Tests for the Railway OAuth token persistence utilities.
 */

import { readFile, writeFile } from 'fs/promises';
import { distributeTokenToAgents, getAgentWorkspaces, updateEnvVar } from '../token-utils';

// Mock fs/promises
jest.mock('fs/promises');

const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockedWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

// =============================================================================
// updateEnvVar
// =============================================================================

describe('updateEnvVar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedWriteFile.mockResolvedValue(undefined);
  });

  test('replaces existing key in-place', async () => {
    mockedReadFile.mockResolvedValue(
      'FOO=bar\nRAILWAY_TOKEN=old_token\nOTHER=value\n'
    );

    await updateEnvVar('/test/.env', 'RAILWAY_TOKEN', 'new_token');

    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/test/.env',
      'FOO=bar\nRAILWAY_TOKEN=new_token\nOTHER=value\n',
      'utf-8'
    );
  });

  test('appends key when it does not exist', async () => {
    mockedReadFile.mockResolvedValue('FOO=bar\nOTHER=value\n');

    await updateEnvVar('/test/.env', 'RAILWAY_TOKEN', 'new_token');

    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/test/.env',
      'FOO=bar\nOTHER=value\nRAILWAY_TOKEN=new_token\n',
      'utf-8'
    );
  });

  test('handles empty file', async () => {
    mockedReadFile.mockResolvedValue('');

    await updateEnvVar('/test/.env', 'RAILWAY_TOKEN', 'new_token');

    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/test/.env',
      'RAILWAY_TOKEN=new_token\n',
      'utf-8'
    );
  });

  test('creates file when it does not exist', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    await updateEnvVar('/test/.env', 'RAILWAY_TOKEN', 'new_token');

    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/test/.env',
      'RAILWAY_TOKEN=new_token\n',
      'utf-8'
    );
  });

  test('handles file without trailing newline', async () => {
    mockedReadFile.mockResolvedValue('FOO=bar');

    await updateEnvVar('/test/.env', 'NEW_KEY', 'value');

    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/test/.env',
      'FOO=bar\nNEW_KEY=value\n',
      'utf-8'
    );
  });

  test('replaces only the matching key (not partial matches)', async () => {
    mockedReadFile.mockResolvedValue(
      'RAILWAY_TOKEN=old\nRAILWAY_TOKEN_EXTRA=should_stay\n'
    );

    await updateEnvVar('/test/.env', 'RAILWAY_TOKEN', 'new');

    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/test/.env',
      'RAILWAY_TOKEN=new\nRAILWAY_TOKEN_EXTRA=should_stay\n',
      'utf-8'
    );
  });
});

// =============================================================================
// getAgentWorkspaces
// =============================================================================

describe('getAgentWorkspaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns workspace paths from openclaw.json', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({
      agents: {
        list: [
          { id: 'rocket', workspace: '/home/neg0/.openclaw/workspace-rocket' },
          { id: 'captain', workspace: '/home/neg0/.openclaw/workspace-captain' },
        ]
      }
    }));

    const workspaces = await getAgentWorkspaces();
    expect(workspaces).toEqual([
      '/home/neg0/.openclaw/workspace-rocket',
      '/home/neg0/.openclaw/workspace-captain',
    ]);
  });

  test('filters out agents without workspace', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({
      agents: {
        list: [
          { id: 'rocket', workspace: '/home/neg0/.openclaw/workspace-rocket' },
          { id: 'orphan' }, // no workspace
        ]
      }
    }));

    const workspaces = await getAgentWorkspaces();
    expect(workspaces).toEqual(['/home/neg0/.openclaw/workspace-rocket']);
  });

  test('returns empty array when no agents configured', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({ agents: {} }));

    const workspaces = await getAgentWorkspaces();
    expect(workspaces).toEqual([]);
  });
});

// =============================================================================
// distributeTokenToAgents
// =============================================================================

describe('distributeTokenToAgents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedWriteFile.mockResolvedValue(undefined);
  });

  test('updates all workspace .env files', async () => {
    // First call reads openclaw.json, subsequent calls read workspace .env files
    mockedReadFile
      .mockResolvedValueOnce(JSON.stringify({
        agents: {
          list: [
            { id: 'rocket', workspace: '/ws/rocket' },
            { id: 'captain', workspace: '/ws/captain' },
          ]
        }
      }))
      .mockResolvedValue('RAILWAY_TOKEN=old_token\n');

    const result = await distributeTokenToAgents('new_token');

    expect(result.updated).toEqual(['/ws/rocket', '/ws/captain']);
    expect(result.failed).toEqual([]);
    expect(mockedWriteFile).toHaveBeenCalledTimes(2);
  });

  test('reports failures without throwing', async () => {
    // updateEnvVar catches readFile errors gracefully (treats as empty file),
    // so we must make writeFile fail to simulate a true failure.
    mockedReadFile
      .mockResolvedValueOnce(JSON.stringify({
        agents: {
          list: [
            { id: 'rocket', workspace: '/ws/rocket' },
            { id: 'broken', workspace: '/ws/broken' },
          ]
        }
      }))
      .mockResolvedValueOnce('RAILWAY_TOKEN=old\n') // rocket .env read
      .mockResolvedValueOnce('RAILWAY_TOKEN=old\n'); // broken .env read

    mockedWriteFile
      .mockResolvedValueOnce(undefined) // rocket write succeeds
      .mockRejectedValueOnce(new Error('EACCES: permission denied')); // broken write fails

    const result = await distributeTokenToAgents('new_token');

    expect(result.updated).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.updated).toContain('/ws/rocket');
    expect(result.failed).toContain('/ws/broken');
  });
});
