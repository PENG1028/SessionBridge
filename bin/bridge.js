#!/usr/bin/env node
// ─── SessionBridge Launcher ──────────────────────────────
// Go Core is the only runtime. Legacy Node relay has been retired.
//
// Usage:
//   node bin/bridge.js      — default: start Go Core
//   node bin/bridge.js core — start Go Core
//   node bin/bridge.js web  — start Next.js (prod, needs build:web first)
//   node bin/bridge.js dev  — start Go Core + Next.js dev

const { spawn, spawnSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const subcommand = process.argv[2] || '';

function usage() {
  console.log(`
SessionBridge — Go Core is the primary runtime. Legacy Node relay has been retired.

Default:   node bin/bridge.js  →  start Go Core (same as "core")
Commands:
  core          Start Go Core (default runtime)
  web           Start Next.js production server (build first: npm run build:web)
  dev           Start Go Core + Next.js dev server

npm scripts:
  npm start         → start Go Core (default)
  npm run dev       → Go Core + Next.js dev
  npm run dev:core  → Go Core dev mode
  npm run dev:web   → Next.js dev only
  npm run build     → build:web + build:core

Docs: docs/development.md
`);
}

function runScript(scriptPath, args = []) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

switch (subcommand) {
  case '--help':
  case '-h':
    usage();
    break;

  case '':
  case 'core':
    runScript(path.join(projectRoot, 'scripts', 'start-core.js'), process.argv.slice(3));
    break;

  case 'web': {
    // Check for Next.js build
    const outDir = path.join(projectRoot, 'out');
    const nextDir = path.join(projectRoot, '.next');
    if (!existsSync(outDir) && !existsSync(nextDir)) {
      console.error('No Next.js build found. Run: npm run build:web');
      process.exit(1);
    }
    const nextBin = path.join(projectRoot, 'node_modules', '.bin', 'next');
    const nextBinPlatform = process.platform === 'win32' ? nextBin + '.cmd' : nextBin;
    const child = spawn(nextBinPlatform, ['start', ...process.argv.slice(3)], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    });
    child.on('exit', (code) => process.exit(code ?? 1));
    break;
  }

  case 'dev':
    runScript(path.join(projectRoot, 'scripts', 'dev-all.js'), process.argv.slice(3));
    break;

  case 'legacy-relay':
  case 'legacy:relay':
    console.error('Legacy Node relay has been retired. Use Go Core: npm start / npm run dev.');
    process.exit(1);

  default:
    console.error(`Unknown command: ${subcommand}`);
    console.error('');
    usage();
    process.exit(1);
}
