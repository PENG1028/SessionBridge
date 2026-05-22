'use client';

import React, { useState, useEffect } from 'react';
import type { ComponentType } from 'react';
import type { CoreClient } from '../core/core-types';

// ─── HostComponentProps — props for host-rendered components ───
export interface HostComponentProps {
  core: CoreClient;
  config: {
    componentId: string;
    pluginId: string;
    title: string;
    icon?: string;
  };
  container: {
    surface: string;
    width: number;
    height: number;
  };
  session?: { id: string; kind: string; status: string };
  node?: { id: string; name: string };
}

// ─── HostComponentRegistry ─────────────────────────────────────
export class HostComponentRegistry {
  private _components = new Map<string, ComponentType<HostComponentProps>>();

  register(componentId: string, component: ComponentType<HostComponentProps>): void {
    this._components.set(componentId, component);
  }

  get(componentId: string): ComponentType<HostComponentProps> | undefined {
    return this._components.get(componentId);
  }

  has(componentId: string): boolean {
    return this._components.has(componentId);
  }

  getAll(): Map<string, ComponentType<HostComponentProps>> {
    return new Map(this._components);
  }
}

export const hostComponentRegistry = new HostComponentRegistry();

// ─── Shared hook ──────────────────────────────────────────────────

function useCoreCall<T>(core: CoreClient, method: string, params: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    core.call<T>(method, params)
      .then(result => { if (!cancelled) { setData(result); setLoading(false); } })
      .catch((err: Error) => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [core, method, JSON.stringify(params)]);

  return { data, loading, error };
}

// ─── PluginPermissionPanel ──────────────────────────────────────────

