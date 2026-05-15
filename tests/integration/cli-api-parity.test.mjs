// ─── CLI-API Parity Test ────────────────────────────────────
// Verifies that CLI --json output schemas (documented in
// CLI_REFERENCE.md) are structurally consistent with their
// corresponding HTTP API responses (documented in API_REFERENCE.md).
//
// This test connects to a running relay and checks that the
// API responses have the fields that the CLI --json contract
// promises. It does NOT require the CLI commands to exist —
// it validates the API side of the contract.
//
// Usage:
//   node tests/integration/cli-api-parity.test.mjs [http://host:port]
//   Default: http://localhost:8080

const RELAY_HTTP = process.argv[2] || 'http://localhost:8080';

let passed = 0, failed = 0, total = 0;
function check(desc, ok) {
  total++;
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function get(path) {
  try {
    const res = await fetch(`${RELAY_HTTP}${path}`);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function main() {
  console.log(`\n===== CLI-API Parity Test =====`);
  console.log(`  Relay: ${RELAY_HTTP}\n`);

  // ── Check relay is reachable ────────────────────────────────
  const health = await get('/api/health');
  if (health.status !== 200) {
    console.log(`  SKIP: Relay not reachable at ${RELAY_HTTP} (status ${health.status})`);
    console.log(`  Start relay first: npm run dev`);
    process.exit(0);
  }
  check('Relay is reachable', true);

  // ── Parity 1: bridge status --json ↔ GET /api/status ───────
  console.log('\n── P1: bridge status --json ↔ GET /api/status ──');
  {
    const r = await get('/api/status');
    check('GET /api/status returns 200', r.status === 200);
    // CLI_REFERENCE.md §3: bridge status --json contract
    check('status.version is string', typeof r.json?.version === 'string');
    check('status.label is string', typeof r.json?.label === 'string');
    check('status.pid is number', typeof r.json?.pid === 'number');
    check('status.uptime is number', typeof r.json?.uptime === 'number');
    check('status.system is object', typeof r.json?.system === 'object');
    check('status.system.platform is string', typeof r.json?.system?.platform === 'string');
    check('status.system.hostname is string', typeof r.json?.system?.hostname === 'string');
    check('status.adapters is array', Array.isArray(r.json?.adapters));
    if (r.json?.adapters?.length > 0) {
      check('status.adapters[0].id is string', typeof r.json.adapters[0].id === 'string');
      check('status.adapters[0].available is boolean', typeof r.json.adapters[0].available === 'boolean');
    }
  }

  // ── Parity 2: bridge instances list --json ↔ GET /api/instances ──
  console.log('\n── P2: bridge instances list --json ↔ GET /api/instances ──');
  {
    const r = await get('/api/instances');
    check('GET /api/instances returns 200', r.status === 200);
    // CLI_REFERENCE.md §3: bridge instances list --json contract
    check('instances.instances is array', Array.isArray(r.json?.instances));
    check('instances.activeId is string or null',
      typeof r.json?.activeId === 'string' || r.json?.activeId === null);
    if (r.json?.instances?.length > 0) {
      const inst = r.json.instances[0];
      check('instance has id', typeof inst.id === 'string');
      check('instance has dir', typeof inst.dir === 'string');
      check('instance has label', typeof inst.label === 'string');
      check('instance has status', typeof inst.status === 'string');
      check('instance has source', typeof inst.source === 'string');
      check('instance has adapterId', typeof inst.adapterId === 'string');
    }
  }

  // ── Parity 3: bridge connections list --json ↔ GET /api/connections ──
  console.log('\n── P3: bridge connections list --json ↔ GET /api/connections ──');
  {
    const r = await get('/api/connections');
    check('GET /api/connections returns 200', r.status === 200);
    check('connections has connections array', Array.isArray(r.json?.connections));
    if (r.json?.connections?.length > 0) {
      const conn = r.json.connections[0];
      check('connection has id', typeof conn.id === 'string');
      check('connection has url', typeof conn.url === 'string');
    }
  }

  // ── Parity 4: bridge auth status --json ↔ GET /api/auth/check ──
  console.log('\n── P4: bridge auth status --json ↔ GET /api/auth/check ──');
  {
    const r = await get('/api/auth/check');
    check('GET /api/auth/check returns 200', r.status === 200);
    // CLI_REFERENCE.md §3: bridge auth status --json contract
    check('auth/check has authEnabled (boolean)', typeof r.json?.authEnabled === 'boolean');
    check('auth/check has tokenSet (boolean)', typeof r.json?.tokenSet === 'boolean');
    check('auth/check has authenticated (boolean)', typeof r.json?.authenticated === 'boolean');
    // localhost gets local=true, remote gets session object
    if (r.json?.local) {
      check('auth/check local=true for localhost', r.json.local === true);
    }
  }

  // ── Parity 5: GET /api/connect ↔ bridge connect --json ─────
  console.log('\n── P5: GET /api/connect ↔ bridge connect --json (contract check) ──');
  {
    const r = await get('/api/connect');
    check('GET /api/connect returns 200', r.status === 200);
    // CLI_REFERENCE.md §3: bridge connect --json contract
    check('connect.relayUrl is string', typeof r.json?.relayUrl === 'string');
    check('connect.connected is boolean', typeof r.json?.connected === 'boolean');
    check('connect.status is string', typeof r.json?.status === 'string');
    check('connect.instanceId is string', typeof r.json?.instanceId === 'string');
    check('connect.role is string', typeof r.json?.role === 'string');
  }

  // ── Parity 6: bridge operation start --json contract check ──
  console.log('\n── P6: Operation contract ↔ documented schemas ──');
  // CLI_REFERENCE.md §3 defines operation start --json output.
  // We can't trigger an operation via HTTP, but we verify the
  // documented fields match the RemoteOperationManager types.
  {
    // Verify health endpoint provides the system info that
    // a successful operation.start would return via WS
    check('health has system.hostname (for agent hostname check)', typeof health.json?.system?.hostname === 'string');
    check('health has system.platform (for agent platform check)', typeof health.json?.system?.platform === 'string');
    check('health has system.arch (for agent arch check)', typeof health.json?.system?.arch === 'string');
  }

  // ── Parity 7: Health ↔ Status field consistency ────────────
  console.log('\n── P7: Cross-endpoint field consistency ──');
  {
    const status = await get('/api/status');
    // Both endpoints should agree on system info
    if (status.json?.system && health.json?.system) {
      check('health.system.hostname === status.system.hostname',
        health.json.system.hostname === status.json.system.hostname);
      check('health.system.platform === status.system.platform',
        health.json.system.platform === status.json.system.platform);
    }
  }

  // ── Parity 8: Config endpoints ─────────────────────────────
  console.log('\n── P8: Config API parity ──');
  {
    const config = await get('/api/config');
    if (config.status === 200) {
      check('GET /api/config returns 200', true);
      check('config is object', typeof config.json === 'object');
    } else if (config.status === 501) {
      console.log('  NOTE: Config manager not available (501) — skipping config parity');
    }
  }

  // ── Parity 9: Health schema completeness ───────────────────
  console.log('\n── P9: Health response schema completeness ──');
  {
    // All fields that CLI_REFERENCE.md §3 bridge status --json expects
    // should be available in either /api/health or /api/status
    check('health has uptime', typeof health.json?.uptime === 'number');
    check('health has instanceCount', typeof health.json?.instanceCount === 'number');
    check('health has memory.rss', typeof health.json?.memory?.rss === 'number');
    check('health has memory.heapUsed', typeof health.json?.memory?.heapUsed === 'number');
    check('health has system.loadavg', Array.isArray(health.json?.system?.loadavg));
    check('health has system.nodeVersion', typeof health.json?.system?.nodeVersion === 'string');
    check('health has instances array', Array.isArray(health.json?.instances));
  }

  // ── Results ─────────────────────────────────────────────────
  console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  if (failed > 0) {
    console.log(`  FAIL: ${failed} test(s) failed`);
  } else {
    console.log(`  PASS: All CLI-API parity checks passed`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
