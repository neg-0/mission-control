import { processVerdicts } from '@/lib/idea-verdict';
import { generateMissingPostMortems } from '@/lib/idea-postmortem';
import { NextResponse } from 'next/server';

/**
 * GET /api/cron-jobs/refinery-verdict
 * Checks for expired validation sprints and issues verdicts with override window.
 * Also generates post-mortems for any killed ideas missing them.
 * Called by external cron or orchestrator every 5 mins.
 */
export async function GET() {
  try {
    const verdicts = await processVerdicts();
    const postMortems = await generateMissingPostMortems();

    return NextResponse.json({
      processed: verdicts.length,
      results: verdicts.map(v => ({
        id: v.ideaId,
        title: v.title,
        signups: v.signups,
        decision: v.decision,
        autoExecuted: v.autoExecuted,
      })),
      postMortems: postMortems.length,
    });
  } catch (e) {
    console.error('[Refinery Verdict Cron]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