export function PluginPermissionPanel({ core, config }: HostComponentProps) {
  const { data, loading, error } = useCoreCall<Record<string, unknown>>(core, 'plugin.permissions.list', { pluginId: config.pluginId });

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading permissions...</div>;
  if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;

  const perms = safeArray(data?.permissions);

  if (perms.length === 0) return <div className="p-4 text-sm text-gray-500">No permissions declared.</div>;

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Declared Permissions</h3>
      <div className="space-y-2">
        {perms.map((p, i) => (
          <div key={i} className="px-3 py-2 bg-gray-900 rounded-lg border border-gray-800">
            <div className="flex items-center gap-2 mb-1">
              <code className="text-xs text-gray-200 font-mono">{str(p.id)}</code>
              <DefaultBadge value={str(p.default)} />
              <GrantBadge grant={p.grant as Record<string, unknown> | undefined | null} />
            </div>
            <p className="text-xs text-gray-500 mb-1">{str(p.description)}</p>
            {Array.isArray(p.capabilities) && (
              <div className="flex flex-wrap gap-1">
                {(p.capabilities as string[]).map(c => (
                  <span key={c} className="text-xs px-1 py-0.5 bg-gray-800 text-gray-500 rounded">{c}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GrantBadge({ grant }: { grant: Record<string, unknown> | undefined | null }) {
  if (!grant) return <span className="text-xs text-gray-600">grant: not set</span>;
  const mode = str(grant.mode);
  const colors: Record<string, string> = {
    allow: 'bg-green-900/50 text-green-400',
    ask: 'bg-yellow-900/50 text-yellow-400',
    deny: 'bg-red-900/50 text-red-400',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[mode] || 'bg-gray-800 text-gray-500'}`}>
      grant: {mode}
    </span>
  );
}

function DefaultBadge({ value }: { value: string }) {
  const colors: Record<string, string> = {
    allow: 'bg-green-900/50 text-green-400',
    ask: 'bg-yellow-900/50 text-yellow-400',
    deny: 'bg-red-900/50 text-red-400',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[value] || 'bg-gray-800 text-gray-500'}`}>{value}</span>
  );
}

// ─── PluginFilesTable ───────────────────────────────────────────────

export function PluginFilesTable({ core, config }: HostComponentProps) {
  const { data, loading, error } = useCoreCall<Record<string, unknown>>(core, 'plugin.files.list', { pluginId: config.pluginId });

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading files...</div>;
  if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;

  const files = safeArray(data?.files);

  if (files.length === 0) return <div className="p-4 text-sm text-gray-500">No files declared.</div>;

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">File Locations</h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-800">
            <th className="pb-2 pr-3">ID</th>
            <th className="pb-2 pr-3">Path</th>
            <th className="pb-2">Clearable</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => (
            <tr key={i} className="border-b border-gray-800/50 text-gray-400">
              <td className="py-1.5 pr-3 font-mono">{str(f.id)}</td>
              <td className="py-1.5 pr-3 font-mono text-gray-500 max-w-60 truncate" title={str(f.path)}>{str(f.path)}</td>
              <td className="py-1.5">{f.clearable ? <span className="text-yellow-400">yes</span> : <span className="text-gray-600">no</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── PluginCacheTable ───────────────────────────────────────────────

export function PluginCacheTable({ core, config }: HostComponentProps) {
  const { data, loading, error } = useCoreCall<Record<string, unknown>>(core, 'plugin.cache.list', { pluginId: config.pluginId });

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading cache entries...</div>;
  if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;

  const caches = safeArray(data?.caches);

  if (caches.length === 0) return <div className="p-4 text-sm text-gray-500">No cache entries declared.</div>;

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Cache Entries</h3>
      <div className="space-y-2">
        {caches.map((c, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <code className="text-xs text-gray-200 font-mono">{str(c.id)}</code>
                {!!c.risk && (
                  <RiskBadge risk={str(c.risk)} />
                )}
              </div>
              <p className="text-xs text-gray-500 truncate">{str(c.path)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const colors: Record<string, string> = {
    low: 'bg-green-900/50 text-green-400',
    medium: 'bg-yellow-900/50 text-yellow-400',
    high: 'bg-red-900/50 text-red-400',
  };
  return <span className={`text-xs px-1.5 py-0.5 rounded ${colors[risk] || 'bg-gray-800 text-gray-500'}`}>{risk}</span>;
}

// ─── PluginConfigForm ───────────────────────────────────────────────

export function PluginConfigForm({ core, config }: HostComponentProps) {
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [schemaRes, configRes] = await Promise.all([
          core.call<Record<string, unknown>>('plugin.config.schema', { pluginId: config.pluginId }),
          core.call<Record<string, unknown>>('plugin.config.get', { pluginId: config.pluginId }),
        ]);
        if (cancelled) return;
        setSchema((schemaRes?.schema as Record<string, unknown>) || null);
        setValues((configRes?.config as Record<string, unknown>) || {});
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [core, config.pluginId]);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      // Core plugin.config.set expects { key, value } per entry.
      const entries = Object.entries(values);
      for (const [key, value] of entries) {
        await core.call('plugin.config.set', { pluginId: config.pluginId, key, value });
      }
      setSaveMsg('Saved');
      // Refresh values
      const configRes = await core.call<Record<string, unknown>>('plugin.config.get', { pluginId: config.pluginId });
      setValues((configRes?.config as Record<string, unknown>) || {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setSaveMsg(msg.includes('not_implemented') ? 'Save not supported by Go Core' : msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading config...</div>;
  if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;
  if (!schema) return <div className="p-4 text-sm text-gray-500">No configuration schema.</div>;

  const properties = (schema.properties as Record<string, unknown>) || {};
  const entries = Object.entries(properties);

  if (entries.length === 0) return <div className="p-4 text-sm text-gray-500">No configuration properties.</div>;

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Configuration</h3>
      <div className="space-y-3">
        {entries.map(([key, prop]) => {
          const p = prop as Record<string, unknown>;
          const currentVal = values[key];
          return (
            <div key={key} className="px-3 py-2 bg-gray-900 rounded-lg border border-gray-800">
              <div className="flex items-center justify-between mb-1">
                <code className="text-xs text-gray-200 font-mono">{key}</code>
                <span className="text-xs text-gray-600">{String(p.type || 'string')}</span>
              </div>
              {!!p.description && <p className="text-xs text-gray-500 mb-1">{String(p.description)}</p>}
              <code className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">
                {currentVal !== undefined ? JSON.stringify(currentVal) : '(not set)'}
              </code>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save to Core'}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>{saveMsg}</span>
        )}
      </div>
    </div>
  );
}

// ─── PluginInstallHistoryPanel ──────────────────────────────────────

export function PluginInstallHistoryPanel({ core, config }: HostComponentProps) {
  const { data, loading, error } = useCoreCall<Record<string, unknown>>(core, 'plugin.history', { pluginId: config.pluginId });
  const notImpl = (data?.status as string) === 'not_implemented';

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading history...</div>;
  if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;
  if (notImpl) return <div className="p-4 text-sm text-gray-500">History tracking not available in Phase 1.</div>;

  const events = safeArray(data?.events);

  if (events.length === 0) return <div className="p-4 text-sm text-gray-500">No install history.</div>;

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Install History</h3>
      <div className="space-y-2">
        {events.map((evt, i) => (
          <div key={i} className="flex items-start gap-3 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800">
            <div className="w-1.5 h-1.5 rounded-full bg-gray-600 mt-1.5 flex-shrink-0" />
            <div>
              <span className="text-xs text-gray-300">{str(evt.action) || 'event'}</span>
              {!!evt.version && <span className="text-xs text-gray-600 ml-2">v{str(evt.version)}</span>}
              {!!evt.timestamp && <p className="text-xs text-gray-600 mt-0.5">{str(evt.timestamp)}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function safeArray(val: unknown): Record<string, unknown>[] {
  if (Array.isArray(val)) return val as Record<string, unknown>[];
  return [];
}

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val === null || val === undefined) return '';
  return String(val);
}

// ─── Register built-in host-rendered components ─────────────────────
export function registerBuiltinHostComponents(): void {
  hostComponentRegistry.register('PluginCacheTable', PluginCacheTable);
  hostComponentRegistry.register('PluginPermissionPanel', PluginPermissionPanel);
  hostComponentRegistry.register('PluginConfigForm', PluginConfigForm);
  hostComponentRegistry.register('PluginFilesTable', PluginFilesTable);
  hostComponentRegistry.register('PluginInstallHistoryPanel', PluginInstallHistoryPanel);
}
