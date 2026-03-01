import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

/**
 * GET /api/cron-jobs/refinery-verdict
 * Checks for expired validation sprints and issues verdicts.
 * Called by external cron or orchestrator every 5 mins.
 */
export async function GET() {
  try {
    const now = new Date();
    
    // Find ideas that are 'validating' and past deadline
    const expiredIdeas = await prisma.idea.findMany({
      where: {
        status: 'validating',
        validationDeadline: { lt: now }
      }
    });

    const results = [];

    for (const idea of expiredIdeas) {
      // Count actual signups
      const signups = await prisma.waitlistSignup.count({
        where: { ideaId: idea.id }
      });

      const target = idea.validationTarget || 10;
      let newStatus = idea.status;
      let decision = 'pending';

      if (signups >= target) {
        newStatus = 'validated'; // Ready for promotion
        decision = 'PASS';
      } else if (signups >= target * 0.8) {
        // Near miss - keep validating or flag for review
        newStatus = 'review_failed'; // Or 'near_miss' if we add that enum
        decision = 'NEAR_MISS';
      } else {
        newStatus = 'review_failed'; // Failed validation
        decision = 'FAIL';
      }

      await prisma.idea.update({
        where: { id: idea.id },
        data: { status: newStatus }
      });

      // Log to MessageLog
      await prisma.messageLog.create({
        data: {
          fromId: 'system',
          toId: 'broadcast',
          channel: 'refinery_verdict',
          subject: `Verdict: ${idea.title}`,
          body: `Sprint expired. Signups: ${signups}/${target}. Result: ${decision}. Status set to ${newStatus}.`,
          metadata: { ideaId: idea.id, signups, target, decision }
        }
      });

      results.push({ id: idea.id, title: idea.title, signups, decision });
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (e) {
    console.error('[Refinery Verdict Cron]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
