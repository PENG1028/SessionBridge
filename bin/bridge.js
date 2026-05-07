#!/usr/bin/env node
// ─── SessionBridge Build Entry ──────────────────────────────
// Loads compiled dist/src/index.js, or falls back to tsx for dev.
// Enables npx session-bridge to work after npm install / build.

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distEntry = path.join(projectRoot, 'dist', 'src', 'index.js');

if (fs.existsSync(distEntry)) {
  // Fast path: compiled JS exists
  require(distEntry);
} else {
  // Fallback: auto-compile via tsx
  const tsxBin = path.join(projectRoot, 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(tsxBin) || fs.existsSync(tsxBin + '.cmd')) {
    const { spawnSync } = require('child_process');
    const tsxPath = process.platform === 'win32' ? tsxBin + '.cmd' : tsxBin;
    const result = spawnSync(process.execPath, [tsxPath, path.join(projectRoot, 'src', 'index.ts'), ...process.argv.slice(2)], {
      stdio: 'inherit',
      cwd: projectRoot,
      env: process.env,
    });
    process.exit(result.status ?? 1);
  } else {
    console.error('tsx not found. Run "npm install" first.');
    process.exit(1);
  }
}
