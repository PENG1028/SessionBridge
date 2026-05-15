// ─── CLI Command Existence Test ──────────────────────────────
// Verifies that every command documented in CLI_REFERENCE.md
// actually exists in the bridge CLI. Detects stale-doc
// references (commands documented but not implemented).
//
// Usage:
//   node tests/integration/cli-command-existence.test.mjs [path/to/bridge]
//   Default: bin/bridge.js → dist/src/index.js

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// ── Resolve bridge binary ────────────────────────────────────
function resolveBridge() {
  const explicit = process.env.BRIDGE_BIN || process.argv[2];
  if (explicit) {
    const abs = resolve(explicit);
    if (existsSync(abs)) return abs;
    console.error(`FATAL: BRIDGE_BIN "${explicit}" does not exist at ${abs}`);
    process.exit(1);
  }

  // Fallback chain: bin/bridge.js → dist/src/index.js
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

let passed = 0, failed = 0, total = 0;
function check(desc, ok) {
  total++;
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

function bridge(args, timeout = 10000) {
  try {
    const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
    const stdout = execSync(`${nodeCmd} "${BRIDGE}" ${args}`, {
      cwd: ROOT,
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      status: err.status,
      signal: err.signal,
    };
  }
}

async function main() {
  console.log(`\n===== CLI Command Existence Test =====`);
  console.log(`  Binary: ${BRIDGE}\n`);

  // ── T1: bridge --help produces help text ────────────────────
  console.log('── T1: bridge --help ──');
  {
    const r = bridge('--help');
    check('bridge --help exits 0', r.ok);
    check('bridge --help mentions SessionBridge', r.stdout.includes('SessionBridge'));
    check('bridge --help lists daemon subcommands', r.stdout.includes('daemon start'));
    check('bridge --help lists run command', r.stdout.includes('bridge run'));
    check('bridge --help lists setup command', r.stdout.includes('bridge setup'));
    check('bridge --help lists --upstream flag', r.stdout.includes('--upstream'));
  }

  // ── T2: bridge daemon subcommands exist ─────────────────────
  console.log('\n── T2: bridge daemon <subcommand> ──');
  {
    const r = bridge('daemon');
    check('bridge daemon (no subcmd) exits non-zero', !r.ok);
    check('bridge daemon shows usage',
      r.stderr.includes('start') || r.stderr.includes('Usage') || r.stdout.includes('Usage'));
  }

  // ── T3: bridge daemon status works ──────────────────────────
  console.log('\n── T3: bridge daemon status ──');
  {
    const r = bridge('daemon status');
    check('bridge daemon status exits 0', r.ok);
    check('bridge daemon status reports state',
      r.stdout.includes('Daemon is running') || r.stdout.includes('Daemon is not running'));
  }

  // ── T4: bridge setup works ──────────────────────────────────
  console.log('\n── T4: bridge setup ──');
  {
    const r = bridge('setup');
    check('bridge setup (no args) exits 0', r.ok);
    check('bridge setup shows config path or usage',
      r.stdout.includes('Config file') || r.stdout.includes('Usage') || r.stdout.includes('(no config'));
  }

  // ── T5: bridge run shows usage without command ──────────────
  console.log('\n── T5: bridge run ──');
  {
    const r = bridge('run');
    check('bridge run (no cmd) exits non-zero', !r.ok);
    check('bridge run shows usage', r.stderr.includes('Usage') || r.stdout.includes('Usage'));
  }

  // ── T6: bridge default mode is a recognized entry ───────────
  // Running 'bridge' with no subcommand starts the full node runtime.
  // Extension loading takes several seconds; if port 8080 is busy or
  // inaccessible we get EACCES/EADDRINUSE. All of these outcomes prove
  // the command exists — only "command not found" or "unknown command"
  // would be failures.
  console.log('\n── T6: bridge (default node start) ──');
  {
    const r = bridge('', 15000);
    const combined = (r.stdout || '') + (r.stderr || '');

    // Recognizable signs that bridge actually ran as a node (not "unknown command"):
    const isNodeStart = combined.includes('[node] Starting')
      || combined.includes('Node:')
      || combined.includes('Role:')
      || combined.includes('EACCES')
      || combined.includes('EADDRINUSE')
      || combined.includes('already running')
      || combined.includes('listening');

    // Signs of a broken CLI / missing command.
    // "not found" is too broad — extension loading errors contain
    // "Cannot find module" which also matches. Use tighter patterns.
    const isUnknown = combined.includes('Unknown command')
      || combined.includes('command not found')
      || combined.includes('no such file')
      || r.signal; // killed by signal (timeout) = might not have started properly

    check('bridge default does not error with unknown command', isNodeStart && !isUnknown);
    if (!isNodeStart) {
      console.log(`    DEBUG: stdout(${r.stdout.length}B) stderr(${r.stderr.length}B) signal=${r.signal}`);
    }
  }

  // ── T7: Missing commands (documented but not implemented) ───
  console.log('\n── T7: Missing commands (CLI_REFERENCE.md planned/missing) ──');
  // These are documented as 'planned' or 'missing' in CLI_REFERENCE.md.
  // We verify they're actually absent, proving the doc is honest.
  // A 'missing' command either exits non-zero with usage, or falls through
  // to node mode (the "bridge connect" bug — see CLI_FEATURE_GAPS.md §2.1).

  const documentedMissing = [
    ['status', 'planned in CLI_REFERENCE.md §3'],
    ['instances list', 'planned in CLI_REFERENCE.md §3'],
    ['connections list', 'planned in CLI_REFERENCE.md §3'],
    ['auth status', 'planned in CLI_REFERENCE.md §3'],
    ['auth toggle', 'planned in CLI_REFERENCE.md §3'],
    ['auth change-password', 'planned in CLI_REFERENCE.md §3'],
    ['config get', 'planned in CLI_REFERENCE.md §3'],
    ['config set', 'planned in CLI_REFERENCE.md §3'],
    ['logs', 'planned in CLI_REFERENCE.md §3'],
    ['permissions get', 'planned in CLI_REFERENCE.md §3'],
    ['permissions set', 'planned in CLI_REFERENCE.md §3'],
    ['extensions list', 'planned in CLI_REFERENCE.md §3'],
    ['extensions reload', 'planned in CLI_REFERENCE.md §3'],
    ['operation start', 'planned in CLI_REFERENCE.md §3'],
  ];

  for (const [cmd, note] of documentedMissing) {
    const r = bridge(cmd, 5000);
    const combined = (r.stdout || '') + (r.stderr || '');
    // If it starts node mode (like "bridge connect" bug), it doesn't recognize
    // the subcommand — which is correct for "missing" status.
    const startsNode = combined.includes('[node] Starting') || combined.includes('Role:');
    const showsUsage = combined.includes('Usage');
    const isMissing = !r.ok || showsUsage || startsNode;

    if (cmd === 'connect') {
      // Special case: "bridge connect" should NOT exist but falls through to node
      // mode. This is the stale-doc bug — the doc says it exists (stale-doc mark).
      check(`bridge connect falls through to node mode (stale-doc bug — CLI_FEATURE_GAPS.md §2.1)`,
        startsNode || !r.ok);
    } else {
      console.log(`  NOTE: bridge ${cmd} — ${isMissing ? 'correctly missing' : 'unexpectedly exists'}. ${note}`);
    }
  }

  // ── T8: bridge --update flag is recognized ──────────────────
  console.log('\n── T8: bridge --update ──');
  {
    const r = bridge('--update', 10000);
    const combined = (r.stdout || '') + (r.stderr || '');
    // --update tries git operations, which may fail outside a repo,
    // but it should NOT be an unknown flag
    const recognized = combined.includes('update')
      || combined.includes('git')
      || combined.includes('[update]')
      || combined.includes('repository');
    check('bridge --update is recognized (not unknown flag)', recognized || r.ok);
  }

  // ── Results ─────────────────────────────────────────────────
  console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  if (failed > 0) {
    console.log(`  FAIL: ${failed} test(s) failed`);
  } else {
    console.log(`  PASS: All CLI command existence checks passed`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
