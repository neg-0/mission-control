/**
 * API Integration Tests: Idea Verdict Engine
 *
 * Tests the auto-verdict with override window system.
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestIdea } from '../helpers/factories';
import { testPrisma } from '../helpers/test-db';
import { calculateVerdict, processVerdicts } from '@/lib/idea-verdict';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Idea Verdict Engine', () => {
  describe('calculateVerdict', () => {
    it('returns PASS when signups >= target', () => {
      expect(calculateVerdict(10, 10)).toBe('PASS');
      expect(calculateVerdict(15, 10)).toBe('PASS');
    });

    it('returns NEAR_MISS when signups >= 80% of target', () => {
      expect(calculateVerdict(8, 10)).toBe('NEAR_MISS');
      expect(calculateVerdict(9, 10)).toBe('NEAR_MISS');
    });

    it('returns FAIL when signups < 80% of target', () => {
      expect(calculateVerdict(7, 10)).toBe('FAIL');
      expect(calculateVerdict(0, 10)).toBe('FAIL');
    });
  });

  describe('processVerdicts', () => {
    it('marks expired sprint as pending verdict with override window', async () => {
      const idea = await createTestIdea({
        status: 'validating',
        validationTarget: 10,
        validationDeadline: new Date(Date.now() - 1000),
      });

      // Add 5 signups (FAIL)
      for (let i = 0; i < 5; i++) {
        await testPrisma.waitlistSignup.create({
          data: { ideaId: idea.id, email: `verdict${i}@test.com` },
        });
      }

      const results = await processVerdicts(testPrisma);
      expect(results).toHaveLength(1);
      expect(results[0].decision).toBe('FAIL');
      expect(results[0].autoExecuted).toBe(false);
      expect(results[0].overrideWindowEndsAt).toBeDefined();

      // Verify idea status changed to review_failed
      const updated = await testPrisma.idea.findUnique({ where: { id: idea.id } });
      expect(updated?.status).toBe('review_failed');

      // Verify refineryData has pending verdict
      const data = updated?.refineryData as Record<string, unknown>;
      expect(data.pendingVerdict).toBe('FAIL');
      expect(data.overrideWindowEndsAt).toBeDefined();
    });

    it('auto-executes PASS verdict after override window expires', async () => {
      const idea = await createTestIdea({
        status: 'review_failed',
        refineryData: {
          pendingVerdict: 'PASS',
          verdictSignups: 12,
          verdictTarget: 10,
          overrideWindowEndsAt: new Date(Date.now() - 1000).toISOString(),
          verdictCalculatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        },
      });

      const results = await processVerdicts(testPrisma);
      const autoExec = results.find(r => r.ideaId === idea.id);
      expect(autoExec).toBeDefined();
      expect(autoExec?.autoExecuted).toBe(true);
      expect(autoExec?.decision).toBe('PASS');

      // Verify idea promoted to validated
      const updated = await testPrisma.idea.findUnique({ where: { id: idea.id } });
      expect(updated?.status).toBe('validated');
    });

    it('does not auto-execute within override window', async () => {
      await createTestIdea({
        status: 'review_failed',
        refineryData: {
          pendingVerdict: 'PASS',
          verdictSignups: 12,
          verdictTarget: 10,
          overrideWindowEndsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });

      const results = await processVerdicts(testPrisma);
      const autoExec = results.filter(r => r.autoExecuted);
      expect(autoExec).toHaveLength(0);
    });

    it('logs verdict to MessageLog', async () => {
      await createTestIdea({
        status: 'validating',
        validationTarget: 5,
        validationDeadline: new Date(Date.now() - 1000),
      });

      await processVerdicts(testPrisma);

      const log = await testPrisma.messageLog.findFirst({
        where: { channel: 'refinery_verdict', fromId: 'verdict-engine' },
      });
      expect(log).not.toBeNull();
      expect(log?.subject).toContain('Verdict pending');
    });
  });
});
