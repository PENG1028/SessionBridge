'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient, PluginInfo } from '../../core/core-types';
import { PageHeader, PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';

interface PluginManagerProps {
  core: CoreClient;
  onPluginSelect?: (pluginId: string) => void;
}

/**
 * Plugin Manager — list all plugins, enable/disable.
 * Calls: plugin.list, plugin.enable, plugin.disable
 * Events: plugin.registered (WS), plugin.unregistered (WS)
 */
export function PluginManager({ core, onPluginSelect }: PluginManagerProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function fetchPlugins() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const result = await core.call<PluginInfo[]>('plugin.list');
      setPlugins(result || []);
      setPageState((result?.length ?? 0) > 0 ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plugins');
      setPageState('error');
    }
  }

  async function handleToggle(pluginId: string, currentStatus: string) {
    setTogglingId(pluginId);
    try {
      if (currentStatus === 'enabled') {
        await core.call('plugin.disable', { pluginId });
      } else {
        await core.call('plugin.enable', { pluginId });
      }
      fetchPlugins();
    } catch (err) {
      console.error('Failed to toggle plugin:', err);
    } finally {
      setTogglingId(null);
    }
  }

  useEffect(() => {
    fetchPlugins();
  }, [core]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={5} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchPlugins} /></div>;
  if (pageState === 'empty') return <div className="flex-1"><PageEmpty title="No plugins installed" description="Plugins extend SessionNode capabilities. Install a plugin to get started." /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title="Plugins"
        actions={
          <button
            onClick={fetchPlugins}
            className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        }
      />

      <div className="p-6">
        <div className="space-y-2">
          {plugins.map(plugin => (
            <div
              key={plugin.pluginId}
              className="flex items-center gap-4 px-4 py-3 rounded-lg border border-gray-800 bg-gray-900"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-200">{plugin.pluginId}</span>
                  {plugin.type && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      plugin.type === 'builtin' ? 'bg-gray-800 text-gray-400' : 'bg-blue-900/50 text-blue-400'
                    }`}>
                      {plugin.type}
                    </span>
                  )}
                  <span className="text-xs text-gray-600">{plugin.version}</span>
                </div>
                {plugin.description && (
                  <div className="text-xs text-gray-500 mt-0.5">{plugin.description}</div>
                )}
              </div>

              <span className={`w-2 h-2 rounded-full ${
                plugin.status === 'enabled' ? 'bg-green-500' :
                plugin.status === 'error' ? 'bg-red-500' :
                'bg-gray-600'
              }`} />

              <button
                onClick={() => onPluginSelect?.(plugin.pluginId)}
                className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
              >
                Detail
              </button>

              {plugin.type !== 'builtin' && (
                <button
                  onClick={() => handleToggle(plugin.pluginId, plugin.status)}
                  disabled={togglingId === plugin.pluginId}
                  className={`text-xs px-3 py-1.5 rounded transition-colors ${
                    plugin.status === 'enabled'
                      ? 'bg-red-900/50 hover:bg-red-800/50 text-red-400'
                      : 'bg-green-900/50 hover:bg-green-800/50 text-green-400'
                  } disabled:opacity-50`}
                >
                  {togglingId === plugin.pluginId ? '...' : (plugin.status === 'enabled' ? 'Disable' : 'Enable')}
                </button>
              )}
              {plugin.type === 'builtin' && (
                <span className="text-xs text-gray-600">builtin — always on</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
