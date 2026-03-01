/**
 * @module api/costs
 * @description
 * CRUD for the cost ledger + computed burn rate.
 *
 * GET  /api/costs           → Full burn rate with breakdown
 * POST /api/costs           → Add a manual cost entry
 * DELETE /api/costs?id=xxx  → Remove a cost entry
 */

import { calculateBurnRate } from '@/lib/burn-rate';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET — Returns full burn rate calculation with breakdown.
 */
export async function GET() {
  try {
    const result = await calculateBurnRate();

    // Also fetch historical cost entries for the ledger view
    const history = await prisma.costEntry.findMany({
      orderBy: { date: 'desc' },
      take: 100,
    });

    return NextResponse.json({
      ...result,
      history,
    });
  } catch (e) {
    console.error('[Costs GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * POST — Add a manual cost entry.
 *
 * Body: { service, amount, category?, notes?, date?, recurring? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, service, amount, category, notes, date, recurring } = body;

    if (!service || amount === undefined) {
      return NextResponse.json(
        { error: 'service and amount are required' },
        { status: 400 }
      );
    }

    // If id is provided, update that specific entry
    if (id) {
      const entry = await prisma.costEntry.update({
        where: { id },
        data: {
          service,
          amount: parseFloat(amount),
          category: category || 'other',
          notes: notes || null,
          recurring: recurring ?? true,
          source: 'manual',
        },
      });
      return NextResponse.json(entry);
    }

    const entryDate = date
      ? new Date(date)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const entry = await prisma.costEntry.upsert({
      where: {
        service_date: { service, date: entryDate },
      },
      update: {
        amount: parseFloat(amount),
        category: category || 'other',
        notes: notes || null,
        recurring: recurring ?? true,
        source: 'manual',
      },
      create: {
        service,
        amount: parseFloat(amount),
        category: category || 'other',
        notes: notes || null,
        date: entryDate,
        recurring: recurring ?? true,
        source: 'manual',
      },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (e) {
    console.error('[Costs POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE — Remove a cost entry by ID.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await prisma.costEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[Costs DELETE]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
