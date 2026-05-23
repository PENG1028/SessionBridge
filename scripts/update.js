#!/usr/bin/env node
// ─── SessionBridge Git-based Updater ─────────────────────────────────
// External CLI helper. Pulls the latest code from GitHub, installs
// dependencies, and rebuilds. This is NOT the Core update.* system.
//
// Core update.check / update.plan are read-only diagnostics surfaced
// through the Go Core API. This script is a manual CLI tool for
// developers who want to git-pull + rebuild from the command line.
//
// Usage:
//   node scripts/update.js                  # check + prompt + update
//   node scripts/update.js --force          # update without prompt
//   node scripts/update.js --check-only     # just check, no update
//
// Steps:
//   1. git pull from the tracked GitHub remote
//   2. npm install
//   3. npm run build (build:web + build:core)
//   4. Signal success (caller handles restart)

const { execSync, spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');

// Read version from package.json
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || VERSION;
} catch {} // fallback

function run(cmd, opts = {}) {
  const env = { ...process.env, ...opts.env };
  // Pipe stdio by default so user sees progress
  const stdio = opts.stdio || 'inherit';
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: opts.timeout || 300000, stdio, env });
  } catch (e) {
    throw new Error(`Command failed: ${cmd}\n${e.stderr || e.message}`);
  }
}

function getRemote() {
  const out = run('git remote -v', { stdio: 'pipe', timeout: 10000 });
  const lines = out.split('\n').filter(Boolean);
  for (const line of lines) {
    const parts = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    if (parts && parts[1] === 'origin' && parts[2].includes('github.com')) return 'origin';
  }
  // Fallback: any GitHub remote
  for (const line of lines) {
    const parts = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    if (parts && parts[2].includes('github.com')) return parts[1];
  }
  // Last resort: first remote
  const first = lines[0]?.match(/^(\S+)/);
  return first ? first[1] : 'origin';
}

function prompt(msg) {
  return new Promise((resolve) => {
    process.stdout.write(msg + ' [Y/n] ');
    process.stdin.once('data', (d) => {
      const answer = d.toString().trim().toLowerCase();
      resolve(answer === '' || answer === 'y' || answer === 'yes');
    });
  });
}

async function main() {
  const force = process.argv.includes('--force');
  const checkOnly = process.argv.includes('--check-only');

  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║  SessionBridge Updater                ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log(`  Version: v${VERSION}`);
  console.log('');

  // 1. Verify git repo
  if (!existsSync(join(ROOT, '.git'))) {
    console.error('  ✗ Not a git repository. Update requires a git clone.');
    process.exit(1);
  }

  const branch = run('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe', timeout: 10000 });
  const remote = getRemote();
  const currentHash = run('git rev-parse HEAD', { stdio: 'pipe', timeout: 10000 }).slice(0, 12);

  console.log(`  Branch: ${branch}`);
  console.log(`  Remote: ${remote}`);
  console.log(`  Commit: ${currentHash}`);
  console.log('');

  // 2. Check for update
  console.log('  Checking for updates...');
  try {
    run(`git fetch ${remote} --quiet`, { timeout: 60000 });
  } catch (err) {
    console.error(`  ✗ Failed to fetch: ${err.message}`);
    process.exit(1);
  }

  const remoteRef = `${remote}/${branch}`;
  const latestHash = run(`git rev-parse ${remoteRef}`, { stdio: 'pipe', timeout: 10000 }).slice(0, 12);
  const behindCount = parseInt(run(`git rev-list --count HEAD..${remoteRef}`, { stdio: 'pipe', timeout: 10000 }) || '0', 10);

  if (!latestHash) {
    console.error('  ✗ Could not resolve remote branch.');
    process.exit(1);
  }

  if (currentHash === latestHash) {
    console.log(`  ✓ Already up to date (${currentHash}).`);
    return;
  }

  console.log(`  → Update available: ${currentHash} → ${latestHash} (${behindCount} commit(s) ahead)`);
  if (checkOnly) return;

  // 3. Confirm
  if (!force) {
    const ok = await prompt('\n  Pull latest and rebuild?');
    if (!ok) { console.log('  Cancelled.'); return; }
  }

  // 4. Stash any local changes
  console.log('');
  console.log('  Stashing local changes...');
  try {
    run('git stash --include-untracked', { timeout: 10000 });
  } catch { /* nothing to stash */ }

  // 5. Pull
  console.log('  Pulling latest code...');
  try {
    run(`git pull ${remote} ${branch} --ff-only`);
  } catch {
    // Fallback: try merge
    console.log('  Fast-forward failed, trying merge...');
    run(`git pull ${remote} ${branch}`);
  }
  console.log('  ✓ Pull complete.');

  // 6. Install dependencies
  console.log('  Installing dependencies...');
  try {
    run('npm install');
  } catch (err) {
    console.error(`  ✗ npm install failed: ${err.message}`);
    process.exit(1);
  }
  console.log('  ✓ Dependencies installed.');

  // 7. Build (build:web generates .next/, build:core generates Go binary)
  console.log('  Building...');
  try {
    run('npm run build');
  } catch (err) {
    console.error(`  ✗ Build failed: ${err.message}`);
    process.exit(1);
  }
  console.log('  ✓ Build complete.');

  console.log('');
  console.log(`  ✓ Update complete!`);
  console.log('');
  console.log('  Restart the server to apply the update.');
  console.log('  If running via PM2: pm2 restart sessionbridge');
  console.log('  If in terminal: Ctrl+C then npm start');
  console.log('');
}

main().catch((err) => {
  console.error(`  ✗ ${err.message}`);
  process.exit(1);
});
