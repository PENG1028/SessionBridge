'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { CoreClient, CoreConnectionStatus } from './core-types';
import { createCoreClient, createMockCoreClient, type CoreClientImpl } from './core-client';
import { ProxyCoreClient } from './proxy-core-client';

// ─── Context ────────────────────────────────────────────────────
interface CoreClientContextValue {
  core: CoreClient;
  status: CoreConnectionStatus;
  /** Set to true when mock/offline mode is active. */
  isOffline: boolean;
  /** The active connection mode. */
  mode: 'proxy' | 'direct' | 'mock';
}

const CoreClientContext = createContext<CoreClientContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────
interface CoreClientProviderProps {
  children: ReactNode;
  /** Explicit WebSocket URL override. Only used in direct mode. */
  wsUrl?: string;
  /** Authentication token, sent as ?token= query param on WebSocket URL. Only used in direct mode. */
  token?: string;
  /** Connection mode: "proxy" (default, via /api/core/call) or "direct" (WebSocket to Core). */
  mode?: 'proxy' | 'direct';
  /** Force offline/mock mode even if Core is reachable. */
  forceOffline?: boolean;
  /** Mock data maps method name -> result for offline mode. */
  mockData?: Record<string, unknown>;
  /** Increment to trigger reconnection with current wsUrl/token. */
  reconnectKey?: number;
}

export function CoreClientProvider({
  children,
  wsUrl,
  token,
  mode = 'proxy',
  forceOffline = false,
  mockData,
  reconnectKey = 0,
}: CoreClientProviderProps) {
  const [status, setStatus] = useState<CoreConnectionStatus>('connecting');
  const [core, setCore] = useState<CoreClient>(() => {
    if (forceOffline) {
      return createMockCoreClient(mockData);
    }
    if (mode === 'proxy') {
      return new ProxyCoreClient();
    }
    return createCoreClient({ wsUrl, token });
  });
  const [isOffline, setIsOffline] = useState(forceOffline);

  useEffect(() => {
    if (forceOffline) {
      setCore(createMockCoreClient(mockData));
      setStatus('disconnected');
      setIsOffline(true);
      return;
    }

    if (mode === 'proxy') {
      const proxyClient = new ProxyCoreClient();
      setCore(proxyClient);
      setIsOffline(false);

      // In proxy mode, check connectivity by calling a lightweight status endpoint
      fetch('/api/auth/status', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
          if (data.configured && data.authenticated) {
            proxyClient.setConnected(true);
            setStatus('connected');
          } else if (data.configured && !data.authenticated) {
            proxyClient.setConnected(false);
            setStatus('disconnected');
          } else {
            // Auth not configured yet — the middleware will redirect to /setup
            // Still mark as "connected" in proxy sense (server is running)
            proxyClient.setConnected(true);
            setStatus('connected');
          }
        })
        .catch(() => {
          proxyClient.setConnected(false);
          setStatus('error');
        });

      return;
    }

    // Direct mode: create WebSocket-based CoreClient
    const instance = createCoreClient({ wsUrl, token }) as CoreClientImpl;
    const unsubStatus = instance.onStatusChange(setStatus);
    instance.connect();

    setCore(instance);
    setIsOffline(false);

    return () => {
      unsubStatus();
      instance.disconnect();
    };
  }, [wsUrl, token, mode, forceOffline, reconnectKey]);

  // eslint-disable-next-line react-perf/jsx-no-new-object-as-prop
  const value = { core, status, isOffline, mode };

  return (
    <CoreClientContext.Provider value={value}>
      {children}
    </CoreClientContext.Provider>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────
export function useCoreClient(): CoreClientContextValue {
  const ctx = useContext(CoreClientContext);
  if (!ctx) {
    throw new Error('useCoreClient must be used within a CoreClientProvider');
  }
  return ctx;
}

export function useCore(): CoreClient {
  return useCoreClient().core;
}

export function useCoreStatus(): CoreConnectionStatus {
  return useCoreClient().status;
}

export function useIsOnline(): boolean {
  return useCoreClient().status === 'connected';
}
