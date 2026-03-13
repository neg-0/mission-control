/**
 * E2E test database seeding helpers.
 *
 * Used by Playwright tests via test.beforeEach to ensure a known database state.
 * Loads .env.test so the PrismaClient connects to the test database
 * (the Playwright webServer loads it separately for Next.js).
 */
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../../.env.test') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Truncate all tables and seed minimal data for the War Room to render.
 */
export async function seedWarRoom(): Promise<void> {
  // Truncate everything — dynamically query table names so this
  // doesn't break if schema and migrations are temporarily out of sync.
  const tables: Array<{ tablename: string }> = await prisma.$queryRawUnsafe(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
    ORDER BY tablename
  `);

  if (tables.length > 0) {
    const quoted = tables.map((t) => `"${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE`);
  }

  // Seed minimal data so the War Room doesn't render empty-state errors
  await prisma.agent.create({
    data: {
      id: 'rocket',
      role: 'COO',
      workspacePath: '/tmp/test-workspace-rocket',
      status: 'active',
    },
  });

  await prisma.orchestratorConfig.create({
    data: { id: 'singleton' },
  });
}

/**
 * Disconnect Prisma client. Call in afterAll or globalTeardown.
 */
export async function teardown(): Promise<void> {
  await prisma.$disconnect();
}
