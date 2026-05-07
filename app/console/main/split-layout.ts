// ─── Split Layout Types and Helpers ──────────────────────────
// State model for Stage multi-pane split-screen layout.

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitPane {
  /** Instance ID to render in this pane. */
  instanceId: string;
  /** Relative size (flex-grow weight). Defaults to 1. */
  size?: number;
}

export interface SplitLayout {
  direction: SplitDirection;
  panes: SplitPane[];
}

/** Create a single-pane layout (default, backward-compatible). */
export function singlePaneLayout(instanceId: string): SplitLayout {
  return { direction: 'horizontal', panes: [{ instanceId }] };
}

/** Check if layout has only one pane. */
export function isSinglePane(layout: SplitLayout): boolean {
  return layout.panes.length <= 1;
}

/** Ensure an instance has a pane in the layout. */
export function ensurePane(layout: SplitLayout, instanceId: string): SplitLayout {
  if (layout.panes.some(p => p.instanceId === instanceId)) return layout;
  return { ...layout, panes: [...layout.panes, { instanceId }] };
}

/** Remove a pane by instanceId. */
export function removePane(layout: SplitLayout, instanceId: string): SplitLayout {
  const panes = layout.panes.filter(p => p.instanceId !== instanceId);
  return panes.length === 0
    ? singlePaneLayout(instanceId) // fallback — shouldn't happen
    : { ...layout, panes };
}

/** Toggle split: add instance as second pane or go back to single. */
export function toggleSplit(
  layout: SplitLayout,
  currentId: string,
  newId: string,
  direction?: SplitDirection,
): SplitLayout {
  // If already showing both, collapse to single
  if (layout.panes.length > 1 && layout.panes.some(p => p.instanceId === newId)) {
    return singlePaneLayout(currentId);
  }
  // Switch to multi-pane
  return {
    direction: direction ?? 'horizontal',
    panes: [
      { instanceId: currentId },
      { instanceId: newId },
    ],
  };
}

/** Resize a pane (adjust size weight). delta: positive = larger. */
export function resizePane(layout: SplitLayout, instanceId: string, delta: number): SplitLayout {
  return {
    ...layout,
    panes: layout.panes.map(p =>
      p.instanceId === instanceId
        ? { ...p, size: Math.max(0.2, Math.min(5, (p.size ?? 1) + delta)) }
        : p
    ),
  };
}
