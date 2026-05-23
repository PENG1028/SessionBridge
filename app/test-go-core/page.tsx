'use client';

export const dynamic = 'force-dynamic';

import { useRef, useEffect, useState } from 'react';
import { CoreClientImpl } from '../console/core/core-client';
import { PluginHost } from '../console/plugin-host/plugin-host';
import {
  registerBuiltinHostComponents,
  registerPluginHostComponents,
} from '../console/plugin-host';
import type { SurfaceRenderContext } from '../console/surface/surface-types';

/**
 * Test harness page for Go Core E2E.
 * Route: /test-go-core
 *
 * Renders TerminalView and SystemInfoPanel via PluginHost,
 * connecting to Go Core WebSocket at ws://localhost:9090/ws.
 * Exposes __testCore on window for Playwright evaluate() calls.
 */

// Register at module level so both SSR and client see the same manifests.
// Prevents hydration mismatch that would cause WebSocket to disconnect/reconnect.
registerBuiltinHostComponents();
registerPluginHostComponents();

export default function TestGoCorePage() {
  const [wsStatus, setWsStatus] = useState('connecting');

  // Lazy init: create CoreClientImpl once and keep it across renders/StrictMode.
  // Using useRef instead of useMemo avoids double-init in SSR→hydration transition.
  const coreRef = useRef<CoreClientImpl | null>(null);
  if (!coreRef.current) {
    const client = new CoreClientImpl({
      pluginId: 'sessionnode-core',
      wsUrl: 'ws://localhost:9090/ws',
      callTimeout: 15_000,
    });

    client.onStatusChange((status) => {
      setWsStatus(status);
    });

    // Expose for Playwright test evaluate() calls
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__testCore = client;
    }

    coreRef.current = client;
  }
  const core = coreRef.current;

  // Connect WebSocket on mount (client-only, runs once).
  // No cleanup — keep the WS alive across React Strict Mode double-mount.
  // connect() is idempotent: if already connected/CONNECTING, it's a no-op.
  useEffect(() => {
    core.connect();

    // Debug: log WS disconnect/reconnect for test diagnostics
    const unsubStatus = core.onStatusChange((status) => {
      console.log('[test-core] WS status:', status, 'at', Date.now());
    });
    return () => {
      unsubStatus();
    };
  }, [core]);

  const terminalSurface: SurfaceRenderContext = {
    id: 'test-terminal',
    type: 'main.editor',
    pluginId: 'terminal',
    viewId: 'terminal.view',
  };

  const systemInfoSurface: SurfaceRenderContext = {
    id: 'test-system-info',
    type: 'panel.bottom',
    pluginId: 'system-info',
    panelId: 'system-info.panel',
  };

  const statusColor =
    wsStatus === 'connected'
      ? 'text-green-400'
      : wsStatus === 'error'
        ? 'text-red-400'
        : 'text-yellow-400';

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-gray-200">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900 text-xs shrink-0">
        <span className="text-gray-300 font-medium">Go Core E2E Harness</span>
        <span className="text-gray-600">|</span>
        <span id="ws-status" className={statusColor}>
          WS: {wsStatus}
        </span>
      </div>

      {/* Main content — only render PluginHost after WS connected so
          component useEffects don't fire calls before WS is ready */}
      {wsStatus === 'connected' ? (
        <div className="flex-1 flex min-h-0">
          {/* Terminal — left area */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <PluginHost surface={terminalSurface} core={core} />
          </div>

          {/* System Info — right sidebar */}
          <div className="w-80 flex flex-col min-h-0 border-l border-gray-800 shrink-0">
            <PluginHost surface={systemInfoSurface} core={core} />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Waiting for WebSocket connection to Go Core...
        </div>
      )}
    </div>
  );
}
