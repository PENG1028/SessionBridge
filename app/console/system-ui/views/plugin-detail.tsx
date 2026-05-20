'use client';

import React, { useState, useEffect } from 'react';
import type { CoreClient } from '../../core/core-types';
import { PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';

interface PluginDetailProps {
  core: CoreClient;
  pluginId: string;
  onBack?: () => void;
}

type DetailTab = 'overview' | 'environment' | 'permissions' | 'files' | 'cache' | 'settings' | 'logs' | 'history';

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'environment', label: 'Environment' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'files', label: 'Files' },
  { id: 'cache', label: 'Cache' },
  { id: 'settings', label: 'Settings' },
  { id: 'logs', label: 'Logs' },
  { id: 'history', label: 'History' },
];

/**
 * Plugin Detail — full plugin detail page with 8 tabs.
 * Each tab fetches its own data from Core.
 * Tab state (activeTab) is React state, can be localStorage preference but
 * plugin data truth always comes from Core.
 *
 * Calls: plugin.get, plugin.status, plugin.check, plugin.files.list,
 *        plugin.cache.list, plugin.permissions.*, plugin.config.*,
 *        plugin.history, logs.query(source: plugin)
 */
export function PluginDetail({ core, pluginId, onBack }: PluginDetailProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchPlugin() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const result = await core.call('plugin.get', { pluginId });
      setManifest(result as Record<string, unknown>);
      setPageState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plugin');
      setPageState('error');
    }
  }

  useEffect(() => {
    fetchPlugin();
  }, [core, pluginId]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={8} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchPlugin} /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header with back button */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        {onBack && (
          <button
            onClick={onBack}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            &lt; Plugin Manager
          </button>
        )}
        <h1 className="text-lg font-semibold text-gray-100">{pluginId}</h1>
        {manifest && (
          <>
            <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
              {String((manifest as Record<string, string>)?.version || '—')}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              String((manifest as Record<string, string>)?.status || '') === 'enabled'
                ? 'bg-green-900/50 text-green-400'
                : 'bg-gray-800 text-gray-500'
            }`}>
              {(manifest as Record<string, string>)?.status || 'unknown'}
            </span>
          </>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-gray-800 px-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 p-6">
        <TabContent core={core} pluginId={pluginId} tab={activeTab} manifest={manifest} />
      </div>
    </div>
  );
}

function TabContent({
  core,
  pluginId,
  tab,
  manifest,
}: {
  core: CoreClient;
  pluginId: string;
  tab: DetailTab;
  manifest: Record<string, unknown> | null;
}) {
  switch (tab) {
    case 'overview':
      return <OverviewTab manifest={manifest} />;
    case 'environment':
      return <EnvironmentTab core={core} pluginId={pluginId} />;
    case 'permissions':
      return <PermissionsTab core={core} pluginId={pluginId} />;
    case 'files':
      return <FilesTab core={core} pluginId={pluginId} />;
    case 'cache':
      return <CacheTab core={core} pluginId={pluginId} />;
    case 'settings':
      return <SettingsTab core={core} pluginId={pluginId} />;
    case 'logs':
      return <LogsTab core={core} pluginId={pluginId} />;
    case 'history':
      return <HistoryTab core={core} pluginId={pluginId} />;
  }
}

function OverviewTab({ manifest }: { manifest: Record<string, unknown> | null }) {
  if (!manifest) return <div className="text-gray-500 text-sm">No manifest data available.</div>;

  return (
    <div className="max-w-2xl space-y-4">
      <Section title="Basic Info">
        {Object.entries(manifest).filter(([k]) => !['capabilities', 'contributes', 'requiredBinaries'].includes(k)).map(([key, value]) => (
          <div key={key} className="flex gap-2 text-sm">
            <span className="text-gray-500 w-32 flex-shrink-0">{key}:</span>
            <span className="text-gray-300">{String(value)}</span>
          </div>
        ))}
      </Section>

      {!!manifest.capabilities && (
        <Section title="Declared Capabilities">
          <div className="flex flex-wrap gap-1">
            {(manifest.capabilities as string[]).map((cap: string) => (
              <span key={cap} className="text-xs px-2 py-1 bg-gray-800 text-gray-400 rounded">{cap}</span>
            ))}
          </div>
        </Section>
      )}

      {!!manifest.contributes && (
        <Section title="Contributes">
          <pre className="text-xs text-gray-500 bg-gray-950 p-3 rounded-lg overflow-x-auto">
            {JSON.stringify(manifest.contributes, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}

function EnvironmentTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  const [checks, setChecks] = useState<Array<{ name: string; required: string; current?: string; met: boolean; optional?: boolean }> | null>(null);
  const [loading, setLoading] = useState(false);

  async function runCheck() {
    setLoading(true);
    try {
      const result = await core.call<{ checks: typeof checks }>('plugin.check', { pluginId });
      setChecks(result?.checks || []);
    } catch {
      setChecks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { runCheck(); }, [core, pluginId]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-medium text-gray-300">Environment Check</h3>
        <button
          onClick={runCheck}
          disabled={loading}
          className="text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Run Check Again'}
        </button>
      </div>
      {!checks ? (
        <div className="text-gray-500 text-sm">Running check...</div>
      ) : checks.length === 0 ? (
        <div className="text-gray-500 text-sm">No environment checks defined.</div>
      ) : (
        <div className="space-y-2">
          {checks.map((check, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800 text-sm">
              <span className={check.met ? 'text-green-500' : check.optional ? 'text-gray-500' : 'text-red-500'}>
                {check.met ? '✓' : check.optional ? '—' : '✗'}
              </span>
              <span className="text-gray-200">{check.name}</span>
              <span className="text-xs text-gray-500">
                {check.current ? `v${check.current}` : 'not installed'}
              </span>
              {check.required && (
                <span className="text-xs text-gray-600">
                  (required: {check.required})
                </span>
              )}
              {check.optional && (
                <span className="text-xs text-gray-600 ml-auto">optional</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabPlaceholder title="Permissions" api="plugin.permissions.list / grant / revoke" core={core} pluginId={pluginId} />;
}

function FilesTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabPlaceholder title="Files" api="plugin.files.list" core={core} pluginId={pluginId} />;
}

function CacheTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabPlaceholder title="Cache" api="plugin.cache.list / clear" core={core} pluginId={pluginId} />;
}

function SettingsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabPlaceholder title="Settings" api="plugin.config.get / set, config.schema" core={core} pluginId={pluginId} />;
}

function LogsTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabPlaceholder title="Logs" api="logs.query(source: plugin, pluginId)" core={core} pluginId={pluginId} />;
}

function HistoryTab({ core, pluginId }: { core: CoreClient; pluginId: string }) {
  return <TabPlaceholder title="History" api="plugin.history" core={core} pluginId={pluginId} />;
}

function TabPlaceholder({ title, api, core: _core, pluginId: _pluginId }: { title: string; api: string; core: CoreClient; pluginId: string }) {
  return (
    <div className="text-gray-500 text-sm">
      <p className="font-medium text-gray-400">{title} (Phase 2)</p>
      <p className="mt-1">Core API: {api}</p>
      <p className="text-xs text-gray-600 mt-1">Full implementation uses host-rendered PluginHost components.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
