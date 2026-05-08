'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { WhenContext } from '../../../lib/evaluate-when';
import { getAdapterViewId, getAllAdapterTypes } from '../main/view-registry';
import { getDefaultAdapterId } from '../../../adapters/registry';

// ── Focus State ───────────────────────────────────────────────

export interface FocusState {
  viewId: string;
  instanceId: string | null;
  adapterId: string | null;
  isRunning: boolean;
  sessionKey: string;
  paneId: string | null;
  paneViewType: string | null;
  whenContext: WhenContext;
}

export type PaneFocusInfo = {
  paneId: string;
  viewType: string;
};

interface FocusProviderProps {
  instances: Array<{ id: string; adapterId?: string; status: string }>;
  activeInstanceId: string | null;
  activeViewId: string;
  sessionKey: string;
  paneFocus?: PaneFocusInfo | null;
  children: ReactNode;
}

// ── Context ───────────────────────────────────────────────────

const FocusContext = createContext<FocusState | null>(null);

// ── Provider ──────────────────────────────────────────────────

export function FocusProvider({
  instances, activeInstanceId, activeViewId, sessionKey, paneFocus, children,
}: FocusProviderProps) {
  const value = useMemo<FocusState>(() => {
    const activeInstance = instances.find(i => i.id === activeInstanceId) ?? null;
    const adapterId = activeInstance?.adapterId ?? null;
    const defaultAdapterId = getAllAdapterTypes()[0]?.id || getDefaultAdapterId();
    const viewId = getAdapterViewId(adapterId || defaultAdapterId) || getDefaultAdapterId();
    const isRunning = activeInstance?.status === 'running';

    const whenContext: WhenContext = {
      view: paneFocus?.viewType || viewId,
      activeAdapterId: adapterId || defaultAdapterId,
      isRunning,
      instanceId: activeInstanceId ?? undefined,
    };

    return {
      viewId: paneFocus?.viewType || viewId,
      instanceId: activeInstanceId,
      adapterId,
      isRunning,
      sessionKey,
      paneId: paneFocus?.paneId || null,
      paneViewType: paneFocus?.viewType || null,
      whenContext,
    };
  }, [instances, activeInstanceId, activeViewId, sessionKey, paneFocus]);

  return (
    <FocusContext.Provider value={value}>
      {children}
    </FocusContext.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────

export function useFocus(): FocusState {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error('useFocus must be used within a FocusProvider');
  return ctx;
}

export function useWhenContext(): WhenContext {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error('useWhenContext must be used within a FocusProvider');
  return ctx.whenContext;
}
