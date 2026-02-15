/**
 * Seed script: Migrate cron/jobs.json → Schedule table
 *
 * Usage: npx tsx scripts/seed-schedules.ts
 *
 * Maps OpenClaw cron/jobs.json entries to Prisma Schedule records.
 * Handles both cron expressions and interval (everyMs) patterns.
 * Skips one-time "at" schedules (they're handled differently).
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface CronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'cron' | 'every' | 'at';
    expr?: string;
    everyMs?: number;
    tz?: string;
    at?: string;
  };
  payload?: {
    text?: string;
    message?: string;
    kind?: string;
  };
  state?: {
    lastRunAtMs?: number;
    nextRunAtMs?: number;
  };
}

async function main() {
  const cronPath = path.resolve('/home/neg0/.openclaw/cron/jobs.json');
  const raw = fs.readFileSync(cronPath, 'utf-8');
  const data = JSON.parse(raw);
  const jobs: CronJob[] = data.jobs || [];

  console.log(`Found ${jobs.length} cron jobs to migrate\n`);

  // Map OpenClaw agentId to our Agent IDs
  // "main" in cron → "rocket" in our DB
  const agentIdMap: Record<string, string> = {
    main: 'rocket',
    rocket: 'rocket',
  };

  let migrated = 0;
  let skipped = 0;

  for (const job of jobs) {
    // Skip one-time "at" schedules
    if (job.schedule.kind === 'at') {
      console.log(`  ⏭  SKIP (one-time): ${job.name}`);
      skipped++;
      continue;
    }

    const agentId = agentIdMap[job.agentId] || job.agentId;

    // Check if agent exists
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      console.log(`  ⚠  SKIP (agent "${agentId}" not in DB): ${job.name}`);
      skipped++;
      continue;
    }

    // Check for duplicate (by name + agentId)
    const existing = await prisma.schedule.findFirst({
      where: { name: job.name, agentId },
    });
    if (existing) {
      console.log(`  ↩  SKIP (already exists): ${job.name}`);
      skipped++;
      continue;
    }

    const payload = job.payload?.text || job.payload?.message || null;
    const cronExpr = job.schedule.kind === 'cron' ? job.schedule.expr || null : null;
    const intervalMs = job.schedule.kind === 'every' ? job.schedule.everyMs || null : null;
    const lastRunAt = job.state?.lastRunAtMs ? new Date(job.state.lastRunAtMs) : null;
    const nextRunAt = job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs) : null;

    await prisma.schedule.create({
      data: {
        agentId,
        name: job.name,
        cronExpr,
        intervalMs,
        enabled: job.enabled !== false,
        priority: job.name.includes('Standup') ? 2 : job.name.includes('Work Session') ? 1 : 0,
        payload,
        lastRunAt,
        nextRunAt,
      },
    });

    console.log(`  ✅ ${job.name} → ${agentId} (${cronExpr || `every ${intervalMs}ms`})`);
    migrated++;
  }

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
