#!/usr/bin/env node
// ─── SessionBridge Web Launcher ──────────────────────────
// Core is a separate product: github.com/PENG1028/sessionbridge-core
//
// Usage:
//   node bin/bridge.js      — start Next.js production
//   node bin/bridge.js web  — start Next.js production (.next/ required)
//   node bin/bridge.js dev  — start Next.js dev server

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const subcommand = process.argv[2] || '';

function usage() {
  console.log(`
SessionBridge Web — Web UI for SessionBridge Core nodes.
Core is a separate product: github.com/PENG1028/sessionbridge-core

Default:   node bin/bridge.js  →  start Next.js production
Commands:
  web           Start Next.js production server (build first: npm run build:web)
  dev           Start Next.js dev server

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
  case 'web': {
    // Check for Next.js production build (.next/)
    const nextDir = path.join(projectRoot, '.next');
    if (!existsSync(nextDir)) {
      console.error('No Next.js production build found. Run: npm run build:web');
      process.exit(1);
    }
    const nextBin = path.join(projectRoot, 'node_modules', '.bin', 'next');
    const nextBinPlatform = process.platform === 'win32' ? nextBin + '.cmd' : nextBin;
    const child = spawn(
      process.platform === 'win32' ? 'cmd.exe' : nextBinPlatform,
      process.platform === 'win32'
        ? ['/c', nextBinPlatform, 'start', ...process.argv.slice(3)]
        : ['start', ...process.argv.slice(3)],
      {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env,
        windowsHide: true,
      }
    );
    child.on('exit', (code) => process.exit(code ?? 1));
    break;
  }

  case 'dev':
    runScript(path.join(projectRoot, 'scripts', 'dev-all.js'), process.argv.slice(3));
    break;

  case 'core':
    console.log('[bridge] Core is a separate product.');
    console.log('[bridge] Get it at: https://github.com/PENG1028/sessionbridge-core/releases');
    console.log('[bridge] Or clone as sibling and run: node ../sessionbridge-core/cmd/node');
    process.exit(1);

  default:
    console.error(`Unknown command: ${subcommand}`);
    console.error('');
    usage();
    process.exit(1);
}
