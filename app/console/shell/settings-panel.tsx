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

type Tab = 'connections' | 'server' | 'notifications';

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 bg-black/60">
      <div className="w-full max-w-lg bg-[#151515] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden max-h-[80vh] flex flex-col">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
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
            { id: 'notifications' as Tab, label: 'Notifications' },
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
          ) : (
            /* ── Notifications tab ── */
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
    </div>
  );
}
