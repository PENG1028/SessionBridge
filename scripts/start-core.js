// ─── Start Go Core ──────────────────────────────────────
// Launches the Go Core binary from a sibling repo or PATH.
// Core is a separate product: https://github.com/PENG1028/sessionbridge-core
//
// Usage: node scripts/start-core.js [--dev] [--help|-h]
//   --dev    Use `go run` from sibling sessionbridge-core repo.

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const siblingCoreDir = path.join(projectRoot, '..', 'sessionbridge-core');
const binaryName = process.platform === 'win32' ? 'sessionnode.exe' : 'sessionnode';

// Candidate binary paths, in order of preference:
// 1. Sibling repo pre-built binary
// 2. Sibling repo go run (--dev)
// 3. System PATH
const BIN_CANDIDATES = [
  path.join(siblingCoreDir, binaryName),
  path.join(projectRoot, 'dist', 'go-core', binaryName), // legacy monorepo path
];

// ── Help ─────────────────────────────────────────────────
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
start-core — Start the Go Core runtime.

Usage:
  node scripts/start-core.js [--dev]
  npm run start:core
  npm run dev:core               (same as --dev)

Core is a separate product. Get it from:
  https://github.com/PENG1028/sessionbridge-core

For local dev, clone as sibling to this repo:
  cd ..
  git clone git@github.com:PENG1028/sessionbridge-core.git
  cd sessionbridge-core && go build ./cmd/node/

Environment variables:
  LISTEN_ADDR              Listen address (default: 127.0.0.1:9090)
  SESSIONNODE_DATA_DIR     Data directory (default: ~/.sessionnode)
  SESSIONNODE_TOKEN        Auth token — empty = dev mode, no auth required
  SESSIONNODE_PLUGIN_DIRS  Plugin directories (default: ./plugins/)
`);
  process.exit(0);
}

const useDev = process.argv.includes('--dev');

// ── Resolve binary ──────────────────────────────────────
let cmd, args, cwd;

let foundBin = null;
for (const p of BIN_CANDIDATES) {
  if (existsSync(p)) { foundBin = p; break; }
}

if (useDev) {
  if (existsSync(siblingCoreDir)) {
    console.log('[start-core] Dev mode — go run from sibling repo');
    cmd = 'go';
    args = ['run', './cmd/node'];
    cwd = siblingCoreDir;
  } else {
    console.error('[start-core] --dev requires sessionbridge-core as a sibling directory.');
    console.error(`  Expected: ${siblingCoreDir}`);
    console.error('  Clone: git clone git@github.com:PENG1028/sessionbridge-core.git');
    process.exit(1);
  }
} else if (foundBin) {
  console.log(`[start-core] Found binary: ${foundBin}`);
  cmd = foundBin;
  args = [];
  cwd = projectRoot;
} else {
  console.log('[start-core] No binary found. Trying `sessionnode` from PATH...');
  console.log('[start-core] Or clone Core as sibling:');
  console.log(`  cd ${path.join(projectRoot, '..')}`);
  console.log('  git clone git@github.com:PENG1028/sessionbridge-core.git');
  console.log('  cd sessionbridge-core && go build ./cmd/node/');
  cmd = 'sessionnode';
  args = [];
  cwd = projectRoot;
}

// ── Environment ─────────────────────────────────────────
const env = { ...process.env };
if (!env.LISTEN_ADDR) env.LISTEN_ADDR = '127.0.0.1:9090';
if (!env.SESSIONNODE_DATA_DIR) {
  const home = env.USERPROFILE || env.HOME || process.cwd();
  env.SESSIONNODE_DATA_DIR = path.join(home, '.sessionnode');
}
if (!env.SESSIONNODE_PLUGIN_DIRS) {
  const localPlugins = path.join(projectRoot, 'plugins');
  if (existsSync(localPlugins)) env.SESSIONNODE_PLUGIN_DIRS = localPlugins;
}

// ── Print startup info ──────────────────────────────────
console.log('[start-core] Go Core starting...');
console.log(`  Command:   ${cmd} ${args.join(' ')}`);
console.log(`  CWD:       ${cwd}`);
console.log(`  Listen:    ws://${env.LISTEN_ADDR}`);
console.log(`  Data dir:  ${env.SESSIONNODE_DATA_DIR}`);
console.log(`  Plugins:   ${env.SESSIONNODE_PLUGIN_DIRS || '(default)'}`);
console.log(`  Token:     ${env.SESSIONNODE_TOKEN ? 'enabled' : 'disabled (dev mode)'}`);
console.log('');

// ── Spawn ───────────────────────────────────────────────
const child = spawn(cmd, args, {
  cwd,
  env,
  stdio: 'inherit',
  windowsHide: true,
});

child.on('error', (err) => {
  console.error(`[start-core] Failed to start: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
