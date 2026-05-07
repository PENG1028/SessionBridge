// ─── Extension Loader ─────────────────────────────────────────────
// Scans extension directories for sb-extension.json manifests,
// dynamically imports the main entry point, and registers adapters.
//
// Supports two module formats:
//   1. New (VS Code-like): exports activate(context) => AgentAdapter
//   2. Legacy: exports a singleton adapter instance (const foo = new X)

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { homedir } from 'os';
import { adapterRegistry } from '../registry';
import { ExtensionContextImpl } from './extension-context';
import { extensionPoints } from './extension-points';
import type {
  AgentAdapter, ExtensionManifest, ExtensionMode,
  AgentCapabilityHost, RuntimeInfo,
} from '../types';

export interface LoaderOptions {
  /** Extension directories to scan (auto-includes defaults). */
  extraPaths?: string[];
  /** Extension mode (production or development). */
  mode?: ExtensionMode;
  /** Only load these extension IDs (empty = load all). */
  filter?: string[];
  /** Capability host for extensions that need it. */
  capabilityHost?: AgentCapabilityHost;
  /** Logger override. */
  log?: (msg: string) => void;
}

function logDefault(msg: string): void { console.log(`[ext-loader] ${msg}`); }

// ─── Scan Paths ──────────────────────────────────────────────────

function getScanPaths(options: LoaderOptions): string[] {
  const paths: string[] = [];

  // 1. Built-in adapters directory (project adapters/)
  // Handles tsx dev mode (__dirname = adapters/agent-core/) and
  // compiled dist mode (__dirname = dist/adapters/agent-core/)
  const projectAdapters = resolve(__dirname, '..');
  if (existsSync(projectAdapters)) {
    // Verify it actually contains manifests (not compiled dist/)
    const probe = join(projectAdapters, 'claude-code', 'sb-extension.json');
    if (existsSync(probe)) {
      paths.push(projectAdapters);
    }
  }

  // 1b. Fallback for compiled dist/: look for source adapters/ at project root
  const srcAdapters = resolve(__dirname, '..', '..', '..', 'adapters');
  if (srcAdapters !== projectAdapters && existsSync(srcAdapters)) {
    const probe = join(srcAdapters, 'claude-code', 'sb-extension.json');
    if (existsSync(probe)) paths.push(srcAdapters);
  }

  // 2. User-installed extensions directory
  const userExtDir = join(homedir(), '.sessionbridge', 'extensions');
  if (existsSync(userExtDir)) paths.push(userExtDir);

  // 3. Environment variable override
  if (process.env.BRIDGE_EXTENSIONS_PATH) {
    for (const p of process.env.BRIDGE_EXTENSIONS_PATH.split(';').filter(Boolean)) {
      if (existsSync(p)) paths.push(resolve(p));
    }
  }

  // 4. Custom paths from options
  if (options.extraPaths) {
    for (const p of options.extraPaths) {
      const resolved = resolve(p);
      if (existsSync(resolved)) paths.push(resolved);
    }
  }

  return paths;
}

// ─── Manifest Discovery ──────────────────────────────────────────

interface ManifestEntry {
  manifest: ExtensionManifest;
  /** Absolute directory containing the manifest. */
  dir: string;
  /** Parsed engines field, or null. */
  engineVersion: string | null;
}

function discoverManifests(paths: string[]): ManifestEntry[] {
  const entries: ManifestEntry[] = [];

  for (const basePath of paths) {
    // A directory either IS an extension (has sb-extension.json itself)
    // or CONTAINS extension subdirectories
    const selfManifest = join(basePath, 'sb-extension.json');
    if (existsSync(selfManifest)) {
      const entry = loadManifest(selfManifest, basePath);
      if (entry) entries.push(entry);
      continue;
    }

    // Check subdirectories
    let subdirs: string[];
    try { subdirs = readdirSync(basePath).filter(d => statSync(join(basePath, d)).isDirectory()); }
    catch { continue; }

    for (const subdir of subdirs) {
      const manifestPath = join(basePath, subdir, 'sb-extension.json');
      if (existsSync(manifestPath)) {
        const entry = loadManifest(manifestPath, join(basePath, subdir));
        if (entry) entries.push(entry);
      }
    }
  }

  return entries;
}

