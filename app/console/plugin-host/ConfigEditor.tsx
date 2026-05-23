'use client';

import { useState, useEffect } from 'react';
import type { CoreClient } from '../core/core-types';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Badge } from '../components/Badge';

interface ConfigEditorProps {
  core: CoreClient;
  pluginId: string;
}

export function ConfigEditor({ core, pluginId }: ConfigEditorProps) {
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
          core.call<Record<string, unknown>>('plugin.config.schema', { pluginId }),
          core.call<Record<string, unknown>>('plugin.config.get', { pluginId }),
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
  }, [core, pluginId]);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const entries = Object.entries(values);
      for (const [key, value] of entries) {
        await core.call('plugin.config.set', { pluginId, key, value });
      }
      setSaveMsg('Saved');
      const configRes = await core.call<Record<string, unknown>>('plugin.config.get', { pluginId });
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

  if (entries.length === 0) {
    return <div className="p-4 text-[11px] text-gray-500">No configuration properties.</div>;
  }

  return (
    <div className="p-4 space-y-3">
      {entries.map(([key, prop]) => {
        const p = prop as Record<string, unknown>;
        const currentVal = values[key];
        return (
          <Card key={key} className="p-3">
            <div className="flex items-center justify-between mb-1">
              <code className="text-xs text-gray-200 font-mono">{key}</code>
              <Badge variant="default">{String(p.type || 'string')}</Badge>
            </div>
            {!!p.description && <p className="text-xs text-gray-500 mb-2">{String(p.description)}</p>}
            <code className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded block truncate">
              {currentVal !== undefined ? JSON.stringify(currentVal) : '(not set)'}
            </code>
          </Card>
        );
      })}
      <div className="flex items-center gap-3 pt-1">
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
