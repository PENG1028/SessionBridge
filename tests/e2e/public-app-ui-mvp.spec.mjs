// @ts-check
/**
 * Round 40 — Public App UI MVP End-to-End Acceptance
 *
 * Starts Go Core + Next.js dev server on random ports, then validates:
 *   T1 — Setup → Login → Proxy Core call
 *   T2 — SSE realtime event path
 *   T3 — Terminal run.create → stream.write → stream.chunk → replay → stop
 *   T4 — No direct mode, no Core token leak
 *
 * Usage:
 *   npx playwright test tests/e2e/public-app-ui-mvp.spec.mjs --reporter=line
 */

import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { createServer, createConnection } from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const GO_CORE_DIR = path.resolve(PROJECT_ROOT, 'go-core');
const PLUGIN_DIRS = path.resolve(PROJECT_ROOT, 'plugins');

const PASSWORD = 'E2ePassword123!';

// ─── Port helpers ───────────────────────────────────────

function getRandomPort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function poll() {
      if (Date.now() > deadline) return reject(new Error(`Timeout ${host}:${port}`));
      const sock = createConnection({ host, port }, () => {
        sock.end();
        sock.destroy();
        resolve();
      });
      sock.on('error', () => setTimeout(poll, 500));
      sock.setTimeout(2000, () => { sock.destroy(); setTimeout(poll, 500); });
    }
    poll();
  });
}

/** Kill a process tree by PID using PowerShell on Windows. */
function killProcessTree(pid) {
  try {
    if (process.platform === 'win32') {
      require('child_process').execSync(`powershell -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; Get-Process -Id ${pid} | ForEach-Object { $_.GetRelatedProcesses() | Stop-Process -Force -ErrorAction SilentlyContinue }"`, { timeout: 3000 });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {}
}

async function httpPost(url, jsonBody) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonBody),
  });
  const body = await res.text();
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}

// ─── Server processes (module-level for cross-test sharing) ──

let corePort, webPort;
let coreProc, nextProc;
let tempDir, authFile;
let sharedCookieValue = null;

