/**
 * Cron Jobs API Route — `/api/cron-jobs`
 *
 * Schedule management backed by the Postgres Schedule table.
 * OpenClaw's built-in scheduler handles execution; MC provides the UI + stagger logic.
 *
 * GET    /api/cron-jobs           → List all jobs (optionally filter by agentId)
 * POST   /api/cron-jobs           → Create a new job
 * PATCH  /api/cron-jobs           → Update an existing job
 * DELETE /api/cron-jobs           → Delete a job by ID
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Types matching OpenClaw's jobs.json schema (preserved for API compatibility)
// ---------------------------------------------------------------------------

interface CronSchedule {
  kind: 'cron' | 'at' | 'every';
  expr?: string;
  at?: string;
  everyMs?: number;
  anchorMs?: number;
  tz?: string;
}

interface CronPayload {
  text?: string;
  kind: 'systemEvent' | 'agentTurn';
  message?: string;
  model?: string;
}

interface CronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget?: string;
  wakeMode?: string;
  payload?: CronPayload;
  delivery?: { mode: string };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

<<<<<<< HEAD
async function readJobsFile(): Promise<JobsFile> {
  const raw = await readFile(getCronJobsPath(), 'utf-8');
  return JSON.parse(raw);
}

async function writeJobsFile(data: JobsFile): Promise<void> {
  await writeFile(getCronJobsPath(), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
=======
type ScheduleRow = Awaited<ReturnType<typeof prisma.schedule.findFirst>>;

function rowToJob(row: NonNullable<ScheduleRow>): CronJob {
  const schedule: CronSchedule = { kind: row.scheduleKind as CronSchedule['kind'] };
  if (row.scheduleKind === 'cron' && row.cronExpr) schedule.expr = row.cronExpr;
  if (row.scheduleKind === 'at' && row.scheduleAt) schedule.at = row.scheduleAt;
  if (row.scheduleKind === 'every' && row.intervalMs) schedule.everyMs = row.intervalMs;
  if (row.anchorMs != null) schedule.anchorMs = Number(row.anchorMs);
  if (row.tz) schedule.tz = row.tz;
>>>>>>> 50c660c (feat: migrate cron job config from cron/jobs.json to Postgres Schedule table)

  let payload: CronPayload | undefined;
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = { kind: 'agentTurn', text: row.payload };
    }
  }

  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    enabled: row.enabled,
    deleteAfterRun: row.deleteAfterRun || undefined,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
    schedule,
    sessionTarget: row.sessionTarget ?? undefined,
    wakeMode: row.wakeMode ?? undefined,
    payload,
    delivery: { mode: row.channel },
    state: {
      nextRunAtMs: row.nextRunAt?.getTime(),
      lastRunAtMs: row.lastRunAt?.getTime(),
      lastStatus: row.lastStatus ?? undefined,
      lastDurationMs: row.lastDurationMs ?? undefined,
      consecutiveErrors: row.consecutiveErrors,
    },
  };
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    const rows = await prisma.schedule.findMany({
      where: agentId ? { agentId } : undefined,
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ jobs: rows.map(rowToJob) });
  } catch (error) {
    console.error('Cron jobs GET error:', error);
    return NextResponse.json({ jobs: [], error: 'Failed to read cron jobs' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create a new job
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, name, schedule, payload, sessionTarget, wakeMode, enabled, deleteAfterRun } = body;

    if (!agentId || !name || !schedule) {
      return NextResponse.json(
        { error: 'agentId, name, and schedule are required' },
        { status: 400 }
      );
    }

    const row = await prisma.schedule.create({
      data: {
        agentId,
        name,
        enabled: enabled ?? true,
        scheduleKind: schedule.kind,
        cronExpr: schedule.kind === 'cron' ? schedule.expr ?? null : null,
        intervalMs: schedule.kind === 'every' ? schedule.everyMs ?? null : null,
        scheduleAt: schedule.kind === 'at' ? schedule.at ?? null : null,
        anchorMs: schedule.anchorMs != null ? BigInt(schedule.anchorMs) : null,
        tz: schedule.tz ?? null,
        sessionTarget: sessionTarget ?? 'main',
        wakeMode: wakeMode ?? 'next-heartbeat',
        deleteAfterRun: deleteAfterRun ?? false,
        payload: payload ? JSON.stringify(payload) : null,
      },
    });

    return NextResponse.json({ job: rowToJob(row) }, { status: 201 });
  } catch (error) {
    console.error('Cron jobs POST error:', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update an existing job
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existing = await prisma.schedule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: `Job ${id} not found` }, { status: 404 });
    }

    const data: Parameters<typeof prisma.schedule.update>[0]['data'] = {};

    if (updates.name !== undefined) data.name = updates.name;
    if (updates.enabled !== undefined) data.enabled = updates.enabled;
    if (updates.agentId !== undefined) data.agentId = updates.agentId;
    if (updates.sessionTarget !== undefined) data.sessionTarget = updates.sessionTarget;
    if (updates.wakeMode !== undefined) data.wakeMode = updates.wakeMode;
    if (updates.deleteAfterRun !== undefined) data.deleteAfterRun = updates.deleteAfterRun;
    if (updates.payload !== undefined) data.payload = JSON.stringify(updates.payload);

    if (updates.schedule !== undefined) {
      const s: CronSchedule = updates.schedule;
      data.scheduleKind = s.kind;
      data.cronExpr = s.kind === 'cron' ? s.expr ?? null : null;
      data.intervalMs = s.kind === 'every' ? s.everyMs ?? null : null;
      data.scheduleAt = s.kind === 'at' ? s.at ?? null : null;
      data.anchorMs = s.anchorMs != null ? BigInt(s.anchorMs) : null;
      data.tz = s.tz ?? null;
    }

    const row = await prisma.schedule.update({ where: { id }, data });

    return NextResponse.json({ job: rowToJob(row) });
  } catch (error) {
    console.error('Cron jobs PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove a job
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existing = await prisma.schedule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: `Job ${id} not found` }, { status: 404 });
    }

    await prisma.schedule.delete({ where: { id } });

    const remaining = await prisma.schedule.count();
    return NextResponse.json({ success: true, remaining });
  } catch (error) {
    console.error('Cron jobs DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