function loadManifest(manifestPath: string, dir: string): ManifestEntry | null {
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as ExtensionManifest;

    // Validate required fields
    if (!manifest.id || !manifest.displayName || !manifest.main) {
      console.warn(`[ext-loader] Invalid manifest in ${dir}: missing id/displayName/main`);
      return null;
    }

    const engineVersion = manifest.engines?.sessionbridge ?? null;
    return { manifest, dir, engineVersion };
  } catch (err) {
    console.warn(`[ext-loader] Failed to load manifest at ${manifestPath}:`, err);
    return null;
  }
}

// ─── Dynamic Module Loading ──────────────────────────────────────

async function importModule(manifest: ExtensionManifest, extDir: string): Promise<Record<string, unknown>> {
  const mainPath = resolve(extDir, manifest.main);

  // Try direct import first (works for compiled .js and .ts via tsx)
  try {
    return await import(mainPath);
  } catch (err1) {
    // Fallback #1: if extDir is source adapters/, try dist/adapters/ equivalent
    // (handles running compiled code from dist/ while manifests are in source adapters/)
    const extParent = dirname(extDir);     // e.g. /project/adapters/
    const extName = basename(extDir);       // e.g. claude-code
    const distExtDir = resolve(extParent, '..', 'dist', 'adapters', extName);
    if (existsSync(distExtDir)) {
      const distMainPath = resolve(distExtDir, manifest.main);
      try {
        return await import(distMainPath);
      } catch {}
    }

    // Fallback #2: try index.ts in the extension directory
    const tsPath = resolve(extDir, 'index.ts');
    if (tsPath !== mainPath && existsSync(tsPath)) {
      try {
        return await import(tsPath);
      } catch (err2) {
        throw new Error(`Cannot load extension "${manifest.id}": ${(err1 as Error).message}; fallback also failed: ${(err2 as Error).message}`);
      }
    }
    throw new Error(`Cannot load extension "${manifest.id}": ${(err1 as Error).message}`);
  }
}

function resolveAdapter(module: Record<string, unknown>, manifest: ExtensionManifest): AgentAdapter | null {
  // 1. New-style: module exports activate(context) => AgentAdapter
  if (typeof module.activate === 'function') {
    return null; // activate will be called separately with context
  }

  // 2. Legacy: look for exported singleton instances
  const knownNames = [
    // PascalCase ID convention: "claude-code" → "claudeCodeAdapter"
    `${manifest.id.replace(/-([a-z])/g, (_, c) => (c as string).toUpperCase())}Adapter`,
    // camelCase ID: "shell" → "shellAdapter"
    `${manifest.id.replace(/-([a-z])/g, (_, c) => (c as string).toUpperCase())}Adapter`,
    // Direct ID attempt
    `${manifest.id}Adapter`,
  ];

  // Also check 'default' export
  if (module.default && typeof (module.default as any)?.id === 'string') {
    return module.default as AgentAdapter;
  }

  for (const name of knownNames) {
    if (module[name] && typeof (module[name] as any)?.id === 'string') {
      return module[name] as AgentAdapter;
    }
  }

  // 3. Last resort: find any export that looks like an AgentAdapter
  for (const [key, value] of Object.entries(module)) {
    if (
      key !== 'default' &&
      typeof value === 'object' &&
      value !== null &&
      typeof (value as any).id === 'string' &&
      typeof (value as any).start === 'function'
    ) {
      return value as AgentAdapter;
    }
  }

  return null;
}

// ─── Extension Lifecycle ─────────────────────────────────────────

export interface ActivatedExtension {
  manifest: ExtensionManifest;
  adapter: AgentAdapter;
  context: ExtensionContextImpl;
  activateTime: number;
}

/**
 * Scan all extension paths, discover manifests, load and activate
 * extensions. Returns the list of successfully activated adapters.
 */
