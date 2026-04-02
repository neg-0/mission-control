import { validateBootContext, loadSoulContent } from '../boot-context';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import { validateManifest } from '../project-manifest';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findUnique: jest.fn() },
  },
}));

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
  },
}));

jest.mock('../project-manifest', () => ({
  validateManifest: jest.fn(),
}));

const SOUL_WITH_SECTIONS = `
# SOUL.md
## Budget Limits
## Deploy Restrictions
## Scope Boundaries
`;

const baseConfig = {
  agentId: 'agent-1',
  workspacePath: '/workspace',
  requiredFiles: [],
  soulTemplate: '',
};

describe('loadSoulContent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns DB content when Agent.soulContent is set', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: 'DB soul' });

    const result = await loadSoulContent('agent-1', '/workspace');

    expect(result.content).toBe('DB soul');
    expect(result.warnings).toHaveLength(0);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('falls back to filesystem when DB column is null and emits deprecation warning', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: null });
    (fs.readFile as jest.Mock).mockResolvedValue('FS soul');

    const result = await loadSoulContent('agent-1', '/workspace');

    expect(result.content).toBe('FS soul');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/DEPRECATION/);
    expect(result.warnings[0]).toMatch(/agent-1/);
  });

  it('falls back to filesystem when agent not found in DB', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue(null);
    (fs.readFile as jest.Mock).mockResolvedValue('FS soul');

    const result = await loadSoulContent('agent-1', '/workspace');

    expect(result.content).toBe('FS soul');
    expect(result.warnings[0]).toMatch(/DEPRECATION/);
  });

  it('returns null content when both DB and filesystem are unavailable', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: null });
    (fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await loadSoulContent('agent-1', '/workspace');

    expect(result.content).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });
});

describe('validateBootContext', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes when soul from DB has all critical sections', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: SOUL_WITH_SECTIONS });
    (fs.access as jest.Mock).mockResolvedValue(undefined);

    const result = await validateBootContext(baseConfig);

    expect(result.ready).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when SOUL.md is missing a critical section', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({
      soulContent: '## Budget Limits\n## Deploy Restrictions\n',
    });

    const result = await validateBootContext(baseConfig);

    expect(result.ready).toBe(false);
    expect(result.errors).toContain('SOUL.md missing critical section: "Scope Boundaries"');
  });

  it('errors when soul content is unavailable from both DB and filesystem', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: null });
    (fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await validateBootContext(baseConfig);

    expect(result.ready).toBe(false);
    expect(result.errors.some((e) => e.includes('Failed to read SOUL.md'))).toBe(true);
  });

  it('emits deprecation warning when falling back to filesystem', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: null });
    (fs.readFile as jest.Mock).mockResolvedValue(SOUL_WITH_SECTIONS);

    const result = await validateBootContext(baseConfig);

    expect(result.ready).toBe(true);
    expect(result.warnings.some((w) => w.includes('DEPRECATION'))).toBe(true);
  });

  it('errors for each missing required file', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: SOUL_WITH_SECTIONS });
    (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const result = await validateBootContext({
      ...baseConfig,
      requiredFiles: ['HEARTBEAT.md', 'GOALS.md'],
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some((e) => e.includes('HEARTBEAT.md'))).toBe(true);
    expect(result.errors.some((e) => e.includes('GOALS.md'))).toBe(true);
  });

  it('validates manifest when manifestPath is provided', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: SOUL_WITH_SECTIONS });
    (fs.access as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockResolvedValue('{"valid":true}');
    (validateManifest as jest.Mock).mockReturnValue({ valid: true, errors: [] });

    const result = await validateBootContext({
      ...baseConfig,
      manifestPath: 'project.lock.json',
    });

    expect(result.ready).toBe(true);
    expect(validateManifest).toHaveBeenCalled();
  });

  it('errors when manifest validation fails', async () => {
    (prisma.agent.findUnique as jest.Mock).mockResolvedValue({ soulContent: SOUL_WITH_SECTIONS });
    (fs.access as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockResolvedValue('{}');
    (validateManifest as jest.Mock).mockReturnValue({ valid: false, errors: ['missing field'] });

    const result = await validateBootContext({
      ...baseConfig,
      manifestPath: 'project.lock.json',
    });

    expect(result.ready).toBe(false);
    expect(result.errors.some((e) => e.includes('missing field'))).toBe(true);
  });
});
