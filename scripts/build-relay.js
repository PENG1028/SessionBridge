// ─── Relay Server pkg Build Script ──────────────────────────────
// Compiles the Node.js relay server into a standalone binary.
// Output: dist/relay-server/  (one binary per platform)
//
// Usage:
//   node scripts/build-relay.js               # Build for current platform
//   node scripts/build-relay.js --all          # Build for all platforms
//   node scripts/build-relay.js --platform win # Build for Windows only
//
// Prerequisites:
//   npm install -g @yao-pkg/pkg
//   or: npx @yao-pkg/pkg ...
//
// The output binary is consumed by:
//   - Flutter desktop: bundled as asset, spawned via Process.start()
//   - Flutter mobile:  uses nodejs-mobile instead (separate config)

const { execSync } = require('child_process');
const { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } = require('fs');
const { join, dirname } = require('path');

const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const RELAY_OUT = join(DIST, 'relay-server');
const PKG_JSON = join(ROOT, 'package.json');

const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf-8'));
const version = pkg.version;

// Platform targets for pkg
const TARGETS = {
  win: 'node22-win-x64',
  mac: 'node22-macos-x64',
  macArm: 'node22-macos-arm64',
  linux: 'node22-linux-x64',
};

function getName(target) {
  const map = {
    'node22-win-x64': `sessionbridge-relay-v${version}-win-x64.exe`,
    'node22-macos-x64': `sessionbridge-relay-v${version}-mac-x64`,
    'node22-macos-arm64': `sessionbridge-relay-v${version}-mac-arm64`,
    'node22-linux-x64': `sessionbridge-relay-v${version}-linux-x64`,
  };
  return map[target] || `sessionbridge-relay-${target}`;
}

function build(target) {
  console.log(`\n  Building for ${target}...`);
  const outName = getName(target);
  const outPath = join(RELAY_OUT, outName);

  if (!existsSync(RELAY_OUT)) mkdirSync(RELAY_OUT, { recursive: true });

  // Step 1: Build TypeScript
  console.log('    → Compiling TypeScript...');
  execSync('npx tsc -p tsconfig.server.json', { cwd: ROOT, stdio: 'pipe' });

  // Step 2: Compile with pkg
  console.log(`    → Running pkg (target: ${target})...`);
  try {
    execSync(
      `npx @yao-pkg/pkg dist/src/index.js --target ${target} --output "${outPath}"`,
      { cwd: ROOT, stdio: 'pipe', timeout: 120000 },
    );
    console.log(`    ✓ ${outName}`);
  } catch (err) {
    console.error(`    ✗ Failed: ${err.message}`);
    return false;
  }
  return true;
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const buildAll = args.includes('--all');

  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║  SessionBridge Relay Binary Build     ║');
  console.log(`  ║  v${version.padEnd(35)}║`);
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');

  // Determine which targets to build
  let targets = [];
  const platformArg = args.find(a => a.startsWith('--platform='));
  if (platformArg) {
    const plat = platformArg.split('=')[1];
    if (TARGETS[plat]) {
      targets = [TARGETS[plat]];
    } else {
      console.error(`  Unknown platform: ${plat}. Options: win, mac, macArm, linux`);
      process.exit(1);
    }
  } else if (buildAll) {
    targets = Object.values(TARGETS);
  } else {
    // Auto-detect current platform
    const plat = process.platform;
    if (plat === 'win32') targets = [TARGETS.win];
    else if (plat === 'darwin') {
      const arch = process.arch;
      targets = [arch === 'arm64' ? TARGETS.macArm : TARGETS.mac];
    } else if (plat === 'linux') targets = [TARGETS.linux];
    else {
      console.error(`  Unsupported platform: ${plat}`);
      process.exit(1);
    }
  }

  let success = 0;
  let fail = 0;
  for (const t of targets) {
    if (build(t)) success++;
    else fail++;
  }

  console.log('');
  console.log(`  Done: ${success} built, ${fail} failed`);
  console.log(`  Output: ${RELAY_OUT}`);
  console.log('');
}

main().catch(err => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
