'use client';

// ─── DependencyPanel ──────────────────────────────────────────────
// Shows environment check results for a plugin and allows one-click
// install of missing dependencies. Uses useDependencyCheck hook.

import { useState } from 'react';
import { Check, X, RefreshCw, Play } from 'lucide-react';
import { useCore, useDependencyCheck } from '../../sdk';
import type { CheckResult } from '../../sdk';

// ─── Row: single dependency check ────────────────────────────────
function DepRow({ check, onInstall }: { check: CheckResult; onInstall: (c: CheckResult) => void }) {
  const [installing, setInstalling] = useState(false);

  if (check.blockedBy) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-gray-600 italic">
        <span className="w-4 text-center">—</span>
        <span className="flex-1">{check.id}</span>
        <span className="text-[9px]">blocked by: {check.blockedBy}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-900/50 rounded">
      {/* Status icon */}
      {check.found ? (
        <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
      ) : check.error ? (
        <X className="w-3.5 h-3.5 text-red-500 shrink-0" />
      ) : (
        <X className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <span className="text-[10px] text-gray-300 font-medium">{check.id}</span>
        <span className="text-[9px] text-gray-600 ml-1.5">{check.type}</span>
        {check.version && (
          <code className="text-[9px] text-green-500 ml-1.5">v{check.version}</code>
        )}
        {check.path && (
          <div className="text-[8px] text-gray-700 truncate">{check.path}</div>
        )}
        {check.error && (
          <div className="text-[8px] text-red-500/70 truncate">{check.error}</div>
        )}
      </div>

      {/* Required badge */}
      {check.required && (
        <span className="text-[8px] px-1 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-700/30 shrink-0">
          required
        </span>
      )}

      {/* Install button */}
      {!check.found && check.installHint && (
        <button
          onClick={() => { setInstalling(true); onInstall(check); }}
          disabled={installing}
          className="flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded bg-purple-900/30 text-purple-400 border border-purple-700/50 hover:bg-purple-800/40 disabled:opacity-50 shrink-0 transition-colors"
        >
          {installing ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3 fill-current" />
          )}
          {installing ? 'Installing...' : 'Install'}
        </button>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────
interface DependencyPanelProps {
  appId: string;
}

export function DependencyPanel({ appId }: DependencyPanelProps) {
  const core = useCore();
  const { results, loading, error, runChecks } = useDependencyCheck(core);
  const [checking, setChecking] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  async function handleCheck() {
    setChecking(true);
    await runChecks(appId);
    setChecking(false);
  }

  async function handleInstall(check: CheckResult) {
    if (!check.installHint) return;
    try {
      // Start install record
      await fetch(`/api/apps/${appId}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId: check.id, command: check.installHint }),
      });
      // Execute via Core process.spawn
      await core.call('process.spawn', {
        command: check.installHint,
        kind: 'install',
        pluginId: appId,
      });
      // Mark success
      await fetch(`/api/apps/${appId}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId: check.id, status: 'success' }),
      });
      // Re-check after install
      await runChecks(appId);
    } catch (err) {
      setInstallError(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
      await fetch(`/api/apps/${appId}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId: check.id, status: 'failed' }),
      });
      setTimeout(() => setInstallError(null), 5000);
    }
  }

  const passed = results.filter(r => r.found).length;
  const blocked = results.filter(r => r.blockedBy).length;

  return (
    <div className="flex flex-col min-h-0">
      {/* Summary bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-3 text-[9px]">
          <span className="text-gray-500">
            {results.length > 0
              ? `${passed}/${results.length - blocked} passed`
              : 'Not checked'}
          </span>
          {blocked > 0 && (
            <span className="text-gray-600">{blocked} blocked</span>
          )}
        </div>
        <button
          onClick={handleCheck}
          disabled={checking}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking...' : 'Check'}
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-3 text-[10px] text-red-400 text-center">{error}</div>
        )}
        {installError && (
          <div className="p-2 mx-3 mt-2 text-[10px] text-red-400 bg-red-900/20 border border-red-800/40 rounded">{installError}</div>
        )}

        {!loading && results.length === 0 && !error && (
          <div className="p-4 text-center text-[10px] text-gray-600">
            No dependencies declared. Click Check to verify.
          </div>
        )}

        {results.map(check => (
          <DepRow key={check.id} check={check} onInstall={handleInstall} />
        ))}
      </div>
    </div>
  );
}
