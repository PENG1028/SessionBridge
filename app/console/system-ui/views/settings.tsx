'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient, ConfigEntry } from '../../core/core-types';
import { PageLoading, PageError, PageOffline, type PageState } from './page-utils';

type SettingsCategory = 'general' | 'core' | 'node' | 'plugins' | 'access-control';

const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'core', label: 'Core' },
  { id: 'node', label: 'Node' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'access-control', label: 'Access Control' },
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

  async function fetchConfigs() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const result = await core.call<ConfigEntry[]>('config.list');
      setConfigs(result || []);
      setPageState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
      setPageState('error');
    }
  }

  useEffect(() => {
    fetchConfigs();
  }, [core]);

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
    if (activeCategory === 'core') return c.key.startsWith('host.') || c.key.startsWith('log.') || c.key.startsWith('session.') || c.key.startsWith('relay.') || c.key.startsWith('crypto.');
    if (activeCategory === 'node') return c.key.startsWith('node.');
    if (activeCategory === 'plugins') return c.key.startsWith('plugin.');
    if (activeCategory === 'access-control') return c.key.startsWith('auth.') || c.key.startsWith('access.');
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

        {/* Config content */}
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
                      onClick={() => core.call('config.reset', { key: config.key })}
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
      </div>
    </div>
  );
}
