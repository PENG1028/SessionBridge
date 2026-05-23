#!/usr/bin/env node
// ─── SessionBridge Launcher ──────────────────────────────
// Go Core is the primary runtime. Legacy Node relay preserved
// under the "legacy-relay" subcommand.
//
// Usage:
//   node bin/bridge.js              — default: start Go Core
//   node bin/bridge.js core         — start Go Core
//   node bin/bridge.js web          — start Next.js (prod, needs build:web first)
//   node bin/bridge.js dev          — start Go Core + Next.js dev
//   node bin/bridge.js legacy-relay — start legacy Node relay (deprecated)

const { spawn, spawnSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const subcommand = process.argv[2] || '';

function usage() {
  console.log(`
SessionBridge — Go Core is the primary runtime.

Default:   node bin/bridge.js  →  start Go Core (same as "core")
Commands:
  core          Start Go Core (default runtime)
  web           Start Next.js production server (build first: npm run build:web)
  dev           Start Go Core + Next.js dev server
  legacy-relay  Start legacy Node relay (deprecated)

npm scripts:
  npm start             → start Go Core (default)
  npm run dev           → Go Core + Next.js dev
  npm run dev:core      → Go Core dev mode
  npm run dev:web       → Next.js dev only
  npm run build         → build:web + build:core
  npm run legacy:relay  → legacy Node relay (deprecated)

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

  case 'legacy-relay': {
    // Legacy Node relay — load dist/src/index.js or fall back to tsx
    const distEntry = path.join(projectRoot, 'dist', 'src', 'index.js');
    if (existsSync(distEntry)) {
      console.log('[legacy-relay] Starting legacy Node relay (compiled)...');
      require(distEntry);
    } else {
      console.log('[legacy-relay] Starting legacy Node relay (tsx dev)...');
      const tsxBin = path.join(projectRoot, 'node_modules', '.bin', 'tsx');
      const tsxPlatform = process.platform === 'win32' ? tsxBin + '.cmd' : tsxBin;
      if (!existsSync(tsxBin) && !existsSync(tsxPlatform)) {
        console.error('tsx not found. Run "npm install" first.');
        process.exit(1);
      }
      const child = spawn(process.execPath, [tsxPlatform, path.join(projectRoot, 'src', 'index.ts'), ...process.argv.slice(3)], {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env,
        windowsHide: true,
      });
      child.on('exit', (code) => process.exit(code ?? 1));
    }
    break;
  }

  default:
    console.error(`Unknown command: ${subcommand}`);
    console.error('');
    usage();
    process.exit(1);
}
