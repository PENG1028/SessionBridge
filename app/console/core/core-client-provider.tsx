'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { CoreClient, CoreConnectionStatus } from './core-types';
import { createMockCoreClient } from './core-client';
import { ProxyCoreClient } from './proxy-core-client';

// ─── Context ────────────────────────────────────────────────────
interface CoreClientContextValue {
  core: CoreClient;
  status: CoreConnectionStatus;
  /** Set to true when mock/offline mode is active. */
  isOffline: boolean;
}

const CoreClientContext = createContext<CoreClientContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────
interface CoreClientProviderProps {
  children: ReactNode;
  /** Force offline/mock mode even if Core is reachable. */
  forceOffline?: boolean;
  /** Mock data maps method name -> result for offline mode. */
  mockData?: Record<string, unknown>;
  /** Increment to trigger SSE reconnection. */
  reconnectKey?: number;
}

export function CoreClientProvider({
  children,
  forceOffline = false,
  mockData,
  reconnectKey = 0,
}: CoreClientProviderProps) {
  const [status, setStatus] = useState<CoreConnectionStatus>('disconnected');
  const [core, setCore] = useState<CoreClient>(() => {
    if (forceOffline) return createMockCoreClient(mockData);
    return new ProxyCoreClient();
  });
  const [isOffline, setIsOffline] = useState(forceOffline);

  useEffect(() => {
    if (forceOffline) {
      setCore(createMockCoreClient(mockData));
      setStatus('disconnected');
      setIsOffline(true);
      return;
    }

    const proxyClient = new ProxyCoreClient();
    setCore(proxyClient);
    setIsOffline(false);

    // ProxyCoreClient auto-connects via SSE to /api/core/events
    // when on() is called. Status updates flow through onStatusChange.
    const unsub = proxyClient.onStatusChange(setStatus);

    // Seed a connectivity probe — if no SSE event has triggered within 2s,
    // try a direct core call to give immediate feedback.
    const probeTimer = setTimeout(() => {
      if (proxyClient.connectionStatus === 'disconnected') {
        proxyClient.call('node.health', {}).then(() => {
          proxyClient.setConnected();
          setStatus('connected');
        }).catch(() => {
          setStatus('disconnected');
        });
      }
    }, 2000);

    return () => {
      unsub();
      clearTimeout(probeTimer);
      proxyClient.disconnect();
    };
  }, [forceOffline, reconnectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-perf/jsx-no-new-object-as-prop
  const value = { core, status, isOffline };

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
