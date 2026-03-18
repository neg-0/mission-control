/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Serialize test execution to prevent DB deadlocks when unit and API
  // projects run concurrently against the same Postgres instance
  maxWorkers: 1,
  projects: [
    // ── Unit Tests ──────────────────────────────────────────────────────
    // Existing pure-function tests. No database, no setup files.
    // Run with: npm run test:unit
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/**/*.test.ts'],
      testPathIgnorePatterns: ['__tests__/api/'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
    },

    // ── API Integration Tests ──────────────────────────────────────────
    // Tests that import route handlers and hit the test database.
    // Requires: test DB running (npm run test:setup-db)
    // Run with: npm run test:api
    // maxWorkers: 1 prevents deadlocks from concurrent DB access across suites
    {
      displayName: 'api',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/api/**/*.test.ts'],
      maxWorkers: 1,
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      setupFiles: ['<rootDir>/src/lib/__tests__/helpers/jest-api-setup.ts'],
    },
  ],
};
