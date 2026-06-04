'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, Search, Radio, ChevronRight } from 'lucide-react';
import { useCoreStatus, useCoreClient, useCore } from '../core/core-client-provider';
import { ConnectionDot, connectionStatusLabel, ConfigField, CollapsibleSection } from './settings-panel/shared';

// ── Types ──────────────────────────────────────────────────────

interface CoreConfigEntry {
  key: string;
  value: unknown;
  revision: number;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called when user wants to reconnect (same URL). */
  onReconnect: () => void;
}

// ── Main Panel ─────────────────────────────────────────────────

export function SettingsPanel({ open, onClose, onReconnect }: SettingsPanelProps) {
  const coreStatus = useCoreStatus();
  const { isOffline } = useCoreClient();
  const core = useCore();

  // ── Port-only input state ─────────────────────────────────────
  const [localPort, setLocalPort] = useState('9090');
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<Array<{ port: number; status: string }> | null>(null);

  // Track mount state so async callbacks don't setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // Fetch current server-side Core target on panel open
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    setScanResults(null);
    fetch('/api/core/target')
      .then(r => r.json())
      .then(data => {
        if (ignore) return;
        if (data?.url) {
          try {
            const port = new URL(data.url).port || '9090';
            setLocalPort(port);
          } catch (_e) { /* URL parse failure — keep default port */ }
        }
      })
      .catch(() => {});
    return () => { ignore = true; };
  }, [open]);

  // ── Port scan handler ─────────────────────────────────────────
  const handleScanPorts = useCallback(async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const res = await fetch('/api/core/discover');
      const data = await res.json() as { results: Array<{ port: number; status: string; info?: unknown }> };
      if (!mountedRef.current) return;
      setScanResults(data.results);
    } catch (_e) {
      if (!mountedRef.current) return;
      setScanResults([]);
    }
    if (!mountedRef.current) return;
    setScanning(false);
  }, []);

  // ── Apply port via server API ─────────────────────────────────
  const applyLocalPort = useCallback(async (port: string) => {
    const cleanPort = port.trim() || '9090';
    try {
      await fetch('/api/core/target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ port: parseInt(cleanPort, 10) }),
      });
      if (!mountedRef.current) return;
      setLocalPort(cleanPort);
      // Trigger reconnection after state is settled. Uses rAF so the
      // reconnect fires after the next paint, picking up the new target.
      requestAnimationFrame(() => {
        if (mountedRef.current) onReconnect();
      });
    } catch (_e) { /* fetch failure — keep current port */ }
  }, [onReconnect]);

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
      if (!mountedRef.current) return;
      const entries: CoreConfigEntry[] = result?.configs ?? [];
      setCoreConfigs(entries);
      setDirtyMap(new Map());
      setValidationErrors({});
    } catch (err) {
      if (!mountedRef.current) return;
      setError((err as Error).message || 'Failed to load config');
    }
    if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
      setCoreConfigs((prev) => prev.filter((e) => e.key !== key));
      setDirtyMap((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } catch (err) {
      if (!mountedRef.current) return;
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

    if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
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
    } catch (_e) {
      // Update manager may not be available on this Core version
    }
  }, [core]);

  const handleCheckUpdate = useCallback(async () => {
    setUpdateChecking(true);
    try {
      const result = await core.call('update.check') as Record<string, unknown> | undefined;
      if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
      setUpdateStatus('error');
      setUpdateInfo(prev => ({ ...prev, lastCheckError: (err as Error).message }));
    }
    if (!mountedRef.current) return;
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
              <span className="text-[9px] text-gray-600 font-mono ml-auto">:{localPort}</span>
              {coreStatus !== 'connected' && !isOffline && (
                <button
                  onClick={onReconnect}
                  className="text-[9px] text-purple-400 hover:text-purple-300"
                >
                  reconnect
                </button>
              )}
            </div>

            {/* Port input */}
            <div className="py-2">
              <div className="text-[9px] text-gray-600 mb-1">Core Port</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localPort}
                  onChange={(e) => { setLocalPort(e.target.value); }}
                  className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500 font-mono"
                  placeholder="9090"
                />
                <button
                  onClick={() => applyLocalPort(localPort)}
                  className="px-2.5 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 transition-colors shrink-0"
                >
                  Connect
                </button>
              </div>
              <div className="text-[8px] text-gray-700 mt-0.5">
                Sets the port the server uses to reach Core on localhost
              </div>
            </div>

            {/* Scan for Core (always available) */}
            <div className="py-1">
              <button
                onClick={handleScanPorts}
                disabled={scanning}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1a1a1a] hover:bg-[#222] border border-gray-700 text-gray-300 text-[10px] rounded transition-colors w-full justify-center"
              >
                {scanning ? (
                  <><span className="w-3 h-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" /> Scanning...</>
                ) : (
                  <><Radio className="w-3 h-3" /> Scan for Core</>
                )}
              </button>

              {/* Scan results */}
              {scanResults !== null && (
                <div className="mt-2 space-y-1">
                  {scanResults.filter(r => r.status === 'running').length > 0 ? (
                    scanResults.filter(r => r.status === 'running').map(r => {
                      const isCurrentPort = String(r.port) === localPort;
                      return (
                        <div key={r.port} className="flex items-center gap-2 px-2 py-1.5 bg-emerald-900/10 border border-emerald-800/20 rounded">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span className="text-[10px] text-emerald-400 flex-1 font-mono">
                            Core running on port {r.port}
                            {isCurrentPort && (
                              <span className="text-emerald-600 ml-1">(current)</span>
                            )}
                          </span>
                          {!isCurrentPort && (
                            <button
                              onClick={() => applyLocalPort(String(r.port))}
                              className="text-[9px] text-purple-400 hover:text-purple-300"
                            >
                              switch
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-2 py-2 text-center">
                      <div className="text-[10px] text-gray-600 font-mono">No Core detected on this device</div>
                      <div className="text-[8px] text-gray-700 mt-1">
                        Probed ports: {scanResults.map(r => r.port).join(', ')}
                      </div>
                      <div className="text-[8px] text-gray-700">
                        Make sure Core is running (<span className="font-mono">npm run dev:core</span>)
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
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
                <span className="text-[10px] text-gray-500">Core Port</span>
                <span className="text-[10px] text-gray-500 font-mono">{localPort}</span>
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
                  {filteredConfigs.map((entry: CoreConfigEntry) => (
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
                Check the <span className="text-purple-400">Connection</span> section above to configure your port and reconnect.
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
