#!/usr/bin/env node
// ─── SessionBridge Git-based Update Checker ──────────────────────────
// Compares local git HEAD with the remote tracking branch to determine
// if updates are available.
//
// Usage:
//   node scripts/check-update.js              → stdout JSON result
//   node scripts/check-update.js --notify     → human-readable output
//
// Output (JSON):
//   { currentHash, latestHash, behindCount, hasUpdate, currentVersion, currentBranch, error }
//   hasUpdate is true when behindCount > 0 or hashes differ.
//   Works with any remote name (origin, github, etc.) — auto-detects the
//   first remote that points to the project's GitHub repo.

const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const ROOT = join(__dirname, '..');

// Read version from package.json (self-contained, no TS dependency)
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(require('fs').readFileSync(join(ROOT, 'package.json'), 'utf8')).version || VERSION;
} catch {} // fallback

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch { return ''; }
}

function getRemotes() {
  const out = run('git remote -v');
  const lines = out.split('\n').filter(Boolean);
  const remotes = [];
  for (const line of lines) {
    const parts = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    if (parts) remotes.push({ name: parts[1], url: parts[2] });
  }
  return remotes;
}

function findUpdateRemote() {
  const remotes = getRemotes();
  // Prefer "origin" if it points to GitHub
  const origin = remotes.find(r => r.name === 'origin' && r.url.includes('github.com'));
  if (origin) return origin;
  // Fallback: any remote pointing to github.com
  const gh = remotes.find(r => r.url.includes('github.com'));
  if (gh) return gh;
  // Last resort: first available remote
  return remotes[0] || null;
}

async function main() {
  const isNotify = process.argv.includes('--notify');

  // Check we're in a git repo
  if (!existsSync(join(ROOT, '.git'))) {
    const result = {
      currentHash: '',
      latestHash: '',
      behindCount: 0,
      hasUpdate: false,
      currentVersion: VERSION,
      currentBranch: '',
      error: 'Not a git repository',
    };
    if (isNotify) { console.log('  - Not a git repository. Update check requires a git clone.'); return; }
    console.log(JSON.stringify(result));
    return;
  }

  const currentBranch = run('git rev-parse --abbrev-ref HEAD');
  const currentHash = run('git rev-parse HEAD');

  const remote = findUpdateRemote();
  if (!remote) {
    const result = {
      currentHash,
      latestHash: currentHash,
      behindCount: 0,
      hasUpdate: false,
      currentVersion: VERSION,
      currentBranch,
      error: 'No git remote found',
    };
    if (isNotify) { console.log('  - No git remote configured.'); return; }
    console.log(JSON.stringify(result));
    return;
  }

  // Fetch remote to get latest
  console.error(`[check-update] Fetching ${remote.name} (${remote.url})...`);
  run(`git fetch ${remote.name} --quiet`, { timeout: 60000 });

  const remoteRef = `${remote.name}/${currentBranch}`;
  const latestHash = run(`git rev-parse ${remoteRef}`);

  if (!latestHash) {
    const result = {
      currentHash,
      latestHash: currentHash,
      behindCount: 0,
      hasUpdate: false,
      currentVersion: VERSION,
      currentBranch,
      error: `Could not resolve ${remoteRef}`,
    };
    if (isNotify) { console.log(`  - Could not resolve remote branch ${remoteRef}`); return; }
    console.log(JSON.stringify(result));
    return;
  }

  // Count commits behind
  const behindCountStr = run(`git rev-list --count ${remoteRef}..HEAD`);
  const aheadCountStr = run(`git rev-list --count HEAD..${remoteRef}`);
  const behindCount = parseInt(behindCountStr, 10) || 0;
  const aheadCount = parseInt(aheadCountStr, 10) || 0;
  const hasUpdate = currentHash !== latestHash && (aheadCount > 0 || behindCount === 0);

  const result = {
    currentHash: currentHash.slice(0, 12),
    latestHash: latestHash.slice(0, 12),
    behindCount,
    aheadCount,
    hasUpdate,
    currentVersion: VERSION,
    currentBranch,
    remoteName: remote.name,
    error: null,
  };

  if (isNotify) {
    if (hasUpdate) {
      console.log(`\n  Update available:`);
      console.log(`    ${currentHash.slice(0, 8)} → ${latestHash.slice(0, 8)} (${aheadCount} commit(s) ahead)`);
      console.log(`    Branch: ${currentBranch}`);
      console.log(`    Run: bridge update\n`);
    } else {
      console.log(`  ✓ v${VERSION} (${currentHash.slice(0, 8)}) is up to date.`);
    }
    return;
  }

  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.log(JSON.stringify({
    currentHash: '', latestHash: '', behindCount: 0,
    hasUpdate: false, currentVersion: VERSION, currentBranch: '',
    error: err.message,
  }));
});
