'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient, ConfigEntry, UpdateSource, UpdatePolicy, UpdateStatus } from '../../core/core-types';
import { PageLoading, PageError, PageOffline, type PageState } from './page-utils';
import { listFromResponse } from './core-response-utils';

type SettingsCategory = 'general' | 'core' | 'node' | 'plugins' | 'access-control' | 'update';

const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'core', label: 'Core' },
  { id: 'node', label: 'Node' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'access-control', label: 'Access Control' },
  { id: 'update', label: 'Update' },
];

interface SettingsProps {
  core: CoreClient;
}

/**
 * Settings — configuration management page.
 * Calls: config.list, config.get (with revision), config.set (with expectedRevision)
 * Events: config.changed (WS)
 *
 * Core truth: Config values live in Core config.yaml.
 * Revision-based optimistic locking for CONFIG_CONFLICT handling.
 * UI state: dirty map for unsaved changes, activeCategory (localStorage preference).
 */
export function Settings({ core }: SettingsProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirtyValues, setDirtyValues] = useState<Record<string, { value: unknown; originalRevision: number }>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ─── update state ─────────────────────────────────────────────
  const [updateSource, setUpdateSource] = useState<UpdateSource>({ type: 'git', remote: 'origin', branch: 'main', repoUrl: '', mode: 'manual' });
  const [updatePolicy, setUpdatePolicy] = useState<UpdatePolicy>({ autoCheck: false, autoApply: false, checkIntervalSeconds: 86400, allowDirtyWorktree: false, allowWhenRunsActive: false, ignoredVersions: [] });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'unknown', currentCommit: '', remoteCommit: '', behindBy: 0, dirty: false, source: { type: 'git', remote: 'origin', branch: 'main', repoUrl: '', mode: 'manual' }, lastCheckedAt: 0, requiresRestart: false });
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updatePlanResult, setUpdatePlanResult] = useState<Record<string, unknown> | null>(null);

  async function fetchConfigs() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const result = await core.call<unknown>('config.list');
      setConfigs(listFromResponse<ConfigEntry>(result, 'configs'));
      setPageState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
      setPageState('error');
    }
  }

  useEffect(() => {
    fetchConfigs();
  }, [core]);

  async function fetchUpdateData() {
    if (!core.isConnected) return;
    try {
      const [src, pol, st] = await Promise.all([
        core.call<UpdateSource>('update.source.get'),
        core.call<UpdatePolicy>('update.policy.get'),
        core.call<UpdateStatus>('update.status'),
      ]);
      setUpdateSource(src);
      setUpdatePolicy(pol);
      setUpdateStatus(st);
    } catch {
      // Degrade gracefully when update manager not available
    }
  }

  useEffect(() => {
    if (activeCategory === 'update') {
      fetchUpdateData();
    }
  }, [activeCategory, core]);

  async function handleUpdateCheck() {
    setUpdateChecking(true);
    try {
      const result = await core.call<UpdateStatus>('update.check');
      setUpdateStatus(result);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Update check failed');
    } finally {
      setUpdateChecking(false);
    }
  }

  async function handleUpdatePlan() {
    try {
      const result = await core.call<Record<string, unknown>>('update.plan');
      setUpdatePlanResult(result);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Update plan failed');
    }
  }

  async function handleUpdateSourceSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await core.call<UpdateSource>('update.source.set', updateSource as unknown as Record<string, unknown>);
      setUpdateSource(result);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save source failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePolicySave() {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await core.call<UpdatePolicy>('update.policy.set', updatePolicy as unknown as Record<string, unknown>);
      setUpdatePolicy(result);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save policy failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateIgnore(version: string) {
    try {
      await core.call('update.ignore', { version });
      fetchUpdateData();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Ignore version failed');
    }
  }

  async function handleSave(key: string) {
    const dirty = dirtyValues[key];
    if (!dirty) return;

    setSaving(true);
    setSaveError(null);

    try {
      // config.set with expectedRevision for optimistic locking
      await core.call('config.set', {
        key,
        value: dirty.value,
        expectedRevision: dirty.originalRevision,
      });
      setDirtyValues(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      // Refresh to get new revisions
      fetchConfigs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      // Check for CONFIG_CONFLICT
      if (msg.includes('CONFIG_CONFLICT') || msg.includes('conflict') || msg.includes('revision')) {
        setSaveError(`CONFIG_CONFLICT: "${key}" was modified by another device. Refresh and try again.`);
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(key: string) {
    const config = configs.find(c => c.key === key);
    setSaving(true);
    setSaveError(null);
    try {
      await core.call('config.reset', { key, expectedRevision: config?.revision ?? 0 });
      setDirtyValues(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      fetchConfigs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reset failed';
      if (msg.includes('CONFIG_CONFLICT') || msg.includes('conflict') || msg.includes('revision')) {
        setSaveError(`CONFIG_CONFLICT: "${key}" was modified by another device. Refresh and try again.`);
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleValueChange(key: string, value: unknown) {
    const config = configs.find(c => c.key === key);
    setDirtyValues(prev => ({
      ...prev,
      [key]: { value, originalRevision: config?.revision ?? 0 },
    }));
  }

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={8} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchConfigs} /></div>;

  const categoryConfigs = configs.filter(c => {
    if (activeCategory === 'general') return c.key.startsWith('ui.') || c.key.startsWith('app.');
    if (activeCategory === 'core') return c.key.startsWith('core.') || c.key.startsWith('topology.');
    if (activeCategory === 'node') return c.key.startsWith('node.');
    if (activeCategory === 'plugins') return c.key.startsWith('plugin.');
    if (activeCategory === 'access-control') return c.key.startsWith('core.auth.') || c.key.startsWith('auth.') || c.key.startsWith('access.');
    return true;
  });

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
        <h1 className="text-lg font-semibold text-gray-100">Settings</h1>
        <button
          onClick={fetchConfigs}
          className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {saveError && (
        <div className="mx-6 mt-3 px-4 py-2 bg-red-900/50 border border-red-800 rounded text-sm text-red-400">
          {saveError}
          <button onClick={() => setSaveError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <div className="flex flex-1">
        {/* Category nav */}
        <nav className="w-48 border-r border-gray-800 p-3 flex-shrink-0">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`w-full text-left px-3 py-2 text-sm rounded transition-colors ${
                activeCategory === cat.id
                  ? 'bg-blue-900/30 text-blue-400'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </nav>

        {/* Config content or Update tab */}
        {activeCategory === 'update' ? (
          <div className="flex-1 p-6 overflow-y-auto">
            <h2 className="text-sm font-medium text-gray-300 mb-4">Update Configuration</h2>

            <div className="space-y-6 max-w-2xl">
              {/* Update Source */}
              <section className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <h3 className="text-sm font-semibold text-gray-200 mb-3">Update Source</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Type</label>
                    <input type="text" value={updateSource.type} readOnly className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-sm text-gray-400 font-mono" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Mode</label>
                    <select value={updateSource.mode} onChange={e => setUpdateSource({ ...updateSource, mode: e.target.value })} className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-sm text-gray-200 font-mono">
                      <option value="manual">manual</option>
                      <option value="auto-check">auto-check</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Remote</label>
                    <input type="text" value={updateSource.remote} onChange={e => setUpdateSource({ ...updateSource, remote: e.target.value })} className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-blue-700" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Branch</label>
                    <input type="text" value={updateSource.branch} onChange={e => setUpdateSource({ ...updateSource, branch: e.target.value })} className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-blue-700" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500">Repo URL</label>
                    <input type="text" value={updateSource.repoUrl} onChange={e => setUpdateSource({ ...updateSource, repoUrl: e.target.value })} className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-blue-700" />
                  </div>
                </div>
                <button onClick={handleUpdateSourceSave} disabled={saving} className="mt-3 px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Source'}
                </button>
              </section>

              {/* Update Policy */}
              <section className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <h3 className="text-sm font-semibold text-gray-200 mb-3">Update Policy</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="autoCheck" checked={updatePolicy.autoCheck} onChange={e => setUpdatePolicy({ ...updatePolicy, autoCheck: e.target.checked })} className="rounded" />
                    <label htmlFor="autoCheck" className="text-sm text-gray-300">Auto Check</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="autoApply" checked={updatePolicy.autoApply} disabled className="rounded opacity-50" />
                    <label htmlFor="autoApply" className="text-sm text-gray-500">Auto Apply (disabled — not supported)</label>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Check Interval (seconds)</label>
                    <input type="number" value={updatePolicy.checkIntervalSeconds} onChange={e => setUpdatePolicy({ ...updatePolicy, checkIntervalSeconds: parseInt(e.target.value) || 0 })} className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-blue-700" />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="allowDirty" checked={updatePolicy.allowDirtyWorktree} onChange={e => setUpdatePolicy({ ...updatePolicy, allowDirtyWorktree: e.target.checked })} className="rounded" />
                    <label htmlFor="allowDirty" className="text-sm text-gray-300">Allow Dirty Worktree</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="allowRuns" checked={updatePolicy.allowWhenRunsActive} onChange={e => setUpdatePolicy({ ...updatePolicy, allowWhenRunsActive: e.target.checked })} className="rounded" />
                    <label htmlFor="allowRuns" className="text-sm text-gray-300">Allow When Runs Active</label>
                  </div>
                </div>
                <button onClick={handleUpdatePolicySave} disabled={saving} className="mt-3 px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Policy'}
                </button>
              </section>

              {/* Update Status */}
              <section className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-200">Update Status</h3>
                  <div className="flex gap-2">
                    <button onClick={handleUpdateCheck} disabled={updateChecking} className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded transition-colors disabled:opacity-50">
                      {updateChecking ? 'Checking...' : 'Check Now'}
                    </button>
                    <button onClick={handleUpdatePlan} className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded transition-colors">
                      Plan
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Status: </span>
                    <span className={`font-mono ${
                      updateStatus.status === 'up-to-date' ? 'text-green-400' :
                      updateStatus.status === 'update-available' ? 'text-yellow-400' :
                      updateStatus.status === 'checking' ? 'text-blue-400' :
                      updateStatus.status === 'error' ? 'text-red-400' : 'text-gray-400'
                    }`}>{updateStatus.status}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Behind: </span>
                    <span className="font-mono text-gray-200">{updateStatus.behindBy} commits</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Dirty: </span>
                    <span className={`font-mono ${updateStatus.dirty ? 'text-yellow-400' : 'text-green-400'}`}>{String(updateStatus.dirty)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Requires Restart: </span>
                    <span className={`font-mono ${updateStatus.requiresRestart ? 'text-yellow-400' : 'text-gray-400'}`}>{String(updateStatus.requiresRestart)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Current: </span>
                    <span className="font-mono text-xs text-gray-300">{updateStatus.currentCommit || '(unknown)'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Remote: </span>
                    <span className="font-mono text-xs text-gray-300">{updateStatus.remoteCommit || '(unknown)'}</span>
                  </div>
                  {updateStatus.lastCheckedAt > 0 && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Last Checked: </span>
                      <span className="text-xs text-gray-400">{new Date(updateStatus.lastCheckedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {updateStatus.lastCheckError && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Error: </span>
                      <span className="text-xs text-red-400">{updateStatus.lastCheckError}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Ignored Versions */}
              <section className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <h3 className="text-sm font-semibold text-gray-200 mb-3">Ignored Versions</h3>
                {updatePolicy.ignoredVersions.length === 0 ? (
                  <p className="text-xs text-gray-500">No ignored versions.</p>
                ) : (
                  <ul className="space-y-1">
                    {updatePolicy.ignoredVersions.map(v => (
                      <li key={v} className="flex items-center justify-between text-sm font-mono text-gray-300">
                        <span>{v.slice(0, 12)}...</span>
                        <button onClick={() => handleUpdateIgnore(v)} className="text-xs text-gray-500 hover:text-red-400">un-ignore</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Plan Result */}
              {updatePlanResult && (
                <section className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <h3 className="text-sm font-semibold text-gray-200 mb-3">Update Plan</h3>
                  <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap overflow-x-auto max-h-64">
                    {JSON.stringify(updatePlanResult, null, 2)}
                  </pre>
                </section>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 p-6 overflow-y-auto">
            <h2 className="text-sm font-medium text-gray-300 mb-4">
              {CATEGORIES.find(c => c.id === activeCategory)?.label || 'General'} Configuration
            </h2>

            {categoryConfigs.length === 0 && (
              <p className="text-gray-600 text-sm">No configuration entries for this category.</p>
            )}

            <div className="space-y-3 max-w-2xl">
              {categoryConfigs.map(config => {
                const isDirty = dirtyValues[config.key] !== undefined;
                const displayValue = isDirty ? dirtyValues[config.key].value : config.value;

                return (
                  <div key={config.key} className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm font-mono text-gray-300">{config.key}</label>
                      {isDirty && (
                        <span className="text-xs text-yellow-500">modified</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={String(displayValue ?? '')}
                        onChange={e => handleValueChange(config.key, e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-blue-700"
                      />
                      {isDirty && (
                        <button
                          onClick={() => handleSave(config.key)}
                          disabled={saving}
                          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors disabled:opacity-50"
                        >
                          {saving ? '...' : 'Save'}
                        </button>
                      )}
                      <button
                        onClick={() => handleReset(config.key)}
                        disabled={saving}
                        className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-colors"
                      >
                        Reset
                      </button>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      revision: {config.revision}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
