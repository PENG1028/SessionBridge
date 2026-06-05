'use client';

// ─── AppManager ──────────────────────────────────────────────────
// Plugin management page: list all apps, toggle enable/disable,
// view dependency status, navigate to detail.

import { useState, useEffect } from 'react';
import { RefreshCw, Settings, ChevronRight } from 'lucide-react';
import { loadApps, isEnabled, setEnabled, getLoadError } from '../../sdk';
import type { AppSummary } from '../../sdk';
import { useCoreStatus } from '../../sdk';

export function AppManager() {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const coreStatus = useCoreStatus();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await loadApps();
      setApps(list);
    } catch (_e) {
      setError('Failed to load apps');
    }
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  async function handleToggle(appId: string) {
    const currentlyEnabled = isEnabled(appId);
    await setEnabled(appId, !currentlyEnabled);
    refresh(); // re-read from server to get authoritative state
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-bold text-gray-200">Apps</span>
          <span className="text-[10px] text-gray-600">({apps.length})</span>
        </div>
        <button onClick={refresh} disabled={loading}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-5 h-5 text-gray-600 animate-spin" />
          </div>
        )}
        {error && <div className="p-4 text-[11px] text-red-400 text-center">{error}</div>}

        {!loading && apps.length === 0 && (
          <div className="p-8 text-center text-gray-600 text-xs">
            {coreStatus !== 'connected'
              ? 'Cannot load plugins — Core is not connected.'
              : getLoadError()
                ? `Failed to load plugins: ${getLoadError()}`
                : 'No plugins found in plugins/ directory.'}
          </div>
        )}

        {apps.map(app => {
          const enabled = isEnabled(app.id);
          return (
            <div key={app.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors">
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${enabled ? 'bg-green-500' : 'bg-gray-600'}`} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-200">{app.name}</span>
                  <code className="text-[9px] text-gray-600">{app.id}</code>
                  <span className="text-[9px] text-gray-600">v{app.version}</span>
                  {app.trusted && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-700/30">
                      trusted
                    </span>
                  )}
                </div>
                {app.description && (
                  <div className="text-[10px] text-gray-500 truncate mt-0.5">{app.description}</div>
                )}
                {app.capabilities.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {app.capabilities.slice(0, 3).map(c => (
                      <code key={c} className="text-[8px] text-gray-600 bg-gray-800 px-1 rounded">{c}</code>
                    ))}
                    {app.capabilities.length > 3 && (
                      <span className="text-[8px] text-gray-700">+{app.capabilities.length - 3}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Enable/Disable toggle */}
              <button
                onClick={() => handleToggle(app.id)}
                className={`text-[9px] font-bold px-2 py-1 rounded border transition-colors shrink-0 ${
                  enabled
                    ? 'bg-green-900/30 text-green-400 border-green-700/50 hover:bg-green-800/40'
                    : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700'
                }`}
              >
                {enabled ? 'Enabled' : 'Disabled'}
              </button>

              <ChevronRight className="w-3 h-3 text-gray-700" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AppManager;
