// ─── Dev All ────────────────────────────────────────────
// Starts Go Core (127.0.0.1:8080) + Next.js dev (3000) in parallel.
// Usage: node scripts/dev-all.js

const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// ── Go Core ─────────────────────────────────────────────
const binaryName = process.platform === 'win32' ? 'sessionnode.exe' : 'sessionnode';
const binPath = path.join(projectRoot, 'dist', 'go-core', binaryName);
const { existsSync } = require('fs');

let coreCmd, coreArgs;
if (existsSync(binPath)) {
  coreCmd = binPath;
  coreArgs = [];
} else {
  coreCmd = 'go';
  coreArgs = ['run', './go-core/cmd/node'];
}

const configPath = path.join(projectRoot, 'go-core', 'config', 'dev.json');
const pluginDirs = path.join(projectRoot, 'plugins');

const coreEnv = {
  ...process.env,
  LISTEN_ADDR: process.env.LISTEN_ADDR || '127.0.0.1:8080',
  SESSIONNODE_DATA_DIR: process.env.SESSIONNODE_DATA_DIR || path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), '.sessionnode'),
  SESSIONNODE_PLUGIN_DIRS: pluginDirs,
};

console.log('[dev-all] Starting Go Core on 127.0.0.1:8080...');
const core = spawn(coreCmd, coreArgs, {
  cwd: projectRoot,
  env: coreEnv,
  stdio: 'inherit',
  windowsHide: true,
});

// ── Next.js Dev ─────────────────────────────────────────
const nextBin = path.join(projectRoot, 'node_modules', '.bin', 'next');
const nextBinPlatform = process.platform === 'win32' ? nextBin + '.cmd' : nextBin;

console.log('[dev-all] Starting Next.js dev on 3000...');
const next = spawn(nextBinPlatform, ['dev'], {
  cwd: projectRoot,
  env: { ...process.env },
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
