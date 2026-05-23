'use client';

import React, { useState, useEffect } from 'react';
import type { ComponentType } from 'react';
import type { CoreClient } from '../core/core-types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import type { TableColumn } from '../components/Table';
import { StatusIndicator } from './StatusIndicator';

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

  if (loading) return <div className="p-4 text-[11px] text-gray-500">Loading permissions...</div>;
  if (error) return <div className="p-4 text-[11px] text-red-400">{error}</div>;

  const perms = safeArray(data?.permissions);

  if (perms.length === 0) return <div className="p-4 text-[11px] text-gray-500">No permissions declared.</div>;

  return (
    <div className="p-4">
      <h3 className="text-[11px] font-medium text-gray-300 mb-3">Declared Permissions</h3>
      <div className="space-y-2">
        {perms.map((p, i) => (
          <Card key={i} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <code className="text-xs text-gray-200 font-mono">{str(p.id)}</code>
              <DefaultBadge value={str(p.default)} />
              <GrantBadge grant={p.grant as Record<string, unknown> | undefined | null} />
            </div>
            <p className="text-xs text-gray-500 mb-1">{str(p.description)}</p>
            {Array.isArray(p.capabilities) && (
              <div className="flex flex-wrap gap-1">
                {(p.capabilities as string[]).map(c => <Badge key={c}>{c}</Badge>)}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function grantVariant(mode: string): 'success' | 'warning' | 'danger' | 'default' {
  if (mode === 'allow') return 'success';
  if (mode === 'ask') return 'warning';
  if (mode === 'deny') return 'danger';
  return 'default';
}

function GrantBadge({ grant }: { grant: Record<string, unknown> | undefined | null }) {
  if (!grant) return <span className="text-[10px] text-gray-600">grant: not set</span>;
  const mode = str(grant.mode);
  return <Badge variant={grantVariant(mode)}>grant: {mode}</Badge>;
}

function DefaultBadge({ value }: { value: string }) {
  return <Badge variant={grantVariant(value)}>{value}</Badge>;
}

// ─── PluginFilesTable ───────────────────────────────────────────────

const fileColumns: TableColumn<Record<string, unknown>>[] = [
  { key: 'id', label: 'ID', className: 'font-mono' },
  {
    key: 'path', label: 'Path',
    render: v => <span className="text-gray-500 font-mono max-w-60 truncate block" title={String(v)}>{String(v)}</span>,
    className: 'font-mono',
  },
  {
    key: 'clearable', label: 'Clearable',
    render: v => v ? <Badge variant="warning">yes</Badge> : <span className="text-gray-600 text-[10px]">no</span>,
  },
];

export function PluginFilesTable({ core, config }: HostComponentProps) {
  const { data, loading, error } = useCoreCall<Record<string, unknown>>(core, 'plugin.files.list', { pluginId: config.pluginId });

  if (loading) return <div className="p-4 text-[11px] text-gray-500">Loading files...</div>;
  if (error) return <div className="p-4 text-[11px] text-red-400">{error}</div>;

  const files = safeArray(data?.files);

  return (
    <div className="p-4">
      <h3 className="text-[11px] font-medium text-gray-300 mb-3">File Locations</h3>
      <Table columns={fileColumns} data={files} emptyMessage="No files declared." />
    </div>
  );
}

// ─── PluginCacheTable ───────────────────────────────────────────────

export function PluginCacheTable({ core, config }: HostComponentProps) {
  const { data, loading, error } = useCoreCall<Record<string, unknown>>(core, 'plugin.cache.list', { pluginId: config.pluginId });

  if (loading) return <div className="p-4 text-[11px] text-gray-500">Loading cache entries...</div>;
  if (error) return <div className="p-4 text-[11px] text-red-400">{error}</div>;

  const caches = safeArray(data?.caches);

  if (caches.length === 0) return <div className="p-4 text-[11px] text-gray-500">No cache entries declared.</div>;

  return (
    <div className="p-4">
      <h3 className="text-[11px] font-medium text-gray-300 mb-3">Cache Entries</h3>
      <div className="space-y-2">
        {caches.map((c, i) => (
          <Card key={i} className="p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <code className="text-xs text-gray-200 font-mono">{str(c.id)}</code>
                {!!c.risk && <RiskBadge risk={str(c.risk)} />}
              </div>
              <p className="text-xs text-gray-500 truncate">{str(c.path)}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function riskVariant(risk: string): 'success' | 'warning' | 'danger' | 'default' {
  if (risk === 'low') return 'success';
  if (risk === 'medium') return 'warning';
  if (risk === 'high') return 'danger';
  return 'default';
}

function RiskBadge({ risk }: { risk: string }) {
  return <Badge variant={riskVariant(risk)}>{risk}</Badge>;
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

  if (loading) return <div className="p-4 text-[11px] text-gray-500">Loading config...</div>;
  if (error) return <div className="p-4 text-[11px] text-red-400">{error}</div>;
  if (!schema) return <div className="p-4 text-[11px] text-gray-500">No configuration schema.</div>;

  const properties = (schema.properties as Record<string, unknown>) || {};
  const entries = Object.entries(properties);

  if (entries.length === 0) return <div className="p-4 text-[11px] text-gray-500">No configuration properties.</div>;

  return (
    <div className="p-4">
      <h3 className="text-[11px] font-medium text-gray-300 mb-3">Configuration</h3>
      <div className="space-y-3">
        {entries.map(([key, prop]) => {
          const p = prop as Record<string, unknown>;
          const currentVal = values[key];
          return (
            <Card key={key} className="p-3">
              <div className="flex items-center justify-between mb-1">
                <code className="text-xs text-gray-200 font-mono">{key}</code>
                <Badge variant="default">{String(p.type || 'string')}</Badge>
              </div>
              {!!p.description && <p className="text-xs text-gray-500 mb-1">{String(p.description)}</p>}
              <code className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded block truncate">
                {currentVal !== undefined ? JSON.stringify(currentVal) : '(not set)'}
              </code>
            </Card>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-2">
        <Button variant="primary" size="md" onClick={handleSave} loading={saving}>
          Save to Core
        </Button>
        {saveMsg && (
          <span className={`text-[10px] ${saveMsg === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>{saveMsg}</span>
        )}
      </div>
    </div>
  );
}

// ─── PluginInstallHistoryPanel ──────────────────────────────────────

export function PluginInstallHistoryPanel({ core, config }: HostComponentProps) {
  const { data, loading, error } = useCoreCall<Record<string, unknown>>(core, 'plugin.history', { pluginId: config.pluginId });
  const notImpl = (data?.status as string) === 'not_implemented';

  if (loading) return <div className="p-4 text-[11px] text-gray-500">Loading history...</div>;
  if (error) return <div className="p-4 text-[11px] text-red-400">{error}</div>;
  if (notImpl) return <div className="p-4 text-[11px] text-gray-500">History tracking not available in Phase 1.</div>;

  const events = safeArray(data?.events);

  if (events.length === 0) return <div className="p-4 text-[11px] text-gray-500">No install history.</div>;

  return (
    <div className="p-4">
      <h3 className="text-[11px] font-medium text-gray-300 mb-3">Install History</h3>
      <div className="space-y-2">
        {events.map((evt, i) => (
          <Card key={i} className="p-3 flex items-start gap-3">
            <StatusIndicator status="idle" className="mt-1.5" />
            <div>
              <span className="text-xs text-gray-300">{str(evt.action) || 'event'}</span>
              {!!evt.version && <span className="text-xs text-gray-600 ml-2">v{str(evt.version)}</span>}
              {!!evt.timestamp && <p className="text-xs text-gray-600 mt-0.5">{str(evt.timestamp)}</p>}
            </div>
          </Card>
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
