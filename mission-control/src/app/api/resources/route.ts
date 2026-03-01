import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const resources = await prisma.infraResource.findMany({
      orderBy: { type: 'asc' },
      include: {
        project: {
          select: { name: true }
        }
      }
    });

    // Group by type for easier frontend consumption
    const grouped = {
      supabase: resources.filter(r => r.type === 'supabase_project'),
      railway: resources.filter(r => r.type === 'railway_project'),
      other: resources.filter(r => r.type !== 'supabase_project' && r.type !== 'railway_project')
    };

    return NextResponse.json(grouped);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
