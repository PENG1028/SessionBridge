'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Search, ChevronRight } from 'lucide-react';
import { useCoreStatus, useCoreClient, useCore } from '../core/core-client-provider';
import { sanitizeWsUrlForDisplay, normalizeWsUrlAndToken } from '../core/core-url';

// ── Types ──────────────────────────────────────────────────────

interface CoreConfigEntry {
  key: string;
  value: unknown;
  revision: number;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Current WebSocket URL. */
  wsUrl: string;
  /** Current auth token. */
  token?: string;
  /** Called when user changes the WebSocket URL. */
  onWsUrlChange: (url: string) => void;
  /** Called when user changes the auth token. */
  onTokenChange: (token: string | undefined) => void;
  /** Called when user wants to reconnect (same URL). */
  onReconnect: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────

function connectionStatusLabel(status: string): string {
  switch (status) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting...';
    case 'disconnected': return 'Disconnected';
    case 'error': return 'Connection Error';
    default: return status;
  }
}

function ConnectionDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connected: 'bg-emerald-500',
    connecting: 'bg-yellow-500 animate-pulse',
    disconnected: 'bg-gray-600',
    error: 'bg-red-500',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-gray-600'}`} />;
}

function inferConfigType(value: unknown): 'boolean' | 'number' | 'string' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

// ── Simple ConfigField for Go Core key-value config ────────────

