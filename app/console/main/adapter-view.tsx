'use client';

// ─── Adapter View Router ────────────────────────────────────
// Routes to the correct view component based on the active
// instance's adapter type. This is the ONLY place in Console
// that knows about specific adapter view names.

import type { ReactNode } from 'react';

export interface AdapterViewProps {
  /** Active instance ID (null = no instance selected) */
  activeInstanceId: string | null;
  /** Adapter ID of the active instance */
  adapterId: string | null;
  /** Fallback content when no instance is active */
  children?: ReactNode;
}

/**
 * AdapterView — renders the main content for the active instance.
 * Currently inline-renders Claude/Terminal views since they
 * haven't been fully extracted yet. Will be replaced with
 * proper adapter.getView() calls in the future.
 */
export function AdapterView({ activeInstanceId, adapterId, children }: AdapterViewProps) {
  if (!activeInstanceId) {
    // No instance selected — show empty state
    return <>{children}</>;
  }

  // Future: dynamic routing via adapter.getView()
  // const adapter = adapterRegistry.get(adapterId);
  // const View = adapter?.getView();
  // return <View instanceId={activeInstanceId} ... />;

  // For now, the actual rendering is inline in page.tsx's main area.
  // This component just provides the routing structure.
  return <>{children}</>;
}
