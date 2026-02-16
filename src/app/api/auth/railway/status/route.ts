import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Lightweight check: does RAILWAY_API_TOKEN exist in env? */
export async function GET() {
  const hasToken = !!process.env.RAILWAY_API_TOKEN;
  return NextResponse.json({ connected: hasToken });
}
