import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/webhooks/refinery/[ideaId]
 * Public webhook for capturing waitlist signups.
 * 
 * Payload: { email: "...", source: "..." }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { ideaId: string } }
) {
  try {
    const { ideaId } = params;
    const body = await request.json();
    const { email, source, ...metadata } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    // Verify idea exists
    const idea = await prisma.idea.findUnique({
      where: { id: ideaId }
    });

    if (!idea) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }

    // Record signup (deduped by unique constraint)
    try {
      await prisma.waitlistSignup.create({
        data: {
          ideaId,
          email,
          source: source || 'direct',
          metadata: metadata
        }
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        // Unique constraint violation - already signed up. 
        // We return success to not leak state to the public form.
        return NextResponse.json({ success: true, status: 'duplicate' });
      }
      throw e;
    }

    // Update aggregate metrics on Idea model
    const count = await prisma.waitlistSignup.count({
      where: { ideaId }
    });

    await prisma.idea.update({
      where: { id: ideaId },
      data: {
        validationMetrics: {
          ...(idea.validationMetrics as object || {}),
          signups: count,
          lastSignupAt: new Date().toISOString()
        }
      }
    });

    return NextResponse.json({ success: true, count });
  } catch (e) {
    console.error('[Refinery Webhook]', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
