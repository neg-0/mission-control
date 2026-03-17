/**
 * API Integration Tests: Idea Post-Mortem Generation
 *
 * Tests post-mortem generation for killed ideas.
 */
import { resetDatabase, disconnectTestDb } from '../helpers/test-db';
import { createTestIdea } from '../helpers/factories';
import { testPrisma } from '../helpers/test-db';
import { generatePostMortem, generateMissingPostMortems } from '@/lib/idea-postmortem';

beforeEach(() => resetDatabase());
afterAll(() => disconnectTestDb());

describe('Idea Post-Mortem', () => {
  describe('generatePostMortem', () => {
    it('generates post-mortem for a killed idea', async () => {
      const idea = await createTestIdea({
        status: 'killed',
        title: 'Dead Idea',
        source: 'AI Agent',
      });

      const pm = await generatePostMortem(idea.id, testPrisma);
      expect(pm).not.toBeNull();
      expect(pm!.ideaId).toBe(idea.id);
      expect(pm!.title).toBe('Dead Idea');
      expect(pm!.origin).toBe('AI Agent');
      expect(pm!.timeline.length).toBeGreaterThan(0);
      expect(pm!.deathReason).toBeDefined();
      expect(pm!.lessons.length).toBeGreaterThan(0);
    });

    it('returns null for non-killed ideas', async () => {
      const idea = await createTestIdea({ status: 'draft' });
      const pm = await generatePostMortem(idea.id, testPrisma);
      expect(pm).toBeNull();
    });

    it('returns null for non-existent ideas', async () => {
      const pm = await generatePostMortem('nonexistent', testPrisma);
      expect(pm).toBeNull();
    });

    it('includes validation summary when sprint was run', async () => {
      const now = new Date();
      const idea = await createTestIdea({
        status: 'killed',
        validationStartedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        validationDeadline: now,
        validationTarget: 10,
        refineryData: { pendingVerdict: 'FAIL' },
      });

      // Add some signups
      for (let i = 0; i < 3; i++) {
        await testPrisma.waitlistSignup.create({
          data: { ideaId: idea.id, email: `pm${i}@test.com` },
        });
      }

      const pm = await generatePostMortem(idea.id, testPrisma);
      expect(pm!.validationSummary).not.toBeNull();
      expect(pm!.validationSummary!.actual).toBe(3);
      expect(pm!.validationSummary!.target).toBe(10);
      expect(pm!.validationSummary!.percentOfTarget).toBe(30);
      expect(pm!.validationSummary!.verdict).toBe('FAIL');
    });

    it('stores post-mortem in idea refineryData', async () => {
      const idea = await createTestIdea({ status: 'killed' });
      await generatePostMortem(idea.id, testPrisma);

      const updated = await testPrisma.idea.findUnique({ where: { id: idea.id } });
      const data = updated?.refineryData as Record<string, unknown>;
      expect(data.postmortem).toBeDefined();
    });

    it('logs post-mortem to MessageLog', async () => {
      const idea = await createTestIdea({ status: 'killed', title: 'PM Log Test' });
      await generatePostMortem(idea.id, testPrisma);

      const log = await testPrisma.messageLog.findFirst({
        where: { channel: 'refinery_verdict', fromId: 'postmortem-engine' },
      });
      expect(log).not.toBeNull();
      expect(log?.subject).toContain('Post-mortem');
    });

    it('derives zero-signup lesson', async () => {
      const idea = await createTestIdea({
        status: 'killed',
        validationStartedAt: new Date(),
        validationTarget: 10,
      });

      const pm = await generatePostMortem(idea.id, testPrisma);
      expect(pm!.lessons.some(l => l.includes('zero signups'))).toBe(true);
    });
  });

  describe('generateMissingPostMortems', () => {
    it('generates post-mortems for killed ideas without one', async () => {
      await createTestIdea({ status: 'killed', title: 'Needs PM' });
      await createTestIdea({ status: 'killed', title: 'Also Needs PM' });
      await createTestIdea({ status: 'draft' }); // Not killed — skip

      const results = await generateMissingPostMortems(testPrisma);
      expect(results).toHaveLength(2);
    });

    it('skips killed ideas that already have post-mortems', async () => {
      await createTestIdea({
        status: 'killed',
        refineryData: { postmortem: { title: 'Already Done' } },
      });

      const results = await generateMissingPostMortems(testPrisma);
      expect(results).toHaveLength(0);
    });
  });
});
