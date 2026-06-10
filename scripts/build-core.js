// ─── Build Core — download helper ──────────────────────
// Core is now a separate product. This script prints download instructions.
//
// Pre-built binaries: https://github.com/PENG1028/sessionbridge-core/releases
// Source:              https://github.com/PENG1028/sessionbridge-core

const { execSync } = require('child_process');
const path = require('path');

// ── Help ─────────────────────────────────────────────────
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
build-core — Download or build Core binary.

Core is maintained in a separate repository:
  https://github.com/PENG1028/sessionbridge-core

To get the Core binary:
  1. Download from releases: https://github.com/PENG1028/sessionbridge-core/releases
  2. Or build from source:
       git clone git@github.com:PENG1028/sessionbridge-core.git
       cd sessionbridge-core
       go build -o sessionnode ./cmd/node/
`);
  process.exit(0);
}

console.log('[build-core] Core is a separate product.');
console.log('  Releases: https://github.com/PENG1028/sessionbridge-core/releases');
console.log('');

// Try to build if sessionbridge-core exists as a sibling directory
const projectRoot = path.resolve(__dirname, '..');
const siblingCoreDir = path.join(projectRoot, '..', 'sessionbridge-core');
const { existsSync, mkdirSync } = require('fs');

if (existsSync(siblingCoreDir)) {
  console.log(`[build-core] Found sibling repo: ${siblingCoreDir}`);
  console.log('[build-core] Building...');
  try {
    execSync('go build -o sessionnode ./cmd/node/', { cwd: siblingCoreDir, stdio: 'inherit' });
    console.log('[build-core] Done.');
  } catch (err) {
    console.error(`[build-core] Build failed: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log('[build-core] Clone Core repo as a sibling to build:');
  console.log(`  cd ${path.join(projectRoot, '..')}`);
  console.log('  git clone git@github.com:PENG1028/sessionbridge-core.git');
  console.log('  cd sessionbridge-core && go build ./cmd/node/');
}
