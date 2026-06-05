'use client';

// ─── InstalledSoftwarePanel ──────────────────────────────────────
// Shows all recorded installations for this plugin.
// Each row has a Verify button to re-run env.which and confirm the
// binary is still present, updating version/path if changed.

import { useState, useEffect, useCallback } from 'react';
import { Check, RefreshCw, AlertTriangle, Package } from 'lucide-react';
import { useCore } from '../../sdk';
import type { InstalledSoftwareEntry } from '../../sdk';

interface InstalledSoftwarePanelProps {
  appId: string;
}

export function InstalledSoftwarePanel({ appId }: InstalledSoftwarePanelProps) {
  const core = useCore();
  const [entries, setEntries] = useState<InstalledSoftwareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [coreAvailable, setCoreAvailable] = useState(true);

  const fetchInstalled = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/installed`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Failed to fetch installed software (${res.status})`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
    setLoading(false);
  }, [appId]);

  useEffect(() => {
    fetchInstalled();
  }, [fetchInstalled]);

  async function handleVerify(entry: InstalledSoftwareEntry) {
    setVerifyingIds(prev => new Set(prev).add(entry.checkId));
    try {
      const result = await core.call<{ found?: boolean; path?: string; version?: string }>('env.which', {
        name: entry.binary,
      });

      if (result?.found) {
        // Binary still present — update record
        const res = await fetch(`/api/apps/${appId}/installed`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkId: entry.checkId,
            name: entry.name,
            binary: entry.binary,
            version: result.version ?? entry.version,
            path: result.path ?? entry.path,
            stale: false,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries ?? []);
        }
      } else {
        // Binary gone — mark as stale
        const res = await fetch(`/api/apps/${appId}/installed`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkId: entry.checkId,
            stale: true,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries ?? []);
        }
      }
    } catch (err) {
      // Core offline — just keep current data
      setCoreAvailable(false);
      setTimeout(() => setCoreAvailable(true), 3000);
    }
    setVerifyingIds(prev => {
      const next = new Set(prev);
      next.delete(entry.checkId);
      return next;
    });
  }

  function formatDate(ts: number): string {
    try {
      return new Date(ts).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(ts);
    }
  }

  // ─── Render states ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="w-5 h-5 text-gray-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-[11px] text-red-400">{error}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <Package className="w-5 h-5 text-gray-700" />
        <p className="text-[11px] text-gray-600">No software recorded</p>
        <p className="text-[9px] text-gray-700">
          Installed dependencies will appear here after installation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-[9px] text-gray-500">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
        <button
          onClick={fetchInstalled}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {/* Core offline warning */}
      {!coreAvailable && (
        <div className="mx-3 mt-2 p-2 text-[10px] text-yellow-400 bg-yellow-900/20 border border-yellow-800/40 rounded flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          Core offline — cannot verify installations
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {entries.map(entry => {
          const isVerifying = verifyingIds.has(entry.checkId);
          return (
            <div
              key={entry.id}
              className={`flex items-center gap-2 px-3 py-2.5 hover:bg-gray-900/50 rounded ${
                entry.stale ? 'opacity-60' : ''
              }`}
            >
              {/* Binary name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-200 font-semibold">
                    {entry.name}
                  </span>
                  {entry.stale && (
                    <span className="flex items-center gap-0.5 text-[9px] text-yellow-500">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      not found
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {/* Version */}
                  {entry.version ? (
                    <code className="text-[9px] text-green-500 bg-green-900/20 px-1 py-0.5 rounded">
                      {entry.version}
                    </code>
                  ) : (
                    <span className="text-[9px] text-gray-700 italic">no version</span>
                  )}
                  {/* Path */}
                  {entry.path && (
                    <code
                      className="text-[8px] text-gray-600 truncate max-w-[200px]"
                      title={entry.path}
                    >
                      {entry.path}
                    </code>
                  )}
                </div>
                {/* Installed date */}
                <div className="text-[8px] text-gray-700 mt-0.5">
                  Installed {formatDate(entry.installedAt)}
                </div>
              </div>

              {/* Verify button */}
              <button
                onClick={() => handleVerify(entry)}
                disabled={isVerifying || !coreAvailable}
                className="flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700 hover:text-gray-300 disabled:opacity-50 shrink-0 transition-colors"
                title="Re-run env.which to confirm binary is still present"
              >
                {isVerifying ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                {isVerifying ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
