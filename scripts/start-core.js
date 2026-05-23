// ─── Start Go Core ──────────────────────────────────────
// Launches the Go Core binary (built) or falls back to `go run`.
// Usage: node scripts/start-core.js [--dev]
//   --dev    Use `go run` instead of the pre-built binary.

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const binaryName = process.platform === 'win32' ? 'sessionnode.exe' : 'sessionnode';
const binPath = path.join(projectRoot, 'dist', 'go-core', binaryName);
const goCmdDir = path.join(projectRoot, 'go-core', 'cmd', 'node');

const useDev = process.argv.includes('--dev');

// ── Resolve binary ──────────────────────────────────────
let cmd, args;

if (useDev || !existsSync(binPath)) {
  if (!useDev && !existsSync(binPath)) {
    console.log('[start-core] No pre-built binary found. Falling back to `go run`.');
    console.log('[start-core] Run `npm run build:core` first for faster startup.');
  }
  // Check Go availability
  try {
    const { execSync } = require('child_process');
    execSync('go version', { stdio: 'pipe' });
  } catch {
    console.error('Go is required. Install Go (https://go.dev/dl/) or add it to PATH.');
    console.error('Or build first: npm run build:core');
    process.exit(1);
  }
  cmd = 'go';
  args = ['run', './go-core/cmd/node'];
} else {
  cmd = binPath;
  args = [];
}

// ── Environment ─────────────────────────────────────────
const env = { ...process.env };

// Default listen address
if (!env.LISTEN_ADDR) {
  env.LISTEN_ADDR = '127.0.0.1:8080';
}

// Default data directory
if (!env.SESSIONNODE_DATA_DIR) {
  const home = env.USERPROFILE || env.HOME || process.cwd();
  env.SESSIONNODE_DATA_DIR = path.join(home, '.sessionnode');
}

// Token (empty = dev mode, no auth)
if (!env.SESSIONNODE_TOKEN) {
  // Leave empty for dev — Go Core treats empty token as dev mode
}

// Plugin dirs — default to local plugins/ if no explicit config
if (!env.SESSIONNODE_PLUGIN_DIRS) {
  const localPlugins = path.join(projectRoot, 'plugins');
  if (existsSync(localPlugins)) {
    env.SESSIONNODE_PLUGIN_DIRS = localPlugins;
  }
}

// ── Print startup info ──────────────────────────────────
console.log('[start-core] Go Core starting...');
console.log(`  Binary:    ${useDev ? 'go run (dev)' : binPath}`);
console.log(`  Listen:    ws://${env.LISTEN_ADDR}`);
console.log(`  HTTP:      http://${env.LISTEN_ADDR}`);
console.log(`  Data dir:  ${env.SESSIONNODE_DATA_DIR}`);
if (env.SESSIONNODE_PLUGIN_DIRS) {
  console.log(`  Plugins:   ${env.SESSIONNODE_PLUGIN_DIRS}`);
}
if (env.SESSIONNODE_TOKEN) {
  console.log(`  Token:     enabled`);
} else {
  console.log(`  Token:     disabled (dev mode)`);
}
console.log('');

// ── Spawn ───────────────────────────────────────────────
const child = spawn(cmd, args, {
  cwd: projectRoot,
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

// Forward signals
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
