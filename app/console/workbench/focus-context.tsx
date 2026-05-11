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
  /** View-scoped dock profile key for panel order/collapse/size persistence.
   *  Format: `view:<viewType>`, e.g. `view:claude-chat`.
   *  Future: `instance:<instanceId>` for instance-scoped profiles. */
  dockProfileKey: string;
}

export type PaneFocusInfo = {
  paneId: string;
  viewType: string;
  /** Phase 4F: instanceId from the active tab, so FocusProvider can resolve
   *  adapterId/isRunning from the tab-bound instance instead of the global
   *  activeInstanceId. */
  instanceId?: string;
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
    // Phase 4I: effectiveInstanceId comes SOLELY from the tab-bound instanceId.
    // The global activeInstanceId (management selection in the sidebar) is no
    // longer a fallback — tab is the subject, instance is a tab's binding.
    const effectiveInstanceId = paneFocus?.instanceId ?? null;
    const activeInstance = instances.find(i => i.id === effectiveInstanceId) ?? null;
    const adapterId = activeInstance?.adapterId ?? null;
    const isRunning = activeInstance?.status === 'running';

    // Phase 4I: adapterId can be null (no instance bound to tab). We intentionally
    // pass '' instead of defaultAdapterId so right-side panels with when conditions
    // won't fire for unbounded tabs. When a view is rendered, the view component
    // receives the correct instanceId through its own props.
    const safeAdapterId = adapterId || '';
    const viewId = paneFocus?.viewType || getAdapterViewId(safeAdapterId) || '';

    const whenContext: WhenContext = {
      view: paneFocus?.viewType || viewId,
      activeAdapterId: safeAdapterId,
      isRunning,
      instanceId: effectiveInstanceId ?? undefined,
    };

    const dockProfileKey = paneFocus?.viewType
      ? `view:${paneFocus.viewType}`
      : `view:${activeViewId || 'unknown'}`;

    return {
      viewId,
      instanceId: effectiveInstanceId,
      adapterId,
      isRunning,
      sessionKey,
      paneId: paneFocus?.paneId || null,
      paneViewType: paneFocus?.viewType || null,
      whenContext,
      dockProfileKey,
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
