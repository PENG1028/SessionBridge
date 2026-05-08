// ─── Flutter App Build Script ────────────────────────────────────
// Orchestrates building the Flutter client for all platforms.
// Steps:
//   1. Build relay server binary (pkg)
//   2. Copy relay binary to Flutter app assets
//   3. Run flutter build for target platform
//
// Usage:
//   node scripts/build-flutter.js               # Build Flutter for current platform
//   node scripts/build-flutter.js --platform android
//   node scripts/build-flutter.js --platform windows
//   node scripts/build-flutter.js --all
//
// Prerequisites:
//   - Flutter SDK installed
//   - For desktop: `flutter config --enable-windows-desktop` etc.

const { execSync } = require('child_process');
const { existsSync, mkdirSync, copyFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const FLUTTER_APP = join(ROOT, 'flutter_app');
const RELAY_BINARY_DIR = join(ROOT, 'dist', 'relay-server');
const FLUTTER_ASSETS = join(FLUTTER_APP, 'assets');
const FLUTTER_RELAY_DIR = join(FLUTTER_ASSETS, 'relay');

const PLATFORMS = ['android', 'ios', 'windows', 'macos', 'linux'];

function getRelayBinaryName(platform) {
  const map = {
    android: 'relay-server-arm64',
    ios: 'relay-server-arm64',
    windows: 'relay-server.exe',
    macos: 'relay-server-macos-arm64',
    linux: 'relay-server-linux-x64',
  };
  return map[platform] || 'relay-server';
}

function buildFlutter(platform) {
  console.log(`\n  Building Flutter for ${platform}...`);

  // Step 1: Ensure relay binary exists
  const binaryName = getRelayBinaryName(platform);
  const binarySrc = join(RELAY_BINARY_DIR, binaryName);
  if (!existsSync(binarySrc)) {
    console.log(`    → Relay binary not found at ${binarySrc}`);
    console.log(`    → Run "node scripts/build-relay.js" first`);
    return false;
  }

  // Step 2: Copy to Flutter assets
  if (!existsSync(FLUTTER_RELAY_DIR)) mkdirSync(FLUTTER_RELAY_DIR, { recursive: true });
  copyFileSync(binarySrc, join(FLUTTER_RELAY_DIR, binaryName));
  console.log(`    → Relay binary copied to assets/relay/`);

  // Step 3: Run Flutter build
  const buildCmd = {
    android: 'flutter build apk --release',
    ios: 'flutter build ios --release',
    windows: 'flutter build windows --release',
    macos: 'flutter build macos --release',
    linux: 'flutter build linux --release',
  }[platform];

  if (!buildCmd) {
    console.error(`    ✗ Unknown platform: ${platform}`);
    return false;
  }

  try {
    execSync(buildCmd, { cwd: FLUTTER_APP, stdio: 'inherit', timeout: 600000 });
  } catch (err) {
    console.error(`    ✗ Flutter build failed: ${err.message}`);
    return false;
  }

  console.log(`    ✓ Flutter ${platform} build succeeded`);
  return true;
}

// ─── Main ───────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const buildAll = args.includes('--all');

  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║  SessionBridge Flutter Build           ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');

  let platforms = [];
  const platformArg = args.find(a => a.startsWith('--platform='));
  if (platformArg) {
    platforms = [platformArg.split('=')[1]];
  } else if (buildAll) {
    platforms = PLATFORMS;
  } else {
    // Auto-detect
    const plat = process.platform;
    if (plat === 'win32') platforms = ['windows'];
    else if (plat === 'darwin') platforms = ['macos'];
    else if (plat === 'linux') platforms = ['linux'];
    else platforms = ['android'];
  }

  let success = 0;
  let fail = 0;
  for (const p of platforms) {
    if (buildFlutter(p)) success++;
    else fail++;
  }

  console.log('');
  console.log(`  Done: ${success} built, ${fail} failed`);
  console.log('');
}

main();
