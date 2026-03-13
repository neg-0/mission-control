/**
 * Jest setup file for API integration tests.
 *
 * Loads .env.test BEFORE any test module imports, ensuring the Prisma
 * singleton in @/lib/prisma reads DATABASE_URL from the test environment.
 *
 * Referenced in jest.config.js as a setupFile for the "api" project.
 */
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../../../../.env.test') });
