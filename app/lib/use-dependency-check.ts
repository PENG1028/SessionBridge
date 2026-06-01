'use client';

// ─── useDependencyCheck ───────────────────────────────────────────
// Reads environment checks from plugin manifest, calls Core env.which
// for each, and returns structured results.
// Handles cascading: if parent missing → children marked blockedBy.

import { useState, useCallback } from 'react';
import type { CoreClient } from '../console/core/core-types';
import type { CheckResult } from './app-registry/app-types';

interface EnvCheckSpec {
  id: string;
  type: string;
  required?: boolean;
  command?: string;
  args?: string[];
  installHint?: string;
}

const CASCADE_MAP: Record<string, string> = {
  npm: 'node',
  npx: 'node',
  pip: 'python3',
  python: 'python3',
  gem: 'ruby',
};

export function useDependencyCheck(core: CoreClient) {
  const [results, setResults] = useState<CheckResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runChecks = useCallback(async (appId: string) => {
    setLoading(true);
    setError(null);
    try {
      // 1. Get environment checks from server
      const res = await fetch(`/api/apps/${appId}/check`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Failed to fetch environment checks');
      const data = await res.json();
      const checks: EnvCheckSpec[] = data.checks ?? [];

      // 2. Run each check via Core env.which
      const results: CheckResult[] = [];
      const foundCommands = new Set<string>();

      for (const check of checks) {
        // Cascading check: if this command depends on another that's missing
        const parent = CASCADE_MAP[check.command || ''];
        const blockedBy = parent && !foundCommands.has(parent) ? parent : undefined;

        if (blockedBy) {
          results.push({
            id: check.id,
            type: check.type,
            command: check.command || check.id,
            found: false,
            required: check.required ?? false,
            installHint: check.installHint,
            blockedBy,
          });
          continue;
        }

        try {
          const result = await core.call<{ found: boolean; path?: string }>('env.which', {
            name: check.command || check.id,
          });
          const found = result?.found ?? false;
          if (found) foundCommands.add(check.command || check.id);

          results.push({
            id: check.id,
            type: check.type,
            command: check.command || check.id,
            found,
            path: result?.path,
            required: check.required ?? false,
            installHint: check.installHint,
          });
        } catch (err) {
          results.push({
            id: check.id,
            type: check.type,
            command: check.command || check.id,
            found: false,
            error: String(err),
            required: check.required ?? false,
            installHint: check.installHint,
          });
        }
      }

      setResults(results);
      return results;
    } catch (err) {
      setError(String(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [core]);

  return { results, loading, error, runChecks };
}
