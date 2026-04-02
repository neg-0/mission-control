/**
 * Cron Jobs API Route — `/api/cron-jobs`
 *
 * Hybrid schedule management: reads/writes the OpenClaw `cron/jobs.json` file.
 * OpenClaw's built-in scheduler handles execution; MC provides the UI + stagger logic.
 *
 * GET    /api/cron-jobs           → List all jobs (optionally filter by agentId)
 * POST   /api/cron-jobs           → Create a new job
 * PATCH  /api/cron-jobs           → Update an existing job
 * DELETE /api/cron-jobs           → Delete a job by ID
 */

import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { getOpenClawHome } from '@/lib/config';

function getCronJobsPath() {
  return path.join(getOpenClawHome(), 'cron', 'jobs.json');
}

// ---------------------------------------------------------------------------
// Types matching OpenClaw's jobs.json schema
// ---------------------------------------------------------------------------

interface CronSchedule {
  kind: 'cron' | 'at' | 'every';
  expr?: string;          // cron expression (kind=cron)
  at?: string;            // ISO date (kind=at)
  everyMs?: number;       // interval ms (kind=every)
  anchorMs?: number;       // anchor for interval
  tz?: string;            // timezone
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

interface JobsFile {
  version: number;
  jobs: CronJob[];
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

async function readJobsFile(): Promise<JobsFile> {
  const raw = await readFile(getCronJobsPath(), 'utf-8');
  return JSON.parse(raw);
}

async function writeJobsFile(data: JobsFile): Promise<void> {
  await writeFile(getCronJobsPath(), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}


// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    const data = await readJobsFile();
    let jobs = data.jobs || [];

    if (agentId) {
      jobs = jobs.filter(j => j.agentId === agentId);
    }

    return NextResponse.json({ jobs });
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

    const data = await readJobsFile();
    const now = Date.now();

    const newJob: CronJob = {
      id: randomUUID(),
      agentId,
      name,
      enabled: enabled ?? true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule,
      sessionTarget: sessionTarget || 'main',
      wakeMode: wakeMode || 'next-heartbeat',
      ...(payload && { payload }),
      ...(deleteAfterRun && { deleteAfterRun }),
      state: {},
    };

    data.jobs.push(newJob);
    await writeJobsFile(data);

    return NextResponse.json({ job: newJob }, { status: 201 });
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

    const data = await readJobsFile();
    const jobIndex = data.jobs.findIndex(j => j.id === id);

    if (jobIndex === -1) {
      return NextResponse.json({ error: `Job ${id} not found` }, { status: 404 });
    }

    const job = data.jobs[jobIndex];

    // Apply updates
    if (updates.name !== undefined) job.name = updates.name;
    if (updates.enabled !== undefined) job.enabled = updates.enabled;
    if (updates.schedule !== undefined) job.schedule = updates.schedule;
    if (updates.payload !== undefined) job.payload = updates.payload;
    if (updates.sessionTarget !== undefined) job.sessionTarget = updates.sessionTarget;
    if (updates.wakeMode !== undefined) job.wakeMode = updates.wakeMode;
    if (updates.deleteAfterRun !== undefined) job.deleteAfterRun = updates.deleteAfterRun;
    if (updates.agentId !== undefined) job.agentId = updates.agentId;
    job.updatedAtMs = Date.now();

    data.jobs[jobIndex] = job;
    await writeJobsFile(data);

    return NextResponse.json({ job });
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

    const data = await readJobsFile();
    const before = data.jobs.length;
    data.jobs = data.jobs.filter(j => j.id !== id);

    if (data.jobs.length === before) {
      return NextResponse.json({ error: `Job ${id} not found` }, { status: 404 });
    }

    await writeJobsFile(data);

    return NextResponse.json({ success: true, remaining: data.jobs.length });
  } catch (error) {
    console.error('Cron jobs DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
