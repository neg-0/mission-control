import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Mission Control E2E tests.
 *
 * - Tests run against a Next.js dev server loaded with .env.test
 * - Single worker to avoid test database race conditions
 * - Chromium only (desktop Chrome viewport)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npx dotenv -e .env.test -- npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
