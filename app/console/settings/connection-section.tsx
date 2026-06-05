'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Radio } from 'lucide-react';
import {
  ConnectionDot,
  connectionStatusLabel,
  CollapsibleSection,
} from '../shell/settings-panel/shared';

// ── Types ──────────────────────────────────────────────────────

interface ConnectionSectionProps {
  coreStatus: string;
  isOffline: boolean;
  onReconnect: () => void;
  localPort: string;
  onLocalPortChange: (port: string) => void;
}

// ── ConnectionSection ──────────────────────────────────────────

export function ConnectionSection({
  coreStatus,
  isOffline,
  onReconnect,
  localPort,
  onLocalPortChange,
}: ConnectionSectionProps) {
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<Array<{ port: number; status: string }> | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch current server-side Core target on mount
  useEffect(() => {
    let ignore = false;
    setScanResults(null);
    fetch('/api/core/target')
      .then((r) => r.json())
      .then((data) => {
        if (ignore) return;
        if (data?.url) {
          try {
            const port = new URL(data.url).port || '9090';
            onLocalPortChange(port);
          } catch (_e) {
            /* URL parse failure — keep default port */
          }
        }
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [onLocalPortChange]);

  // ── Port scan handler ─────────────────────────────────────────
  const handleScanPorts = useCallback(async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const res = await fetch('/api/core/discover');
      const data = (await res.json()) as {
        results: Array<{ port: number; status: string; info?: unknown }>;
      };
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
  const applyLocalPort = useCallback(
    async (port: string) => {
      const cleanPort = port.trim() || '9090';
      try {
        await fetch('/api/core/target', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ port: parseInt(cleanPort, 10) }),
        });
        if (!mountedRef.current) return;
        onLocalPortChange(cleanPort);
        // Trigger reconnection after state is settled. Uses rAF so the
        // reconnect fires after the next paint, picking up the new target.
        requestAnimationFrame(() => {
          if (mountedRef.current) onReconnect();
        });
      } catch (_e) {
        /* fetch failure — keep current port */
      }
    },
    [onReconnect, onLocalPortChange],
  );

  // ── Collapse toggle ───────────────────────────────────────────
  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  return (
    <CollapsibleSection
      id="connection"
      title="Connection"
      collapsed={collapsed}
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
            onChange={(e) => {
              onLocalPortChange(e.target.value);
            }}
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
            <>
              <span className="w-3 h-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />{' '}
              Scanning...
            </>
          ) : (
            <>
              <Radio className="w-3 h-3" /> Scan for Core
            </>
          )}
        </button>

        {/* Scan results */}
        {scanResults !== null && (
          <div className="mt-2 space-y-1">
            {scanResults.filter((r) => r.status === 'running').length > 0 ? (
              scanResults
                .filter((r) => r.status === 'running')
                .map((r) => {
                  const isCurrentPort = String(r.port) === localPort;
                  return (
                    <div
                      key={r.port}
                      className="flex items-center gap-2 px-2 py-1.5 bg-emerald-900/10 border border-emerald-800/20 rounded"
                    >
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
                <div className="text-[10px] text-gray-600 font-mono">
                  No Core detected on this device
                </div>
                <div className="text-[8px] text-gray-700 mt-1">
                  Probed ports: {scanResults.map((r) => r.port).join(', ')}
                </div>
                <div className="text-[8px] text-gray-700">
                  Make sure Core is running (
                  <span className="font-mono">npm run dev:core</span>)
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
