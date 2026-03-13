/**
 * E2E Smoke Test: Mission Control
 *
 * Verifies the app loads, renders past its loading state, and produces no
 * unexpected console errors.
 *
 * In the test environment the OpenClaw gateway and openclaw.json are not
 * available, so the app renders the "No workspaces configured" empty state.
 * This test validates the app boots cleanly despite that.
 */
import { test, expect } from '@playwright/test';
import { seedWarRoom, teardown } from './helpers/seed';

test.beforeEach(async () => {
  await seedWarRoom();
});

test.afterAll(async () => {
  await teardown();
});

test.describe('Mission Control Smoke Test', () => {
  test('loads and renders app shell without crashing', async ({ page }) => {
    // Collect console errors throughout the test
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate to root — use 'domcontentloaded' instead of 'networkidle'
    // because SSE/WebSocket connections never idle in this app
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for the app to finish its loading state. After the React client
    // fetches from /api/dashboard and /api/workspaces, it renders either:
    //  - The War Room tab bar (if workspaces are found)
    //  - The "No workspaces configured" empty state
    //  - The "Open Settings" CTA
    // We wait for any of these post-loading indicators to appear.
    await expect(
      page.getByText('No workspaces configured').or(
        page.getByRole('button', { name: /War Room/i })
      )
    ).toBeVisible({ timeout: 20_000 });

    // Verify the app chrome (header bar) is present.
    // The header text "Mission" has CSS letter-spacing — find it by exact text.
    await expect(page.getByText('Mission', { exact: true })).toBeVisible();

    // In test (no openclaw.json), the empty state should be shown.
    // Verify its CTA also renders.
    const emptyState = page.getByText('No workspaces configured');
    if (await emptyState.isVisible()) {
      await expect(page.getByText('Open Settings')).toBeVisible();
    }

    // Filter out expected errors (WebSocket/Gateway/SSE connection failures
    // are expected in test since there's no live OpenClaw gateway)
    const unexpectedErrors = consoleErrors.filter(
      (e) =>
        !e.includes('WebSocket') &&
        !e.includes('Gateway') &&
        !e.includes('ECONNREFUSED') &&
        !e.includes('fetch failed') &&
        !e.includes('openclaw.json') &&
        !e.includes('ERR_CONNECTION_REFUSED') &&
        !e.includes('Failed to load resource') &&
        !e.includes('net::ERR_')
    );

    expect(unexpectedErrors).toHaveLength(0);
  });
});
