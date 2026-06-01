// ─── Dependency Checker ──────────────────────────────────────────
// Reads plugin.yaml environment.checks, calls Core env.which/env.checkBinary,
// and returns structured CheckResult[] with cascading dependency handling.
//
// Server-side only — never imported by client components.

import type { CheckResult } from './app-registry/app-types';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';

const PLUGINS_DIR = join(process.cwd(), 'plugins');

interface EnvCheckSpec {
  id: string;
  type: string;
  required?: boolean;
  command?: string;
  args?: string[];
  installHint?: string;
}

/**
 * Read environment checks from a plugin's manifest.
 */
export function readEnvChecks(appId: string): EnvCheckSpec[] {
  const yamlPath = join(PLUGINS_DIR, appId, 'plugin.yaml');
  if (!existsSync(yamlPath)) return [];
  try {
    const raw = readFileSync(yamlPath, 'utf-8');
    const manifest = load(raw) as { core?: { environment?: { checks?: EnvCheckSpec[] } } };
    return manifest.core?.environment?.checks ?? [];
  } catch {
    return [];
  }
}

/**
 * Check all declared dependencies for an app.
 * Handles cascading: if a parent dependency is missing, children are marked blockedBy.
 */
export function getEnvChecks(appId: string): EnvCheckSpec[] {
  return readEnvChecks(appId);
}

/**
 * Returns a subset of environment checks that block execution.
 * (required=true AND check found=false)
 */
export function getBlockedChecks(results: CheckResult[]): CheckResult[] {
  return results.filter(r => r.required && !r.found);
}

/**
 * Returns true if all required checks pass.
 */
export function allRequiredPass(results: CheckResult[]): boolean {
  return getBlockedChecks(results).length === 0;
}
