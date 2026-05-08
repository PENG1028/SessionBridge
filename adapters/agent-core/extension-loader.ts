// ─── Extension Loader ─────────────────────────────────────────────
// Scans extension directories for sb-extension.json manifests,
// dynamically imports the main entry point, and activates extensions.
//
// Supports two activation patterns:
//   1. New (VS Code-like): exports activate(context) => AgentAdapter | void
//   2. Legacy: exports a singleton adapter instance (const foo = new X)
//
// Extensions may return an AgentAdapter (for runtime capabilities) or
// contribute only manifest-level declarations (commands, menus, views, etc.).

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';
import { adapterRegistry } from '../registry';
import { ExtensionContextImpl } from './extension-context';
import { extensionPoints } from './extension-points';
import type {
  AgentAdapter, ExtensionManifest, ExtensionMode, ExtensionStatus, ExtensionDiagnostic,
  AgentCapabilityHost,
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

export interface LoaderResult {
  activated: ActivatedExtension[];
  diagnostics: ExtensionDiagnostic[];
}

function logDefault(msg: string): void { console.log(`[ext-loader] ${msg}`); }

// ─── Scan Paths ──────────────────────────────────────────────────

function getScanPaths(options: LoaderOptions): string[] {
  const paths: string[] = [];

  // Helper: check if path contains at least one extension manifest subdirectory.
  function hasManifestSubdir(dir: string): boolean {
    try {
      return readdirSync(dir).some(d =>
        statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, 'sb-extension.json'))
      );
    } catch { return false; }
  }

  // 1. Built-in adapters directory (project adapters/)
  // Handles tsx dev mode (__dirname = adapters/agent-core/) and
  // compiled dist mode (__dirname = dist/adapters/agent-core/)
  const projectAdapters = resolve(__dirname, '..');
  if (existsSync(projectAdapters) && hasManifestSubdir(projectAdapters)) {
    paths.push(projectAdapters);
  }

  // 1b. Fallback for compiled dist/: look for source adapters/ at project root
  const srcAdapters = resolve(__dirname, '..', '..', '..', 'adapters');
  if (srcAdapters !== projectAdapters && existsSync(srcAdapters) && hasManifestSubdir(srcAdapters)) {
    paths.push(srcAdapters);
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

// ─── Manifest Validation ─────────────────────────────────────────

/**
 * Validate an extension manifest structure.
 * Returns an array of error messages (empty = valid).
 * Non-fatal warnings are prefixed with "[WARN]".
 */
export function validateManifest(manifest: Record<string, unknown>, dir: string): string[] {
  const errors: string[] = [];

  // id
  if (!manifest.id || typeof manifest.id !== 'string') {
    errors.push('id is required and must be a string');
  } else if (!/^[a-z0-9][a-z0-9.\-]*[a-z0-9]$/.test(manifest.id as string)) {
    errors.push(`id "${manifest.id}" must match /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/`);
  }

  // displayName
  if (!manifest.displayName || typeof manifest.displayName !== 'string') {
    errors.push('displayName is required and must be a string');
  }

  // version
  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('version is required and must be a string');
  } else if (!/^\d+\.\d+\.\d+/.test(manifest.version as string)) {
    errors.push(`version "${manifest.version}" must be semver (x.y.z)`);
  }

  // main
  if (!manifest.main || typeof manifest.main !== 'string') {
    errors.push('main is required and must be a string');
  } else {
    const resolved = resolve(dir, manifest.main as string);
    // Check the resolved path does not escape the extension directory
    const normalizedDir = resolve(dir);
    const rel = relative(normalizedDir, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      errors.push(`main "${manifest.main}" resolves outside extension directory`);
    }
    // Warn (not error) if main does not exist — dev mode may have .ts instead of .js
    const tsPath = resolve(dir, manifest.main.replace(/\.js$/, '.ts'));
    if (!existsSync(resolved) && !existsSync(tsPath)) {
      // Neither .js nor .ts found — add as warning prefix
      errors.push(`[WARN] main "${manifest.main}" not found at ${resolved} (may be compiled later)`);
    }
  }

  // engines.sessionbridge — warn only
  const engines = manifest.engines as Record<string, unknown> | undefined;
  if (engines?.sessionbridge && typeof engines.sessionbridge !== 'string') {
    errors.push('engines.sessionbridge must be a string if present');
  }

  // capabilities — must only contain known fields
  const knownCapabilities = new Set([
    'terminal', 'fileContext', 'structuredEvents', 'approvals',
    'modes', 'timeline', 'compact', 'tasks',
  ]);
  const capabilities = manifest.capabilities as Record<string, unknown> | undefined;
  if (capabilities !== undefined) {
    if (typeof capabilities !== 'object' || capabilities === null) {
      errors.push('capabilities must be an object');
    } else {
      for (const key of Object.keys(capabilities)) {
        if (!knownCapabilities.has(key)) {
          errors.push(`capabilities: unknown field "${key}"`);
        }
      }
    }
  }

  // contributes
  const contributes = manifest.contributes as Record<string, unknown> | undefined;
  if (contributes !== undefined) {
    if (typeof contributes !== 'object' || contributes === null) {
      errors.push('contributes must be an object');
    } else {
      // commands
      const commands = contributes.commands as Record<string, unknown>[] | undefined;
      if (commands !== undefined) {
        if (!Array.isArray(commands)) {
          errors.push('contributes.commands must be an array');
        } else {
          for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            if (!cmd.id || typeof cmd.id !== 'string') {
              errors.push(`contributes.commands[${i}]: id is required`);
            }
            if (!cmd.title || typeof cmd.title !== 'string') {
              errors.push(`contributes.commands[${i}] (${cmd.id || '?'}): title is required`);
            }
          }
        }
      }

      // menus
      const menus = contributes.menus as Record<string, unknown>[] | undefined;
      if (menus !== undefined) {
        if (!Array.isArray(menus)) {
          errors.push('contributes.menus must be an array');
        } else {
          for (let i = 0; i < menus.length; i++) {
            const menu = menus[i];
            if (!menu.id || typeof menu.id !== 'string') {
              errors.push(`contributes.menus[${i}]: id is required`);
            }
            if (!menu.command || typeof menu.command !== 'string') {
              errors.push(`contributes.menus[${i}] (${menu.id || '?'}): command is required`);
            }
          }
        }
      }

      // views
      const views = contributes.views as Record<string, unknown> | undefined;
      if (views !== undefined) {
        if (typeof views !== 'object' || views === null) {
          errors.push('contributes.views must be an object');
        } else {
          for (const side of ['sidebar-left', 'sidebar-right']) {
            const panels = views[side] as Record<string, unknown>[] | undefined;
            if (panels !== undefined) {
              if (!Array.isArray(panels)) {
                errors.push(`contributes.views.${side} must be an array`);
              } else {
                for (let i = 0; i < panels.length; i++) {
                  const panel = panels[i];
                  if (!panel.id || typeof panel.id !== 'string') {
                    errors.push(`contributes.views.${side}[${i}]: id is required`);
                  }
                  if (!panel.title || typeof panel.title !== 'string') {
                    errors.push(`contributes.views.${side}[${i}] (${panel.id || '?'}): title is required`);
                  }
                }
              }
            }
          }
        }
      }

      // notifications
      const notifications = contributes.notifications as Record<string, unknown>[] | undefined;
      if (notifications !== undefined) {
        if (!Array.isArray(notifications)) {
          errors.push('contributes.notifications must be an array');
        } else {
          for (let i = 0; i < notifications.length; i++) {
            const n = notifications[i];
            if (!n.id || typeof n.id !== 'string') {
              errors.push(`contributes.notifications[${i}]: id is required`);
            }
            if (!n.label || typeof n.label !== 'string') {
              errors.push(`contributes.notifications[${i}] (${n.id || '?'}): label is required`);
            }
          }
        }
      }

      // configuration
      const config = contributes.configuration as Record<string, unknown> | undefined;
      if (config !== undefined && (typeof config !== 'object' || config === null)) {
        errors.push('contributes.configuration must be an object');
      }

      // languages
      const languages = contributes.languages as Record<string, unknown>[] | undefined;
      if (languages !== undefined) {
        if (!Array.isArray(languages)) {
          errors.push('contributes.languages must be an array');
        } else {
          for (let i = 0; i < languages.length; i++) {
            const lang = languages[i];
            if (!lang.id || typeof lang.id !== 'string') {
              errors.push(`contributes.languages[${i}]: id is required`);
            }
            if (lang.extensions !== undefined && !Array.isArray(lang.extensions)) {
              errors.push(`contributes.languages[${i}] (${lang.id || '?'}): extensions must be an array`);
            }
          }
        }
      }
    }
  }

  return errors;
}

