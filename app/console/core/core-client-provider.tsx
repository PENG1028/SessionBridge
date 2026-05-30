'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { CoreClient, CoreConnectionStatus } from './core-types';
import { createMockCoreClient } from './core-client';
import { ProxyCoreClient } from './proxy-core-client';

const EMPTY_SET = new Set<string>();

// ─── Context ────────────────────────────────────────────────────
interface CoreClientContextValue {
  core: CoreClient;
  status: CoreConnectionStatus;
  /** Set to true when mock/offline mode is active. */
  isOffline: boolean;
  /** The node ID that capability calls are routed to via mesh.
   *  null = local node (no mesh routing). */
  activeNodeId: string | null;
  /** The local node's own ID, resolved from node.identity.get on connect. */
  localNodeId: string | null;
  /** Set the active target node for mesh routing. Pass null to reset to local. */
  setActiveNode: (nodeId: string | null) => void;
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
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [localNodeId, setLocalNodeId] = useState<string | null>(null);
  const coreRef = useRef<CoreClient>(core);
  coreRef.current = core;

  // When activeNodeId changes, sync it to the ProxyCoreClient so
  // subsequent core.call() requests auto-inject targetNodeId.
  const setActiveNode = useCallback((nodeId: string | null) => {
    setActiveNodeId(nodeId);
    const c = coreRef.current;
    if (c instanceof ProxyCoreClient) {
      c.setTargetNodeId(nodeId);
    }
  }, []);

  useEffect(() => {
    if (forceOffline) {
      setCore(createMockCoreClient(mockData));
      setStatus('disconnected');
      setIsOffline(true);
      return;
    }

    const proxyClient = new ProxyCoreClient();
    // Restore any previously-set target node ID
    if (activeNodeId) {
      proxyClient.setTargetNodeId(activeNodeId);
    }
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

    // Fetch local node identity as soon as the Core responds.
    const idTimer = setTimeout(() => {
      proxyClient.call<{nodeId: string}>('node.identity.get', {}).then(id => {
        if (id?.nodeId) setLocalNodeId(id.nodeId);
      }).catch(() => {});
    }, 500);

    return () => {
      unsub();
      clearTimeout(probeTimer);
      clearTimeout(idTimer);
      proxyClient.disconnect();
    };
  }, [forceOffline, reconnectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-perf/jsx-no-new-object-as-prop
  const value = { core, status, isOffline, activeNodeId, localNodeId, setActiveNode };

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

/** Returns the currently active target node ID for mesh routing. */
export function useActiveNodeId(): string | null {
  return useCoreClient().activeNodeId;
}

/** Returns a setter to switch the active target node for mesh routing. */
export function useSetActiveNode(): (nodeId: string | null) => void {
  return useCoreClient().setActiveNode;
}

/** Returns the local node's own ID (resolved from node.identity.get). */
export function useLocalNodeId(): string | null {
  return useCoreClient().localNodeId;
}

/**
 * useTargetReachability — returns true if a given remote node is currently
 * reachable via mesh. Always returns true for local node (null target).
 *
 * Uses useSyncExternalStore so the layout can react instantly when
 * a node connects or disconnects without polling.
 */
export function useTargetReachability(nodeId: string | null): boolean {
  const core = useCore();

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!(core instanceof ProxyCoreClient)) return () => {};
      return core.onReachabilityChange(onChange);
    },
    [core],
  );

  const getSnapshot = useCallback((): boolean => {
    if (!nodeId) return true; // local node, always reachable
    if (!(core instanceof ProxyCoreClient)) return true; // mock core
    return core.isNodeReachable(nodeId);
  }, [core, nodeId]);

  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

/**
 * useReachableNodeIds — returns a Set of node IDs currently reachable via mesh.
 * Updates instantly when a node connects or disconnects.
 */
export function useReachableNodeIds(): Set<string> {
  const core = useCore();
  const cachedRef = useRef<Set<string>>(EMPTY_SET);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!(core instanceof ProxyCoreClient)) return () => {};
      return core.onReachabilityChange(onChange);
    },
    [core],
  );

  const getSnapshot = useCallback((): Set<string> => {
    if (!(core instanceof ProxyCoreClient)) return EMPTY_SET;
    const ids = core.getReachableNodeIds();
    const prev = cachedRef.current;
    // Return cached Set unless contents changed.
    if (prev.size !== ids.length || ids.some(id => !prev.has(id))) {
      cachedRef.current = new Set(ids);
    }
    return cachedRef.current;
  }, [core]);

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SET);
}
