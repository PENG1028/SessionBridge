'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Link, Bell, Settings } from 'lucide-react';

interface RemoteRelay {
  id: string;
  name: string;
  url: string;
  token?: string;
}

interface ServerConfig {
  port: number;
  token: string;
  sslKey: string;
  sslCert: string;
  connections: RemoteRelay[];
  notifications: { ntfyTopic: string; enabled: boolean };
  theme: 'dark' | 'light';
  defaultDir: string;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Currently active connection info */
  currentUrl: string;
  currentToken?: string;
  /** Called when user wants to switch to a different connection */
  onConnect: (url: string, token?: string) => void;
  /** Called when local server config changes */
  onConfigChange?: (config: Partial<ServerConfig>) => void;
}

interface NetworkInfo {
  canExternal: boolean;
  hasPublicIP: boolean;
  hasTLS: boolean;
  hasToken: boolean;
  portReachable: boolean;
  ips: { type: string; addr: string; family: string; interface: string }[];
  warnings: string[];
}

type Tab = 'connections' | 'server' | 'notifications' | 'external' | 'extensions';

interface ConfigPropertySchema {
  type: string;
  default?: unknown;
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  scope?: string;
  requiresRestart?: boolean;
  deprecated?: boolean | string;
  secret?: boolean;
}

interface ConfigContribution {
  extensionId: string;
  title: string;
  properties: Record<string, ConfigPropertySchema>;
}

