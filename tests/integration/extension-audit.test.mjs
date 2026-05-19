// Extension audit test — E1-E4 from consistency checklist
// Validates manifest correctness, dist completeness, loader errors.
// Pure static test — no relay server needed.
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.error(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

// ── Helper: find all sb-extension.json manifests ──
function findManifests(baseDir, pattern = 'sb-extension.json') {
  const results = [];
  function walk(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          if (statSync(full).isDirectory()) walk(full);
          else if (entry === pattern) results.push(full);
        } catch {}
      }
    } catch {}
  }
  walk(baseDir);
  return results;
}

// ── Helper: read JSON safely ──
function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return null; }
}

console.log('=== Extension Audit Test ===\n');

// ════════════════════════════════════════════════════
// E1: All manifest-declared views have component registrations
// ════════════════════════════════════════════════════
console.log('── E1: Manifest view → component registration ──');

// Read client-index.ts to find registered views
const clientIndexPath = join(ROOT, 'extensions', 'client-index.ts');
let clientIndexSrc = '';
try { clientIndexSrc = readFileSync(clientIndexPath, 'utf-8'); } catch {}

// Read page.tsx for the view registry
const pageTsxPath = join(ROOT, 'app', 'page.tsx');
let pageTsxSrc = '';
try { pageTsxSrc = readFileSync(pageTsxPath, 'utf-8'); } catch {}

// Read view-registry.ts
let viewRegistrySrc = '';
try { viewRegistrySrc = readFileSync(join(ROOT, 'app', 'console', 'main', 'view-registry.ts'), 'utf-8'); } catch {}

const builtinManifests = findManifests(join(ROOT, 'extensions'));
const exampleManifests = findManifests(join(ROOT, 'examples'));
const allManifests = [...builtinManifests, ...exampleManifests];

for (const mp of allManifests) {
  const m = readJSON(mp);
  if (!m) { check(`manifest parse: ${mp}`, false, 'invalid JSON'); continue; }
  const extDir = dirname(mp);
  const relPath = mp.replace(ROOT, '');

  check(`E1.${m.id}: manifest parse OK`, !!m, relPath);

  // Collect declared views
  const views = [
    ...(m.contributes?.views?.sidebarLeft || []),
    ...(m.contributes?.views?.sidebarRight || []),
  ];

  // Check each view has a component reference
  for (const v of views) {
    const viewId = v.id || '?';
    // Views from shell/claude-code are registered in client-index.ts
    // or page.tsx. Check if the view ID appears anywhere.
    const inClientIndex = clientIndexSrc.includes(viewId);
    const inPageTsx = pageTsxSrc.includes(viewId);
    const inViewRegistry = viewRegistrySrc.includes(viewId);
    const registered = inClientIndex || inPageTsx || inViewRegistry;
    if (!registered) {
      // Some views only exist as manifest declarations without client components
      // Only flag as failure if the extension has a real adapter (not contributions-only)
      const isContribOnly = !m.extensionKind?.includes('adapter') && !m.extensionKind?.includes('integration');
      if (!isContribOnly) {
        check(`E1.${m.id}: view "${viewId}" registered`, registered, `in client-index/page/view-registry`);
      }
    }
  }
}

// ════════════════════════════════════════════════════
// E2: adapter kind in manifest matches code reality
// ════════════════════════════════════════════════════
console.log('\n── E2: Manifest extensionKind vs code reality ──');

for (const mp of builtinManifests) {
  const m = readJSON(mp);
  if (!m) continue;
  const extDir = dirname(mp);
  const manifestKinds = m.extensionKind || [];

  // Check if compiled dist file exports activate() or an adapter.
  // The source is .ts; the compiled output is in dist/extensions/<id>/
  let hasActivate = false;
  let hasAdapterExport = false;
  const distMainFile = join(ROOT, 'dist', 'extensions', m.id, m.main || 'index.js');
  const srcMainFile = m.main ? join(extDir, m.main) : null;
  // Try dist first, then source dir
  for (const checkFile of [distMainFile, srcMainFile]) {
    if (checkFile && existsSync(checkFile)) {
      const src = readFileSync(checkFile, 'utf-8');
      // Check for activate function export or adapter class/instance export
      hasActivate = hasActivate || /export.*function activate|export.*activate\s*=|exports\.activate|module\.exports.*activate/.test(src);
      hasAdapterExport = hasAdapterExport || (/Adapter|adapter/i.test(src) && /export|exports\.|module\.exports/.test(src));
      if (hasActivate || hasAdapterExport) break;
    }
  }

  const hasAdapterInCode = hasActivate || hasAdapterExport;
  const declaresAdapter = manifestKinds.includes('adapter') || manifestKinds.includes('integration');

  if (hasAdapterInCode && !declaresAdapter) {
    check(`E2.${m.id}: manifest missing "adapter" kind`, false,
      `code exports adapter but manifest says ${JSON.stringify(manifestKinds)}`);
  } else {
    check(`E2.${m.id}: manifest kinds match code`, true,
      `kinds=${JSON.stringify(manifestKinds)} hasAdapter=${hasAdapterInCode}`);
  }
}

