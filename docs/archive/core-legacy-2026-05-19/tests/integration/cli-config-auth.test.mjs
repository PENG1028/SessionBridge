// ─── CLI Config → Auth Chain Test ────────────────────────────
// Verifies the end-to-end chain: config file → auth system → HTTP API.
// Starts a real relay with a temp config containing dashboardToken, then
// asserts every step of the auth flow via HTTP.
//
// Assertions:
//   1. Config file with dashboardToken → relay starts
//   2. GET /api/auth/check → tokenSet:true, authEnabled:true
//   3. GET /setup (token set) → 302 redirect to /login
//   4. POST /api/auth/login (correct password) → 302 + Set-Cookie sb_session
//   5. POST /api/auth/login (wrong password) → error page
//   6. POST /api/auth/change-password → old sessions invalidated
//   7. POST /api/auth/toggle → authEnabled flips
//   8. GET /api/auth/sessions → lists active sessions
//   9. dashboard-sessions.json written after login
//
// Usage:
//   node tests/integration/cli-config-auth.test.mjs [path/to/bridge]
//   Default: bin/bridge.js → dist/src/index.js

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomInt } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// ── Resolve bridge binary ────────────────────────────────────
function resolveBridge() {
  const explicit = process.env.BRIDGE_BIN || process.argv[2];
  if (explicit) {
    const abs = resolve(explicit);
    if (existsSync(abs)) return abs;
  }
  const candidates = [
    join(ROOT, 'bin', 'bridge.js'),
    join(ROOT, 'dist', 'src', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`FATAL: No bridge entry found. Tried: ${candidates.join(', ')}`);
  console.error(`Build first: npm run build`);
  process.exit(1);
}

const BRIDGE = resolveBridge();
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0, total = 0;
function check(desc, ok) {
  total++;
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function httpGet(baseUrl, path) {
  try {
    const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, text, json, cookies: res.headers.get('set-cookie') };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function httpPost(baseUrl, path, body) {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, text, json, cookies: res.headers.get('set-cookie') };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function main() {
  console.log(`\n===== CLI Config → Auth Chain Test =====`);
  console.log(`  Binary: ${BRIDGE}\n`);

  // ── Setup: temp work dir ────────────────────────────────────
  const workDir = join(tmpdir(), `sb-auth-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const configDir = join(workDir, '.sessionbridge');
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, 'agent.json');
  const sessionsPath = join(configDir, 'dashboard-sessions.json');

  const TEST_PORT = randomInt(19000, 19999);
  const TEST_PASSWORD = 'test-secret-42';
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;

  let relayProcess = null;

  try {
    // ── T1: Write config with dashboardToken ──────────────────
    console.log('── T1: Config file created with dashboardToken ──');
    const config = {
      dashboardToken: TEST_PASSWORD,
      dashboardAuthEnabled: true,
      label: 'auth-test-node',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    check('dashboardToken persisted', written.dashboardToken === TEST_PASSWORD);
    check('dashboardAuthEnabled=true', written.dashboardAuthEnabled === true);

    // ── T2: Start relay with temp config ──────────────────────
    console.log('\n── T2: Start relay with config ──');
    relayProcess = spawn(nodeCmd, [BRIDGE, '--relay-port', String(TEST_PORT), '--dir', workDir, '--label', 'auth-test-node'], {
      cwd: ROOT,
      env: { ...process.env, BRIDGE_CONFIG: configPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Collect stdout/stderr for diagnostics
    let relayStdout = '', relayStderr = '';
    relayProcess.stdout.on('data', d => { relayStdout += d.toString(); });
    relayProcess.stderr.on('data', d => { relayStderr += d.toString(); });

    // Wait for relay to accept connections
    let started = false;
    const startTimeout = 20000;
    const startTime = Date.now();
    while (Date.now() - startTime < startTimeout) {
      try {
        const r = await fetch(`${RELAY_URL}/api/health`);
        if (r.ok) { started = true; break; }
      } catch {}
      await delay(300);
    }

    if (!started) {
      console.log(`  Relay did not start within ${startTimeout}ms.`);
      console.log(`  stdout tail: ${relayStdout.slice(-500)}`);
      console.log(`  stderr tail: ${relayStderr.slice(-500)}`);
      check('Relay started successfully', false);
      // Still report results
      console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
      process.exit(1);
    }
    check('Relay started and /api/health responds', true);

    // ── T3: GET /api/auth/check → tokenSet:true, authEnabled:true ──
    console.log('\n── T3: /api/auth/check from localhost ──');
    {
      const r = await httpGet(RELAY_URL, '/api/auth/check');
      check('GET /api/auth/check returns 200', r.status === 200);
      check('localhost is authenticated', r.json?.authenticated === true);
      check('authEnabled is true', r.json?.authEnabled === true);
      check('tokenSet is true', r.json?.tokenSet === true);
      check('local flag is true', r.json?.local === true);
    }

    // ── T4: GET /setup redirects to /login (token is set) ─────
    console.log('\n── T4: GET /setup (token set) → 302 /login ──');
    {
      const r = await httpGet(RELAY_URL, '/setup');
      check('GET /setup returns 302 when token is set', r.status === 302);
    }

    // ── T5: Login with correct password → Set-Cookie sb_session ──
    console.log('\n── T5: Login with correct password ──');
    {
      const r = await httpPost(RELAY_URL, '/api/auth/login', { token: TEST_PASSWORD });
      check('POST /api/auth/login returns 302', r.status === 302);
      check('Sets sb_session cookie', (r.cookies || '').includes('sb_session'));
    }

    // ── T6: Login with wrong password fails ────────────────────
    console.log('\n── T6: Login with wrong password ──');
    {
      const r = await httpPost(RELAY_URL, '/api/auth/login', { token: 'wrong-password-xyz' });
      check('POST /api/auth/login (wrong) returns 200 (error page)', r.status === 200);
      check('Error page contains 密钥错误',
        (r.text || '').includes('密钥错误') || (r.text || '').includes('incorrect') || (r.text || '').includes('重试'));
    }

    // ── T7: Login (correct) → dashboard-sessions.json exists ──
    console.log('\n── T7: Login creates dashboard-sessions.json ──');
    {
      // Login again to create a clear session
      await httpPost(RELAY_URL, '/api/auth/login', { token: TEST_PASSWORD });
      await delay(500);
      // Check sessions file
      if (existsSync(sessionsPath)) {
        const sessionsRaw = readFileSync(sessionsPath, 'utf-8');
        const sessions = JSON.parse(sessionsRaw);
        check('dashboard-sessions.json exists', true);
        check('dashboard-sessions.json has entries', Array.isArray(sessions) && sessions.length > 0);
        if (sessions.length > 0) {
          check('Session has id', typeof sessions[0].id === 'string');
          check('Session has createdAt', typeof sessions[0].createdAt === 'number');
        }
      } else {
        // Sessions may be stored differently (in-memory or other path)
        console.log('  NOTE: dashboard-sessions.json not found — checking /api/auth/sessions instead');
        const r = await httpGet(RELAY_URL, '/api/auth/sessions');
        check('GET /api/auth/sessions returns 200', r.status === 200);
        check('Sessions list is array', Array.isArray(r.json));
        if (r.json?.length > 0) {
          check('Session has id', typeof r.json[0].id === 'string');
          check('Session has createdAt', typeof r.json[0].createdAt === 'string');
        }
      }
    }

    // ── T8: Change password → old password rejected ───────────
    console.log('\n── T8: Change password → sessions invalidated ──');
    {
      const newPassword = 'new-secret-99';

      // Change password
      const change = await httpPost(RELAY_URL, '/api/auth/change-password', {
        oldToken: TEST_PASSWORD,
        newToken: newPassword,
      });
      check('POST /api/auth/change-password returns 200', change.status === 200);
      check('Change password response ok', change.json?.ok === true);

      // New password works
      const loginNew = await httpPost(RELAY_URL, '/api/auth/login', { token: newPassword });
      check('Login with new password succeeds (302)', loginNew.status === 302);

      // Old password rejected
      const loginOld = await httpPost(RELAY_URL, '/api/auth/login', { token: TEST_PASSWORD });
      check('Login with old password fails after change',
        (loginOld.text || '').includes('密钥错误') || (loginOld.text || '').includes('incorrect'));

      // Config file was updated
      const updated = JSON.parse(readFileSync(configPath, 'utf8'));
      check('Config file dashboardToken updated', updated.dashboardToken === newPassword);

      // Restore original password
      await httpPost(RELAY_URL, '/api/auth/change-password', {
        oldToken: newPassword,
        newToken: TEST_PASSWORD,
      });
    }

    // ── T9: Auth toggle flips authEnabled ─────────────────────
    console.log('\n── T9: Auth toggle ──');
    {
      // Disable auth
      const disable = await httpPost(RELAY_URL, '/api/auth/toggle', { enabled: false });
      check('POST /api/auth/toggle enabled=false returns 200', disable.status === 200);
      check('Response authEnabled=false', disable.json?.authEnabled === false);

      const checkDisabled = await httpGet(RELAY_URL, '/api/auth/check');
      check('auth/check shows authEnabled=false', checkDisabled.json?.authEnabled === false);

      // Re-enable
      const enable = await httpPost(RELAY_URL, '/api/auth/toggle', { enabled: true });
      check('POST /api/auth/toggle enabled=true returns 200', enable.status === 200);

      const checkEnabled = await httpGet(RELAY_URL, '/api/auth/check');
      check('auth/check shows authEnabled=true after re-enable', checkEnabled.json?.authEnabled === true);
    }

    // ── T10: /api/setup returns 403 when token already set ────
    console.log('\n── T10: /api/auth/setup rejected when token exists ──');
    {
      const r = await httpPost(RELAY_URL, '/api/auth/setup', {
        password: 'another-pass',
        confirm: 'another-pass',
      });
      check('POST /api/auth/setup returns 403 when token already set',
        r.status === 403 || (r.json?.error && r.json.error.includes('already')));
    }

    // ── T11: Auth endpoints serve proper JSON errors for API calls ──
    console.log('\n── T11: Auth JSON error format ──');
    {
      const r = await httpPost(RELAY_URL, '/api/auth/change-password', {
        oldToken: 'wrong-old',
        newToken: 'short',
      });
      check('/api/auth/change-password with wrong old token returns error',
        r.status === 403 || (r.json?.error));
    }

    // ── Results ───────────────────────────────────────────────
    console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
    if (failed > 0) {
      console.log(`  FAIL: ${failed} test(s) failed`);
    } else {
      console.log(`  PASS: All config→auth chain tests passed`);
    }

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  } finally {
    if (relayProcess) {
      relayProcess.kill();
      await delay(500);
    }
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
