/**
 * check-hardcodes.js — CI gate for hardcoded plugin patterns.
 *
 * Usage: node scripts/check-hardcodes.js
 *        npm run check:hardcodes
 *
 * Each check MUST pass with zero violations on a clean main branch.
 * If you need to add an exception, add an explicit allowlist entry below.
 *
 * Checks:
 *   A — No local icon maps (ICON_MAP / iconMap) outside shared registry
 *   B — No Dashboard-specific hardcoded entry points
 *   C — registerPanelComponent IDs must have a matching plugin.yaml panel declaration
 *   D — Warn: registered view IDs without plugin.yaml declarations
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/** Convert a Windows path to Unix-style for shell commands. */
function shPath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1');
}

const ROOT = path.resolve(__dirname, '..');
let errors = 0;
let warnings = 0;

function err(msg, file, line) {
  console.error(`  ❌ ${msg}${file ? ` — ${file}${line ? `:${line}` : ''}` : ''}`);
  errors++;
}

function warn(msg, file, line) {
  console.warn(`  ⚠️  ${msg}${file ? ` — ${file}${line ? `:${line}` : ''}` : ''}`);
  warnings++;
}

// ── Helper: grep-like file scanner ────────────────────────────

function grep(pattern, dirs, excludePatterns = []) {
  const dirList = Array.isArray(dirs) ? dirs : [dirs];
  const results = [];
  for (const dir of dirList) {
    const absDir = path.resolve(ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    try {
      const out = execSync(
        `grep -r "${pattern}" "${shPath(absDir)}" --include='*.ts' --include='*.tsx' 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] },
      );
      for (const line of out.split('\n').filter(Boolean)) {
        const skip = excludePatterns.some(ep => line.includes(ep));
        if (!skip) results.push(line);
      }
    } catch {
      // grep exits 1 when no match — ignore
    }
  }
  return results;
}

function grepFiles(dir) {
  const absDir = path.resolve(ROOT, dir);
  if (!fs.existsSync(absDir)) return [];
  return execSync(
    `find "${shPath(absDir)}" -type f \\( -name '*.ts' -o -name '*.tsx' \\) 2>/dev/null`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  ).split('\n').filter(Boolean);
}

// ──────────────────────────────────────────────────────────────
// Check A — No local icon maps outside shared/icon-registry
// ──────────────────────────────────────────────────────────────

console.log('\n── Check A: No local icon maps ──');

const iconMapFiles = grep(
  'const (ICON_MAP|iconMap)\\b',
  ['app/console'],
  ['toast-container.tsx', 'icon-registry.ts', 'node_modules'],
);

if (iconMapFiles.length === 0) {
  console.log('  ✅ No local icon maps found');
} else {
  for (const match of iconMapFiles) {
    const [file, line, ...rest] = match.split(':');
    err(`Local icon map found (use shared/icon-registry.ts instead)`, file, line);
  }
}

// ──────────────────────────────────────────────────────────────
// Check B — No Dashboard-specific hardcoded entry points
// ──────────────────────────────────────────────────────────────

console.log('\n── Check B: No Dashboard hardcoded entry points ──');

const dashboardPatterns = [
  'onToggleDashboard',
  'onSelectSystemView\\(.dashboard.\\)',
  '\"host\\.dashboard\\.open\"',
  '\"layout-dashboard\"',
];

for (const pattern of dashboardPatterns) {
  const matches = grep(pattern, ['app/console/shell', 'app/console/actions']);

  // Exclude surface-registry.ts which has this in comments/strings
  // Also exclude icon-registry.ts which defines it as a mapping entry
  const filtered = matches.filter(m => {
    const isIconRegistry = m.includes('icon-registry.ts');
    const isComment = m.match(/\/\//) || m.match(/\/\*/);
    return !isIconRegistry && !isComment;
  });

  if (filtered.length === 0) continue;
  for (const match of filtered) {
    const [file, line, ...rest] = match.split(':');
    err(`Dashboard hardcoded reference`, file, line);
  }
}

if (errors === 0 || (() => {
  // If no errors from this check specifically, the above loop just didn't find anything
  return true;
})()) {
  // Check if there were actual errors from dashboard patterns
  const allMatches = [];
  for (const pattern of dashboardPatterns) {
    allMatches.push(...grep(pattern, ['app/console/shell', 'app/console/actions']));
  }
  // No need to re-report, the per-pattern loop already did
}

// Also check the specific onSelectSystemView pattern in instance-tab-bar (should be gone)
const instanceTabBarDashboard = grep(
  'onSelectSystemView',
  ['app/console/main'],
  [],
);
if (instanceTabBarDashboard.length > 0) {
  for (const match of instanceTabBarDashboard) {
    const [file, line] = match.split(':');
    err(`onSelectSystemView still exists (should be dead code)`, file, line);
  }
} else {
  console.log('  ✅ No Dashboard hardcoded entry points found');
}

// ──────────────────────────────────────────────────────────────
// Check C — All registerPanelComponent IDs must have a matching
//           panel declaration in some plugin.yaml
// ──────────────────────────────────────────────────────────────

console.log('\n── Check C: Panel component registrations ↔ YAML declarations ──');

// Read all panel IDs from plugin YAML files (handled by parseYamlPanelIds below)

function parseYamlPanelIds() {
  const ids = new Set();
  const yamlDir = path.join(ROOT, 'plugins');
  if (!fs.existsSync(yamlDir)) return ids;
  for (const pluginDir of fs.readdirSync(yamlDir)) {
    const yamlPath = path.join(yamlDir, pluginDir, 'plugin.yaml');
    if (!fs.existsSync(yamlPath)) continue;
    const content = fs.readFileSync(yamlPath, 'utf-8');
    const lines = content.split('\n');
    let panelsIndent = 0; // indent level of the `panels:` line (0 = not found)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Find the panels: section header and record its indentation
      const panelsMatch = line.match(/^(\s*)panels:/);
      if (panelsMatch && panelsMatch[1].length >= 2) {
        panelsIndent = panelsMatch[1].length;
        continue;
      }
      // Inside panels section: read - id: entries until a line at ≤ panelsIndent
      if (panelsIndent > 0) {
        const leadSpace = line.match(/^(\s*)\S/);
        const indent = leadSpace ? leadSpace[1].length : 0;
        // Empty line — skip
        if (line.trim() === '') continue;
        // Line at same or lesser indent as `panels:` → section ended
        if (indent <= panelsIndent && line.trim().startsWith('panels:') === false) {
          // Section ended — but don't exit on continuation lines starting with #
          if (line.trim().startsWith('#')) continue;
          panelsIndent = 0;
          continue;
        }
        // Line is a panel entry with id:
        const m = line.match(/^\s*-\s*id:\s*['"]?([a-zA-Z0-9_.-]+)['"]?\s*$/);
        if (m) ids.add(m[1]);
      }
    }
  }
  return ids;
}

const yamlIds = parseYamlPanelIds();
const regFile = path.join(ROOT, 'app', 'console', 'panels', 'register-panel-components.ts');
const regContent = fs.readFileSync(regFile, 'utf-8');
const regIds = [];
for (const line of regContent.split('\n')) {
  const m = line.match(/registerPanelComponent\s*\(\s*['"]([^'"]+)['"]/);
  if (m) regIds.push(m[1]);
}

let allMatched = true;
for (const id of regIds) {
  if (!yamlIds.has(id)) {
    err(`Panel component '${id}' registered but no matching plugin.yaml panel declaration`, 'register-panel-components.ts');
    allMatched = false;
  }
}
if (allMatched) {
  console.log(`  ✅ All ${regIds.length} registered panel components have matching YAML declarations`);
}

// Check for YAML panels without component registrations
for (const id of yamlIds) {
  if (!regIds.includes(id)) {
    warn(`Plugin panel '${id}' declared in YAML but no component override registered`, 'plugin.yaml');
  }
}

// ──────────────────────────────────────────────────────────────
// Check D — Core view registrations without plugin.yaml
// ──────────────────────────────────────────────────────────────

console.log('\n── Check D: Core view registrations (non-plugin) ──');

const coreViews = ['logs', 'agent-monitor'];
for (const viewId of coreViews) {
  warn(`Core view '${viewId}' registered without plugin.yaml declaration`, 'register-core-views.ts');
}

// Also check if any view IDs from plugin YAML views: are registered
const yamlViewIds = new Set();
for (const pluginDir of fs.readdirSync(path.join(ROOT, 'plugins'))) {
  const yamlPath = path.join(ROOT, 'plugins', pluginDir, 'plugin.yaml');
  if (!fs.existsSync(yamlPath)) continue;
  const content = fs.readFileSync(yamlPath, 'utf-8');
  let inViewsSection = false;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{2,}views:/.test(line)) { inViewsSection = true; continue; }
    if (inViewsSection) {
      if (/^\s{2,}(panels:|core:)/.test(line)) { inViewsSection = false; continue; }
      const m = line.match(/^\s*-\s*id:\s*['"]?([a-zA-Z0-9_.-]+)['"]?\s*$/);
      if (m) yamlViewIds.add(m[1]);
    }
  }
}

console.log(`  ℹ️  Plugin-declared views: ${[...yamlViewIds].join(', ') || '(none)'}`);

// ──────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
if (errors > 0 || warnings > 0) {
  console.log(`  ${errors} error(s), ${warnings} warning(s)`);
  if (errors > 0) {
    console.log('  ❌ FAIL — fix errors before merging');
    process.exit(1);
  } else {
    console.log('  ⚠️  PASS with warnings — review before merging');
  }
} else {
  console.log('  ✅ All checks passed');
}
console.log('═══════════════════════════════════════\n');
