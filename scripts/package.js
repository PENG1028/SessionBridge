// ─── SessionBridge Portable Package Script ───────────────────────
// Builds everything and creates a portable `dist/sessionbridge/` folder.
// Contents can be zipped and run on any machine with Node.js >= 18.
//
// Usage:  node scripts/package.js
// Output: dist/sessionbridge/  (portable app)
//         dist/sessionbridge-v0.6.0.zip  (optional, if zip tool available)

const { execSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync } = require('fs');
const { join, relative } = require('path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'dist', 'sessionbridge');
const PACKAGE_JSON = join(ROOT, 'package.json');

console.log('');
console.log('  ╔═══════════════════════════════════════╗');
console.log('  ║  SessionBridge Portable Package       ║');
console.log('  ╚═══════════════════════════════════════╝');
console.log('');

// ─── 1. Build frontend ─────────────────────────
console.log('  [1/4] Building frontend (next build)...');
execSync('npx next build', { cwd: ROOT, stdio: 'pipe' });

// ─── 2. Create portable folder ─────────────────
console.log('  [2/3] Assembling portable package...');

// Clean previous output
if (existsSync(OUT)) rmSync(OUT, { recursive: true });

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));

// Collect runtime dependencies (production only)
const runtimeDeps = new Set([
  ...Object.keys(pkg.dependencies || {}),
  // Core runtime modules that need to be explicitly included
  'next', 'react', 'react-dom',
]);

// Copy files needed at runtime
mkdirSync(join(OUT, 'dist'));
cpSync(join(ROOT, 'dist'), join(OUT, 'dist'), { recursive: true });       // Server build
cpSync(join(ROOT, 'out'), join(OUT, 'out'), { recursive: true });         // Frontend (static export)
cpSync(join(ROOT, 'adapters'), join(OUT, 'adapters'), { recursive: true }); // Adapter source (loaded at runtime)
cpSync(join(ROOT, 'lib'), join(OUT, 'lib'), { recursive: true });         // Client libs
cpSync(join(ROOT, 'public'), join(OUT, 'public'), { recursive: true });   // Static assets

// Copy node_modules (production only)
// This uses npm ls to find all production deps, or just copies node_modules minus devDeps
const nmSrc = join(ROOT, 'node_modules');
const nmDst = join(OUT, 'node_modules');
if (!existsSync(nmDst)) mkdirSync(nmDst, { recursive: true });

// Copy only what's needed — the server runtime + next
const neededModules = new Set([
  // Server runtime
  'ws', 'react', 'react-dom', 'next', 'styled-jsx', 'zod', 'caniuse-lite',
  // Next.js peer deps
  'postcss', 'autoprefixer', 'tailwindcss', 'lucide-react',
  'react-markdown', 'remark-gfm', '@xterm/xterm', '@xterm/addon-fit',
  // Framework deps
  'next/dist', 'next/link', 'next/router', 'next/navigation',
]);

// Simpler approach: copy the full node_modules and prune dev deps
// Using npm's --omit=dev approach

// Actually the most reliable approach is to let npm handle it
console.log('  ... installing production dependencies');
execSync(`npm ci --omit=dev --prefix "${OUT}" 2> nul || true`, { cwd: ROOT, stdio: 'pipe' });

// If npm --prefix fails, manually copy node_modules (Windows compatibility)
if (!existsSync(join(OUT, 'node_modules', 'ws'))) {
  console.log('  ... copying node_modules (fallback)');
  // Copy key runtime deps
  const keep = ['ws', 'next', 'react', 'react-dom', 'styled-jsz', 'lucide-react',
    'react-markdown', 'remark-gfm', 'zod', 'caniuse-lite',
    '@xterm/xterm', '@xterm/addon-fit'];
  for (const mod of keep) {
    const src = join(nmSrc, mod);
    if (existsSync(src)) {
      cpSync(src, join(nmDst, mod), { recursive: true });
    }
  }
}

// Copy package.json (for version info)
const portablePkg = {
  name: 'sessionbridge',
  version: pkg.version,
  private: true,
  scripts: { start: 'node bin/bridge.js' },
};
writeFileSync(join(OUT, 'package.json'), JSON.stringify(portablePkg, null, 2));

// Copy launcher scripts
const batSrc = join(__dirname, '..', 'SessionBridge.bat');
if (existsSync(batSrc)) cpSync(batSrc, join(OUT, 'SessionBridge.bat'));
const shSrc = join(__dirname, '..', 'SessionBridge.sh');
if (existsSync(shSrc)) cpSync(shSrc, join(OUT, 'SessionBridge.sh'));

// ─── 4. Write a start.json with metadata ────────
writeFileSync(join(OUT, '.bridge-info'), JSON.stringify({
  version: pkg.version,
  builtAt: new Date().toISOString(),
  nodeRequired: '>=18',
}, null, 2));

console.log('  [3/3] Done!');
console.log('');
console.log(`  📦  ${OUT}`);
console.log('');
console.log('  To run:');
console.log('    cd dist/sessionbridge');
console.log('    node bin/bridge.js');
console.log('  Or just double-click SessionBridge.bat');
console.log('');
