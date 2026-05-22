'use client';

/**
 * Shared launchability check — unified across view-registry, view-selector,
 * workbench-state, plugin-manager, and plugin-detail.
 *
 * Rules:
 * 1. Only main.editor views (not panel, status, header) can be launchable
 * 2. hidden / runtime launchMode views are never launchable
 * 3. Explicitly launchable when launchable === true OR launchMode === 'direct'
 * 4. Adapter mappings alone (without direct launchMode) do NOT qualify
 */

export interface LaunchabilityMeta {
  launchable?: boolean;
  launchMode?: string;
  viewType?: string;
}

/**
 * Returns true if the view can appear in the "New Tab" selector or be
 * opened as a standalone tab.
 *
 * A view is launchable ONLY if:
 * - Its viewType is undefined or 'main.editor' (panels, status bar, headers are never launchable)
 * - launchMode is NOT 'hidden' or 'runtime'
 * - launchable === true OR launchMode === 'direct'
 */
export function isViewLaunchable(meta: LaunchabilityMeta): boolean {
  // Only main.editor views can be launchable.
  // If viewType is undefined (not explicitly set), default to allowing it
  // for backward compatibility with views registered before viewType existed.
  if (meta.viewType && meta.viewType !== 'main.editor') return false;

  // hidden, runtime, and session modes are never launchable
  if (meta.launchMode === 'hidden' || meta.launchMode === 'runtime' || meta.launchMode === 'session') return false;

  // Explicitly launchable
  if (meta.launchable === true || meta.launchMode === 'direct') return true;

  return false;
}

/**
 * Filter an iterable of [id, entry] pairs to only launchable views.
 * Useful for view-selector and default-view computation.
 */
export function filterLaunchableViews<E extends { meta: LaunchabilityMeta }>(
  entries: Array<[string, E]>,
): Array<[string, E]> {
  return entries.filter(([id, entry]) => {
    if (id === 'empty') return false;
    return isViewLaunchable(entry.meta);
  });
}

/**
 * Find the first launchable view from an iterable of [id, entry] pairs.
 * Returns the id string or null.
 */
export function firstLaunchableViewId<E extends { meta: LaunchabilityMeta }>(
  entries: Array<[string, E]>,
): string | null {
  const match = entries.find(([id, entry]) => {
    if (id === 'empty') return false;
    return isViewLaunchable(entry.meta);
  });
  return match ? match[0] : null;
}

/**
 * Check whether a specific plugin has at least one launchable/direct view
 * among the given entries.
 *
 * @param pluginId   The plugin to check for.
 * @param entries    View registry entries as [[viewId, entry], ...].
 * @param ownerResolver  Function that maps a viewId to its owning pluginId.
 *                       Adapter views map to their adapter plugin; core views
 *                       with no mapping default to 'sessionnode-core'.
 * @returns true if at least one entry owned by pluginId passes isViewLaunchable.
 */
export function hasLaunchableViewForPlugin<E extends { meta: LaunchabilityMeta }>(
  pluginId: string,
  entries: Array<[string, E]>,
  ownerResolver: (viewId: string) => string | undefined,
): boolean {
  for (const [viewId, entry] of entries) {
    const ownerId = ownerResolver(viewId) ?? 'sessionnode-core';
    if (ownerId !== pluginId) continue;
    if (isViewLaunchable(entry.meta)) return true;
  }
  return false;
}
