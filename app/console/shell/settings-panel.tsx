'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Search, ChevronRight } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

interface ConfigPropertySchema {
  type: string;
  default?: unknown;
  description?: string;
  enum?: unknown[];
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
  scope?: string;
  requiresRestart?: boolean;
  deprecated?: boolean | string;
  secret?: boolean;
  tags?: string[];
}

interface ConfigContribution {
  extensionId: string;
  title: string;
  properties: Record<string, ConfigPropertySchema>;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

// ── Field Renderer ─────────────────────────────────────────────

function fieldLabel(key: string): string {
  const parts = key.split('.');
  // Return the last part, but for host keys just return the key
  if (parts[0] === 'host') return parts.slice(1).join('.');
  return parts.length > 1 ? parts.slice(1).join('.') : key;
}

function ConfigField({
  keyName,
  schema,
  currentValue,
  isDirty,
  source,
  onChange,
  onReset,
  validationError,
}: {
  keyName: string;
  schema: ConfigPropertySchema;
  currentValue: unknown;
  isDirty: boolean;
  source?: 'Workspace' | 'User' | 'Default';
  onChange: (value: unknown) => void;
  onReset: () => void;
  validationError?: string;
}) {
  const label = fieldLabel(keyName);
  const desc = schema.description;

  // Deprecated
  if (schema.deprecated) {
    return (
      <div className="opacity-30 py-1.5">
        <span className="text-[10px] text-gray-600 line-through">{label}</span>
        <span className="text-[8px] text-yellow-700 ml-2">deprecated</span>
        {typeof schema.deprecated === 'string' && (
          <div className="text-[8px] text-gray-700 mt-0.5">{schema.deprecated}</div>
        )}
      </div>
    );
  }

  let input: React.ReactNode;

  switch (schema.type) {
    case 'boolean':
      input = (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!currentValue}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-purple-500 w-3 h-3"
          />
          <span className="text-[11px] text-gray-300">{desc || label}</span>
        </label>
      );
      break;

    case 'integer':
    case 'number': {
      const numVal = typeof currentValue === 'number' ? currentValue : (schema.default as number ?? 0);
      input = (
        <input
          type="number"
          value={numVal}
          min={schema.minimum}
          max={schema.maximum}
          onChange={(e) => onChange(schema.type === 'integer' ? parseInt(e.target.value, 10) || 0 : parseFloat(e.target.value) || 0)}
          className="w-28 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
        />
      );
      break;
    }

    case 'string': {
      const strVal = typeof currentValue === 'string' ? currentValue : (schema.default as string ?? '');
      if (schema.enum && schema.enum.length > 0) {
        input = (
          <select
            value={strVal}
            onChange={(e) => onChange(e.target.value)}
            className="bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
          >
            {schema.enum.map((opt, i) => (
              <option key={String(opt)} value={String(opt)}>
                {String(opt)}
                {schema.enumDescriptions?.[i] ? ` — ${schema.enumDescriptions[i]}` : ''}
              </option>
            ))}
          </select>
        );
      } else if (schema.secret) {
        input = (
          <input
            type="password"
            value={strVal}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
            placeholder="(not set)"
          />
        );
      } else {
        input = (
          <input
            type="text"
            value={strVal}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
            placeholder={String(schema.default ?? '')}
          />
        );
      }
      break;
    }

    case 'array':
    case 'object':
      input = (
        <div className="bg-[#0d0d0d] border border-gray-800 rounded px-2 py-1 text-[9px] text-gray-600 font-mono max-h-16 overflow-y-auto w-full">
          {currentValue !== undefined ? JSON.stringify(currentValue, null, 2) : '—'}
        </div>
      );
      break;

    default:
      input = <span className="text-[9px] text-gray-700">Unknown type: {schema.type}</span>;
  }

  return (
    <div className={`py-2 ${isDirty ? 'border-l-2 border-purple-500 pl-3 -ml-1' : 'pl-2'}`}>
      {/* Label row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-gray-200 font-mono">{label}</span>
            {schema.requiresRestart && (
              <span className="text-[7px] text-yellow-600 bg-yellow-900/20 px-1 rounded">restart</span>
            )}
            {schema.secret && (
              <span className="text-[7px] text-gray-600 bg-gray-800 px-1 rounded">secret</span>
            )}
            {source && (
              <span className={`text-[7px] px-1 rounded ${
                source === 'Workspace' ? 'text-cyan-400 bg-cyan-900/20'
                : source === 'User' ? 'text-emerald-400 bg-emerald-900/20'
                : 'text-gray-600 bg-gray-800'
              }`}>{source}</span>
            )}
          </div>
          {desc && schema.type !== 'boolean' && (
            <div className="text-[9px] text-gray-500 mt-0.5">{desc}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {schema.type !== 'boolean' && input}
          {schema.type === 'boolean' && input}
          {(isDirty || currentValue !== schema.default) && (
            <button
              onClick={onReset}
              className="text-[8px] text-gray-600 hover:text-gray-400 transition-colors shrink-0"
              title="Reset to default"
            >
              reset
            </button>
          )}
        </div>
      </div>
      {/* Meta row */}
      <div className="flex items-center gap-2 mt-0.5">
        {isDirty && <span className="text-[7px] text-purple-400">modified</span>}
        {schema.minimum !== undefined && schema.maximum !== undefined && (
          <span className="text-[7px] text-gray-700">min: {schema.minimum} max: {schema.maximum}</span>
        )}
        {validationError && (
          <span className="text-[8px] text-red-400">{validationError}</span>
        )}
      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editScope, setEditScope] = useState<'user' | 'workspace'>('workspace');
  const [modifiedOnly, setModifiedOnly] = useState(false);

