'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, ShieldCheck, ShieldAlert, Globe, Lock, Unlock } from 'lucide-react';
import type { CoreClient, ConfigEntry, UpdateSource, UpdatePolicy, UpdateStatus } from '../core/core-types';
import { PageLoading, PageError, PageOffline, type PageState } from './page-utils';
import { listFromResponse } from './core-response-utils';

type SettingsCategory = 'general' | 'core' | 'node' | 'plugins' | 'access-control' | 'connection' | 'update';

const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'core', label: 'Core' },
  { id: 'node', label: 'Node' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'access-control', label: 'Access Control' },
  { id: 'connection', label: 'Connection' },
  { id: 'update', label: 'Update' },
];

interface SettingsProps {
  core: CoreClient;
}

function renderBlockerMessage(blocker: Record<string, unknown>): string {
  const kind = blocker.kind as string || '';
  switch (kind) {
    case 'dirty_worktree':
      return 'Working tree has uncommitted changes. Commit or stash them first, or enable "Allow Dirty Worktree" in Update Policy.';
    case 'active_runs':
      return `One or more runs are still active. Stop active runs before updating, or enable "Allow When Runs Active" in Update Policy.`;
    case 'no_git_runner':
      return 'Git is not available. Ensure the Core is running in a git repository with git installed.';
    default:
      return blocker.message as string || `Unknown blocker: ${kind || JSON.stringify(blocker)}`;
  }
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
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800">
        <h1 className="text-[11px] font-mono tracking-wider uppercase text-gray-300">Settings</h1>
        <button
          onClick={fetchConfigs}
          className="p-1.5 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {saveError && (
        <div className="mx-4 mt-2 px-3 py-1.5 bg-red-900/20 border border-red-800 rounded text-[10px] text-red-400">
          {saveError}
          <button onClick={() => setSaveError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <div className="flex flex-1">
        {/* Category nav */}
        <nav className="w-48 border-r border-gray-800 p-2 flex-shrink-0">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-mono rounded transition-colors ${
                activeCategory === cat.id
                  ? 'bg-purple-900/20 text-purple-400'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </nav>

        {/* Config content or Update tab */}
        {activeCategory === 'update' ? (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-[10px] font-mono text-gray-300 mb-3">Update Configuration</h2>

            <div className="space-y-4 max-w-2xl">
              {/* Update Source */}
              <section className="p-3 bg-[#111] rounded border border-gray-800">
                <h3 className="text-[10px] font-mono text-gray-200 mb-2">Update Source</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-gray-500">Type</label>
                    <input type="text" value={updateSource.type} readOnly className="w-full px-2.5 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-400 font-mono" />
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500">Mode</label>
                    <select value={updateSource.mode} onChange={e => setUpdateSource({ ...updateSource, mode: e.target.value })} className="w-full px-2.5 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono">
                      <option value="manual">manual</option>
                      <option value="auto-check">auto-check</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500">Remote</label>
                    <input type="text" value={updateSource.remote} onChange={e => setUpdateSource({ ...updateSource, remote: e.target.value })} className="w-full px-2.5 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono focus:outline-none focus:border-purple-500" />
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500">Branch</label>
                    <input type="text" value={updateSource.branch} onChange={e => setUpdateSource({ ...updateSource, branch: e.target.value })} className="w-full px-2.5 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono focus:outline-none focus:border-purple-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[9px] text-gray-500">Repo URL</label>
                    <input type="text" value={updateSource.repoUrl} onChange={e => setUpdateSource({ ...updateSource, repoUrl: e.target.value })} className="w-full px-2.5 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono focus:outline-none focus:border-purple-500" />
                  </div>
                </div>
                <button onClick={handleUpdateSourceSave} disabled={saving} className="mt-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] rounded transition-colors disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Source'}
                </button>
              </section>

              {/* Update Policy */}
              <section className="p-3 bg-[#111] rounded border border-gray-800">
                <h3 className="text-[10px] font-mono text-gray-200 mb-2">Update Policy</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="autoCheck" checked={updatePolicy.autoCheck} onChange={e => setUpdatePolicy({ ...updatePolicy, autoCheck: e.target.checked })} className="rounded" />
                    <label htmlFor="autoCheck" className="text-[10px] text-gray-300">Auto Check</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="autoApply" checked={updatePolicy.autoApply} disabled className="rounded opacity-50" />
                    <label htmlFor="autoApply" className="text-[10px] text-gray-500">Auto Apply (disabled — not supported)</label>
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500">Check Interval (seconds)</label>
                    <input type="number" value={updatePolicy.checkIntervalSeconds} onChange={e => setUpdatePolicy({ ...updatePolicy, checkIntervalSeconds: parseInt(e.target.value) || 0 })} className="w-full px-2.5 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono focus:outline-none focus:border-purple-500" />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="allowDirty" checked={updatePolicy.allowDirtyWorktree} onChange={e => setUpdatePolicy({ ...updatePolicy, allowDirtyWorktree: e.target.checked })} className="rounded" />
                    <label htmlFor="allowDirty" className="text-[10px] text-gray-300">Allow Dirty Worktree</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="allowRuns" checked={updatePolicy.allowWhenRunsActive} onChange={e => setUpdatePolicy({ ...updatePolicy, allowWhenRunsActive: e.target.checked })} className="rounded" />
                    <label htmlFor="allowRuns" className="text-[10px] text-gray-300">Allow When Runs Active</label>
                  </div>
                </div>
                <button onClick={handleUpdatePolicySave} disabled={saving} className="mt-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] rounded transition-colors disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Policy'}
                </button>
              </section>

              {/* Update Status */}
              <section className="p-3 bg-[#111] rounded border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[10px] font-mono text-gray-200">Update Status</h3>
                  <div className="flex gap-1.5">
                    <button onClick={handleUpdateCheck} disabled={updateChecking} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] rounded transition-colors disabled:opacity-50">
                      {updateChecking ? 'Checking...' : 'Check Now'}
                    </button>
                    <button onClick={handleUpdatePlan} className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] rounded transition-colors">
                      Plan
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-gray-500">Status: </span>
                    <span className={`font-mono ${
                      updateStatus.status === 'up-to-date' ? 'text-emerald-400' :
                      updateStatus.status === 'update-available' ? 'text-yellow-400' :
                      updateStatus.status === 'checking' ? 'text-purple-400' :
                      updateStatus.status === 'error' ? 'text-red-400' : 'text-gray-400'
                    }`}>{updateStatus.status}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Behind: </span>
                    <span className="font-mono text-gray-200">{updateStatus.behindBy} commits</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Dirty: </span>
                    <span className={`font-mono ${updateStatus.dirty ? 'text-yellow-400' : 'text-emerald-400'}`}>{String(updateStatus.dirty)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Requires Restart: </span>
                    <span className={`font-mono ${updateStatus.requiresRestart ? 'text-yellow-400' : 'text-gray-400'}`}>{String(updateStatus.requiresRestart)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Current: </span>
                    <span className="font-mono text-[9px] text-gray-300">{updateStatus.currentCommit || '(unknown)'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Remote: </span>
                    <span className="font-mono text-[9px] text-gray-300">{updateStatus.remoteCommit || '(unknown)'}</span>
                  </div>
                  {updateStatus.lastCheckedAt > 0 && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Last Checked: </span>
                      <span className="text-[9px] text-gray-400">{new Date(updateStatus.lastCheckedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {updateStatus.lastCheckError && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Error: </span>
                      <span className="text-[9px] text-red-400">{updateStatus.lastCheckError}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Ignored Versions */}
              <section className="p-3 bg-[#111] rounded border border-gray-800">
                <h3 className="text-[10px] font-mono text-gray-200 mb-2">Ignored Versions</h3>
                {updatePolicy.ignoredVersions.length === 0 ? (
                  <p className="text-[9px] text-gray-500">No ignored versions.</p>
                ) : (
                  <ul className="space-y-1">
                    {updatePolicy.ignoredVersions.map(v => (
                      <li key={v} className="flex items-center justify-between text-[10px] font-mono text-gray-300">
                        <span>{v.slice(0, 12)}...</span>
                        <button onClick={() => handleUpdateIgnore(v)} className="text-[9px] text-gray-500 hover:text-red-400">un-ignore</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Plan Result */}
              {updatePlanResult && (
                <section className="p-3 bg-[#111] rounded border border-gray-800">
                  <h3 className="text-[10px] font-mono text-gray-200 mb-2">Update Plan</h3>
                  {updatePlanResult.canUpdate ? (
                    <div className="text-[10px] text-emerald-400 mb-2">Ready to update — no blockers.</div>
                  ) : (
                    <div className="mb-2">
                      <div className="text-[10px] text-yellow-400 mb-2">Update blocked — the following conditions must be resolved:</div>
                      <ul className="space-y-1.5">
                        {(Array.isArray(updatePlanResult.blockers) ? updatePlanResult.blockers as Array<Record<string, unknown>> : []).map((b: Record<string, unknown>, i: number) => (
                          <li key={i} className="text-[9px] text-gray-300 bg-[#1a1a1a] rounded p-2 border border-gray-700">
                            <span className="font-mono text-yellow-400">{b.kind as string || 'unknown'}</span>
                            <span className="mx-2 text-gray-600">—</span>
                            <span>{renderBlockerMessage(b)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <details>
                    <summary className="text-[9px] text-gray-500 cursor-pointer hover:text-gray-400">Raw response</summary>
                    <pre className="text-[9px] text-gray-500 font-mono whitespace-pre-wrap overflow-x-auto max-h-32 mt-2">
                      {JSON.stringify(updatePlanResult, null, 2)}
                    </pre>
                  </details>
                </section>
              )}
            </div>
          </div>
        ) : activeCategory === 'connection' ? (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-[10px] font-mono text-gray-300 mb-3">Connection</h2>
            <div className="space-y-3 max-w-2xl">
              <section className="p-3 bg-[#111] rounded border border-gray-800">
                <h3 className="text-[10px] font-mono text-gray-200 mb-2">Connection Status</h3>
                <div className="space-y-2 text-[10px]">
                  <div className="flex items-center gap-2">
                    {core.isConnected ? (
                      <ShieldCheck size={14} className="text-emerald-400" />
                    ) : (
                      <ShieldAlert size={14} className="text-red-400" />
                    )}
                    <span className="text-gray-400">Status:</span>
                    <span className={core.isConnected ? 'text-emerald-400' : 'text-red-400'}>
                      {core.isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block mb-0.5">WebSocket URL:</span>
                    <code className="font-mono text-[9px] text-gray-300 break-all bg-black px-2 py-1 rounded block">{core.wsUrl}</code>
                  </div>
                  <DetailRow label="Plugin ID" value={core.pluginId} />
                  {core.lastError && <DetailRow label="Last Error" value={core.lastError} />}
                </div>
              </section>

              <section className="p-3 bg-[#111] rounded border border-gray-800">
                <h3 className="text-[10px] font-mono text-gray-200 mb-2">Authentication</h3>
                <div className="space-y-2 text-[10px]">
                  <div className="flex items-center gap-2">
                    {core.hasToken ? (
                      <Lock size={14} className="text-emerald-400" />
                    ) : (
                      <Unlock size={14} className="text-yellow-400" />
                    )}
                    <span className="text-gray-400">Token in URL:</span>
                    <span className={core.hasToken ? 'text-emerald-400' : 'text-yellow-400'}>
                      {core.hasToken ? 'Present' : 'Not present'}
                    </span>
                  </div>
                  <div className="bg-[#1a1a1a] rounded p-2 text-gray-500">
                    {core.hasToken ? (
                      <span className="text-emerald-400">Auth token is being sent via WebSocket URL.</span>
                    ) : (
                      <span className="text-yellow-400">No auth token detected in WebSocket URL. Connections to remote nodes without a token will be rejected if the remote requires authentication.</span>
                    )}
                  </div>
                </div>
              </section>

              <section className="p-3 bg-[#111] rounded border border-gray-800">
                <h3 className="text-[10px] font-mono text-gray-200 mb-2">Security Notes</h3>
                <ul className="space-y-1.5 text-[10px] text-gray-500">
                  <li className="flex items-start gap-2">
                    <Globe size={12} className="mt-0.5 flex-shrink-0 text-purple-400" />
                    <span>Use <code className="text-purple-400 text-[9px]">SESSIONNODE_TOKEN</code> environment variable to set an auth token on the Go Core side.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Globe size={12} className="mt-0.5 flex-shrink-0 text-purple-400" />
                    <span>The token is validated at WebSocket upgrade time. Without a token, the server runs in development mode (no auth).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Globe size={12} className="mt-0.5 flex-shrink-0 text-purple-400" />
                    <span>Peer-to-peer connections use ed25519 challenge-response authentication, not the shared token.</span>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-[10px] font-mono text-gray-300 mb-3">
              {CATEGORIES.find(c => c.id === activeCategory)?.label || 'General'} Configuration
            </h2>

            {categoryConfigs.length === 0 && (
              <p className="text-gray-600 text-[10px]">No configuration entries for this category.</p>
            )}

            <div className="space-y-2 max-w-2xl">
              {categoryConfigs.map(config => {
                const isDirty = dirtyValues[config.key] !== undefined;
                const displayValue = isDirty ? dirtyValues[config.key].value : config.value;

                return (
                  <div key={config.key} className="p-3 bg-[#111] rounded border border-gray-800">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-mono text-gray-200">{config.key}</label>
                      {isDirty && (
                        <span className="text-[9px] text-yellow-500">modified</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={String(displayValue ?? '')}
                        onChange={e => handleValueChange(config.key, e.target.value)}
                        className="flex-1 px-2.5 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                      />
                      {isDirty && (
                        <button
                          onClick={() => handleSave(config.key)}
                          disabled={saving}
                          className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] rounded transition-colors disabled:opacity-50"
                        >
                          {saving ? '...' : 'Save'}
                        </button>
                      )}
                      <button
                        onClick={() => handleReset(config.key)}
                        disabled={saving}
                        className="px-3 py-1 bg-[#1a1a1a] hover:bg-[#222] text-gray-400 text-[10px] rounded transition-colors"
                      >
                        Reset
                      </button>
                    </div>
                    <div className="text-[9px] text-gray-600 mt-1">
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-20 flex-shrink-0 text-[10px]">{label}:</span>
      <span className="text-gray-300 text-[10px]">{value}</span>
    </div>
  );
}
