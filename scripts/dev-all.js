// ─── Dev All ────────────────────────────────────────────
// Starts Next.js dev server (3000). Core must be running separately.
// Usage: node scripts/dev-all.js

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// ── Help ─────────────────────────────────────────────────
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
dev-all — Start Next.js dev server.

Usage:
  node scripts/dev-all.js
  npm run dev
  npm run dev:all

Prerequisites:
  Go Core must be running on ws://127.0.0.1:9090 (or set SESSIONBRIDGE_CORE_WS_URL).
  Clone and build from: https://github.com/PENG1028/sessionbridge-core

What it does:
  Next.js    → http://localhost:3000 (LAN: 0.0.0.0)
  Go Core    → ws://127.0.0.1:9090 (expected to be already running)
`);
  process.exit(0);
}

// ── Reminder about Core ─────────────────────────────────
const coreUrl = process.env.SESSIONBRIDGE_CORE_WS_URL || 'ws://127.0.0.1:9090/ws';
console.log('[dev-all] Core expected at:', coreUrl);
console.log('[dev-all] If Core is not running, clone & build:');
console.log('          git clone git@github.com:PENG1028/sessionbridge-core.git');
console.log('          cd sessionbridge-core && go build ./cmd/node/ && ./sessionnode');
console.log('');

// ── Next.js Dev ─────────────────────────────────────────
const nextBin = path.join(projectRoot, 'node_modules', '.bin', 'next');
const nextBinPlatform = process.platform === 'win32' ? nextBin + '.cmd' : nextBin;

if (!existsSync(nextBinPlatform)) {
  console.error('[dev-all] Next.js binary not found. Run: npm install');
  process.exit(1);
}

console.log('[dev-all] Starting Next.js dev on 0.0.0.0:3000 (LAN accessible)...');
const next = spawn(nextBinPlatform, ['dev', '--webpack', '-H', '0.0.0.0'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    SESSIONBRIDGE_AUTH_BYPASS: process.env.SESSIONBRIDGE_AUTH_BYPASS || '1',
    SESSIONBRIDGE_CORE_WS_URL: coreUrl,
  },
  stdio: 'inherit',
  windowsHide: true,
  shell: process.platform === 'win32',
});

// ── Cleanup ─────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[dev-all] Stopping Next.js...');
  next.kill('SIGINT');
});
process.on('SIGTERM', () => {
  next.kill('SIGTERM');
});

next.on('exit', (code) => {
  console.log(`[dev-all] Next.js exited (code ${code})`);
  process.exit(code ?? 0);
});
