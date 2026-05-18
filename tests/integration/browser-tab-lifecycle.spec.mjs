// ─── Browser Tab Lifecycle Test ──────────────────────────
// Uses Playwright to test real browser behavior against a running relay.
//
// Prerequisites:
//   npm run build    (generates out/ — static files served by relay)
//
// Usage:
//   node tests/integration/browser-tab-lifecycle.spec.mjs
//
// Environment:
//   HEADLESS=0   — show browser window (default: headless)
//   VERBOSE=1    — print relay output and console logs

import { chromium } from 'playwright';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const OUT_DIR = join(ROOT, 'out');
const HEADLESS = process.env.HEADLESS !== '0';
const VERBOSE = process.env.VERBOSE === '1';

const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}
function section(name) {
  console.log(`\n─── ${name} ───`);
}

function resolveBridge() {
  const candidates = [
    join(ROOT, 'bin', 'bridge.js'),
    join(ROOT, 'dist', 'src', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error('FATAL: No bridge entry found');
  process.exit(1);
}

const BRIDGE = resolveBridge();
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        if (ct.includes('text/html')) {
          reject(new Error(`Expected JSON, got HTML: ${data.slice(0, 100)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}\n${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function killProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
}

function startRelay(port, workDir) {
  return new Promise((resolvePromise, reject) => {
    const args = [BRIDGE, '--relay-port', String(port), '--dir', workDir];
    const proc = spawn(nodeCmd, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    let started = false;
    const timer = setTimeout(() => {
      if (!started) { reject(new Error(`Relay ${port} start timeout`)); killProc(proc); }
    }, 45000);

    let output = '';
    const onData = (d) => {
      output += d.toString();
      if (output.includes('SessionBridge') && !started) {
        started = true;
        clearTimeout(timer);
        resolvePromise(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', e => { clearTimeout(timer); reject(e); });

    if (VERBOSE) {
      proc.stdout.on('data', d => process.stdout.write(`[relay] ${d}`));
      proc.stderr.on('data', d => process.stderr.write(`[relay] ${d}`));
    }
  });
}

// ─── Check build exists ─────────────────────────────────
if (!existsSync(join(OUT_DIR, 'index.html'))) {
  console.error('FATAL: Build not found. Run: npm run build');
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  const relayPort = 14400 + (Date.now() % 1000);
  const workDir = join(tmpdir(), `sb-browser-test-${Date.now().toString(36)}`);
  const HTTP = `http://localhost:${relayPort}`;

  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  Browser Tab Lifecycle Test`);
  console.log(`  Relay: :${relayPort}`);
  console.log(`  Headless: ${HEADLESS}`);
  console.log(`══════════════════════════════════════════════════════\n`);

  let relayProc;
  let browser;

  try {
    // ── Start relay (serves static files from out/ if present) ──
    section('Start relay');
    relayProc = await startRelay(relayPort, workDir);
    console.log(`  Relay listening on :${relayPort}`);

    // ── Verify relay HTTP API ──────────────────────────────
    const info = await httpGet(`${HTTP}/api/info`);
    check('B0: /api/info returns homeDir', !!info.homeDir);
    console.log(`  homeDir: ${info.homeDir}`);

    const instances = await httpGet(`${HTTP}/api/instances`);
    check('B0b: /api/instances returns list', Array.isArray(instances.instances));

    // ── Launch headless Chromium ───────────────────────────
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // ════════════════════════════════════════════════════════
    // B1: Page loads, connects WebSocket, renders UI
    // ════════════════════════════════════════════════════════
    section('B1: Page load and connection');
    const page1 = await context.newPage();
    const logs = [];
    page1.on('console', msg => { if (msg.type() === 'error') logs.push(msg.text()); });

    await page1.goto(HTTP, { waitUntil: 'networkidle', timeout: 30000 });
    await delay(2000);

    const bodyText = await page1.textContent('body');
    check('B1.1: Page renders with content', bodyText.length > 50);

    // Page should contain app name and connection status
    const hasTitle = bodyText.includes('Session') || bodyText.includes('Bridge');
    check('B1.2: App name visible', hasTitle);

    // Check WebSocket connection status indicator
    const hasConnected = bodyText.includes('CONNECTED') || bodyText.includes('connected');
    check('B1.3: WebSocket connected', hasConnected);

    if (VERBOSE) {
      console.log('  Page errors:', logs.length);
      logs.forEach(l => console.log('    ', l));
    }

    // ════════════════════════════════════════════════════════
    // B2: Page refresh — tab/state persistence in localStorage
    // ════════════════════════════════════════════════════════
    section('B2: Page refresh');

    // First, capture initial localStorage state
    const lsBefore = await page1.evaluate(() => {
      const result = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) result[key] = (localStorage.getItem(key) || '').length;
      }
      return result;
    });
    check('B2.1: localStorage has persisted data', Object.keys(lsBefore).length > 0);

    if (VERBOSE) console.log('  localStorage keys:', Object.keys(lsBefore).join(', '));

    // Reload the page
    await page1.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await delay(2000);

    const bodyAfter = await page1.textContent('body');
    check('B2.2: Page renders after refresh', bodyAfter.length > 50);

    // Verify localStorage survives reload
    const lsAfter = await page1.evaluate(() => {
      const result = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) result[key] = (localStorage.getItem(key) || '').length;
      }
      return result;
    });
    check('B2.3: localStorage persists across refresh', Object.keys(lsAfter).length > 0);

    // ════════════════════════════════════════════════════════
    // B3: Two browser tabs (same relay) — peer discovery
    // ════════════════════════════════════════════════════════
    section('B3: Multi-browser connection');

    const page2 = await context.newPage();
    await page2.goto(HTTP, { waitUntil: 'networkidle', timeout: 30000 });
    await delay(2000);

    const p2Text = await page2.textContent('body');
    check('B3.1: Second page renders', p2Text.length > 50);
    check('B3.2: Second page also connected', p2Text.includes('CONNECTED') || p2Text.includes('connected'));

    // The relay should have at least 2 browser connections
    // Verify by checking peer list or instance list
    check('B3.3: Relay has connections', instances.instances.length > 0);

    await page2.close();

    // ════════════════════════════════════════════════════════
    // B4: Server-side state verification via HTTP API
    // ════════════════════════════════════════════════════════
    section('B4: Server-side APIs');

    // Verify debug endpoints
    try {
      const debug = await httpGet(`${HTTP}/api/debug/surfaces`);
      check('B4.1: Debug surfaces endpoint', debug.surfaces !== undefined || debug.ok === true);
    } catch (e) {
      check('B4.1: Debug surfaces endpoint', false);
    }

    try {
      const debugState = await httpGet(`${HTTP}/api/debug/statebus`);
      check('B4.2: StateBus debug endpoint', debugState.ok === true);
    } catch (e) {
      check('B4.2: StateBus debug endpoint', false);
    }

    // ── Summary ──────────────────────────────────────────
    console.log(`\n══════════════════════════════════════════════════════`);
    console.log(`  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    console.log(`══════════════════════════════════════════════════════\n`);

  } finally {
    if (browser) await browser.close().catch(() => {});
    killProc(relayProc);
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
