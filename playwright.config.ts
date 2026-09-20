import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a real dev server and the real database — the one the
 * live site serves. The suite replaces the schedule with its own fixture in
 * `global-setup` and puts the sample back in `global-teardown`, so while it runs the
 * public URL shows the fixture. Do not run it once a link has been handed to anyone.
 * See docs/OPERATIONS.md.
 */
export default defineConfig({
  testDir: './e2e',
  // Seeds the fixture, and restores the sample afterwards.
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
