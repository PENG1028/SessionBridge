// ─── UI Operation Map Contract Test ─────────────────────────
// Verifies that every API endpoint and WebSocket message type
// referenced in app/** source files is documented in
// docs/UI_OPERATION_MAP.md.
//
// This is a static analysis test — it reads source files and
// the documentation, then cross-references them.
//
// Usage:
//   node tests/integration/ui-operation-map-contract.test.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

let passed = 0, failed = 0, total = 0;
function check(desc, ok) {
  total++;
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

/** Recursively find all .ts/.tsx/.js/.jsx files under a directory. */
function findSourceFiles(dir, exclude = ['node_modules', '.next', 'out', 'dist', '.git']) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (exclude.includes(entry)) continue;
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          results.push(...findSourceFiles(full, exclude));
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
          results.push(full);
        }
      } catch { /* permission or missing */ }
    }
  } catch {}
  return results;
}

/** Extract API endpoint references from source content. */
function extractApiRefs(content) {
  const refs = new Set();
  // Match: fetch('/api/...'), fetch(`/api/...`), "/api/...", '/api/...'
  const patterns = [
    /\/api\/[a-zA-Z0-9_\-./?=&#:%]+/g,
    /['"]\/api\/[^'"]*['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      let path = match[0].replace(/^['"]|['"]$/g, '');
      // Normalize: strip query params
      const qIdx = path.indexOf('?');
      if (qIdx >= 0) path = path.slice(0, qIdx);
      // Normalize: trailing slash
      path = path.replace(/\/$/, '') || '/';
      refs.add(path);
    }
  }
  return refs;
}

/** Extract WebSocket message types from source content. */
function extractWsMsgTypes(content) {
  const types = new Set();
  // Match envelope('type', ...), envelope("type", ...), `type: 'type'`, type: "type"
  const patterns = [
    /envelope\s*\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g,
    /type\s*:\s*['"]([a-zA-Z0-9_.-]+)['"]/g,
    /msg\.type\s*===\s*['"]([a-zA-Z0-9_.-]+)['"]/g,
    /\.startsWith\s*\(\s*['"]([a-zA-Z0-9_.-]+)\.?['"]\s*\)/g,
    /case\s+['"]([a-zA-Z0-9_.-]+)['"]\s*:/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      types.add(match[1]);
    }
  }
  return types;
}

/** Load and parse UI_OPERATION_MAP.md. */
function loadOperationMap() {
  const mapPath = join(ROOT, 'docs', 'UI_OPERATION_MAP.md');
  if (!existsSync(mapPath)) {
    return { apiRefs: new Set(), wsTypes: new Set(), raw: '' };
  }
  const raw = readFileSync(mapPath, 'utf-8');

  // Extract all /api/* references from the doc
  const apiRefs = new Set();
  for (const match of raw.matchAll(/\/api\/[a-zA-Z0-9_\-./?=&#:]+/g)) {
    let path = match[0];
    const qIdx = path.indexOf('?');
    if (qIdx >= 0) path = path.slice(0, qIdx);
    path = path.replace(/\/$/, '') || '/';
    apiRefs.add(path);
  }

  // Extract all WS message types from the doc
  const wsTypes = new Set();
  // Look for backtick-quoted message types like `instance.list`, `shell.spawn`
  for (const match of raw.matchAll(/`([a-zA-Z0-9_.-]+)`/g)) {
    const val = match[1];
    if (val.includes('.') && !val.startsWith('/') && !val.includes(' ') && !val.startsWith('http')) {
      wsTypes.add(val);
    }
  }

  return { apiRefs, wsTypes, raw };
}

async function main() {
  console.log(`\n===== UI Operation Map Contract Test =====\n`);

  const docMap = loadOperationMap();

  // ── T1: Operation map document exists ───────────────────────
  console.log('── T1: UI_OPERATION_MAP.md exists ──');
  const mapPath = join(ROOT, 'docs', 'UI_OPERATION_MAP.md');
  check('docs/UI_OPERATION_MAP.md exists', existsSync(mapPath));

  if (!existsSync(mapPath)) {
    console.log('  FATAL: UI_OPERATION_MAP.md not found. Aborting.');
    process.exit(1);
  }

  // ── T2: Scan app/ for API references ────────────────────────
  console.log('\n── T2: App API references documented in map ──');
  const appDir = join(ROOT, 'app');
  if (!existsSync(appDir)) {
    console.log('  SKIP: app/ directory not found');
    process.exit(0);
  }

  const appFiles = findSourceFiles(appDir);
  console.log(`  Found ${appFiles.length} source files in app/`);

  const appApiRefs = new Set();
  const appWsTypes = new Set();

  for (const file of appFiles) {
    const relPath = relative(appDir, file);
    try {
      const content = readFileSync(file, 'utf-8');
      for (const ref of extractApiRefs(content)) {
        appApiRefs.add(ref);
      }
      for (const type of extractWsMsgTypes(content)) {
        // Filter out non-message-type strings (JS keywords, local vars, etc.)
        if (type.includes('.') && type.length > 5 && type.length < 80) {
          appWsTypes.add(type);
        }
      }
    } catch { /* skip unreadable */ }
  }

  console.log(`  Found ${appApiRefs.size} unique API references in app/`);
  console.log(`  Found ${appWsTypes.size} unique WS message types in app/`);

  // Check API references
  const criticalApis = [
    '/api/instances', '/api/health', '/api/status', '/api/config',
    '/api/connect', '/api/connections', '/api/sessions',
    '/api/auth/check', '/api/auth/setup', '/api/auth/login',
    '/api/auth/logout', '/api/auth/toggle', '/api/auth/change-password',
    '/api/auth/sessions', '/api/configuration/schema', '/api/configuration/values',
    '/api/shell/run', '/api/shell/stream', '/api/shell/input',
    '/api/extensions', '/api/logs', '/api/permissions',
    '/api/notifications', '/api/aliases', '/api/node/external',
    '/api/secrets', '/api/system',
  ];

  for (const api of criticalApis) {
    if (appApiRefs.has(api)) {
      const documented = docMap.apiRefs.has(api) || docMap.raw.includes(api);
      check(`API ${api} used in app → documented in UI_OPERATION_MAP.md`, documented);
    }
  }

  // ── T3: Key WS message types documented ─────────────────────
  console.log('\n── T3: Key WS message types documented in map ──');
  // These are the well-known WS message types that should be in the doc
  const keyWsTypes = [
    'hello', 'welcome', 'instance.list', 'instance.added', 'instance.removed',
    'instance.command', 'shell.spawn', 'shell.input', 'shell.output', 'shell.exit',
    'shell.resize', 'workbench.tabs', 'workbench.subscribe', 'workbench.unsubscribe',
    'operation.start', 'operation.status', 'operation.output', 'operation.result',
    'operation.subscribe', 'operation.cancel', 'peer.list',
    'agent.operation.status', 'agent.operation.output', 'agent.operation.result',
    'relay.operation.start', 'relay.operation.input', 'relay.operation.cancel',
    'agent.register', 'agent.registered',
  ];

  for (const type of keyWsTypes) {
    const inApp = appWsTypes.has(type);
    if (inApp) {
      const documented = docMap.wsTypes.has(type) || docMap.raw.includes(type);
      check(`WS type "${type}" used in app → documented in UI_OPERATION_MAP.md`, documented);
    }
  }

  // ── T4: Document has all required sections ──────────────────
  console.log('\n── T4: UI_OPERATION_MAP.md structure ──');
  const docRaw = docMap.raw;
  const requiredSections = [
    '页面初始化流程', '认证流程', '节点/实例管理', '终端操作',
    'Workbench Tab', '连接/网络面板', 'Settings Panel', 'Extension',
    '仅页面能力', '标记',
  ];
  for (const section of requiredSections) {
    check(`Doc has section: ${section}`, docRaw.includes(section));
  }

  // ── T5: Doc references are valid (no nonexistent endpoints) ──
  console.log('\n── T5: UI_OPERATION_MAP.md references only valid endpoints ──');
  // All /api/* references in the doc should map to known routes in API_REFERENCE.md
  const apiRefDoc = existsSync(join(ROOT, 'docs', 'API_REFERENCE.md'))
    ? readFileSync(join(ROOT, 'docs', 'API_REFERENCE.md'), 'utf-8')
    : '';

  // Known valid API patterns from api-routes.ts + admin-routes.ts
  const knownApiPatterns = [
    '/api/instances', '/api/instances/:id',
    '/api/instances/:id/status', '/api/instances/:id/command',
    '/api/aliases', '/api/aliases/:identity',
    '/api/sessions', '/api/health', '/api/status', '/api/system',
    '/api/processes', '/api/config', '/api/config/connections',
    '/api/config/connections/:id', '/api/configuration/schema',
    '/api/configuration/values', '/api/configuration/inspect',
    '/api/secrets', '/api/connections', '/api/connect',
    '/api/auth/setup', '/api/auth/login', '/api/auth/logout',
    '/api/auth/check', '/api/auth/toggle', '/api/auth/change-password',
    '/api/auth/sessions', '/api/shell/run', '/api/shell/stream',
    '/api/shell/input', '/api/shell/kill', '/api/logs',
    '/api/extensions', '/api/permissions', '/api/notifications',
    '/api/node/external', '/api/daemon/stop',
  ];

  let docApiOk = 0, docApiBad = 0;
  for (const ref of docMap.apiRefs) {
    // Check if it matches a known pattern (exact or parameterized)
    const known = knownApiPatterns.some(p => {
      if (p === ref) return true;
      // Check parameterized: /api/instances/:id matches /api/instances/xxx
      const pParts = p.split('/');
      const rParts = ref.split('/');
      if (pParts.length !== rParts.length) return false;
      return pParts.every((pp, i) => pp.startsWith(':') || pp === rParts[i]);
    });
    if (known) docApiOk++; else {
      docApiBad++;
      console.log(`  WARN: Doc ref "${ref}" not in known API patterns`);
    }
  }
  // These endpoints are referenced in the UI map doc but don't have corresponding
  // server routes yet. They are documented gaps — the page expects them but the
  // server doesn't implement them. See UI_OPERATION_MAP.md §九 (仅页面能力).
  const knownGapEndpoints = [
    '/api/info', '/api/sessions/current', '/api/check-update', '/api/do-update',
    '/api/restart', '/api/sessions/search', '/api/read-file', '/api/upload',
  ];
  const unexplainedBad = docApiBad - knownGapEndpoints.filter(g => docMap.apiRefs.has(g)).length;

  for (const gap of knownGapEndpoints) {
    if (docMap.apiRefs.has(gap)) {
      console.log(`  NOTE: "${gap}" is in doc but has no server route (known gap — see §九)`);
    }
  }
  check(`All ${docMap.apiRefs.size} API refs in doc explainable (${docApiOk} have routes, ${unexplainedBad} unexplained)`,
    unexplainedBad === 0);

  // ── T6: CLI_REFERENCE.md references match actual CLI ────────
  console.log('\n── T6: CLI_REFERENCE.md internal consistency ──');
  const cliRefPath = join(ROOT, 'docs', 'CLI_REFERENCE.md');
  if (existsSync(cliRefPath)) {
    const cliRef = readFileSync(cliRefPath, 'utf-8');
    check('CLI_REFERENCE.md exists', true);
    check('CLI_REFERENCE.md documents bridge command', cliRef.includes('bridge'));
    check('CLI_REFERENCE.md documents daemon subcommands', cliRef.includes('daemon start'));
    check('CLI_REFERENCE.md documents setup', cliRef.includes('setup'));
    check('CLI_REFERENCE.md documents run', cliRef.includes('run'));
    check('CLI_REFERENCE.md marks bridge connect as stale-doc',
      cliRef.includes('stale-doc') || cliRef.includes('bridge connect'));
    check('CLI_REFERENCE.md marks missing commands',
      cliRef.includes('missing') && cliRef.includes('planned'));
  } else {
    console.log('  SKIP: CLI_REFERENCE.md not found');
  }

  // ── T7: API_REFERENCE.md completeness ───────────────────────
  console.log('\n── T7: API_REFERENCE.md completeness ──');
  const apiRefPath = join(ROOT, 'docs', 'API_REFERENCE.md');
  if (existsSync(apiRefPath)) {
    check('API_REFERENCE.md exists', true);
    // Check all critical endpoints are documented
    for (const api of criticalApis) {
      check(`API_REFERENCE.md documents ${api}`, apiRefDoc.includes(api));
    }
  } else {
    console.log('  SKIP: API_REFERENCE.md not found');
  }

  // ── T8: REMOTE_OPERATION_REFERENCE.md completeness ──────────
  console.log('\n── T8: REMOTE_OPERATION_REFERENCE.md completeness ──');
  const roRefPath = join(ROOT, 'docs', 'REMOTE_OPERATION_REFERENCE.md');
  if (existsSync(roRefPath)) {
    const roRef = readFileSync(roRefPath, 'utf-8');
    check('REMOTE_OPERATION_REFERENCE.md exists', true);
    check('Documents operation.start', roRef.includes('operation.start'));
    check('Documents operation.subscribe', roRef.includes('operation.subscribe'));
    check('Documents operation.input', roRef.includes('operation.input'));
    check('Documents operation.cancel', roRef.includes('operation.cancel'));
    check('Documents routing invariants (R1-R6)', roRef.includes('R1') && roRef.includes('R6'));
    check('Documents error codes', roRef.includes('TARGET_NOT_FOUND') && roRef.includes('AGENT_DISCONNECTED'));
    check('Documents agent-side OperationRunner', roRef.includes('OperationRunner'));
    check('Documents known gaps', roRef.includes('已知缺口') || roRef.includes('gap'));
  }

  // ── T9: CLI_FEATURE_GAPS.md internal consistency ────────────
  console.log('\n── T9: CLI_FEATURE_GAPS.md internal consistency ──');
  const gapsPath = join(ROOT, 'docs', 'CLI_FEATURE_GAPS.md');
  if (existsSync(gapsPath)) {
    const gaps = readFileSync(gapsPath, 'utf-8');
    check('CLI_FEATURE_GAPS.md exists', true);
    check('Documents bridge connect stale-doc (P0)', gaps.includes('bridge connect') && gaps.includes('stale-doc'));
    check('Documents run-command.ts bugs (P0)', gaps.includes('run-command') && gaps.includes('dashboardPort'));
    check('Documents missing CLI commands (P1)', gaps.includes('缺失 CLI') || gaps.includes('missing'));
    check('Documents missing HTTP API for operations',
      gaps.includes('RemoteOperation') || gaps.includes('operation.start'));
    check('Has priority sections (P0-P3)', gaps.includes('P0') && gaps.includes('P1'));
  }

  // ── Results ─────────────────────────────────────────────────
  console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  if (failed > 0) {
    console.log(`  FAIL: ${failed} test(s) failed`);
  } else {
    console.log(`  PASS: All UI operation map contract checks passed`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
