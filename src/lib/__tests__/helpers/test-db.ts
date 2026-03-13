/**
 * Test database utilities.
 *
 * Provides a dedicated PrismaClient for the test database,
 * a resetDatabase() function for per-test isolation,
 * and a disconnectTestDb() function for cleanup in afterAll().
 */
import { PrismaClient } from '@prisma/client';

/**
 * Dedicated Prisma client for integration tests.
 * Uses DATABASE_URL from the environment (loaded from .env.test via jest-api-setup.ts).
 */
export const testPrisma = new PrismaClient({
  log: ['warn', 'error'],
});

/**
 * Truncate all application tables using TRUNCATE ... CASCADE.
 * Call in beforeEach() for test isolation.
 *
 * Dynamically queries the database for table names so it never fails
 * if the schema and migrations are temporarily out of sync.
 */
export async function resetDatabase(): Promise<void> {
  const tables: Array<{ tablename: string }> = await testPrisma.$queryRawUnsafe(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
    ORDER BY tablename
  `);

  if (tables.length === 0) return;

  const quoted = tables.map((t) => `"${t.tablename}"`).join(', ');
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE`);
}

/**
 * Disconnect the test Prisma client.
 * Call in afterAll() to avoid open handle warnings.
 */
export async function disconnectTestDb(): Promise<void> {
  await testPrisma.$disconnect();
}