// ════════════════════════════════════════════════════
// E3: dist/extensions/ compilation completeness
// ════════════════════════════════════════════════════
console.log('\n── E3: dist/extensions/ completeness ──');

const distExtDir = join(ROOT, 'dist', 'extensions');
if (!existsSync(distExtDir)) {
  check('E3: dist/extensions/ exists', false, 'run npm run build:server first');
} else {
  for (const mp of builtinManifests) {
    const m = readJSON(mp);
    if (!m) continue;
    const expectedMain = m.main || 'index.js';
    const distMain = join(distExtDir, m.id, expectedMain);
    const distExists = existsSync(distMain);
    const distDir = join(distExtDir, m.id);
    const hasAnyJS = existsSync(distDir) &&
      readdirSync(distDir).some(f => f.endsWith('.js'));

    if (!distExists && !hasAnyJS) {
      // Check if it's a contributions-only (no real main needed)
      const extDir = dirname(mp);
      const mainFile = m.main ? join(extDir, m.main) : null;
      let isEmptyMain = false;
      if (mainFile && existsSync(mainFile)) {
        const src = readFileSync(mainFile, 'utf-8');
        // Empty or comment-only file
        isEmptyMain = src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').trim().length === 0;
        isEmptyMain = isEmptyMain || !/export|activate|adapter/i.test(src);
      }
      if (!isEmptyMain) {
        check(`E3.${m.id}: ${expectedMain} in dist/`, false, `missing ${distMain}`);
      } else {
        check(`E3.${m.id}: ${expectedMain} in dist/`, true, 'contributions-only, no JS needed');
      }
    } else {
      check(`E3.${m.id}: ${expectedMain} in dist/`, true);
    }
  }
}

// ════════════════════════════════════════════════════
// E4: No empty/pointless extensions
// ════════════════════════════════════════════════════
console.log('\n── E4: Empty/pointless extension detection ──');

for (const mp of builtinManifests) {
  const m = readJSON(mp);
  if (!m) continue;
  const extDir = dirname(mp);
  const mainFile = m.main ? join(extDir, m.main) : null;
  const hasViews = (m.contributes?.views?.sidebarLeft?.length || 0) +
    (m.contributes?.views?.sidebarRight?.length || 0) > 0;
  const hasCommands = (m.contributes?.commands?.length || 0) > 0;
  const hasChrome = !!(m.contributes?.chrome);
  const hasConfig = (m.contributes?.configuration?.length || 0) > 0;

  let hasCode = false;
  if (mainFile && existsSync(mainFile)) {
    const src = readFileSync(mainFile, 'utf-8');
    hasCode = src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').trim().length > 20;
    hasCode = hasCode || /export|activate|adapter/i.test(src);
  }

  const totalContributions = (hasViews ? 1 : 0) + (hasCommands ? 1 : 0) +
    (hasChrome ? 1 : 0) + (hasConfig ? 1 : 0);

  if (!hasCode && totalContributions <= 1) {
    check(`E4.${m.id}: has code or >=2 contributions`, false,
      `no code, only ${totalContributions} contribution type(s)`);
  } else {
    check(`E4.${m.id}: has code or >=2 contributions`, true,
      `code=${hasCode} contribs=${totalContributions}`);
  }
}

// ════════════════════════════════════════════════════
// E4b: Check for duplicate extensions (multiple versions)
// ════════════════════════════════════════════════════
console.log('\n── E4b: Duplicate extension IDs ──');

const idCount = new Map();
for (const mp of allManifests) {
  const m = readJSON(mp);
  if (!m) continue;
  idCount.set(m.id, (idCount.get(m.id) || 0) + 1);
}
for (const [id, count] of idCount) {
  check(`E4b: "${id}" appears once`, count === 1, `found ${count} manifest(s)`);
}

// ════════════════════════════════════════════════════
console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
