'use client';

import { createContext, useContext, type ReactNode, type ComponentType } from 'react';
import type { SurfaceRenderContext, SurfaceType, TabProjection } from './surface-types';
import { surfaceRegistry } from './surface-registry';

// ─── Context ────────────────────────────────────────────────────
const SurfaceContext = createContext<SurfaceRenderContext | null>(null);

export function SurfaceContextProvider({ context, children }: { context: SurfaceRenderContext; children: ReactNode }) {
  return (
    <SurfaceContext.Provider value={context}>
      {children}
    </SurfaceContext.Provider>
  );
}

export function useSurfaceContext(): SurfaceRenderContext {
  const ctx = useContext(SurfaceContext);
  if (!ctx) throw new Error('useSurfaceContext must be used within SurfaceContextProvider');
  return ctx;
}

// ─── SurfaceRenderer ────────────────────────────────────────────
interface SurfaceRendererProps {
  context: SurfaceRenderContext;
  fallback?: ReactNode;
}

export function SurfaceRenderer({ context, fallback }: SurfaceRendererProps) {
  const Component = surfaceRegistry.resolve(context) as ComponentType<unknown> | null;

  if (!Component) {
    return fallback ?? <MissingSurfaceWarning context={context} />;
  }

  return (
    <SurfaceContextProvider context={context}>
      <Component />
    </SurfaceContextProvider>
  );
}

function MissingSurfaceWarning({ context }: { context: SurfaceRenderContext }) {
  const viewId = context.viewId || context.panelId || context.id;
  return (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
      Surface not registered: {viewId} ({context.type})
    </div>
  );
}

// ─── TabProjection helpers ──────────────────────────────────────

/**
 * Rebuild tab projections from Core `session.list` data.
 * This is called on page load to reconstruct tabs — tabs are NOT loaded
 * from localStorage. Only UI preferences (layout sizes, collapsed state)
 * survive refresh.
 */
export function rebuildTabsFromSessions(
  sessions: Array<{ sessionId: string; kind: string; pluginId?: string; nodeId?: string; status: string }>,
): TabProjection[] {
  return sessions.map((session, idx) => ({
    tabId: `tab_rebuild_${idx}_${Date.now()}`,
    viewType: resolveViewType(session.pluginId, session.kind),
    title: session.kind,
    sessionId: session.sessionId,
    nodeId: session.nodeId,
    pluginId: session.pluginId,
    surfaceType: 'main.editor' as SurfaceType,
    isAlive: session.status === 'running' || session.status === 'resumable',
  }));
}

/**
 * Resolve a view type from pluginId + kind using the surface registry's
 * session-to-view mappings. This is how tabs are reconstructed on reload.
 */
export function resolveViewType(pluginId?: string, kind?: string): string {
  if (!pluginId || !kind) return 'unknown';
  const mapping = surfaceRegistry.getSessionView(pluginId, kind);
  return mapping?.viewType ?? 'unknown';
}

