// @ts-check
/**
 * Go Core Browser E2E Tests
 *
 * Validates the full System UI → Go Core terminal pipeline:
 *   TerminalView → CoreClientImpl (WebSocket) → Go Core → process → output
 *
 * Prerequisites:
 *   - Go Core running on :9090 (SESSIONNODE_PLUGIN_DIRS must include plugins/)
 *   - Next.js dev server running on :3000
 *   - playwright-go-core.config.mjs handles both
 */

import { test, expect } from '@playwright/test';

test.describe('Go Core Terminal E2E', () => {
  test('T1: terminal spawn — click Start, verify session active', async ({ page }) => {
    await page.goto('/test-go-core/');

    // Wait for WebSocket connection
    await expect(page.locator('#ws-status')).toHaveText('WS: connected', { timeout: 15_000 });

    // Verify Start button is visible
    const startBtn = page.locator('button:has-text("Start")');
    await expect(startBtn).toBeVisible({ timeout: 5_000 });

    // Click Start to spawn bash
    await startBtn.click();

    // Green dot (running indicator) appears
    await expect(page.locator('.bg-green-500')).toBeVisible({ timeout: 10_000 });

    // Truncated sessionId label appears (first 8 chars of sess_proc_*)
    const sessionLabel = page.locator('.text-green-400.font-mono');
    await expect(sessionLabel.first()).toBeVisible({ timeout: 5_000 });
  });

  test('T2: terminal I/O — type echo command, verify output in xterm', async ({ page }) => {
    await page.goto('/test-go-core/');

    // Wait for WebSocket connection
    await expect(page.locator('#ws-status')).toHaveText('WS: connected', { timeout: 15_000 });

    // Spawn bash
    const startBtn = page.locator('button:has-text("Start")');
    await expect(startBtn).toBeVisible({ timeout: 5_000 });
    await startBtn.click();

    // Wait for session running indicator
    await expect(page.locator('.bg-green-500')).toBeVisible({ timeout: 10_000 });

    // Focus xterm helper textarea and type a command
    // xterm.js renders its input as an off-screen textarea with class "xterm-helper-textarea"
    const xtermInput = page.locator('.xterm-helper-textarea').first();
    await xtermInput.waitFor({ state: 'visible', timeout: 5_000 });
    await xtermInput.focus();

    // Type the echo command character by character
    await page.keyboard.type('echo E2E_TERMINAL_OK');
    await page.keyboard.press('Enter');

    // Assert output appears in xterm rows
    const xtermRows = page.locator('.xterm-rows').first();
    await expect(xtermRows).toContainText('E2E_TERMINAL_OK', { timeout: 15_000 });
  });

  test('T3: push messages do not corrupt action.response matching', async ({ page }) => {
    await page.goto('/test-go-core/');

    // Wait for WebSocket connection
    await expect(page.locator('#ws-status')).toHaveText('WS: connected', { timeout: 15_000 });

    // Spawn bash
    const startBtn = page.locator('button:has-text("Start")');
    await expect(startBtn).toBeVisible({ timeout: 5_000 });
    await startBtn.click();

    // Wait for session running
    await expect(page.locator('.bg-green-500')).toBeVisible({ timeout: 10_000 });

    // Generate terminal output (produces stream.chunk push messages)
    const xtermInput = page.locator('.xterm-helper-textarea').first();
    await xtermInput.waitFor({ state: 'visible', timeout: 5_000 });
    await xtermInput.focus();
    await page.keyboard.type('echo HELLO_PUSH_TEST');
    await page.keyboard.press('Enter');

    // While output is streaming, call system.info via evaluate.
    // This tests that the system.info action.response is correctly matched
    // despite interleaving stream.chunk messages on the same WebSocket.
    const systemInfo = await page.evaluate(async () => {
      const core = /** @type {import('../../app/console/core/core-types').CoreClient} */ (
        /** @type {unknown} */ (window.__testCore)
      );
      return await core.call('system.info');
    });

    expect(systemInfo).toHaveProperty('os');
    expect(systemInfo).toHaveProperty('arch');
    expect(systemInfo).toHaveProperty('goVersion');

    // Terminal output should also be visible despite the concurrent call
    const xtermRows = page.locator('.xterm-rows').first();
    await expect(xtermRows).toContainText('HELLO_PUSH_TEST', { timeout: 15_000 });
  });

  test('T4: SystemInfoPanel displays system info and node list', async ({ page }) => {
    await page.goto('/test-go-core/');

    // Wait for WebSocket connection
    await expect(page.locator('#ws-status')).toHaveText('WS: connected', { timeout: 15_000 });

    // Wait for the SystemInfoPanel to render and load data
    const panel = page.locator('[data-testid="system-info-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Verify system info data rows — inside the panel content area
    await expect(panel.getByText('OS', { exact: true })).toBeVisible();
    await expect(panel.getByText('Arch', { exact: true })).toBeVisible();
    await expect(panel.getByText('Go Version', { exact: true })).toBeVisible();
    await expect(panel.getByText('CPU Cores', { exact: true })).toBeVisible();

    // Verify the node list section
    await expect(panel.getByText('Nodes')).toBeVisible();
    await expect(panel.getByText('connected')).toBeVisible();
  });
});
