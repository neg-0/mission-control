/**
 * @module api/cron/knowledge-propagation
 * @description
 * Knowledge propagation cron — runs periodically to:
 * 1. Generate embeddings for entries that don't have them
 * 2. Propagate recent knowledge to relevant agents
 * 3. Run the gardener review for stale/duplicate entries
 * 4. Generate weekly knowledge digest for heartbeat injection
 *
 * **Endpoints:**
 * - POST /api/cron/knowledge-propagation — Run the full cycle
 * - GET  /api/cron/knowledge-propagation — Get last run status
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  gardenerReview,
  propagateKnowledge,
  refreshEmbeddings,
} from '@/lib/knowledge-engine';

// =============================================================================
// POST — Run propagation cycle
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const skipEmbeddings = searchParams.get('skipEmbeddings') === 'true';
    const skipGardener = searchParams.get('skipGardener') === 'true';

    const report: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
    };

    // Step 1: Refresh embeddings
    if (!skipEmbeddings) {
      const embeddingsRefreshed = await refreshEmbeddings(50);
      report.embeddingsRefreshed = embeddingsRefreshed;
    }

    // Step 2: Propagate recent knowledge (last 24h, not yet propagated)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentEntries = await prisma.knowledgeEntry.findMany({
      where: {
        createdAt: { gt: oneDayAgo },
        source: { not: 'propagation' },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true },
    });

    let totalPropagated = 0;
    const propagationDetails: Array<{ entryId: string; notified: number }> = [];

    for (const entry of recentEntries) {
      // Check if already propagated (look for knowledge message referencing this entry)
      const existing = await prisma.messageLog.findFirst({
        where: {
          channel: 'knowledge',
          metadata: {
            path: ['knowledgeId'],
            equals: entry.id,
          },
        },
      });

      if (!existing) {
        const result = await propagateKnowledge(entry.id);
        totalPropagated += result.notified;
        propagationDetails.push({
          entryId: entry.id,
          notified: result.notified,
        });
      }
    }

    report.entriesChecked = recentEntries.length;
    report.totalPropagated = totalPropagated;
    report.propagationDetails = propagationDetails;

    // Step 3: Gardener review
    if (!skipGardener) {
      const gardenerReport = await gardenerReview();
      report.gardener = gardenerReport;

      if (gardenerReport.actions.length > 5) {
        await prisma.escalation.create({
          data: {
            fromAgentId: 'system',
            severity: 'yellow',
            category: 'knowledge-health',
            title: `Knowledge gardener: ${gardenerReport.actions.length} issues found`,
            description: `Stale: ${gardenerReport.staleEntries}, Duplicates: ${gardenerReport.duplicateGroups}. Review recommended.`,
            status: 'open',
          },
        });
      }
    }

    // Step 4: Generate weekly digest (if it's been 7+ days since last digest)
    const lastDigest = await prisma.messageLog.findFirst({
      where: {
        channel: 'knowledge',
        body: { startsWith: 'Weekly knowledge digest' },
      },
      orderBy: { sentAt: 'desc' },
    });

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    if (!lastDigest || lastDigest.sentAt < weekAgo) {
      const weeklyEntries = await prisma.knowledgeEntry.findMany({
        where: {
          createdAt: { gt: weekAgo },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          category: true,
          content: true,
          agentId: true,
        },
      });

      if (weeklyEntries.length > 0) {
        const byCategory: Record<string, number> = {};
        for (const e of weeklyEntries) {
          byCategory[e.category] = (byCategory[e.category] || 0) + 1;
        }

        const digestSummary = Object.entries(byCategory)
          .map(([cat, count]) => `${count} ${cat}`)
          .join(', ');

        const activeAgents = await prisma.agent.findMany({
          where: { status: 'active' },
          select: { id: true },
        });

        for (const agent of activeAgents) {
          await prisma.messageLog.create({
            data: {
              fromId: 'system',
              toId: agent.id,
              channel: 'knowledge',
              body: `Weekly knowledge digest: ${weeklyEntries.length} new entries (${digestSummary})`,
              metadata: {
                type: 'weekly-digest',
                period: `${weekAgo.toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`,
                totalEntries: String(weeklyEntries.length),
                breakdown: JSON.stringify(byCategory),
              },
            },
          });
        }

        report.digest = {
          generated: true,
          entries: weeklyEntries.length,
          breakdown: byCategory,
          notifiedAgents: activeAgents.length,
        };
      } else {
        report.digest = { generated: false, reason: 'No new entries this week' };
      }
    } else {
      report.digest = {
        generated: false,
        reason: 'Digest already sent this week',
        lastDigest: lastDigest.sentAt,
      };
    }

    report.completedAt = new Date().toISOString();

    // Log the run
    await prisma.messageLog.create({
      data: {
        fromId: 'system',
        toId: 'system',
        channel: 'knowledge',
        body: `Propagation cycle: ${totalPropagated} notifications, ${report.embeddingsRefreshed || 0} embeddings`,
        metadata: {
          type: 'propagation-run',
          propagated: String(totalPropagated),
          embeddings: String(report.embeddingsRefreshed || 0),
        },
      },
    });

    return NextResponse.json(report);
  } catch (e) {
    console.error('[Knowledge Propagation]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// GET — Last run status
// =============================================================================

export async function GET() {
  try {
    const lastRun = await prisma.messageLog.findFirst({
      where: {
        fromId: 'system',
        channel: 'knowledge',
        body: { startsWith: 'Propagation cycle' },
      },
      orderBy: { sentAt: 'desc' },
    });

    const recentEntries = await prisma.knowledgeEntry.count({
      where: {
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    const totalEntries = await prisma.knowledgeEntry.count({
      where: {
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    const withEmbeddings = await prisma.knowledgeEntry.count({
      where: { embedding: { not: null } },
    });

    return NextResponse.json({
      lastRun: lastRun
        ? {
            at: lastRun.sentAt,
            body: lastRun.body,
          }
        : null,
      stats: {
        totalEntries,
        withEmbeddings,
        recentEntries24h: recentEntries,
        embeddingCoverage:
          totalEntries > 0
            ? Math.round((withEmbeddings / totalEntries) * 100)
            : 0,
      },
    });
  } catch (e) {
    console.error('[Knowledge Propagation GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
