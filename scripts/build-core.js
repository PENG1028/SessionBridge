// ─── Build Go Core ──────────────────────────────────────
// Builds the Go Core binary into dist/go-core/.
// Usage: node scripts/build-core.js

const { execSync } = require('child_process');
const { existsSync, mkdirSync } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'dist', 'go-core');
const goCmdDir = path.join(projectRoot, 'go-core', 'cmd', 'node');
const binaryName = process.platform === 'win32' ? 'sessionnode.exe' : 'sessionnode';
const outPath = path.join(outDir, binaryName);

// Ensure output directory exists
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

// Check Go availability
try {
  execSync('go version', { stdio: 'pipe' });
} catch {
  console.error('Go is required to build Go Core. Install Go (https://go.dev/dl/) or add it to PATH.');
  process.exit(1);
}

// Clean previous binary so a broken build doesn't leave a stale file
try {
  const { unlinkSync: rm } = require('fs');
  if (existsSync(outPath)) rm(outPath);
} catch {}

console.log(`[build-core] Building Go Core...`);
console.log(`  Source: ${goCmdDir}`);
console.log(`  Output: ${outPath}`);

try {
  execSync(`go build -o "${outPath}" ./go-core/cmd/node`, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, GO111MODULE: 'on' },
  });
  console.log(`[build-core] Done — ${outPath}`);
} catch (err) {
  console.error(`[build-core] Build failed: ${err.message}`);
  process.exit(1);
}
