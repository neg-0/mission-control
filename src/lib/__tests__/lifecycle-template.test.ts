import { maybePromoteProject } from '../lifecycle-template';
import { prisma } from '@/lib/prisma';

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe('Auto-Promotion Logic', () => {
  const mockProject = {
    id: 'test-proj',
    stage: 'backlog',
    checkpoints: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('promotes from backlog to research when idea phase completes', async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      ...mockProject,
      checkpoints: [
        { phase: 'idea', status: 'pass' },
        { phase: 'idea', status: 'pass' },
        { phase: 'ship', status: 'pending' },
      ],
    });

    const result = await maybePromoteProject('test-proj');

    expect(result.promoted).toBe(true);
    expect(result.newStage).toBe('research');
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'test-proj' },
      data: { stage: 'research' },
    });
  });

  it('does not promote if phase is incomplete', async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      ...mockProject,
      checkpoints: [
        { phase: 'idea', status: 'pass' },
        { phase: 'idea', status: 'pending' }, // Stuck
      ],
    });

    const result = await maybePromoteProject('test-proj');

    expect(result.promoted).toBe(false);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('does not regress stage (forward only)', async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      ...mockProject,
      stage: 'launched', // Already advanced
      checkpoints: [
        { phase: 'idea', status: 'pass' }, // Idea complete
        { phase: 'ship', status: 'pending' },
      ],
    });

    const result = await maybePromoteProject('test-proj');

    expect(result.promoted).toBe(false);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('promotes to beta when ship phase completes', async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      ...mockProject,
      stage: 'research',
      checkpoints: [
        { phase: 'idea', status: 'pass' },
        { phase: 'ship', status: 'pass' }, // Ship complete
        { phase: 'live', status: 'pending' },
      ],
    });

    const result = await maybePromoteProject('test-proj');

    expect(result.promoted).toBe(true);
    expect(result.newStage).toBe('beta');
  });
});