export async function scanAndActivate(options: LoaderOptions = {}): Promise<ActivatedExtension[]> {
  const log = options.log ?? logDefault;
  const paths = getScanPaths(options);
  const manifests = discoverManifests(paths);

  log(`Found ${manifests.length} extension manifest(s) in ${paths.length} path(s)`);

  const activated: ActivatedExtension[] = [];

  for (const entry of manifests) {
    try {
      // Filter check
      if (options.filter && options.filter.length > 0 && !options.filter.includes(entry.manifest.id)) {
        log(`  Skipping "${entry.manifest.id}" (not in filter)`);
        continue;
      }

      // Engine version check
      if (entry.engineVersion) {
        log(`  "${entry.manifest.id}" requires sessionbridge ${entry.engineVersion}`);
      }

      // Activate
      const result = await activateExtension(entry, options);
      if (result) {
        activated.push(result);
        log(`  ✅ "${entry.manifest.id}" v${entry.manifest.version} activated (${result.activateTime}ms)`);
      }
    } catch (err) {
      log(`  ❌ "${entry.manifest.id}" activation failed: ${(err as Error).message}`);
    }
  }

  return activated;
}

async function activateExtension(
  entry: ManifestEntry,
  options: LoaderOptions,
): Promise<ActivatedExtension | null> {
  const { manifest, dir } = entry;
  const module = await importModule(manifest, dir);

  // Create context
  const context = new ExtensionContextImpl({
    id: manifest.id,
    displayName: manifest.displayName,
    extensionPath: dir,
    api: options.capabilityHost ?? createNullCapabilityHost(),
    extensionMode: options.mode ?? 'production',
    logLevel: options.mode === 'development' ? 'verbose' : 'info',
  });

  const startTime = Date.now();

  // New-style: call module.activate(context)
  if (typeof module.activate === 'function') {
    const adapter = await module.activate(context);
    if (!adapter || typeof adapter.id !== 'string') {
      throw new Error(`activate() did not return a valid AgentAdapter`);
    }
    adapterRegistry.registerFromManifest(adapter, manifest);
    extensionPoints.register(adapter.id, manifest);
    const activateTime = Date.now() - startTime;
    return { manifest, adapter, context, activateTime };
  }

  // Legacy-style: find exported singleton
  const adapter = resolveAdapter(module, manifest);
  if (!adapter) {
    throw new Error(`No AgentAdapter export found in module for "${manifest.id}"`);
  }
  adapterRegistry.registerFromManifest(adapter, manifest);
  extensionPoints.register(adapter.id, manifest);
  const activateTime = Date.now() - startTime;
  return { manifest, adapter, context, activateTime };
}

/**
 * Deactivate a previously activated extension — dispose its context.
 */
export function deactivateExtension(id: string, activated: ActivatedExtension[]): void {
  const entry = activated.find(a => a.manifest.id === id);
  if (!entry) return;
  try {
    entry.context.dispose();
  } catch { /* ignore dispose errors */ }
  adapterRegistry.unregister(id);
  extensionPoints.unregister(id);
}

/**
 * Reload all extensions: deactivate all, re-scan, re-activate.
 */
export async function reloadExtensions(options: LoaderOptions = {}): Promise<ActivatedExtension[]> {
  // Clear registry and extension points
  const allIds = adapterRegistry.list().map(a => a.id);
  for (const id of allIds) {
    adapterRegistry.unregister(id);
    extensionPoints.unregister(id);
  }
  return scanAndActivate(options);
}

// ─── Null Capability Host (fallback when no agent runtime) ───────

function createNullCapabilityHost(): AgentCapabilityHost {
  const deny = () => { throw new Error('Capability not available (no agent runtime)'); };
  return {
    fs: { read: deny, write: deny, list: deny, exists: deny, delete: deny },
    process: { spawn: () => { throw new Error('Cannot spawn (no agent runtime)'); }, list: deny, kill: deny },
    terminal: { spawn: () => { throw new Error('No terminal (no agent runtime)'); } },
    permissions: { grants: {} as any, check: () => ({ allowed: false, reason: 'No runtime' }) },
    notifications: { notify: () => {} },
  };
}
