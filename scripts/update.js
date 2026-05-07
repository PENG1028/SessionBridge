#!/usr/bin/env node
// ─── SessionBridge Self-Updater ───────────────────────────────────
// Downloads the latest release from GitHub and replaces the current installation.
//
// Usage:
//   node scripts/update.js                  # check + prompt + update
//   node scripts/update.js --force          # update without prompt
//   node scripts/update.js --check-only     # just check, no download
//
// How it works:
//   1. Check GitHub for latest release
//   2. Download the portable zip
//   3. Extract to a temp directory
//   4. Swap with current installation
//   5. Restart (or prompt to restart)

const https = require('https');
const { createWriteStream, existsSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, cpSync } = require('fs');
const { join, dirname } = require('path');
const { spawn } = require('child_process');
const { VERSION } = require('../adapters/version');

const GITHUB_REPO = process.env.BRIDGE_REPO || 'sessionbridge/sessionbridge';
const ROOT = join(__dirname, '..');
const BACKUP_DIR = join(ROOT, '.bridge-backup');

// ─── Helpers ───────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'sessionbridge' } }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'sessionbridge' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        rmSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        rmSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { file.close(); rmSync(dest); reject(err); });
  });
}

function extractZip(zipPath, dest) {
  return new Promise((resolve, reject) => {
    // Use system unzip (cross-platform enough)
    const proc = spawn('unzip', ['-o', zipPath, '-d', dest], { stdio: 'pipe' });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`)));
    proc.on('error', () => {
      // Fallback: try powershell on Windows, or node's built-in
      if (process.platform === 'win32') {
        const ps = spawn('powershell', [
          '-Command',
          `Expand-Archive -Path '${zipPath}' -DestinationPath '${dest}' -Force`
        ], { stdio: 'pipe' });
        ps.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Expand-Archive failed: ${code}`)));
      } else {
        reject(new Error('unzip not available. Install unzip or extract manually.'));
      }
    });
  });
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

// ─── Main ──────────────────────────────────────

async function main() {
  const force = process.argv.includes('--force');
  const checkOnly = process.argv.includes('--check-only');

  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║  SessionBridge Updater                ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log(`  Current version: v${VERSION}`);
  console.log('');

  // 1. Check for update
  console.log('  Checking for updates...');
  let release;
  try {
    release = await fetchJSON(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
  } catch (err) {
    console.error(`  ✗ Failed to check: ${err.message}`);
    process.exit(1);
  }

  const latest = release.tag_name.replace(/^v/, '');
  if (latest === VERSION) {
    console.log(`  ✓ v${VERSION} is already the latest version.`);
    return;
  }

  console.log(`  → Update available: v${VERSION} → v${latest}`);
  console.log(`  ${release.html_url}`);

  if (checkOnly) return;

  // 2. Find the zip asset
  const asset = release.assets?.find(a => a.name.endsWith('.zip') && a.name.includes('sessionbridge'));
  if (!asset) {
    console.error('  ✗ No portable zip found in release assets.');
    process.exit(1);
  }

  // 3. Confirm
  if (!force) {
    const ok = await prompt('\n  Download and install?');
    if (!ok) { console.log('  Cancelled.'); return; }
  }

  // 4. Download
  console.log(`  Downloading ${asset.name}...`);
  const tmpDir = join(ROOT, '.bridge-update-tmp');
  const zipPath = join(tmpDir, asset.name);
  mkdirSync(tmpDir, { recursive: true });

  try {
    await download(asset.browser_download_url, zipPath);
    console.log('  Download complete.');
  } catch (err) {
    console.error(`  ✗ Download failed: ${err.message}`);
    rmSync(tmpDir, { recursive: true });
    process.exit(1);
  }

  // 5. Extract
  console.log('  Extracting...');
  const extractDir = join(tmpDir, 'extracted');
  mkdirSync(extractDir, { recursive: true });

  try {
    await extractZip(zipPath, extractDir);
  } catch (err) {
    console.error(`  ✗ Extraction failed: ${err.message}`);
    console.log('  You can manually extract the zip and replace the files.');
    rmSync(tmpDir, { recursive: true });
    process.exit(1);
  }

  // Find the actual extracted folder (might be nested)
  const extractedItems = require('fs').readdirSync(extractDir);
  const sourceDir = extractedItems.length === 1 && require('fs').statSync(join(extractDir, extractedItems[0])).isDirectory()
    ? join(extractDir, extractedItems[0])
    : extractDir;

  // 6. Swap
  console.log('  Installing...');

  // Backup current installation (just key dirs)
  if (existsSync(BACKUP_DIR)) rmSync(BACKUP_DIR, { recursive: true });
  mkdirSync(BACKUP_DIR, { recursive: true });

  const dirsToReplace = ['dist', 'out', 'adapters', 'lib', 'public', 'scripts', 'node_modules'];
  for (const dir of dirsToReplace) {
    const src = join(sourceDir, dir);
    if (existsSync(src)) {
      const dst = join(ROOT, dir);
      if (existsSync(dst)) {
        renameSync(dst, join(BACKUP_DIR, dir));
      }
      renameSync(src, dst);
    }
  }

  // Update package.json
  const newPkg = join(sourceDir, 'package.json');
  if (existsSync(newPkg)) {
    const oldPkg = join(ROOT, 'package.json');
    if (existsSync(oldPkg)) cpSync(oldPkg, join(BACKUP_DIR, 'package.json'));
    cpSync(newPkg, oldPkg);
  }

  // 7. Cleanup
  rmSync(tmpDir, { recursive: true });

  console.log(`  ✓ Updated to v${latest}!`);

  // 8. Suggest restart
  console.log('');
  console.log('  Restart the server to apply the update.');
  console.log('  If running as a service: bridge daemon restart');
  console.log('  If in terminal: Ctrl+C then npm start');
  console.log('');
}

main().catch((err) => {
  console.error(`  ✗ ${err.message}`);
  process.exit(1);
});