  const [configs, setConfigs] = useState<ConfigContribution[]>([]);
  const [userValues, setUserValues] = useState<Record<string, unknown>>({});
  const [workspaceValues, setWorkspaceValues] = useState<Record<string, unknown>>({});
  const [dirtyMap, setDirtyMap] = useState<Map<string, unknown>>(new Map());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string[]>>({});

  // Load schema + values from both scopes
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [schemaRes, userRes, wsRes] = await Promise.all([
        fetch('/api/configuration/schema'),
        fetch('/api/configuration/values?scope=user'),
        fetch('/api/configuration/values?scope=workspace'),
      ]);
      if (!schemaRes.ok) throw new Error(`Schema: ${schemaRes.status}`);
      if (!userRes.ok) throw new Error(`User values: ${userRes.status}`);
      if (!wsRes.ok) throw new Error(`Workspace values: ${wsRes.status}`);
      const schemaData = await schemaRes.json();
      const userData = await userRes.json();
      const wsData = await wsRes.json();
      setConfigs(schemaData.contributions || []);
      setUserValues(userData.values || {});
      setWorkspaceValues(wsData.values || {});
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchData();
  }, [open, fetchData]);

  // Compute effective value and source for a key
  function effectiveValue(key: string): unknown {
    if (dirtyMap.has(key)) return dirtyMap.get(key);
    if (key in workspaceValues) return workspaceValues[key];
    if (key in userValues) return userValues[key];
    return undefined; // caller falls back to schema.default
  }

  type ValueSource = 'Workspace' | 'User' | 'Default';
  function valueSource(key: string): ValueSource {
    if (dirtyMap.has(key)) return editScope === 'workspace' ? 'Workspace' : 'User';
    if (key in workspaceValues) return 'Workspace';
    if (key in userValues) return 'User';
    return 'Default';
  }

  // Change handler
  const handleChange = useCallback((key: string, value: unknown) => {
    setDirtyMap((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
    setValidationErrors((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Reset single key — delete from whichever scope has it
  const handleReset = useCallback(async (key: string) => {
    const src = valueSource(key);
    const resetScope: string = src === 'Workspace' ? 'workspace' : src === 'User' ? 'user' : editScope;
    try {
      const res = await fetch(`/api/configuration/values?scope=${resetScope}&key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        setValidationErrors((prev) => ({ ...prev, [key]: [err.error || 'Reset failed'] }));
        return;
      }
      // Clear from appropriate scope store
      if (resetScope === 'workspace') {
        setWorkspaceValues((prev) => { const next = { ...prev }; delete next[key]; return next; });
      } else {
        setUserValues((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
      setDirtyMap((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } catch (err) {
      setValidationErrors((prev) => ({ ...prev, [key]: [(err as Error).message] }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editScope, userValues, workspaceValues]);

  // Save all dirty
  const handleSaveAll = useCallback(async () => {
    if (dirtyMap.size === 0) return;
    setSaving(true);
    const errors: Record<string, string[]> = {};
    for (const [key, value] of dirtyMap.entries()) {
      try {
        const res = await fetch('/api/configuration/values', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: editScope, key, value }),
        });
        if (!res.ok) {
          const err = await res.json();
          errors[key] = [err.error || 'Save failed'].concat(err.details || []);
        } else {
          if (editScope === 'workspace') {
            setWorkspaceValues((prev) => ({ ...prev, [key]: value }));
          } else {
            setUserValues((prev) => ({ ...prev, [key]: value }));
          }
        }
      } catch (err) {
        errors[key] = [(err as Error).message];
      }
    }
    setValidationErrors(errors);
    const savedKeys = [...dirtyMap.keys()].filter((k) => !errors[k]);
    if (savedKeys.length > 0) {
      setDirtyMap((prev) => {
        const next = new Map(prev);
        for (const k of savedKeys) next.delete(k);
        return next;
      });
    }
    setSaving(false);
  }, [dirtyMap, editScope]);

  // Toggle collapse
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Filter + search
  const filteredConfigs = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return configs
      .map((ext) => {
        const entries = Object.entries(ext.properties).filter(([key, schema]) => {
          // Modified-only filter
          if (modifiedOnly && !dirtyMap.has(key)) return false;
          // Search filter
          if (q) {
            return (
              key.toLowerCase().includes(q) ||
              (schema.description || '').toLowerCase().includes(q) ||
              String(schema.default ?? '').toLowerCase().includes(q) ||
              (schema.enum || []).some((e) => String(e).toLowerCase().includes(q))
            );
          }
          return true;
        });
        return { ...ext, filteredEntries: entries };
      })
      .filter((ext) => ext.filteredEntries.length > 0);
  }, [configs, searchQuery, modifiedOnly, dirtyMap]);

  // Sort: host first, then alphabetical
  const sortedConfigs = useMemo(() => {
    return [...filteredConfigs].sort((a, b) => {
      if (a.extensionId === 'host' && b.extensionId !== 'host') return -1;
      if (b.extensionId === 'host' && a.extensionId !== 'host') return 1;
      return a.title.localeCompare(b.title);
    });
  }, [filteredConfigs]);

  if (!open) return null;

  const totalKeys = configs.reduce((sum, c) => sum + Object.keys(c.properties).length, 0);
  const filteredKeys = sortedConfigs.reduce((sum, c) => sum + c.filteredEntries.length, 0);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-[#151515] border-l border-gray-700 shadow-2xl shadow-black/60 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <span className="text-gray-200 text-sm font-bold">Settings</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + toolbar */}
        <div className="px-4 py-2 border-b border-gray-800 space-y-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search settings (${totalKeys} total)...`}
              className="w-full bg-[#0d0d0d] border border-gray-700 rounded pl-7 pr-3 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 placeholder-gray-700"
            />
            {searchQuery && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-600">
                {filteredKeys}/{totalKeys}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Edit target toggle */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-600">Save to:</span>
                <button
                  onClick={() => setEditScope('user')}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                    editScope === 'user'
                      ? 'text-purple-400 border-purple-700 bg-purple-900/20'
                      : 'text-gray-600 border-gray-800 hover:text-gray-400'
                  }`}
                >
                  User
                </button>
                <button
                  onClick={() => setEditScope('workspace')}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                    editScope === 'workspace'
                      ? 'text-purple-400 border-purple-700 bg-purple-900/20'
                      : 'text-gray-600 border-gray-800 hover:text-gray-400'
                  }`}
                >
                  Workspace
                </button>
              </div>

              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={modifiedOnly}
                  onChange={(e) => setModifiedOnly(e.target.checked)}
                  className="accent-purple-500 w-2.5 h-2.5"
                />
                <span className="text-[9px] text-gray-600">Modified</span>
              </label>
            </div>

            {dirtyMap.size > 0 && (
              <button
                onClick={handleSaveAll}
                disabled={saving}
                className="px-2.5 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] rounded border border-purple-600 transition-colors flex items-center gap-1"
              >
                {saving ? (
                  <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving</>
                ) : (
                  `Save (${dirtyMap.size})`
                )}
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-600 text-xs gap-2">
              <span className="w-3 h-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
              Loading settings...
            </div>
          ) : error ? (
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/30 rounded">
                <span className="text-[10px] text-red-400 flex-1">{error}</span>
                <button onClick={fetchData} className="text-[9px] text-purple-400 hover:text-purple-300">retry</button>
              </div>
            </div>
          ) : sortedConfigs.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-700 text-[10px]">
              {searchQuery ? 'No settings match your search' : 'No settings registered'}
            </div>
          ) : (
            <div className="py-2">
              {sortedConfigs.map((ext) => {
                const isCollapsed = collapsed[ext.extensionId] ?? false;
                const modCount = ext.filteredEntries.filter(([k]) => dirtyMap.has(k)).length;

                return (
                  <div key={ext.extensionId}>
                    {/* Group header */}
                    <button
                      onClick={() => toggleCollapse(ext.extensionId)}
                      className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left sticky top-0 bg-[#151515] border-b border-gray-800/50"
                    >
                      <ChevronRight
                        className={`w-3 h-3 text-gray-600 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                      />
                      <span className="text-[11px] font-semibold text-gray-300">{ext.title}</span>
                      <span className="text-[9px] text-gray-600">({ext.filteredEntries.length})</span>
                      {modCount > 0 && (
                        <span className="text-[8px] text-purple-400 bg-purple-900/20 px-1 py-0.5 rounded ml-auto">
                          {modCount} changed
                        </span>
                      )}
                    </button>

                    {/* Group body */}
                    {!isCollapsed && (
                      <div className="px-4 divide-y divide-gray-800/30">
                        {ext.filteredEntries.map(([key, schema]) => {
                          const isDirty = dirtyMap.has(key);
                          const eff = effectiveValue(key);
                          const currentValue = eff !== undefined ? eff : (schema.default as unknown);
                          const source = valueSource(key);
                          const errs = validationErrors[key] || [];

                          return (
                            <ConfigField
                              key={key}
                              keyName={key}
                              schema={schema}
                              currentValue={currentValue}
                              isDirty={isDirty}
                              source={source}
                              onChange={(v) => handleChange(key, v)}
                              onReset={() => handleReset(key)}
                              validationError={errs[0]}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
