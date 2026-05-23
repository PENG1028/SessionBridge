// ─── SessionBridge Portable Package Script ───────────────────────
// Builds Go Core + Next.js frontend and creates a portable dist/sessionbridge/ folder.
// Contents can be zipped and run on any machine with Node.js >= 18 and Go.
//
// Usage:  node scripts/package.js
// Output: dist/sessionbridge/  (portable app)
//         dist/sessionbridge-vX.Y.Z.zip  (optional, if zip tool available)
//
// Go Core is the sole runtime. Legacy Node relay has been retired.

const { execSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'dist', 'sessionbridge');
const PACKAGE_JSON = join(ROOT, 'package.json');

console.log('');
console.log('  SessionBridge Portable Package');
console.log('  Go Core + App UI');
console.log('');

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));

// ─── 1. Build ───────────────────────────────────
console.log('  [1/3] Building...');

// Build frontend
try {
  execSync('npm run build:web', { cwd: ROOT, stdio: 'inherit' });
} catch (err) {
  console.error('  Build:web failed. Run npm run build:web manually to diagnose.');
  process.exit(1);
}

// Build Go Core
try {
  execSync('npm run build:core', { cwd: ROOT, stdio: 'inherit' });
} catch (err) {
  console.error('  Build:core failed. Ensure Go >= 1.21 is installed.');
  process.exit(1);
}

// ─── 2. Assemble portable folder ────────────────
console.log('  [2/3] Assembling portable package...');

// Clean previous output
if (existsSync(OUT)) rmSync(OUT, { recursive: true });

// Copy files needed at runtime
const goBinaryName = process.platform === 'win32' ? 'sessionnode.exe' : 'sessionnode';
const goBinarySrc = join(ROOT, 'dist', 'go-core', goBinaryName);

if (!existsSync(goBinarySrc)) {
  console.error(`  Go Core binary not found: ${goBinarySrc}`);
  process.exit(1);
}

mkdirSync(join(OUT, 'bin'), { recursive: true });
cpSync(join(ROOT, 'bin', 'bridge.js'), join(OUT, 'bin', 'bridge.js'));

mkdirSync(join(OUT, 'scripts'), { recursive: true });
cpSync(join(ROOT, 'scripts', 'start-core.js'), join(OUT, 'scripts', 'start-core.js'));
cpSync(join(ROOT, 'scripts', 'check-update.js'), join(OUT, 'scripts', 'check-update.js'));
cpSync(join(ROOT, 'scripts', 'update.js'), join(OUT, 'scripts', 'update.js'));

mkdirSync(join(OUT, 'dist', 'go-core'), { recursive: true });
cpSync(goBinarySrc, join(OUT, 'dist', 'go-core', goBinaryName));

if (existsSync(join(ROOT, 'out'))) {
  cpSync(join(ROOT, 'out'), join(OUT, 'out'), { recursive: true });
}

if (existsSync(join(ROOT, 'public'))) {
  cpSync(join(ROOT, 'public'), join(OUT, 'public'), { recursive: true });
}

if (existsSync(join(ROOT, 'plugins'))) {
  cpSync(join(ROOT, 'plugins'), join(OUT, 'plugins'), { recursive: true });
}

// ─── 3. Install production dependencies ─────────
console.log('  [3/3] Installing production dependencies...');

// Write portable package.json first so npm ci --prefix works
const portablePkg = {
  name: 'sessionbridge',
  version: pkg.version,
  private: true,
  description: pkg.description,
  scripts: {
    start: 'node bin/bridge.js',
    'start:core': 'node scripts/start-core.js',
  },
  dependencies: pkg.dependencies,
};
writeFileSync(join(OUT, 'package.json'), JSON.stringify(portablePkg, null, 2));

// Install production deps into portable directory
try {
  execSync(`npm ci --omit=dev --prefix "${OUT}"`, { cwd: ROOT, stdio: 'pipe' });
} catch {
  // Fallback: copy key runtime modules from local node_modules
  console.log('  ... npm ci failed, copying node_modules (fallback)');
  const nmSrc = join(ROOT, 'node_modules');
  const nmDst = join(OUT, 'node_modules');
  if (!existsSync(nmDst)) mkdirSync(nmDst, { recursive: true });
  const keep = ['ws', 'next', 'react', 'react-dom', 'lucide-react',
    'react-markdown', 'remark-gfm',
    '@xterm/xterm', '@xterm/addon-fit'];
  for (const mod of keep) {
    const src = join(nmSrc, mod);
    if (existsSync(src)) {
      cpSync(src, join(nmDst, mod), { recursive: true });
    }
  }
}

// Write version metadata
writeFileSync(join(OUT, '.bridge-info'), JSON.stringify({
  version: pkg.version,
  builtAt: new Date().toISOString(),
  runtime: 'Go Core',
  nodeRequired: '>=18',
}, null, 2));

// ─── Done ───────────────────────────────────────
console.log('');
console.log(`  Package: ${OUT}`);
console.log('');
console.log('  To run:');
console.log('    cd dist/sessionbridge');
console.log('    node bin/bridge.js');
console.log('');
