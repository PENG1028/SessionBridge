'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Search, Play, Power, PowerOff } from 'lucide-react';
import type { CoreClient, PluginInfo, BlockerEntry, RunInfo } from '../../core/core-types';
import { PageHeader, PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';
import { listFromResponse } from './core-response-utils';
import { getAllViewEntries } from '../../main/view-registry';

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

/** Check if a plugin has any launchable/direct view registered. */
function hasLaunchableView(pluginId: string): boolean {
  for (const [, entry] of getAllViewEntries()) {
    if (entry.meta.launchable && entry.meta.launchMode !== 'hidden' && entry.meta.launchMode !== 'runtime') {
      return true;
    }
  }
  return false;
}

function blockerSummary(blockers: BlockerEntry[]): string {
  if (blockers.length === 0) return '';
  const byKind: Record<string, number> = {};
  blockers.forEach(b => { byKind[b.kind] = (byKind[b.kind] || 0) + 1; });
  const parts: string[] = [];
  if (byKind.missing_grant) parts.push(`perm:${byKind.missing_grant}`);
  if (byKind.unsupported_capability) parts.push(`unsup:${byKind.unsupported_capability}`);
  if (byKind.missing_dependency) parts.push(`deps:${byKind.missing_dependency}`);
  if (byKind.unknown_capability) parts.push(`unk:${byKind.unknown_capability}`);
  return parts.join(' ') || `${blockers.length} blockers`;
}

export function PluginManager({ core, onPluginSelect }: PluginManagerProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [envCheckResults, setEnvCheckResults] = useState<Record<string, EnvCheckResult>>({});
  const [envCheckRunning, setEnvCheckRunning] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());

  // Run counts per plugin (from run.list)
  const [runCounts, setRunCounts] = useState<Record<string, number>>({});

  async function fetchPlugins() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const [pluginResult, runResult] = await Promise.all([
        core.call<unknown>('plugin.list'),
        core.call<unknown>('run.list'),
      ]);

      const normalized = listFromResponse<PluginInfo>(pluginResult, 'plugins');
      setPlugins(normalized);

      // Count runs by pluginId
      const runs = listFromResponse<RunInfo>(runResult, 'runs');
      const counts: Record<string, number> = {};
      for (const r of runs) {
        if (r.pluginId) {
          counts[r.pluginId] = (counts[r.pluginId] || 0) + 1;
        }
      }
      setRunCounts(counts);

      setPageState(normalized.length > 0 ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plugins');
      setPageState('error');
    }
  }

  async function handleToggle(pluginId: string, currentStatus: string) {
    setTogglingIds(prev => new Set(prev).add(pluginId));
    setToggleError(null);
    try {
      if (currentStatus === 'enabled') {
        await core.call('plugin.disable', { pluginId });
        setPlugins(prev => prev.map(p => p.pluginId === pluginId ? { ...p, status: 'disabled' as const } : p));
      } else {
        await core.call('plugin.enable', { pluginId });
        setPlugins(prev => prev.map(p => p.pluginId === pluginId ? { ...p, status: 'enabled' as const } : p));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle plugin';
      if (msg.includes('not_implemented')) {
        setToggleError(`Toggle not supported by Go Core for "${pluginId}"`);
      } else {
        setToggleError(msg);
      }
    } finally {
      setTogglingIds(prev => {
        const next = new Set(prev);
        next.delete(pluginId);
        return next;
      });
    }
  }

  async function runAllEnvChecks() {
    setEnvCheckRunning(true);
    const results: Record<string, EnvCheckResult> = {};
    const tasks = plugins.map(async (p) => {
      try {
        const res = await core.call<{ status: string; dependencies?: unknown[]; blockers?: BlockerEntry[] }>('plugin.check', { pluginId: p.pluginId });
        const blockers = Array.isArray(res?.blockers) ? res.blockers as BlockerEntry[] : [];
        results[p.pluginId] = { status: res?.status || 'ok', deps: res?.dependencies?.length || 0, blockers };
      } catch {
        results[p.pluginId] = { status: 'error', deps: 0, blockers: [] };
      }
    });
    await Promise.allSettled(tasks);
    setEnvCheckResults(results);
    setEnvCheckRunning(false);
  }

  async function runSingleCheck(pluginId: string) {
    setCheckingIds(prev => new Set(prev).add(pluginId));
    try {
      const res = await core.call<{ status: string; dependencies?: unknown[]; blockers?: BlockerEntry[] }>('plugin.check', { pluginId });
      const blockers = Array.isArray(res?.blockers) ? res.blockers as BlockerEntry[] : [];
      setEnvCheckResults(prev => ({
        ...prev,
        [pluginId]: { status: res?.status || 'ok', deps: res?.dependencies?.length || 0, blockers },
      }));
    } catch {
      setEnvCheckResults(prev => ({
        ...prev,
        [pluginId]: { status: 'error', deps: 0, blockers: [] },
      }));
    } finally {
      setCheckingIds(prev => {
        const next = new Set(prev);
        next.delete(pluginId);
        return next;
      });
    }
  }

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
        title="Plugin Management"
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

      {/* Plugin list */}
      <div className="p-6">
        <div className="space-y-2">
          {filteredPlugins.map(plugin => {
            const envCheck = envCheckResults[plugin.pluginId];
            const launchable = hasLaunchableView(plugin.pluginId);
            const capCount = plugin.capabilities?.length ?? 0;
            const runCount = runCounts[plugin.pluginId] ?? 0;
            const isChecking = checkingIds.has(plugin.pluginId);
            const isToggling = togglingIds.has(plugin.pluginId);
            const isBuiltin = plugin.type === 'builtin';

            return (
              <div
                key={plugin.pluginId}
                className="px-4 py-3 rounded-lg border border-gray-800 bg-gray-900"
              >
                {/* Row 1: identity + status + actions */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      plugin.status === 'enabled' ? 'bg-green-500' :
                      plugin.status === 'error' ? 'bg-red-500' :
                      'bg-gray-600'
                    }`} />
                    <span className="font-medium text-gray-200">{plugin.pluginId}</span>
                    {plugin.type && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        isBuiltin ? 'bg-gray-800 text-gray-400' : 'bg-blue-900/50 text-blue-400'
                      }`}>
                        {plugin.type}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-600">{plugin.version}</span>
                    {plugin.status === 'error' && plugin.error && (
                      <span className="text-[10px] text-red-400 truncate max-w-40" title={plugin.error}>
                        {plugin.error}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => runSingleCheck(plugin.pluginId)}
                      disabled={isChecking}
                      className="text-[10px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors disabled:opacity-50"
                      title={`Check ${plugin.pluginId}`}
                    >
                      {isChecking ? '...' : 'Check'}
                    </button>
                    <button
                      onClick={() => onPluginSelect?.(plugin.pluginId)}
                      className="text-[10px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
                    >
                      Detail
                    </button>
                    {!isBuiltin && (
                      <button
                        onClick={() => handleToggle(plugin.pluginId, plugin.status)}
                        disabled={isToggling}
                        className={`text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                          plugin.status === 'enabled'
                            ? 'bg-red-900/50 hover:bg-red-800/50 text-red-400'
                            : 'bg-green-900/50 hover:bg-green-800/50 text-green-400'
                        }`}
                        title={isToggling ? 'Toggling...' : (plugin.status === 'enabled' ? 'Disable' : 'Enable')}
                      >
                        {isToggling ? '...' : (plugin.status === 'enabled' ? 'Disable' : 'Enable')}
                      </button>
                    )}
                    {isBuiltin && (
                      <span className="text-[10px] text-gray-600">builtin</span>
                    )}
                  </div>
                </div>

                {/* Row 2: summary line — launchable / caps / deps / perms / runs */}
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                  <span className={launchable ? 'text-green-400' : 'text-gray-600'}>
                    launchable: {launchable ? 'yes' : 'no'}
                  </span>
                  <span>caps: {capCount}</span>

                  {envCheck ? (
                    <>
                      <span className={
                        envCheck.status === 'ok' ? 'text-green-400' :
                        envCheck.status === 'blocked' ? 'text-red-400' :
                        'text-yellow-400'
                      }>
                        check: {envCheck.status}
                      </span>
                      {envCheck.blockers.length > 0 && (
                        <span className="text-red-400/80">{blockerSummary(envCheck.blockers)}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-600">check: not run</span>
                  )}

                  <span>runs: {runCount}</span>

                  {plugin.description && (
                    <span className="text-gray-600 truncate hidden md:inline">— {plugin.description}</span>
                  )}
                </div>

                {/* Row 3: capability tags (collapsed when many) */}
                {capCount > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(plugin.capabilities || []).slice(0, 8).map((cap: string) => (
                      <span key={cap} className="text-[9px] px-1.5 py-0.5 bg-gray-800/50 text-gray-500 rounded">
                        {cap}
                      </span>
                    ))}
                    {capCount > 8 && (
                      <span className="text-[9px] text-gray-600">+{capCount - 8} more</span>
                    )}
                  </div>
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
