#!/usr/bin/env node
// ─── SessionBridge Launcher ──────────────────────────────────────
// Starts the server, opens browser, handles shutdown gracefully.
// Cross-platform: works on Windows, macOS, Linux.
//
// Usage:  node scripts/serve.js
//         npm run serve          (if added to package.json)

const { spawn } = require('child_process');
const { createServer } = require('net');
const { existsSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const SERVER = join(ROOT, 'dist', 'index.js');
const FRONTEND = join(ROOT, 'out', 'index.html');

// ─── Find free port ─────────────────────────────
function findFreePort(start = 8080, end = 8099) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > end) return reject(new Error(`No free port in range ${start}-${end}`));
      const srv = createServer();
      srv.on('error', () => tryPort(port + 1));
      srv.listen(port, '127.0.0.1', () => {
        srv.close(() => resolve(port));
      });
    };
    tryPort(start);
  });
}

// ─── Open browser ───────────────────────────────
function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? 'start' :
              platform === 'darwin' ? 'open' :
              'xdg-open';
  // Windows needs special handling
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' });
  } else {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' });
  }
}

// ─── Main ───────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const customPort = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '', 10);
  const isQuiet = args.includes('--quiet');

  // Check if built
  if (!existsSync(SERVER)) {
    console.error('\n  ✗ Server not built. Run these first:\n');
    console.error('    npm run build:server');
    console.error('    npx next build\n');
    process.exit(1);
  }

  if (!existsSync(FRONTEND) && !existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
    console.error('\n  ✗ Frontend not built. Run:\n');
    console.error('    npx next build\n');
    process.exit(1);
  }

  // Find port
  const port = customPort || await findFreePort().catch(() => 8080);

  if (!isQuiet) {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║     SessionBridge                     ║');
    console.log('  ║     http://localhost:' + String(port).padEnd(5) + '                ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
  }

  // Start server
  const server = spawn('node', [SERVER, '--relay-port', String(port)], {
    cwd: ROOT,
    stdio: isQuiet ? 'ignore' : 'inherit',
    env: { ...process.env, PORT: String(port) },
  });

  server.on('error', (err) => {
    console.error('  ✗ Failed to start server:', err.message);
    process.exit(1);
  });

  server.on('exit', (code) => {
    if (code && code !== 0 && !isQuiet) {
      console.log(`\n  Server exited with code ${code}`);
    }
    process.exit(code || 0);
  });

  // Open browser after short delay
  const url = `http://localhost:${port}`;
  setTimeout(() => openBrowser(url), 1500);

  // Handle exit signals
  const cleanup = () => {
    server.kill();
    setTimeout(() => process.exit(0), 1000);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep running
  if (!isQuiet) {
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Open ${url}`);
    console.log(`  Press Ctrl+C to stop`);
    console.log('');
  }
}

main().catch((err) => {
  console.error('  ✗', err.message);
  process.exit(1);
});