// ─── Manifest Discovery ──────────────────────────────────────────

interface ManifestEntry {
  manifest: ExtensionManifest;
  /** Absolute directory containing the manifest. */
  dir: string;
  /** Parsed engines field, or null. */
  engineVersion: string | null;
}

function discoverManifests(paths: string[], diagnostics: ExtensionDiagnostic[]): ManifestEntry[] {
  const entries: ManifestEntry[] = [];

  for (const basePath of paths) {
    // A directory either IS an extension (has sb-extension.json itself)
    // or CONTAINS extension subdirectories
    const selfManifest = join(basePath, 'sb-extension.json');
    if (existsSync(selfManifest)) {
      const entry = loadManifest(selfManifest, basePath, diagnostics);
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
        const entry = loadManifest(manifestPath, join(basePath, subdir), diagnostics);
        if (entry) entries.push(entry);
      }
    }
  }

  return entries;
}

function loadManifest(manifestPath: string, dir: string, diagnostics: ExtensionDiagnostic[]): ManifestEntry | null {
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Validate
    const errors = validateManifest(parsed, dir);
    const hardErrors = errors.filter(e => !e.startsWith('[WARN]'));
    const warnings = errors.filter(e => e.startsWith('[WARN]'));

    if (hardErrors.length > 0) {
      const id = (parsed.id as string) || basename(dir);
      console.warn(`[ext-loader] Invalid manifest in ${dir}:`);
      for (const err of hardErrors) console.warn(`  - ${err}`);
      diagnostics.push({
        id,
        dir,
        status: 'invalid',
        message: `Manifest validation failed: ${hardErrors.join('; ')}`,
        manifest: parsed as unknown as ExtensionManifest,
      });
      return null;
    }

    // Print warnings but accept the manifest
    for (const w of warnings) console.warn(`[ext-loader]  ⚠ ${w.replace('[WARN] ', '')}`);

    const manifest = parsed as unknown as ExtensionManifest;
    const engineVersion = manifest.engines?.sessionbridge ?? null;

    if (engineVersion) {
      console.warn(`[ext-loader] "${manifest.id}" requires sessionbridge ${engineVersion} — version check not yet enforced`);
    }

    diagnostics.push({
      id: manifest.id,
      dir,
      status: 'discovered',
      manifest,
    });

    return { manifest, dir, engineVersion };
  } catch (err) {
    const id = basename(dir);
    console.warn(`[ext-loader] Failed to load manifest at ${manifestPath}:`, err);
    diagnostics.push({
      id,
      dir,
      status: 'invalid',
      message: `Failed to load manifest: ${(err as Error).message}`,
    });
    return null;
  }
}

