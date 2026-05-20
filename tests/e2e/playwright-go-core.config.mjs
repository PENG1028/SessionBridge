// @ts-check
/**
 * Playwright config for Go Core E2E browser tests.
 *
 * Starts:
 *   1. Next.js dev server (port 3000) — serves the test harness page
 *   2. Go Core (port 9090) — WebSocket + capability API backend
 *
 * Usage:
 *   npx playwright test --config=tests/e2e/playwright-go-core.config.mjs
 *
 *   Or first build Go Core for faster startup:
 *     cd go-core && go build -o /tmp/gocore-e2e-binary ./cmd/node/
 *     npx playwright test --config=tests/e2e/playwright-go-core.config.mjs
 *
 * Manual debug:
 *   # Terminal 1: Go Core
 *   cd go-core
 *   SESSIONNODE_PLUGIN_DIRS=../plugins go run ./cmd/node/
 *
 *   # Terminal 2: Next.js dev server
 *   npm run dev:web
 *
 *   # Terminal 3: Run tests
 *   npx playwright test --config=tests/e2e/playwright-go-core.config.mjs
 */

import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const goCoreDir = path.resolve(projectRoot, 'go-core');

// Write a temp config that clears pluginDirs so SESSIONNODE_PLUGIN_DIRS
// takes effect (the default config sets pluginDirs which would override the env var).
const tempConfigPath = path.join(
  os.tmpdir(),
  `gocore-e2e-config-${Date.now()}.json`,
);

// Clean up old temp configs (older than 1 hour)
try {
  const tmpDir = fs.readdirSync(os.tmpdir());
  for (const f of tmpDir) {
    if (f.startsWith('gocore-e2e-config-') && f.endsWith('.json')) {
      const fp = path.join(os.tmpdir(), f);
      const stat = fs.statSync(fp);
      if (Date.now() - stat.mtimeMs > 3_600_000) {
        fs.unlinkSync(fp);
      }
    }
  }
} catch {
  // best effort
}

// Write clean config — empty pluginDirs so SESSIONNODE_PLUGIN_DIRS is additive
const tempConfig = {
  core: { listenAddr: ':9090' },
  plugin: { pluginDirs: [] },
  node: { name: 'e2e-test-node' },
};
fs.writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));

export default defineConfig({
  testDir: '.',
  testMatch: 'go-core-terminal-e2e.spec.mjs',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:web',
      port: 3000,
      cwd: projectRoot,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'go run ./cmd/node/',
      port: 9090,
      cwd: goCoreDir,
      env: {
        SESSIONNODE_CONFIG: tempConfigPath,
        SESSIONNODE_PLUGIN_DIRS: path.resolve(projectRoot, 'plugins'),
        NODE_ID: 'e2e-test-node',
      },
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
