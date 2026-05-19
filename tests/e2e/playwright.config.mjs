// Playwright config for SessionBridge E2E browser tests
// Usage: npx playwright test --config=tests/e2e/playwright.config.mjs

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,  // sequential to avoid port conflicts
  use: {
    baseURL: 'http://localhost:14400',
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