// ─── Dynamic Module Loading ──────────────────────────────────────

async function importModule(manifest: ExtensionManifest, extDir: string): Promise<Record<string, unknown>> {
  const mainPath = resolve(extDir, manifest.main);

  // Convert path to file:// URL (required on Windows for dynamic import())
  const importPath = pathToFileURL(mainPath).href;

  // Try direct import first (works for compiled .js and .ts via tsx)
  try {
    return await import(importPath);
  } catch (err1) {
    // Fallback #1: if extDir is source adapters/, try dist/adapters/ equivalent
    // (handles running compiled code from dist/ while manifests are in source adapters/)
    const extParent = dirname(extDir);     // e.g. /project/adapters/
    const extName = basename(extDir);       // e.g. claude-code
    const distExtDir = resolve(extParent, '..', 'dist', 'adapters', extName);
    if (existsSync(distExtDir)) {
      const distMainPath = resolve(distExtDir, manifest.main);
      try {
        return await import(pathToFileURL(distMainPath).href);
      } catch {}
    }

    // Fallback #2: try index.ts in the extension directory
    const tsPath = resolve(extDir, 'index.ts');
    if (tsPath !== mainPath && existsSync(tsPath)) {
      try {
        return await import(pathToFileURL(tsPath).href);
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
  /** Optional adapter — extensions may contribute only manifest declarations. */
  adapter?: AgentAdapter;
  context: ExtensionContextImpl;
  activateTime: number;
}

/**
 * Scan all extension paths, discover manifests, load and activate
 * extensions. Returns both the list of successfully activated extensions
 * and diagnostics for all discovered/invalid/failed extensions.
 */
export async function scanAndActivate(options: LoaderOptions = {}): Promise<LoaderResult> {
  const log = options.log ?? logDefault;
  const paths = getScanPaths(options);
  const diagnostics: ExtensionDiagnostic[] = [];
  const manifests = discoverManifests(paths, diagnostics);

  log(`Found ${manifests.length} valid manifest(s) in ${paths.length} path(s)`);

  const activated: ActivatedExtension[] = [];

  for (const entry of manifests) {
    // Update diagnostic status to activating
    updateDiagnostic(diagnostics, entry.manifest.id, { status: 'activating' });

    try {
      // Filter check
      if (options.filter && options.filter.length > 0 && !options.filter.includes(entry.manifest.id)) {
        log(`  Skipping "${entry.manifest.id}" (not in filter)`);
        updateDiagnostic(diagnostics, entry.manifest.id, { status: 'skipped', message: 'Not in filter' });
        continue;
      }

      // Activate
      const result = await activateExtension(entry, options);
      if (result) {
        activated.push(result);
        updateDiagnostic(diagnostics, entry.manifest.id, {
          status: 'activated',
          message: undefined,
          activateTime: result.activateTime,
        });
        log(`  ✅ "${entry.manifest.id}" v${entry.manifest.version} activated (${result.activateTime}ms)`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      log(`  ❌ "${entry.manifest.id}" activation failed: ${msg}`);
      updateDiagnostic(diagnostics, entry.manifest.id, { status: 'failed', message: msg });
    }
  }

  return { activated, diagnostics };
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

  let adapter: AgentAdapter | undefined | null = null;

  // New-style: call module.activate(context)
  if (typeof module.activate === 'function') {
    const activateResult = await module.activate(context);

    if (activateResult && typeof activateResult === 'object' && typeof (activateResult as any).id === 'string') {
      // activate() returned a valid AgentAdapter
      adapter = activateResult as AgentAdapter;
      if (adapter.id !== manifest.id) {
        throw new Error(`adapter.id ("${adapter.id}") must match manifest.id ("${manifest.id}")`);
      }
      adapterRegistry.registerFromManifest(adapter, manifest);
    } else {
      // activate() returned void/null/undefined — contributions-only extension
      adapter = null;
    }
  } else {
    // Legacy-style: find exported singleton
    adapter = resolveAdapter(module, manifest);
    if (adapter) {
      if (adapter.id !== manifest.id) {
        throw new Error(`adapter.id ("${adapter.id}") must match manifest.id ("${manifest.id}")`);
      }
      adapterRegistry.registerFromManifest(adapter, manifest);
    } else {
      // No adapter found — contributions-only extension
      adapter = null;
    }
  }

  // Always register manifest contributions (regardless of adapter presence)
  extensionPoints.register(manifest.id, manifest);

  const activateTime = Date.now() - startTime;

  // For legacy extensions that returned no adapter and no activate(), log a note
  if (adapter === null && typeof module.activate !== 'function') {
    const log = options.log ?? logDefault;
    log(`  "${manifest.id}" loaded as contributions-only (no adapter export, no activate())`);
  }

  return {
    manifest,
    adapter: adapter || undefined,
    context,
    activateTime,
  };
}

/** Update a diagnostic entry's status/message/activateTime by extension ID. */
function updateDiagnostic(
  diagnostics: ExtensionDiagnostic[],
  id: string,
  update: { status?: ExtensionStatus; message?: string; activateTime?: number },
): void {
  const existing = diagnostics.find(d => d.id === id);
  if (existing) {
    if (update.status) existing.status = update.status;
    if (update.message !== undefined) existing.message = update.message;
    if (update.activateTime !== undefined) existing.activateTime = update.activateTime;
  }
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
export async function reloadExtensions(options: LoaderOptions = {}): Promise<LoaderResult> {
  // Clear registry and extension points
  // Collect all keys (manifest IDs) from extension points
  const allIds = extensionPoints.listExtensions();
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