function ConfigField({
  keyName,
  value,
  onChange,
  onReset,
  isDirty,
  validationError,
}: {
  keyName: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onReset: () => void;
  isDirty: boolean;
  validationError?: string;
}) {
  const label = keyName;
  const type = inferConfigType(value);

  let input: React.ReactNode;

  switch (type) {
    case 'boolean':
      input = (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-purple-500 w-3 h-3"
          />
          <span className="text-[11px] text-gray-300">{label}</span>
        </label>
      );
      break;
    case 'number':
      input = (
        <input
          type="number"
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className="w-28 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
        />
      );
      break;
    case 'string':
    default:
      input = (
        <input
          type="text"
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
        />
      );
      break;
  }

  return (
    <div className={`py-2 ${isDirty ? 'border-l-2 border-purple-500 pl-3 -ml-1' : 'pl-2'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-gray-200 font-mono">{label}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {input}
          {isDirty && (
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
      {validationError && (
        <span className="text-[8px] text-red-400 mt-0.5 block">{validationError}</span>
      )}
    </div>
  );
}

// ── Collapsible Section ─────────────────────────────────────────

function CollapsibleSection({
  id,
  title,
  subtitle,
  collapsed,
  onToggle,
  badge,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left sticky top-0 bg-[#151515] border-b border-gray-800/50"
      >
        <ChevronRight className={`w-3 h-3 text-gray-600 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        <span className="text-[11px] font-semibold text-gray-300">{title}</span>
        {subtitle && <span className="text-[9px] text-gray-600">{subtitle}</span>}
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {!collapsed && <div className="px-4 divide-y divide-gray-800/30">{children}</div>}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────

export function SettingsPanel({ open, onClose, wsUrl, token, onWsUrlChange, onTokenChange, onReconnect }: SettingsPanelProps) {
  const coreStatus = useCoreStatus();
  const { isOffline } = useCoreClient();
  const core = useCore();

  // ── UI Settings state ─────────────────────────────────────────
  const [connectionEditUrl, setConnectionEditUrl] = useState(wsUrl);
  const [connectionEditToken, setConnectionEditToken] = useState(token || '');
  const [connectionChanged, setConnectionChanged] = useState(false);

  // Sync from props when panel opens
  useEffect(() => {
    if (open) {
      setConnectionEditUrl(wsUrl);
      setConnectionEditToken(token || '');
      setConnectionChanged(false);
    }
  }, [open, wsUrl, token]);

  // ── Core Settings state ───────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [modifiedOnly, setModifiedOnly] = useState(false);

  const [coreConfigs, setCoreConfigs] = useState<CoreConfigEntry[]>([]);
  const [dirtyMap, setDirtyMap] = useState<Map<string, unknown>>(new Map());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ connection: false, about: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string[]>>({});

  // ── Load Core configs via WebSocket capability call ───────────
  const fetchConfigs = useCallback(async () => {
    if (coreStatus !== 'connected' || isOffline) return;
    setLoading(true);
    setError('');
    try {
      const result = await core.call('config.list') as { configs: CoreConfigEntry[] } | undefined;
      const entries: CoreConfigEntry[] = result?.configs ?? [];
      setCoreConfigs(entries);
      setDirtyMap(new Map());
      setValidationErrors({});
    } catch (err) {
      setError((err as Error).message || 'Failed to load config');
    }
    setLoading(false);
  }, [core, coreStatus, isOffline]);

  // Fetch Core settings only when open AND Core is connected
  useEffect(() => {
    if (!open) return;
    if (coreStatus === 'connected' && !isOffline) {
      fetchConfigs();
    } else {
      setLoading(false);
      setError('');
    }
  }, [open, coreStatus, isOffline, fetchConfigs]);

  // ── Change handler ────────────────────────────────────────────
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

  // ── Reset single key via CoreClient ───────────────────────────
  const handleReset = useCallback(async (key: string) => {
    try {
      await core.call('config.reset', { key });
      setCoreConfigs((prev) => prev.filter((e) => e.key !== key));
      setDirtyMap((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } catch (err) {
      setValidationErrors((prev) => ({ ...prev, [key]: [(err as Error).message] }));
    }
  }, [core]);

  // ── Save all dirty values via CoreClient ──────────────────────
  const handleSaveAll = useCallback(async () => {
    if (dirtyMap.size === 0) return;
    setSaving(true);
    const errors: Record<string, string[]> = {};
    const saved: CoreConfigEntry[] = [];

    for (const [key, value] of dirtyMap.entries()) {
      try {
        const result = await core.call('config.set', { key, value }) as CoreConfigEntry;
        saved.push(result);
      } catch (err) {
        errors[key] = [(err as Error).message];
      }
    }

    setValidationErrors(errors);

    // Merge saved entries into local state
    if (saved.length > 0) {
      setCoreConfigs((prev) => {
        const map = new Map(prev.map((e) => [e.key, e]));
        for (const entry of saved) map.set(entry.key, entry);
        return [...map.values()];
      });
      setDirtyMap((prev) => {
        const next = new Map(prev);
        for (const entry of saved) next.delete(entry.key);
        return next;
      });
    }

    setSaving(false);
  }, [dirtyMap, core]);

  // ── Collapse toggle ───────────────────────────────────────────
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ── Filter + search (flat config entries) ─────────────────────
  const filteredConfigs = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return coreConfigs.filter((entry) => {
      if (modifiedOnly && !dirtyMap.has(entry.key)) return false;
      if (q && !entry.key.toLowerCase().includes(q) && !String(entry.value ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [coreConfigs, searchQuery, modifiedOnly, dirtyMap]);

  // ── Update state ──────────────────────────────────────────────
  const [updateExpanded, setUpdateExpanded] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>('unknown');
  const [updateInfo, setUpdateInfo] = useState<{
    currentCommit: string;
    remoteCommit: string;
    behindBy: number;
    dirty: boolean;
    lastCheckError?: string;
  }>({ currentCommit: '', remoteCommit: '', behindBy: 0, dirty: false });
  const [updateChecking, setUpdateChecking] = useState(false);

  const fetchUpdateStatus = useCallback(async () => {
    try {
      const result = await core.call('update.status') as Record<string, unknown> | undefined;
      if (result) {
        setUpdateStatus(String(result.status ?? 'unknown'));
        setUpdateInfo({
          currentCommit: String(result.currentCommit ?? ''),
          remoteCommit: String(result.remoteCommit ?? ''),
          behindBy: Number(result.behindBy ?? 0),
          dirty: Boolean(result.dirty),
          lastCheckError: result.lastCheckError as string | undefined,
        });
      }
    } catch {
      // Update manager may not be available
    }
  }, [core]);

  const handleCheckUpdate = useCallback(async () => {
    setUpdateChecking(true);
    try {
      const result = await core.call('update.check') as Record<string, unknown> | undefined;
      if (result) {
        setUpdateStatus(String(result.status ?? 'unknown'));
        setUpdateInfo({
          currentCommit: String(result.currentCommit ?? ''),
          remoteCommit: String(result.remoteCommit ?? ''),
          behindBy: Number(result.behindBy ?? 0),
          dirty: Boolean(result.dirty),
          lastCheckError: result.lastCheckError as string | undefined,
        });
      }
    } catch (err) {
      setUpdateStatus('error');
      setUpdateInfo(prev => ({ ...prev, lastCheckError: (err as Error).message }));
    }
    setUpdateChecking(false);
  }, [core]);

  if (!open) return null;

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

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* ════════════════════════════════════════════════════════
              UI SETTINGS (always available)
              ════════════════════════════════════════════════════════ */}

          {/* ── Connection ──────────────────────────────────────── */}
          <CollapsibleSection
            id="connection"
            title="Connection"
            collapsed={collapsed['connection'] ?? false}
            onToggle={toggleCollapse}
          >
            {/* Status */}
            <div className="flex items-center gap-2 py-2">
              <ConnectionDot status={coreStatus} />
              <span className="text-[11px] text-gray-300">
                {connectionStatusLabel(coreStatus)}
              </span>
              {coreStatus === 'connected' && (
                <span className="text-[9px] text-gray-600 font-mono truncate ml-1">{sanitizeWsUrlForDisplay(wsUrl)}</span>
              )}
              {coreStatus === 'disconnected' && !isOffline && (
                <button
                  onClick={onReconnect}
                  className="text-[9px] text-purple-400 hover:text-purple-300 ml-auto"
                >
                  reconnect
                </button>
              )}
              {coreStatus === 'error' && (
                <button
                  onClick={onReconnect}
                  className="text-[9px] text-purple-400 hover:text-purple-300 ml-auto"
                >
                  retry
                </button>
              )}
            </div>

            {/* wsUrl */}
            <div className="py-2">
              <div className="text-[9px] text-gray-600 mb-1">WebSocket URL</div>
              <input
                type="text"
                value={connectionEditUrl}
                onChange={(e) => { setConnectionEditUrl(e.target.value); setConnectionChanged(true); }}
                className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
                placeholder="ws://localhost:8080"
              />
            </div>

            {/* Token */}
            <div className="py-2">
              <div className="text-[9px] text-gray-600 mb-1">Auth Token</div>
              <input
                type="password"
                value={connectionEditToken}
                onChange={(e) => { setConnectionEditToken(e.target.value); setConnectionChanged(true); }}
                className="w-full bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
                placeholder="(optional)"
              />
              <div className="text-[8px] text-gray-700 mt-0.5">
                {token ? 'Token is set' : 'No token configured'}
              </div>
            </div>

            {/* Apply button */}
            {connectionChanged && (
              <div className="py-2">
                <button
                  onClick={() => {
                    // Normalize: strip any token from URL, use explicit token field
                    const { wsUrl: cleanUrl } = normalizeWsUrlAndToken(connectionEditUrl, connectionEditToken || undefined);
                    onWsUrlChange(cleanUrl);
                    onTokenChange(connectionEditToken || undefined);
                    setConnectionChanged(false);
                    // Reconnect automatically after changing URL
                    setTimeout(onReconnect, 100);
                  }}
                  className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 transition-colors"
                >
                  Apply & Reconnect
                </button>
              </div>
            )}
          </CollapsibleSection>

          {/* ── About ──────────────────────────────────────────── */}
          <CollapsibleSection
            id="about"
            title="About"
            collapsed={collapsed['about'] ?? true}
            onToggle={toggleCollapse}
          >
            <div className="py-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">UI Version</span>
                <span className="text-[10px] text-gray-300 font-mono">0.6.0</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Go Core</span>
                <span className="flex items-center gap-1.5">
                  <ConnectionDot status={coreStatus} />
                  <span className="text-[10px] text-gray-300 font-mono">{connectionStatusLabel(coreStatus)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">WebSocket</span>
                <span className="text-[10px] text-gray-500 font-mono truncate max-w-[200px] text-right">{sanitizeWsUrlForDisplay(wsUrl)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Auth Token</span>
                <span className="text-[10px] text-gray-500">{token ? 'Configured' : 'Not set'}</span>
              </div>
            </div>
          </CollapsibleSection>

          {/* ═══ SEPARATOR ═══ */}
          <div className="border-t border-gray-800/50 mx-4 my-1" />

          {/* ════════════════════════════════════════════════════════
              CORE SETTINGS (only when Core connected)
              ════════════════════════════════════════════════════════ */}
          {coreStatus === 'connected' && !isOffline ? (
            <>
              {/* Search + toolbar */}
              <div className="px-4 py-2 border-b border-gray-800 space-y-2 shrink-0">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Search settings (${coreConfigs.length} total)...`}
                    className="w-full bg-[#0d0d0d] border border-gray-700 rounded pl-7 pr-3 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 placeholder-gray-700"
                  />
                  {searchQuery && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-600">
                      {filteredConfigs.length}/{coreConfigs.length}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modifiedOnly}
                      onChange={(e) => setModifiedOnly(e.target.checked)}
                      className="accent-purple-500 w-2.5 h-2.5"
                    />
                    <span className="text-[9px] text-gray-600">Modified</span>
                  </label>

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

              {loading ? (
                <div className="flex items-center justify-center py-12 text-gray-600 text-xs gap-2">
                  <span className="w-3 h-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
                  Loading settings...
                </div>
              ) : error ? (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/30 rounded">
                    <span className="text-[10px] text-red-400 flex-1">{error}</span>
                    <button onClick={fetchConfigs} className="text-[9px] text-purple-400 hover:text-purple-300">retry</button>
                  </div>
                </div>
              ) : filteredConfigs.length === 0 && !searchQuery && !modifiedOnly ? (
                <div className="px-4 py-8 text-center text-gray-700 text-[10px]">
                  No server settings registered
                </div>
              ) : filteredConfigs.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-700 text-[10px]">
                  {searchQuery ? 'No settings match your search' : 'No modified settings'}
                </div>
              ) : (
                <div className="py-2 divide-y divide-gray-800/30">
                  {filteredConfigs.map((entry) => (
                    <div key={entry.key} className="px-4">
                      <ConfigField
                        keyName={entry.key}
                        value={dirtyMap.has(entry.key) ? dirtyMap.get(entry.key) : entry.value}
                        onChange={(v) => handleChange(entry.key, v)}
                        onReset={() => handleReset(entry.key)}
                        isDirty={dirtyMap.has(entry.key)}
                        validationError={(validationErrors[entry.key] || [])[0]}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* ── Updates ────────────────────────────────────────── */}
              <div>
                <button
                  onClick={() => {
                    setUpdateExpanded(v => !v);
                    if (!updateExpanded && updateStatus === 'unknown') {
                      fetchUpdateStatus();
                    }
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left border-t border-gray-800/50 bg-[#151515]"
                >
                  <ChevronRight className={`w-3 h-3 text-gray-600 transition-transform ${updateExpanded ? 'rotate-90' : ''}`} />
                  <span className="text-[11px] font-semibold text-gray-300">Updates</span>
                  {updateStatus === 'update-available' && (
                    <span className="text-[8px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded ml-auto animate-pulse">
                      {updateInfo.behindBy} behind
                    </span>
                  )}
                </button>

                {updateExpanded && (
                  <div className="px-4 divide-y divide-gray-800/30">
                    <div className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[11px] text-gray-200">Current Version</div>
                          <div className="text-[9px] text-gray-500 mt-0.5 font-mono">
                            {updateInfo.currentCommit ? updateInfo.currentCommit.substring(0, 12) : '—'}
                            {updateInfo.dirty ? ' (dirty)' : ''}
                          </div>
                        </div>
                        <button
                          onClick={handleCheckUpdate}
                          disabled={updateChecking}
                          className="px-2.5 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] rounded border border-purple-600 transition-colors flex items-center gap-1"
                        >
                          {updateChecking ? (
                            <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking</>
                          ) : (
                            'Check for Updates'
                          )}
                        </button>
                      </div>
                    </div>

                    {updateStatus === 'up-to-date' && (
                      <div className="py-2">
                        <span className="text-[10px] text-emerald-400">✓ Up to date</span>
                      </div>
                    )}

                    {updateStatus === 'update-available' && (
                      <div className="py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">Update available</span>
                        </div>
                        <div className="text-[9px] text-gray-400 font-mono">
                          {updateInfo.currentCommit.substring(0, 12)} → <span className="text-amber-300">{updateInfo.remoteCommit.substring(0, 12)}</span>
                          {updateInfo.behindBy > 0 ? ` (${updateInfo.behindBy} commit(s) behind)` : ''}
                        </div>
                        <div className="text-[8px] text-gray-600">
                          Run <span className="font-mono">git pull</span> or use the CLI to update.
                        </div>
                      </div>
                    )}

                    {updateStatus === 'error' && (
                      <div className="py-2">
                        <div className="flex items-center gap-2 px-2 py-1.5 bg-red-900/20 border border-red-800/30 rounded">
                          <span className="text-[9px] text-red-400">
                            {updateInfo.lastCheckError || 'Update check failed'}
                          </span>
                          <button onClick={handleCheckUpdate} disabled={updateChecking} className="text-[9px] text-purple-400 hover:text-purple-300 ml-auto shrink-0">retry</button>
                        </div>
                      </div>
                    )}

                    {updateStatus === 'unknown' && !updateChecking && (
                      <div className="py-2">
                        <span className="text-[9px] text-gray-600">No update information available. Click &quot;Check for Updates&quot; above.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ── Core Offline Notice ──────────────────────────────── */
            <div className="px-4 py-12 text-center">
              <div className="text-[11px] text-gray-600 font-mono">Core not connected</div>
              <div className="text-[9px] text-gray-700 mt-2 max-w-xs mx-auto leading-relaxed">
                Server settings are unavailable while Core is disconnected.
                Check the <span className="text-purple-400">Connection</span> section above to configure your WebSocket URL and reconnect.
              </div>
              <button
                onClick={onReconnect}
                className="mt-4 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 transition-colors"
              >
                Reconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
