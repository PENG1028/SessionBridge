// ─── Dev All ────────────────────────────────────────────
// Starts Go Core (127.0.0.1:9090) + Next.js dev (3000) in parallel.
// Usage: node scripts/dev-all.js

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// ── Help ─────────────────────────────────────────────────
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
dev-all — Start Go Core + Next.js dev server in parallel.

Usage:
  node scripts/dev-all.js
  npm run dev
  npm run dev:all

What it does:
  Go Core    → ws://127.0.0.1:9090
  Next.js    → http://localhost:3000

Requirements:
  Go ≥ 1.21  (for Go Core — built binary or go run fallback)
  Node.js    (Next.js dev server, from node_modules/.bin/next)

Environment variables (Go Core):
  LISTEN_ADDR              default: 127.0.0.1:9090
  SESSIONNODE_DATA_DIR     default: ~/.sessionnode
  SESSIONNODE_PLUGIN_DIRS  default: ./plugins/
`);
  process.exit(0);
}

// ── Go Core ─────────────────────────────────────────────
const goCoreDir = path.join(projectRoot, 'go-core');
const binaryName = process.platform === 'win32' ? 'sessionnode.exe' : 'sessionnode';
const binPath = path.join(projectRoot, 'dist', 'go-core', binaryName);

let coreCmd, coreArgs, coreCwd;
if (existsSync(binPath)) {
  coreCmd = binPath;
  coreArgs = [];
  coreCwd = projectRoot;
} else {
  // Fallback to go run — check Go availability first
  try {
    const { execSync } = require('child_process');
    execSync('go version', { stdio: 'pipe' });
  } catch {
    console.error('Go is required to run Go Core in dev mode.');
    console.error('Install Go (https://go.dev/dl/) or run: npm run build:core');
    process.exit(1);
  }
  coreCmd = 'go';
  coreArgs = ['run', './cmd/node'];
  coreCwd = goCoreDir;
}

const pluginDirs = path.join(projectRoot, 'plugins');

const coreEnv = {
  ...process.env,
  LISTEN_ADDR: process.env.LISTEN_ADDR || '127.0.0.1:9090',
  SESSIONNODE_DATA_DIR: process.env.SESSIONNODE_DATA_DIR || path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), '.sessionnode'),
  SESSIONNODE_PLUGIN_DIRS: pluginDirs,
};

console.log('[dev-all] Starting Go Core on 127.0.0.1:9090...');
const core = spawn(coreCmd, coreArgs, {
  cwd: coreCwd,
  env: coreEnv,
  stdio: 'inherit',
  windowsHide: true,
});

// ── Next.js Dev ─────────────────────────────────────────
const nextBin = path.join(projectRoot, 'node_modules', '.bin', 'next');
const nextBinPlatform = process.platform === 'win32' ? nextBin + '.cmd' : nextBin;

if (!existsSync(nextBinPlatform)) {
  console.error('[dev-all] Next.js binary not found. Run: npm install');
  core.kill();
  process.exit(1);
}

console.log('[dev-all] Starting Next.js dev on 3000...');
const next = spawn(nextBinPlatform, ['dev'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    SESSIONBRIDGE_AUTH_BYPASS: process.env.SESSIONBRIDGE_AUTH_BYPASS || '1',
    SESSIONBRIDGE_CORE_WS_URL: process.env.SESSIONBRIDGE_CORE_WS_URL || 'ws://127.0.0.1:9090/ws',
  },
  stdio: 'inherit',
  windowsHide: true,
});

// ── Cleanup ─────────────────────────────────────────────
let cleaning = false;
function cleanup(signal) {
  if (cleaning) return;
  cleaning = true;
  console.log(`\n[dev-all] ${signal} received — stopping...`);
  core.kill(signal);
  next.kill(signal);
}

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));

core.on('exit', (code) => {
  if (!cleaning) {
    console.log(`[dev-all] Go Core exited (code ${code}) — stopping Next.js...`);
    next.kill();
    process.exit(code ?? 1);
  }
});

next.on('exit', (code) => {
  if (!cleaning) {
    console.log(`[dev-all] Next.js exited (code ${code}) — stopping Go Core...`);
    core.kill();
    process.exit(code ?? 1);
  }
});
