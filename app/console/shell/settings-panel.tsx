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

  // ── Admin auth state ──────────────────────────────────────────
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [pwFormOpen, setPwFormOpen] = useState(false);
  const [adminState, setAdminState] = useState<{
    authEnabled: boolean; tokenSet: boolean; loading: boolean;
  }>({ authEnabled: false, tokenSet: false, loading: true });
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [sessions, setSessions] = useState<{ id: string; createdAt: string; expiresAt: string; userAgent: string }[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [toggleMsg, setToggleMsg] = useState('');

  // ── Update state ──────────────────────────────────────────────
  const [updateExpanded, setUpdateExpanded] = useState(false);
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'uptodate' | 'error' | 'updating' | 'complete'>('idle');
  const [updateInfo, setUpdateInfo] = useState<{
    currentHash?: string; latestHash?: string; behindCount?: number;
    currentVersion?: string; currentBranch?: string; error?: string | null;
  }>({});
  const [updateLog, setUpdateLog] = useState<string[]>([]);

  // Load schema + values from both scopes
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [schemaRes, userRes, wsRes, authRes] = await Promise.all([
        fetch('/api/configuration/schema'),
        fetch('/api/configuration/values?scope=user'),
        fetch('/api/configuration/values?scope=workspace'),
        fetch('/api/auth/check'),
      ]);
      if (!schemaRes.ok) throw new Error(`Schema: ${schemaRes.status}`);
      if (!userRes.ok) throw new Error(`User values: ${userRes.status}`);
      if (!wsRes.ok) throw new Error(`Workspace values: ${wsRes.status}`);
      const schemaData = await schemaRes.json();
      const userData = await userRes.json();
      const wsData = await wsRes.json();
      if (authRes.ok) {
        const authData = await authRes.json();
        setAdminState(prev => ({ ...prev, authEnabled: authData.authEnabled, tokenSet: authData.tokenSet, loading: false }));
      }
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
          ) : (<>
            {/* ── Admin Auth Section ─────────────────────────────── */}
            <div>
              <button
                onClick={() => setAdminExpanded(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left sticky top-0 bg-[#151515] border-b border-gray-800/50"
              >
                <ChevronRight className={`w-3 h-3 text-gray-600 transition-transform ${adminExpanded ? 'rotate-90' : ''}`} />
                <span className="text-[11px] font-semibold text-gray-300">Admin</span>
                <span className="text-[9px] text-gray-600">Authentication</span>
              </button>

              {adminExpanded && (
                <div className="px-4 divide-y divide-gray-800/30">
                  {adminState.loading ? (
                    <div className="py-4 text-[10px] text-gray-600">Loading...</div>
                  ) : (
                    <>
                      {/* Auth toggle */}
                      <div className="flex items-center justify-between py-3">
                        <div>
                          <div className="text-[11px] text-gray-200">Require password for remote access</div>
                          <div className="text-[9px] text-gray-600 mt-0.5">
                            {!adminState.tokenSet
                              ? 'No password set — set one below to enable remote access protection'
                              : adminState.authEnabled
                                ? 'Remote access requires login'
                                : 'Remote access does not require login'
                            }
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            if (!adminState.tokenSet) { setToggleMsg('Set a password first'); setTimeout(() => setToggleMsg(''), 2000); return; }
                            setToggleMsg('');
                            try {
                              const r = await fetch('/api/auth/toggle', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ enabled: !adminState.authEnabled }),
                              });
                              if (!r.ok) { const d = await r.json(); setToggleMsg(d.error || 'Failed'); return; }
                              const d = await r.json();
                              setAdminState(prev => ({ ...prev, authEnabled: d.authEnabled }));
                              setToggleMsg(d.authEnabled ? 'ON' : 'OFF');
                              setTimeout(() => setToggleMsg(''), 2000);
                            } catch { setToggleMsg('Error'); }
                          }}
                          className={`relative w-9 h-5 rounded-full transition-colors ${
                            !adminState.tokenSet ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                          } ${adminState.authEnabled ? 'bg-purple-600' : 'bg-gray-700'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                            adminState.authEnabled ? 'translate-x-4' : ''
                          }`} />
                        </button>
                      </div>
                      {toggleMsg && (
                        <div className="text-[9px] text-purple-400 pb-1 -mt-1">{toggleMsg}</div>
                      )}

                      {/* Set / Change password */}
                      <div className="py-3">
                        <button
                          onClick={() => { setPwFormOpen(v => !v); setPwMsg(null); setOldPw(''); }}
                          className="text-[11px] text-gray-300 hover:text-gray-100 transition-colors"
                        >
                          {pwFormOpen ? '−' : '+'} {adminState.tokenSet ? 'Change password' : 'Set password'}
                        </button>
                        {pwFormOpen && (
                          <div className="mt-2 space-y-2">
                            {adminState.tokenSet && (
                              <input
                                type="password" value={oldPw}
                                onChange={e => setOldPw(e.target.value)}
                                placeholder="Current password"
                                className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500"
                              />
                            )}
                            <input
                              type="password" value={newPw}
                              onChange={e => setNewPw(e.target.value)}
                              placeholder="New password (min 8 chars)"
                              className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500"
                            />
                            <input
                              type="password" value={confirmPw}
                              onChange={e => setConfirmPw(e.target.value)}
                              placeholder="Confirm new password"
                              className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={async () => {
                                  setPwMsg(null);
                                  if (newPw.length < 8) { setPwMsg({ type: 'error', text: 'Min 8 characters' }); return; }
                                  if (newPw !== confirmPw) { setPwMsg({ type: 'error', text: 'Passwords do not match' }); return; }
                                  try {
                                    const endpoint = adminState.tokenSet ? '/api/auth/change-password' : '/api/auth/setup';
                                    const body = adminState.tokenSet
                                      ? JSON.stringify({ oldToken: oldPw, newToken: newPw })
                                      : JSON.stringify({ password: newPw, confirm: newPw });
                                    const r = await fetch(endpoint, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body,
                                    });
                                    const d = await r.json();
                                    if (r.ok) {
                                      setPwMsg({ type: 'ok', text: adminState.tokenSet ? 'Password changed' : 'Password set' });
                                      setOldPw(''); setNewPw(''); setConfirmPw('');
                                      // Refetch auth state so toggle updates
                                      if (!adminState.tokenSet) {
                                        const authRes = await fetch('/api/auth/check');
                                        if (authRes.ok) {
                                          const authData = await authRes.json();
                                          setAdminState(prev => ({ ...prev, authEnabled: authData.authEnabled, tokenSet: authData.tokenSet }));
                                        }
                                      }
                                    } else {
                                      setPwMsg({ type: 'error', text: d.error || 'Failed' });
                                    }
                                  } catch { setPwMsg({ type: 'error', text: 'Network error' }); }
                                }}
                                className="px-2.5 py-1 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 transition-colors"
                              >{adminState.tokenSet ? 'Change' : 'Set'}</button>
                              {pwMsg && (
                                <span className={`text-[9px] ${pwMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {pwMsg.text}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Sessions */}
                      <div className="py-3">
                        <button
                          onClick={async () => {
                            if (sessions.length === 0 && !sessionsLoading) {
                              setSessionsLoading(true);
                              try {
                                const r = await fetch('/api/auth/sessions');
                                if (r.ok) setSessions(await r.json());
                              } catch {}
                              setSessionsLoading(false);
                            } else {
                              setSessions([]);
                            }
                          }}
                          className="text-[11px] text-gray-300 hover:text-gray-100 transition-colors"
                        >
                          {sessions.length > 0 ? '−' : '+'} Active sessions ({sessions.length > 0 ? sessions.length : '...'})
                        </button>
                        {sessions.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {sessionsLoading && <div className="text-[9px] text-gray-600">Loading...</div>}
                            {sessions.map(s => (
                              <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 bg-[#0d0d0d] rounded border border-gray-800">
                                <div className="flex-1 min-w-0">
                                  <div className="text-[10px] text-gray-300 truncate font-mono">{s.id}</div>
                                  <div className="text-[8px] text-gray-600">{s.userAgent} · {new Date(s.createdAt).toLocaleDateString()} — {new Date(s.expiresAt).toLocaleDateString()}</div>
                                </div>
                                <button
                                  onClick={async () => {
                                    try {
                                      const r = await fetch(`/api/auth/sessions?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
                                      if (r.ok) setSessions(prev => prev.filter(x => x.id !== s.id));
                                    } catch {}
                                  }}
                                  className="text-[8px] text-gray-600 hover:text-red-400 transition-colors shrink-0"
                                >Revoke</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Updates Section ──────────────────────────────── */}
            <div>
              <button
                onClick={() => setUpdateExpanded(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left sticky top-0 bg-[#151515] border-b border-gray-800/50"
              >
                <ChevronRight className={`w-3 h-3 text-gray-600 transition-transform ${updateExpanded ? 'rotate-90' : ''}`} />
                <span className="text-[11px] font-semibold text-gray-300">Updates</span>
                {updateState === 'available' && (
                  <span className="text-[8px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded ml-auto animate-pulse">
                    1 available
                  </span>
                )}
              </button>

              {updateExpanded && (
                <div className="px-4 divide-y divide-gray-800/30">
                  {/* Current version */}
                  <div className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-gray-200">Current Version</div>
                        <div className="text-[9px] text-gray-500 mt-0.5 font-mono">
                          v{updateInfo.currentVersion || '—'}
                          {updateInfo.currentHash ? ` (${updateInfo.currentHash})` : ''}
                          {updateInfo.currentBranch ? ` · ${updateInfo.currentBranch}` : ''}
                        </div>
                      </div>

                      {/* Check button */}
                      <button
                        onClick={async () => {
                          setUpdateState('checking');
                          setUpdateInfo({});
                          try {
                            const res = await fetch('/api/check-update');
                            const data = await res.json();
                            setUpdateInfo(data);
                            if (data.hasUpdate) {
                              setUpdateState('available');
                            } else if (data.error) {
                              setUpdateState('error');
                            } else {
                              setUpdateState('uptodate');
                            }
                          } catch {
                            setUpdateState('error');
                            setUpdateInfo({ error: 'Network error' });
                          }
                        }}
                        disabled={updateState === 'checking' || updateState === 'updating'}
                        className="px-2.5 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] rounded border border-purple-600 transition-colors flex items-center gap-1"
                      >
                        {updateState === 'checking' ? (
                          <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking</>
                        ) : (
                          'Check for Updates'
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Status messages */}
                  {updateState === 'uptodate' && (
                    <div className="py-2">
                      <span className="text-[10px] text-emerald-400">✓ Up to date</span>
                    </div>
                  )}

                  {updateState === 'error' && (
                    <div className="py-2">
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-red-900/20 border border-red-800/30 rounded">
                        <span className="text-[9px] text-red-400">
                          {updateInfo.error || 'Update check failed'}
                        </span>
                        <button
                          onClick={async () => {
                            setUpdateState('checking');
                            try {
                              const res = await fetch('/api/check-update');
                              const data = await res.json();
                              setUpdateInfo(data);
                              setUpdateState(data.hasUpdate ? 'available' : data.error ? 'error' : 'uptodate');
                            } catch {
                              setUpdateState('error');
                            }
                          }}
                          className="text-[9px] text-purple-400 hover:text-purple-300 ml-auto shrink-0"
                        >
                          retry
                        </button>
                      </div>
                    </div>
                  )}

                  {updateState === 'available' && (
                    <div className="py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">Update available</span>
                      </div>
                      <div className="text-[9px] text-gray-400 font-mono">
                        {updateInfo.currentHash} → <span className="text-amber-300">{updateInfo.latestHash}</span>
                        {updateInfo.behindCount ? ` (${updateInfo.behindCount} commit(s) ahead)` : ''}
                      </div>

                      {/* Update button */}
                      <button
                        onClick={async () => {
                          setUpdateState('updating');
                          setUpdateLog([]);
                          try {
                            const res = await fetch('/api/do-update', { method: 'POST' });
                            const reader = res.body?.getReader();
                            if (!reader) throw new Error('No response body');

                            const decoder = new TextDecoder();
                            let buffer = '';
                            let currentEvent = '';
                            while (true) {
                              const { done, value } = await reader.read();
                              if (done) break;
                              buffer += decoder.decode(value, { stream: true });
                              // Parse SSE events
                              const lines = buffer.split('\n');
                              buffer = lines.pop() || ''; // keep incomplete line
                              for (const line of lines) {
                                if (line.startsWith('event: ')) {
                                  currentEvent = line.slice(7).trim();
                                } else if (line.startsWith('data: ')) {
                                  try {
                                    const payload = JSON.parse(line.slice(6));
                                    if (payload.message) {
                                      setUpdateLog(prev => [...prev, payload.message]);
                                    }
                                    if (currentEvent === 'complete') {
                                      setUpdateState('complete');
                                    } else if (currentEvent === 'error') {
                                      setUpdateState('error');
                                    }
                                    if (currentEvent === 'complete' || currentEvent === 'error') {
                                      currentEvent = '';
                                    }
                                  } catch {}
                                }
                              }
                            }
                          } catch (err) {
                            setUpdateState('error');
                            setUpdateLog(prev => [...prev, `Error: ${(err as Error).message}`]);
                          }
                        }}
                        className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white text-[10px] rounded border border-amber-600 transition-colors"
                      >
                        {updateState === 'available' ? 'Update & Rebuild' : 'Updating...'}
                      </button>
                    </div>
                  )}

                  {/* Update progress log */}
                  {updateState === 'updating' && updateLog.length > 0 && (
                    <div className="py-2">
                      <div className="bg-[#0a0a0a] border border-gray-800 rounded max-h-40 overflow-y-auto px-2 py-1.5 font-mono text-[9px] leading-relaxed">
                        {updateLog.map((line, i) => (
                          <div key={i} className={
                            line.startsWith('✓') ? 'text-emerald-400'
                            : line.startsWith('✗') ? 'text-red-400'
                            : line.startsWith('→') ? 'text-amber-400'
                            : line.startsWith('  ╔') || line.startsWith('  ╚') || line.startsWith('  ║') ? 'text-gray-500'
                            : 'text-gray-400'
                          }>
                            {line}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Update complete */}
                  {updateState === 'complete' && (
                    <div className="py-3 space-y-2">
                      <div className="text-[10px] text-emerald-400">✓ Update complete!</div>
                      <div className="text-[9px] text-gray-500">Restart the server to apply changes.</div>
                      <button
                        onClick={async () => {
                          try {
                            await fetch('/api/restart', { method: 'POST' });
                            setUpdateState('idle');
                          } catch {}
                        }}
                        className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 transition-colors"
                      >
                        Restart Server
                      </button>
                    </div>
                  )}

                  {/* CLI hint */}
                  <div className="py-2">
                    <div className="text-[8px] text-gray-700">
                      CLI: <span className="font-mono">bridge update</span> · or run <span className="font-mono">node scripts/update.js</span> in project root
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Config Sections ──────────────────────────────────── */}
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
          </>)}
        </div>
      </div>
    </>
  );
}
