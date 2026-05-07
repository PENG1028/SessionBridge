#!/usr/bin/env node
// ─── SessionBridge Update Checker ────────────────────────────────
// Checks GitHub for the latest release and compares with current version.
//
// Usage:
//   node scripts/check-update.js              → stdout JSON result
//   node scripts/check-update.js --notify     → human-readable output
//
// Output (JSON):
//   { current, latest, diff, updateUrl, hasUpdate: boolean }

const https = require('https');
const { VERSION } = require('../adapters/version');
const { parseSemver, compareSemver } = require('../adapters/semver');

const GITHUB_REPO = process.env.BRIDGE_REPO || 'sessionbridge/sessionbridge';
const CHECK_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

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

async function main() {
  const isNotify = process.argv.includes('--notify');
  const current = VERSION;

  let result = {
    current,
    latest: current,
    diff: 'same',
    updateUrl: null,
    hasUpdate: false,
    error: null,
  };

  try {
    const release = await fetchJSON(CHECK_URL);
    const latest = release.tag_name?.replace(/^v/, '') || current;
    const curSem = parseSemver(current);
    const latSem = parseSemver(latest);

    result.latest = latest;
    result.updateUrl = release.html_url || null;

    if (curSem && latSem) {
      const diff = compareSemver(curSem, latSem);
      result.diff = diff;
      result.hasUpdate = diff !== 'same';
    }

    if (isNotify) {
      if (result.hasUpdate) {
        const diffLabels = { major: '⚠ Major', minor: '↑ Minor', patch: '↕ Patch' };
        console.log(`\n  ${diffLabels[result.diff] || 'Update'} available:`);
        console.log(`    ${current} → ${latest}`);
        console.log(`    ${result.updateUrl}`);
        console.log(`    Run: bridge update\n`);
      } else {
        console.log(`  ✓ v${current} is up to date.`);
      }
      return;
    }

    console.log(JSON.stringify(result));
  } catch (err) {
    result.error = err.message;
    if (isNotify) {
      console.log(`  - Update check failed: ${err.message}`);
      return;
    }
    console.log(JSON.stringify(result));
  }
}

main();
