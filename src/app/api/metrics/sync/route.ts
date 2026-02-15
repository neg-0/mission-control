/**
 * @module api/metrics/sync
 * @description
 * Snapshots stats.json data from all agent workspaces into the Metric table.
 * Creates time-series data for trend tracking.
 *
 * POST /api/metrics/sync → reads all stats.json, writes Metric rows
 */

import { prisma } from '@/lib/prisma';
import { readFile, readdir } from 'fs/promises';
import { NextResponse } from 'next/server';
import { join } from 'path';

const OPENCLAW_ROOT = '/home/neg0/.openclaw';

export async function POST() {
  try {
    const entries = await readdir(OPENCLAW_ROOT);
    const workspaceDirs = entries.filter(e => e.startsWith('workspace-'));

    let synced = 0;
    const now = new Date();

    for (const dir of workspaceDirs) {
      const agentId = dir.replace('workspace-', '');
      const statsPath = join(OPENCLAW_ROOT, dir, 'stats.json');

      try {
        const raw = await readFile(statsPath, 'utf-8');
        const stats = JSON.parse(raw);

        // Ensure agent exists in DB
        const agentExists = await prisma.agent.findUnique({
          where: { id: agentId },
        });
        if (!agentExists) continue;

        // Write metric snapshots
        const metricsToWrite = [
          { type: 'mrr', value: stats.mrr ?? 0 },
          { type: 'users', value: stats.users ?? 0 },
          { type: 'traffic', value: stats.traffic ?? 0 },
          { type: 'cost', value: stats.cost ?? 0 },
        ];

        for (const m of metricsToWrite) {
          await prisma.metric.create({
            data: {
              agentId,
              type: m.type,
              value: m.value,
              recordedAt: now,
            },
          });
          synced++;
        }
      } catch {
        // No stats.json or parse error — skip
      }
    }

    return NextResponse.json({
      ok: true,
      synced,
      timestamp: now.toISOString(),
    });
  } catch (e) {
    console.error('[Metrics Sync]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
