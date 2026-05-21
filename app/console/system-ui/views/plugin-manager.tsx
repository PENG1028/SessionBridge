'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { CoreClient, PluginInfo, BlockerEntry } from '../../core/core-types';
import { PageHeader, PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';
import { listFromResponse } from './core-response-utils';

interface PluginManagerProps {
  core: CoreClient;
  onPluginSelect?: (pluginId: string) => void;
}

type StatusFilter = 'all' | 'enabled' | 'disabled' | 'error';
type TypeFilter = 'all' | 'builtin' | 'feature';

interface EnvCheckResult {
  status: string;
  deps: number;
  blockers: BlockerEntry[];
}

export function PluginManager({ core, onPluginSelect }: PluginManagerProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Search & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // Environment check
  const [envCheckResults, setEnvCheckResults] = useState<Record<string, EnvCheckResult>>({});
  const [envCheckRunning, setEnvCheckRunning] = useState(false);

  async function fetchPlugins() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const result = await core.call<unknown>('plugin.list');
      const normalized = listFromResponse<PluginInfo>(result, 'plugins');
      setPlugins(normalized);
      setPageState(normalized.length > 0 ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plugins');
      setPageState('error');
    }
  }

  async function handleToggle(pluginId: string, currentStatus: string) {
    setTogglingId(pluginId);
    setToggleError(null);
    try {
      if (currentStatus === 'enabled') {
        await core.call('plugin.disable', { pluginId });
      } else {
        await core.call('plugin.enable', { pluginId });
      }
      fetchPlugins();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle plugin';
      if (msg.includes('not_implemented')) {
        setToggleError(`Toggle not supported by Go Core for "${pluginId}"`);
      } else {
        setToggleError(msg);
      }
    } finally {
      setTogglingId(null);
    }
  }

  async function runAllEnvChecks() {
    setEnvCheckRunning(true);
    const results: Record<string, EnvCheckResult> = {};
    for (const p of plugins) {
      try {
        const res = await core.call<{ status: string; dependencies?: unknown[]; blockers?: BlockerEntry[] }>('plugin.check', { pluginId: p.pluginId });
        const blockers = Array.isArray(res?.blockers) ? res.blockers as BlockerEntry[] : [];
        results[p.pluginId] = { status: res?.status || 'ok', deps: res?.dependencies?.length || 0, blockers };
      } catch {
        results[p.pluginId] = { status: 'error', deps: 0, blockers: [] };
      }
    }
    setEnvCheckResults(results);
    setEnvCheckRunning(false);
  }

  // WS event subscription for live updates
  useEffect(() => {
    const unsubRegistered = core.on('plugin.registered', () => fetchPlugins());
    const unsubUnregistered = core.on('plugin.unregistered', () => fetchPlugins());
    const unsubStatus = core.on('connectionStatus', () => {
      if (core.isConnected) fetchPlugins();
    });

    return () => {
      unsubRegistered();
      unsubUnregistered();
      unsubStatus();
    };
  }, [core]);

  useEffect(() => {
    fetchPlugins();
  }, [core]);

  // Filtered list
  const filteredPlugins = useMemo(() => {
    return plugins.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return p.pluginId.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [plugins, searchQuery, statusFilter, typeFilter]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={5} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchPlugins} /></div>;
  if (pageState === 'empty') return <div className="flex-1"><PageEmpty title="No plugins installed" description="Plugins extend SessionNode capabilities. Install a plugin to get started." /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title="Plugins"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={runAllEnvChecks}
              disabled={envCheckRunning}
              className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors disabled:opacity-50"
              title="Run environment checks for all plugins"
            >
              {envCheckRunning ? 'Checking...' : 'Check All'}
            </button>
            <button
              onClick={fetchPlugins}
              className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        }
      />

      {toggleError && (
        <div className="mx-6 mt-3 px-3 py-2 bg-red-900/30 border border-red-800 rounded text-sm text-red-400">
          {toggleError}
          <button onClick={() => setToggleError(null)} className="ml-2 text-red-300 hover:text-red-200">&times;</button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            type="text"
            placeholder="Search plugins..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-900 border border-gray-800 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600"
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="text-xs px-2 py-1.5 bg-gray-900 border border-gray-800 rounded text-gray-400 focus:outline-none focus:border-gray-600"
        >
          <option value="all">All Status</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
          <option value="error">Error</option>
        </select>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as TypeFilter)}
          className="text-xs px-2 py-1.5 bg-gray-900 border border-gray-800 rounded text-gray-400 focus:outline-none focus:border-gray-600"
        >
          <option value="all">All Types</option>
          <option value="builtin">Builtin</option>
          <option value="feature">Feature</option>
        </select>

        {searchQuery && (
          <span className="text-xs text-gray-600">
            {filteredPlugins.length} / {plugins.length}
          </span>
        )}
      </div>

      <div className="p-6">
        <div className="space-y-2">
          {filteredPlugins.map(plugin => {
            const envCheck = envCheckResults[plugin.pluginId];
            return (
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
                  {/* Capability & blocker summary */}
                  {envCheck && (
                    <div className="text-xs mt-1 space-y-0.5">
                      <span className={
                        envCheck.status === 'ok' ? 'text-green-500' :
                        envCheck.status === 'blocked' ? 'text-red-500' :
                        envCheck.status === 'incomplete' ? 'text-yellow-500' :
                        'text-yellow-500'
                      }>
                        {envCheck.status === 'blocked' ? '[BLOCKED]' : envCheck.status === 'incomplete' ? '[WARN]' : '[OK]'}{' '}
                        {envCheck.status}
                      </span>
                      {envCheck.blockers.length > 0 && (
                        <span className="text-red-400 block">
                          {(() => {
                            const byKind: Record<string, number> = {};
                            envCheck.blockers.forEach(b => { byKind[b.kind] = (byKind[b.kind] || 0) + 1; });
                            const parts: string[] = [];
                            if (byKind.missing_grant) parts.push(`permission:${byKind.missing_grant}`);
                            if (byKind.unsupported_capability) parts.push(`unsupported:${byKind.unsupported_capability}`);
                            if (byKind.missing_dependency) parts.push(`deps:${byKind.missing_dependency}`);
                            if (byKind.unknown_capability) parts.push(`unknown:${byKind.unknown_capability}`);
                            return parts.length > 0 ? parts.join(' ') : `${envCheck.blockers.length} blocker${envCheck.blockers.length > 1 ? 's' : ''}`;
                          })()}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Capability indicators when no check results yet */}
                  {!envCheck && plugin.capabilities && plugin.capabilities.length > 0 && (
                    <div className="text-xs mt-1 text-gray-600">
                      {plugin.capabilities.length} declared capability{plugin.capabilities.length > 1 ? 's' : ''}
                      {plugin.capabilities.some(c => c.startsWith('network.')) && (
                        <span className="text-yellow-500 ml-1">[network]</span>
                      )}
                      {plugin.capabilities.some(c => c.startsWith('process.')) && (
                        <span className="text-yellow-500 ml-1">[process]</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Status indicator */}
                <span className={`w-2 h-2 rounded-full ${
                  plugin.status === 'enabled' ? 'bg-green-500' :
                  plugin.status === 'error' ? 'bg-red-500' :
                  'bg-gray-600'
                }`} />

                {/* Error message inline */}
                {plugin.status === 'error' && plugin.error && (
                  <span className="text-xs text-red-400 max-w-40 truncate" title={plugin.error}>
                    {plugin.error}
                  </span>
                )}

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
                    title={toggleError ? 'Not supported by Core' : ''}
                  >
                    {togglingId === plugin.pluginId ? '...' : (plugin.status === 'enabled' ? 'Disable' : 'Enable')}
                  </button>
                )}
                {plugin.type === 'builtin' && (
                  <span className="text-xs text-gray-600">builtin — always on</span>
                )}
              </div>
            );
          })}
        </div>

        {filteredPlugins.length === 0 && (
          <div className="text-center py-12 text-gray-500 text-sm">
            No plugins match your filters.
          </div>
        )}
      </div>
    </div>
  );
}