test.beforeAll(async () => {
  test.setTimeout(300_000);

  corePort = await getRandomPort();
  webPort = await getRandomPort();
  console.log(`  Ports: Core=${corePort} Web=${webPort}`);

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-mvp-e2e-'));
  authFile = path.join(tempDir, 'app-ui-auth.json');
  const dataDir = path.join(tempDir, 'core-data');
  fs.mkdirSync(dataDir, { recursive: true });

  const token = 'e2e-token-' + Math.random().toString(36).slice(2, 10);

  // ── Start Go Core ──
  const coreBin = process.env.SESSIONBRIDGE_E2E_USE_DIST === '1'
    ? path.resolve(PROJECT_ROOT, 'dist', 'go-core', process.platform === 'win32' ? 'sessionnode.exe' : 'sessionnode')
    : null;
  if (!coreBin) {
    console.log('  Using go run for current-source E2E...');
  }
  coreProc = spawn(coreBin || 'go', coreBin ? [] : ['run', './cmd/node/'], {
    cwd: coreBin ? PROJECT_ROOT : GO_CORE_DIR,
    env: {
      ...process.env,
      LISTEN_ADDR: `127.0.0.1:${corePort}`,
      SESSIONNODE_TOKEN: token,
      SESSIONNODE_DATA_DIR: dataDir,
      SESSIONNODE_PLUGIN_DIRS: PLUGIN_DIRS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  coreProc.stdout.on('data', (d) => process.stdout.write(`[core] ${d}`));
  coreProc.stderr.on('data', (d) => process.stderr.write(`[core-err] ${d}`));
  coreProc.on('error', (err) => console.log(`[core] error: ${err.message}`));
  coreProc.on('exit', (code, sig) => console.log(`[core] exited code=${code} sig=${sig}`));

  // ── Start Next.js Dev ──
  nextProc = spawn(process.execPath, [
    path.resolve(PROJECT_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'),
    'dev', '-p', String(webPort),
  ], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SESSIONBRIDGE_CORE_WS_URL: `ws://127.0.0.1:${corePort}/ws`,
      SESSIONNODE_TOKEN: token,
      SESSIONBRIDGE_APP_UI_AUTH_FILE: authFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  nextProc.stdout.on('data', (d) => process.stdout.write(`[web] ${d}`));
  nextProc.stderr.on('data', (d) => process.stderr.write(`[web-err] ${d}`));
  nextProc.on('error', (err) => console.log(`[web] error: ${err.message}`));
  nextProc.on('exit', (code, sig) => console.log(`[web] exited code=${code} sig=${sig}`));

  // ── Wait for servers ──
  console.log('  Waiting for Go Core...');
  await waitForPort('127.0.0.1', corePort, 60_000);
  console.log('  Go Core ready');

  console.log('  Waiting for Next.js...');
  await waitForPort('127.0.0.1', webPort, 180_000);
  console.log('  Next.js ready');
});

test.afterAll(async () => {
  console.log('  Cleaning up processes...');
  if (nextProc) { killProcessTree(nextProc.pid); nextProc = null; }
  if (coreProc) { killProcessTree(coreProc.pid); coreProc = null; }
  if (tempDir) {
    setTimeout(() => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }, 2000);
  }
});

// ─── Test helpers ───────────────────────────────────────

/** Set the shared session cookie on a page context. */
async function setCookie(context) {
  if (!sharedCookieValue) return;
  await context.addCookies([{
    name: 'sessionbridge_view',
    value: sharedCookieValue,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
}

/** Make a Core proxy call from the browser page. */
async function coreCall(page, method, params = {}) {
  const { pluginId, ...payload } = params || {};
  return await page.evaluate(async ({ method, params, pluginId }) => {
    const res = await fetch('/api/core/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params, ...(pluginId ? { pluginId } : {}) }),
    });
    return await res.json();
  }, { method, params: payload, pluginId });
}

const baseUrl = () => `http://localhost:${webPort}`;

// ─── Tests ───────────────────────────────────────────────

test.describe('Public App UI MVP', () => {

  test('T1: Setup → Login → Proxy call → Logout', async ({ page, context }) => {
    // 1.1 Visit app — redirects / → /login → /setup (no auth configured yet)
    await page.goto(baseUrl() + '/', { waitUntil: 'networkidle' });
    // Goto finishes at /setup after redirect chain; wait for the setup form
    await expect(page.locator('text=App UI Setup')).toBeVisible({ timeout: 20_000 });
    console.log('  T1: At /setup');

    // 1.2 Fill setup form
    const pwInputs = page.locator('input[type="password"]');
    await expect(pwInputs.first()).toBeVisible({ timeout: 5_000 });
    await pwInputs.nth(0).fill(PASSWORD);
    await pwInputs.nth(1).fill(PASSWORD);

    // 1.3 Submit
    await page.locator('button[type="submit"]').click();

    // 1.4 Should redirect to /
    await page.waitForURL(baseUrl() + '/', { timeout: 15_000 });
    console.log('  T1: At / after setup');

    // Save cookie for other tests
    const cookies = await context.cookies();
    const sessCookie = cookies.find(c => c.name === 'sessionbridge_view');
    expect(sessCookie).toBeTruthy();
    sharedCookieValue = sessCookie.value;
    console.log('  T1: Cookie saved for later tests');

    // 1.5 Proxy call — node.identity.get
    const identity = await coreCall(page, 'node.identity.get');
    console.log(`  T1: identity: nodeId=${identity?.nodeId?.substring(0, 16)||'bad'}...`);
    expect(identity).toBeTruthy();
    expect(identity.nodeId).toBeTruthy();
    expect(identity.fingerprint).toBeTruthy();

    // 1.6 No Core token in page
    const html = await page.content();
    expect(html).not.toContain('e2e-token');
    const lsToken = await page.evaluate(() => localStorage.getItem('sessionbridge_token'));
    expect(lsToken).toBeNull();
    console.log('  T1: No token leak');

    // 1.7 Logout
    await page.evaluate(async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
    });

    // 1.8 After logout, /api/core/call returns 401
    const unauth = await page.evaluate(async () => {
      const res = await fetch('/api/core/call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'node.health' }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(unauth.status).toBe(401);
    console.log('  T1: Logout verified — /api/core/call → 401');
  });

  test('T2: SSE realtime events', async ({ page, context }) => {
    // Setup auth via API (server may be fresh), then login
    await httpPost(`http://127.0.0.1:${webPort}/api/auth/setup`, { password: PASSWORD });
    const loginRes = await httpPost(`http://127.0.0.1:${webPort}/api/auth/login`, { password: PASSWORD });
    expect(loginRes.status).toBe(200);
    const m = loginRes.headers['set-cookie']?.match(/sessionbridge_view=([^;]+)/);
    expect(m).toBeTruthy();
    sharedCookieValue = m[1];
    await setCookie(context);
    // Use 'load' instead of 'networkidle' because Core proxy polling
    // (approval.list, run.list, plugin.get) may not settle.
    await page.goto(baseUrl() + '/', { waitUntil: 'load' });

    // 2.1 Create EventSource
    await page.evaluate(() => {
      const es = new EventSource('/api/core/events');
      window.__es = es;
      window.__esEvents = [];
      es.addEventListener('core', (e) => { window.__esEvents.push(JSON.parse(e.data)); });
    });

    // 2.2 Wait for 'connected' event
    await expect(async () => {
      const connected = await page.evaluate(() =>
        window.__esEvents?.some(e => e.type === 'connected')
      );
      expect(connected).toBe(true);
    }).toPass({ timeout: 15_000 });
    console.log('  T2: SSE connected');

    // 2.3 Trigger a Core event via run.create
    const isWin = process.platform === 'win32';
    await coreCall(page, 'run.create', {
      command: isWin ? 'cmd' : 'echo',
      args: isWin ? ['/c', 'echo', 'SSE_E2E_OK'] : ['SSE_E2E_OK'],
      kind: 'terminal', pty: false, pluginId: 'terminal',
    });

    // 2.4 Wait for stream.chunk or session.started event
    await expect(async () => {
      const received = await page.evaluate(() => {
        const evts = window.__esEvents;
        return evts.some(e => e.type === 'stream.chunk' || e.type === 'session.started');
      });
      expect(received).toBe(true);
    }).toPass({ timeout: 20_000 });

    const summary = await page.evaluate(() =>
      window.__esEvents.filter(e => e.type !== 'connected').slice(0, 5)
        .map(e => `${e.type}${e.sessionId ? ' sid='+e.sessionId.substring(0,12) : ''}`)
    );
    console.log(`  T2: Events: ${summary.join(', ')}`);

    await page.evaluate(() => { window.__es?.close(); });
    console.log('  T2: SSE verified');
  });

  test('T3: Terminal run → stream I/O → replay → stop', async ({ page, context }) => {
    // Setup auth via API (server may be fresh), then login
    await httpPost(`http://127.0.0.1:${webPort}/api/auth/setup`, { password: PASSWORD });
    const loginRes = await httpPost(`http://127.0.0.1:${webPort}/api/auth/login`, { password: PASSWORD });
    expect(loginRes.status).toBe(200);
    const m = loginRes.headers['set-cookie']?.match(/sessionbridge_view=([^;]+)/);
    if (m) sharedCookieValue = m[1];
    await setCookie(context);
    // Use 'load' instead of 'networkidle' because Core proxy polling may not settle.
    await page.goto(baseUrl() + '/', { waitUntil: 'load' });

    // 3.1 EventSource for stream.chunks
    await page.evaluate(() => {
      const es = new EventSource('/api/core/events');
      window.__es = es; window.__esChunks = {};
      es.addEventListener('core', (e) => {
        const evt = JSON.parse(e.data);
        if (evt.type === 'stream.chunk') {
          if (!window.__esChunks[evt.sessionId]) window.__esChunks[evt.sessionId] = [];
          window.__esChunks[evt.sessionId].push(evt);
        }
      });
    });
    await expect(async () => {
      const c = await page.evaluate(() => window.__es?.readyState === 1);
      expect(c).toBe(true);
    }).toPass({ timeout: 10_000 });

    // 3.2 Create run
    const isWin = process.platform === 'win32';
    const testOutput = 'PUBLIC_MVP_TERMINAL_OK';
    const runResult = await coreCall(page, 'run.create', {
      command: isWin ? 'cmd' : 'echo',
      args: isWin ? ['/c', 'echo', testOutput] : [testOutput],
      kind: 'terminal', pty: false, pluginId: 'terminal',
    });
    expect(runResult).toBeTruthy();
    expect(runResult.runId).toBeTruthy();
    const runId = runResult.runId;
    const sessionId = runResult.sessionId;
    console.log(`  T3: runId=${runId.substring(0, 20)} sessionId=${sessionId?.substring(0, 16)}`);

    // 3.3 Subscribe
    await coreCall(page, 'stream.subscribe', { sessionId, streamType: 'stdout', pluginId: 'terminal' });

    // 3.4 Wait for output via SSE
    await expect(async () => {
      const found = await page.evaluate((sid) => {
        const chunks = window.__esChunks[sid] || [];
        return chunks.some(c => c.data && c.data.includes('PUBLIC_MVP'));
      }, sessionId);
      expect(found).toBe(true);
    }).toPass({ timeout: 20_000 });

    const chunks = await page.evaluate((sid) =>
      (window.__esChunks[sid] || []).map(c => ({ data: c.data, seq: c.eventSeq }))
    , sessionId);
    console.log(`  T3: ${chunks.length} chunk(s) received`);
    const allText = chunks.map(c => c.data).join('');
    expect(allText).toContain(testOutput);

    // 3.5 Close SSE (simulate disconnect)
    await page.evaluate(() => { window.__es?.close(); });

    // 3.6 Fresh page
    const page2 = await context.newPage();
    await setCookie(context);
    await page2.goto(baseUrl() + '/', { waitUntil: 'load' });

    // 3.7 run.list still shows run
    const list = await coreCall(page2, 'run.list', { pluginId: 'terminal' });
    console.log(`  T3: run.list: ${list?.runs?.length || 0} runs`);
    expect(list.runs).toBeTruthy();
    const found = list.runs.find(r => r.runId === runId || r.sessionId === sessionId);
    expect(found).toBeTruthy();

    // 3.8 run.attach
    const attach = await coreCall(page2, 'run.attach', { runId, pluginId: 'terminal' });
    expect(attach).toBeTruthy();
    console.log(`  T3: attach ok`);

    // 3.9 stream.replay
    const replay = await coreCall(page2, 'stream.replay', { sessionId, streamType: 'stdout', startSeq: 0, limit: 100, pluginId: 'terminal' });
    console.log(`  T3: replay returned ${replay?.events?.length || 0} events`);
    expect(replay.events).toBeTruthy();
    if (replay.events.length > 0) {
      expect(replay.events.map(e => e.data).join('')).toContain(testOutput);
    }

    // 3.10 run.stop
    await coreCall(page2, 'run.stop', { runId, pluginId: 'terminal' });

    // 3.11 Verify stopped
    const info = await coreCall(page2, 'run.info', { runId, pluginId: 'terminal' });
    console.log(`  T3: state=${info?.state}`);
    expect(['stopped', 'exited'].includes(info?.state)).toBe(true);

    await page2.close();
    console.log('  T3: Terminal lifecycle verified');
  });

  test('T4: Direct mode not default — no Core token leak', async ({ page, context }) => {
    await setCookie(context);

    const wsUrls = [];
    const allUrls = [];
    page.on('request', req => {
      allUrls.push(req.url());
      if (req.url().includes('token=')) wsUrls.push(req.url());
      if (req.url().includes('/ws')) wsUrls.push(req.url());
    });

    await page.goto(baseUrl() + '/', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    // No direct WS with token
    const directWs = wsUrls.filter(u => u.includes('/ws') && u.includes('token='));
    console.log(`  T4: direct WS with token: ${directWs.length}`);
    expect(directWs).toHaveLength(0);

    // No Core token in page
    const html = await page.content();
    expect(html).not.toContain('e2e-token');
    expect(html).not.toContain('SESSIONNODE_TOKEN');

    // No token in localStorage
    const lsToken = await page.evaluate(() => localStorage.getItem('sessionbridge_token'));
    expect(lsToken).toBeNull();

    const bodyLen = (await page.locator('body').textContent()).length;
    expect(bodyLen).toBeGreaterThan(100);
    console.log(`  T4: body=${bodyLen} chars — no token leak`);
  });

});