export function SettingsPanel({
  open,
  onClose,
  currentUrl,
  currentToken,
  onConnect,
  onConfigChange,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>('connections');
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [savedRelays, setSavedRelays] = useState<RemoteRelay[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');

  // ── New connection form ──
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newToken, setNewToken] = useState('');

  // ── Local server config form ──
  const [localPort, setLocalPort] = useState('8080');
  const [localToken, setLocalToken] = useState('');
  const [ntfyTopic, setNtfyTopic] = useState('');
  // ── External access state ──
  const [netInfo, setNetInfo] = useState<NetworkInfo | null>(null);
  const [netLoading, setNetLoading] = useState(false);
  const [externalEnabled, setExternalEnabled] = useState(false);
  const [externalToggling, setExternalToggling] = useState(false);

  // ── Extensions config state (Phase 4M) ──
  const [extConfigs, setExtConfigs] = useState<ConfigContribution[]>([]);
  const [extValues, setExtValues] = useState<Record<string, unknown>>({});
  const [extScope, setExtScope] = useState<'user' | 'workspace'>('user');
  const [dirtyMap, setDirtyMap] = useState<Map<string, unknown>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const [extCollapsed, setExtCollapsed] = useState<Record<string, boolean>>({});
  const [savingExt, setSavingExt] = useState(false);
  const [extLoading, setExtLoading] = useState(false);
  const [extError, setExtError] = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string[]>>({});

  // Load config from backend on mount
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg: ServerConfig) => {
        setServerConfig(cfg);
        setSavedRelays(cfg.connections || []);
        setLocalPort(String(cfg.port));
        setLocalToken(cfg.token || '');
        setNtfyTopic(cfg.notifications?.ntfyTopic || '');
      })
      .catch(() => {
        // Backend might not support config API yet
        setLoading(false);
      })
      .finally(() => setLoading(false));
  }, [open]);

  // Fetch extension config schema and values
  const fetchExtConfigs = useCallback(async () => {
    setExtLoading(true);
    setExtError('');
    try {
      const [schemaRes, valuesRes] = await Promise.all([
        fetch('/api/configuration/schema'),
        fetch(`/api/configuration/values?scope=${extScope}`),
      ]);
      if (!schemaRes.ok) { setExtError(`Schema fetch failed: ${schemaRes.status}`); return; }
      if (!valuesRes.ok) { setExtError(`Values fetch failed: ${valuesRes.status}`); return; }
      const schemaData = await schemaRes.json();
      const valuesData = await valuesRes.json();
      setExtConfigs(schemaData.contributions || []);
      setExtValues(valuesData.values || {});
    } catch (err) {
      setExtError((err as Error).message);
    }
    setExtLoading(false);
  }, [extScope]);

  useEffect(() => {
    if (!open) return;
    fetchExtConfigs();
  }, [open, fetchExtConfigs]);

  // Save local server config
  const handleSaveServerConfig = useCallback(async () => {
    setSaveStatus('');
    const port = parseInt(localPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setSaveStatus('Invalid port (1-65535)');
      return;
    }
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port,
          token: localToken,
          notifications: { ntfyTopic, enabled: true },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveStatus('Saved');
        onConfigChange?.({ port, token: localToken });
        setTimeout(() => setSaveStatus(''), 2000);
      } else {
        setSaveStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setSaveStatus(`Error: ${(err as Error).message}`);
    }
  }, [localPort, localToken, ntfyTopic, onConfigChange]);

  // Add a new relay connection
  const handleAddConnection = useCallback(async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const relay: RemoteRelay = {
      id: Date.now().toString(36),
      name: newName.trim(),
      url: newUrl.trim(),
      token: newToken.trim() || undefined,
    };
    try {
      const res = await fetch('/api/config/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(relay),
      });
      const data = await res.json();
      if (data.success) {
        setSavedRelays(data.connections);
        setNewName('');
        setNewUrl('');
        setNewToken('');
      }
    } catch {}
  }, [newName, newUrl, newToken]);

  // Delete a connection
  const handleDeleteConnection = useCallback(async (id: string) => {
    try {
      await fetch(`/api/config/connections/${id}`, { method: 'DELETE' });
      setSavedRelays((prev) => prev.filter((r) => r.id !== id));
    } catch {}
  }, []);

  // Connect to a relay
  const handleConnect = useCallback(
    (url: string, token?: string) => {
      onConnect(url, token);
      onClose();
    },
    [onConnect, onClose],
  );

  // ── External Access ──
  const handleCheckNetwork = useCallback(async () => {
    setNetLoading(true);
    try {
      const res = await fetch('/api/node/external');
      const info: NetworkInfo = await res.json();
      setNetInfo(info);
      // Determine if currently enabled (bind is 0.0.0.0)
      // We infer from the URL: if not localhost-only, it's enabled
      setExternalEnabled(info.canExternal && info.hasPublicIP);
    } catch (err) {
      setNetInfo({
        canExternal: false,
        hasPublicIP: false,
        hasTLS: false,
        hasToken: false,
        portReachable: false,
        ips: [],
        warnings: ['Failed to detect network. Is the relay server running?'],
      });
    }
    setNetLoading(false);
  }, []);

  const handleToggleExternal = useCallback(async (enable: boolean) => {
    setExternalToggling(true);
    try {
      const res = await fetch('/api/node/external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable }),
      });
      const data = await res.json();
      setExternalEnabled(enable);
      // Refresh network info
      handleCheckNetwork();
    } catch (err) {
      console.error('Failed to toggle external access:', err);
    }
    setExternalToggling(false);
  }, [handleCheckNetwork]);

  // ── Extensions config handlers ──

  // Set a dirty value (pending save)
  const handleExtValueChange = useCallback((key: string, value: unknown) => {
    setDirtyMap((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
    // Clear previous validation error for this key
    setValidationErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Reset a single config key to default
  const handleExtReset = useCallback(async (key: string) => {
    try {
      const res = await fetch(`/api/configuration/values?scope=${extScope}&key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        setValidationErrors((prev) => ({ ...prev, [key]: [err.error || 'Reset failed'] }));
        return;
      }
      const result = await res.json();
      // Update local values
      setExtValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      // Remove from dirty map
      setDirtyMap((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } catch (err) {
      setValidationErrors((prev) => ({ ...prev, [key]: [(err as Error).message] }));
    }
  }, [extScope]);

  // Save all dirty values
  const handleExtSaveAll = useCallback(async () => {
    if (dirtyMap.size === 0) return;
    setSavingExt(true);
    const errors: Record<string, string[]> = {};
    for (const [key, value] of dirtyMap.entries()) {
      try {
        const res = await fetch('/api/configuration/values', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: extScope, key, value }),
        });
        if (!res.ok) {
          const err = await res.json();
          errors[key] = [err.error || 'Save failed'].concat(err.details || []);
        } else {
          // Update local values cache
          setExtValues((prev) => ({ ...prev, [key]: value }));
        }
      } catch (err) {
        errors[key] = [(err as Error).message];
      }
    }
    setValidationErrors(errors);
    // Remove successfully saved keys from dirty map
    const savedKeys = [...dirtyMap.keys()].filter((k) => !errors[k]);
    if (savedKeys.length > 0) {
      setDirtyMap((prev) => {
        const next = new Map(prev);
        for (const k of savedKeys) next.delete(k);
        return next;
      });
    }
    setSavingExt(false);
  }, [dirtyMap, extScope]);

  // Toggle extension group collapse
  const toggleExtCollapse = useCallback((id: string) => {
    setExtCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ── Field renderer ──
  const renderConfigField = (key: string, schema: ConfigPropertySchema): React.ReactNode => {
    const isDirty = dirtyMap.has(key);
    const currentValue = isDirty ? dirtyMap.get(key) : (extValues[key] ?? schema.default);
    const errs = validationErrors[key] || [];
    const displayKey = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;

    // Deprecated: show as read-only
    if (schema.deprecated) {
      return (
        <div key={key} className="opacity-40">
          <div className="flex items-center justify-between">
            <span className="text-gray-500 line-through">{displayKey}</span>
            <span className="text-[8px] text-yellow-600">deprecated</span>
          </div>
          <div className="text-[9px] text-gray-700 italic">Removed in future version</div>
        </div>
      );
    }

    const fieldId = `cfg-${key}`;
    let input: React.ReactNode;

    switch (schema.type) {
      case 'boolean':
        input = (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!currentValue}
              onChange={(e) => handleExtValueChange(key, e.target.checked)}
              className="accent-purple-500"
            />
            <span className="text-gray-300">{schema.description || displayKey}</span>
          </label>
        );
        break;

      case 'integer':
      case 'number': {
        const numVal = typeof currentValue === 'number' ? currentValue : (schema.default as number ?? 0);
        input = (
          <div>
            {schema.description && <div className="text-[9px] text-gray-500 mb-1">{schema.description}</div>}
            <div className="flex items-center gap-2">
              <input
                id={fieldId}
                type="number"
                value={numVal}
                min={schema.minimum}
                max={schema.maximum}
                onChange={(e) => handleExtValueChange(key, schema.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
                className="w-24 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
              />
              {schema.minimum !== undefined && <span className="text-[8px] text-gray-700">min: {schema.minimum}</span>}
              {schema.maximum !== undefined && <span className="text-[8px] text-gray-700">max: {schema.maximum}</span>}
            </div>
          </div>
        );
        break;
      }

      case 'string': {
        const strVal = typeof currentValue === 'string' ? currentValue : (schema.default as string ?? '');
        if (schema.enum && schema.enum.length > 0) {
          input = (
            <div>
              {schema.description && <div className="text-[9px] text-gray-500 mb-1">{schema.description}</div>}
              <select
                id={fieldId}
                value={strVal}
                onChange={(e) => handleExtValueChange(key, e.target.value)}
                className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
              >
                {schema.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
                ))}
              </select>
            </div>
          );
        } else if (schema.secret) {
          input = (
            <div>
              {schema.description && <div className="text-[9px] text-gray-500 mb-1">{schema.description}</div>}
              <input
                id={fieldId}
                type="password"
                value={strVal}
                onChange={(e) => handleExtValueChange(key, e.target.value)}
                className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
                placeholder="Enter value..."
              />
            </div>
          );
        } else {
          input = (
            <div>
              {schema.description && <div className="text-[9px] text-gray-500 mb-1">{schema.description}</div>}
              <input
                id={fieldId}
                type="text"
                value={strVal}
                onChange={(e) => handleExtValueChange(key, e.target.value)}
                className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
                placeholder="Enter value..."
              />
            </div>
          );
        }
        break;
      }

      case 'array':
      case 'object':
        input = (
          <div>
            {schema.description && <div className="text-[9px] text-gray-500 mb-1">{schema.description}</div>}
            <div className="bg-[#0d0d0d] border border-gray-800 rounded px-2 py-1 text-[9px] text-gray-600 font-mono max-h-20 overflow-y-auto">
              {currentValue !== undefined ? JSON.stringify(currentValue) : 'not set'}
            </div>
            <div className="text-[8px] text-gray-700 mt-0.5">Editing {schema.type} values not supported in this panel</div>
          </div>
        );
        break;

      default:
        input = (
          <div className="text-[9px] text-gray-700 italic">
            Unsupported type: {schema.type}
          </div>
        );
    }

    return (
      <div key={key} className={`py-1.5 ${isDirty ? 'bg-purple-900/10 -mx-2 px-2 rounded' : ''}`}>
        {schema.type !== 'boolean' && (
          <div className="flex items-center justify-between mb-0.5">
            <label htmlFor={fieldId} className="text-[10px] text-gray-400">{displayKey}</label>
            {isDirty && <span className="text-[8px] text-purple-400">modified</span>}
          </div>
        )}
        {schema.type === 'boolean' ? input : <div className="flex items-start gap-2">{input}</div>}
        {errs.length > 0 && (
          <div className="text-[9px] text-red-400 mt-0.5">{errs[0]}</div>
        )}
        {schema.requiresRestart && (
          <div className="text-[8px] text-yellow-600 mt-0.5">Requires restart</div>
        )}
        {!schema.type.startsWith('array') && !schema.type.startsWith('object') && schema.type !== 'boolean' && !schema.description && (
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => handleExtReset(key)}
              className="text-[8px] text-gray-600 hover:text-gray-400 transition-colors"
              title="Reset to default"
            >
              reset
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Check if a key matches search query ──
  const matchesSearch = useCallback((key: string, schema: ConfigPropertySchema, query: string): boolean => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      key.toLowerCase().includes(q) ||
      (schema.description || '').toLowerCase().includes(q) ||
      String(schema.default || '').toLowerCase().includes(q)
    );
  }, []);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 transition-opacity"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-[#151515] border-l border-gray-700 shadow-2xl shadow-black/60 flex flex-col animate-slideInRight">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 text-gray-200 text-sm font-bold">
            <Settings className="w-4 h-4" />
            Settings
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-gray-800 text-[10px]">
          {([
            { id: 'connections' as Tab, label: 'Connections' },
            { id: 'server' as Tab, label: 'Server' },
            { id: 'external' as Tab, label: 'External' },
            { id: 'notifications' as Tab, label: 'Notifications' },
            { id: 'extensions' as Tab, label: `Extensions${dirtyMap.size > 0 ? ` (${dirtyMap.size})` : ''}` },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2 font-bold tracking-wider transition-colors ${
                tab === t.id
                  ? 'text-purple-400 border-b-2 border-purple-500'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-4 text-xs space-y-4">
          {loading ? (
            <div className="text-gray-600 text-center py-8">Loading...</div>
          ) : tab === 'connections' ? (
            <>
              {/* Current connection */}
              <div>
                <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-2">
                  CURRENT CONNECTION
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-gray-900 rounded border border-gray-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link className="w-3 h-3 text-green-500 shrink-0" />
                    <span className="truncate text-gray-200">{currentUrl}</span>
                  </div>
                  <span className="text-[9px] text-green-500 bg-green-900/30 px-1.5 py-0.5 rounded ml-2 shrink-0">
                    connected
                  </span>
                </div>
              </div>

              {/* Saved connections */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-gray-500 tracking-wider">
                    SAVED RELAYS
                  </span>
                </div>
                {savedRelays.length === 0 ? (
                  <div className="text-gray-700 text-[10px] italic px-1">
                    No saved connections. Add one below.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {savedRelays.map((relay) => (
                      <div
                        key={relay.id}
                        className="flex items-center gap-2 px-3 py-2 bg-gray-900 rounded border border-gray-800"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-gray-200 text-[11px] truncate">{relay.name}</div>
                          <div className="text-gray-600 text-[9px] truncate">{relay.url}</div>
                        </div>
                        <button
                          onClick={() => handleConnect(relay.url, relay.token)}
                          className="px-2 py-1 bg-purple-700 hover:bg-purple-600 text-white text-[9px] rounded transition-colors shrink-0"
                        >
                          Connect
                        </button>
                        <button
                          onClick={() => handleDeleteConnection(relay.id)}
                          className="p-1 text-gray-600 hover:text-red-400 transition-colors shrink-0"
                          title="Remove"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add new connection */}
              <div className="border-t border-gray-800 pt-3">
                <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-2">
                  ADD RELAY
                </div>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Name (e.g. My VPS)"
                    className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 placeholder-gray-700"
                  />
                  <input
                    type="text"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="ws://your-server.com:8080"
                    className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 placeholder-gray-700 font-mono"
                  />
                  <input
                    type="password"
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}
                    placeholder="Token (optional)"
                    className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 placeholder-gray-700 font-mono"
                  />
                  <button
                    onClick={handleAddConnection}
                    disabled={!newName.trim() || !newUrl.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] rounded border border-purple-600 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>
              </div>
            </>
          ) : tab === 'server' ? (
            <>
              <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-3">
                LOCAL SERVER CONFIG
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-gray-600 block mb-1">Port</label>
                  <input
                    type="number"
                    value={localPort}
                    onChange={(e) => setLocalPort(e.target.value)}
                    className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500"
                    min={1}
                    max={65535}
                  />
                  <div className="text-[8px] text-gray-700 mt-0.5">Requires restart to take effect</div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 block mb-1">Auth Token</label>
                  <input
                    type="password"
                    value={localToken}
                    onChange={(e) => setLocalToken(e.target.value)}
                    placeholder="Leave empty for no auth"
                    className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 placeholder-gray-700 font-mono"
                  />
                </div>
                <button
                  onClick={handleSaveServerConfig}
                  className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 transition-colors"
                >
                  Save
                </button>
                {saveStatus && (
                  <span
                    className={`text-[10px] ${
                      saveStatus === 'Saved' ? 'text-green-500' : 'text-red-400'
                    }`}
                  >
                    {saveStatus}
                  </span>
                )}
              </div>
            </>
          ) : tab === 'external' ? (
            /* ── External Access tab ── */
            <>
              <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-3">
                EXTERNAL ACCESS
              </div>
              <div className="text-[9px] text-gray-500 mb-3 leading-relaxed">
                Allow other devices on your network to access this dashboard.
                This binds the dashboard server to <code className="text-gray-400">0.0.0.0</code> instead of <code className="text-gray-400">127.0.0.1</code>.
              </div>

              {/* Network check button */}
              {!netInfo && (
                <button
                  onClick={handleCheckNetwork}
                  disabled={netLoading}
                  className="w-full px-3 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] rounded border border-purple-600 transition-colors flex items-center justify-center gap-2"
                >
                  {netLoading ? (
                    <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking...</>
                  ) : (
                    'Check Network Environment'
                  )}
                </button>
              )}

              {/* Network info */}
              {netInfo && (
                <div className="space-y-3">
                  <div className="bg-[#0d0d0d] rounded border border-gray-800 p-3 text-[10px] space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Status</span>
                      <span className={externalEnabled ? 'text-green-500' : 'text-gray-400'}>
                        {externalEnabled ? 'External Access ON' : 'Local Only'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Public IP</span>
                      <span className={netInfo.hasPublicIP ? 'text-green-500' : 'text-yellow-500'}>
                        {netInfo.hasPublicIP ? 'Available' : 'None'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">TLS Certificate</span>
                      <span className={netInfo.hasTLS ? 'text-green-500' : 'text-yellow-500'}>
                        {netInfo.hasTLS ? 'Ready' : 'Not configured'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Auth Token</span>
                      <span className={netInfo.hasToken ? 'text-green-500' : 'text-yellow-500'}>
                        {netInfo.hasToken ? 'Set' : 'Not set'}
                      </span>
                    </div>
                  </div>

                  {/* IP list */}
                  {netInfo.ips.length > 0 && (
                    <div>
                      <div className="text-[9px] text-gray-600 mb-1">Network Interfaces</div>
                      <div className="space-y-1">
                        {netInfo.ips.filter(ip => ip.type !== 'loopback').slice(0, 5).map((ip, i) => (
                          <div key={i} className="flex items-center gap-2 text-[9px] bg-[#0d0d0d] px-2 py-1 rounded border border-gray-800">
                            <span className={`w-1.5 h-1.5 rounded-full ${ip.type === 'public' ? 'bg-green-500' : ip.type === 'lan' ? 'bg-blue-500' : 'bg-gray-600'}`} />
                            <span className="text-gray-300 font-mono">{ip.addr}</span>
                            <span className="text-gray-600 ml-auto">{ip.type}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {netInfo.warnings.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[9px] text-yellow-600 font-bold">Warnings</div>
                      {netInfo.warnings.map((w, i) => (
                        <div key={i} className="text-[9px] text-yellow-500/80 bg-yellow-900/10 px-2 py-1 rounded border border-yellow-800/30">
                          {w}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleCheckNetwork}
                      disabled={netLoading}
                      className="flex-1 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-[9px] rounded border border-gray-700 transition-colors"
                    >
                      Refresh
                    </button>
                    <button
                      onClick={() => handleToggleExternal(!externalEnabled)}
                      disabled={externalToggling || !netInfo.canExternal}
                      className={`flex-1 px-2 py-1.5 text-[9px] rounded border transition-colors flex items-center justify-center gap-1 ${
                        externalEnabled
                          ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400 border-red-800/50'
                          : 'bg-purple-700 hover:bg-purple-600 text-white border-purple-600 disabled:opacity-40'
                      }`}
                    >
                      {externalToggling ? (
                        <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Updating...</>
                      ) : externalEnabled ? (
                        'Disable External Access'
                      ) : (
                        'Enable External Access'
      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : tab === 'extensions' ? (
            /* ── Extensions Config tab (Phase 4M) ── */
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-gray-500 tracking-wider">
                  EXTENSION SETTINGS
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[8px] text-gray-600">{extScope === 'user' ? 'User' : 'Workspace'}</span>
                  <button
                    onClick={() => setExtScope((s) => s === 'user' ? 'workspace' : 'user')}
                    className={`relative w-8 h-4 rounded-full transition-colors ${
                      extScope === 'workspace' ? 'bg-purple-600' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                        extScope === 'workspace' ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Error state */}
              {extError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/30 rounded mb-3">
                  <span className="text-[10px] text-red-400 flex-1">{extError}</span>
                  <button onClick={fetchExtConfigs} className="text-[9px] text-purple-400 hover:text-purple-300">
                    retry
                  </button>
                </div>
              )}

              {/* Loading state */}
              {extLoading && (
                <div className="flex items-center gap-2 text-gray-600 py-4 justify-center">
                  <span className="w-3 h-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
                  <span className="text-[10px]">Loading extension configs...</span>
                </div>
              )}

              {!extLoading && !extError && (
                <>
                  {/* Search bar */}
                  <div className="relative mb-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search settings..."
                      className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 pl-6 text-[11px] text-gray-200 outline-none focus:border-purple-500 placeholder-gray-700"
                    />
                    <svg className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>

                  {/* Filter controls */}
                  <div className="flex items-center gap-3 mb-3">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={modifiedOnly}
                        onChange={(e) => setModifiedOnly(e.target.checked)}
                        className="accent-purple-500 w-2.5 h-2.5"
                      />
                      <span className="text-[9px] text-gray-600">Modified only</span>
                    </label>
                    {dirtyMap.size > 0 && (
                      <button
                        onClick={handleExtSaveAll}
                        disabled={savingExt}
                        className="ml-auto px-2 py-0.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[9px] rounded border border-purple-600 transition-colors flex items-center gap-1"
                      >
                        {savingExt ? (
                          <><span className="w-2.5 h-2.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                        ) : (
                          `Save All (${dirtyMap.size})`
                        )}
                      </button>
                    )}
                  </div>

                  {/* No extensions empty state */}
                  {extConfigs.length === 0 && !extLoading ? (
                    <div className="text-gray-700 text-[10px] italic py-4 text-center">
                      No extensions contribute configuration settings.
                    </div>
                  ) : (
                    /* Extension groups */
                    <div className="space-y-2">
                      {extConfigs
                        .filter((ext) => {
                          // Filter by modified-only
                          if (modifiedOnly) {
                            return Object.keys(ext.properties).some((k) => dirtyMap.has(k));
                          }
                          return true;
                        })
                        .map((ext) => {
                          const extKeys = Object.entries(ext.properties);
                          const filteredKeys = extKeys.filter(([k, s]) => matchesSearch(k, s, searchQuery));
                          const modifiedCount = extKeys.filter(([k]) => dirtyMap.has(k)).length;

                          if (filteredKeys.length === 0) return null;

                          const collapsed = extCollapsed[ext.extensionId] ?? true;

                          return (
                            <div key={ext.extensionId} className="border border-gray-800 rounded overflow-hidden">
                              {/* Group header — collapsible */}
                              <button
                                onClick={() => toggleExtCollapse(ext.extensionId)}
                                className="w-full flex items-center gap-2 px-3 py-2 bg-[#0d0d0d] hover:bg-[#111] transition-colors text-left"
                              >
                                <svg
                                  className={`w-2.5 h-2.5 text-gray-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="text-[11px] font-bold text-gray-300">{ext.title}</span>
                                {modifiedCount > 0 && (
                                  <span className="ml-auto text-[8px] text-purple-400 bg-purple-900/20 px-1.5 py-0.5 rounded">
                                    {modifiedCount} modified
                                  </span>
                                )}
                              </button>

                              {/* Group content */}
                              {collapsed && (
                                <div className="px-3 py-2 space-y-1.5 border-t border-gray-800">
                                  {filteredKeys.map(([key, schema]) => renderConfigField(key, schema))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-3">
                NOTIFICATIONS
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-gray-600 block mb-1">
                    ntfy.sh Topic
                  </label>
                  <input
                    type="text"
                    value={ntfyTopic}
                    onChange={(e) => setNtfyTopic(e.target.value)}
                    placeholder="e.g. my-sessionbridge"
                    className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 placeholder-gray-700 font-mono"
                  />
                  <div className="text-[8px] text-gray-700 mt-0.5">
                    Get push notifications when tasks complete. Requires a ntfy.sh topic.
                  </div>
                </div>
                <button
                  onClick={handleSaveServerConfig}
                  className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 transition-colors"
                >
                  Save
                </button>
                {saveStatus && (
                  <span
                    className={`text-[10px] ${
                      saveStatus === 'Saved' ? 'text-green-500' : 'text-red-400'
                    }`}
                  >
                    {saveStatus}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes slideInRight {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
      .animate-slideInRight {
        animation: slideInRight 0.2s ease-out;
      }`}</style>
    </>
  );
}
