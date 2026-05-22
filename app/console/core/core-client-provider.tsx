'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { CoreClient, CoreConnectionStatus } from './core-types';
import { createCoreClient, createMockCoreClient, type CoreClientImpl } from './core-client';

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
  /** Explicit WebSocket URL override. Auto-detected from window.location if omitted. */
  wsUrl?: string;
  /** Force offline/mock mode even if Core is reachable. */
  forceOffline?: boolean;
  /** Mock data maps method name -> result for offline mode. */
  mockData?: Record<string, unknown>;
}

export function CoreClientProvider({
  children,
  wsUrl,
  forceOffline = false,
  mockData,
}: CoreClientProviderProps) {
  const [status, setStatus] = useState<CoreConnectionStatus>('connecting');
  const [core, setCore] = useState<CoreClient>(() =>
    forceOffline
      ? createMockCoreClient(mockData)
      : createCoreClient({ wsUrl }),
  );
  const [isOffline, setIsOffline] = useState(forceOffline);

  useEffect(() => {
    if (forceOffline) {
      setCore(createMockCoreClient(mockData));
      setStatus('disconnected');
      setIsOffline(true);
      return;
    }

    const instance = createCoreClient({ wsUrl }) as CoreClientImpl;
    const unsubStatus = instance.onStatusChange(setStatus);

    // Auto-connect
    instance.connect();

    setCore(instance);
    setIsOffline(false);

    return () => {
      unsubStatus();
      instance.disconnect();
    };
  }, [wsUrl, forceOffline]);

  // eslint-disable-next-line react-perf/jsx-no-new-object-as-prop
  const value = { core, status, isOffline };

  return (
    <CoreClientContext.Provider value={value}>
      {children}
    </CoreClientContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────
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
