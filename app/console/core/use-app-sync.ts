'use client';

// ─── useAppSync ───────────────────────────────────────────────────
// Syncs plugin UI contributions from /api/apps/*.
// Delegates ALL registration logic to syncAllPlugins in app-registry.
// Subscribe to app state changes for hot-reload.

import { useEffect, useRef } from 'react';
import type { CoreClient } from './core-types';
import { syncAllPlugins } from '../../lib/app-registry/plugin-sync';
import { subscribe } from '../../lib/app-registry/app-registry';

export function useAppSync(
  core: CoreClient,
  onExecuteCommand: (commandId: string) => void,
): void {
  const onExecuteRef = useRef(onExecuteCommand);
  onExecuteRef.current = onExecuteCommand;

  // Initial sync when Core connects
  useEffect(() => {
    if (!core.isConnected) return;
    let cancelled = false;

    syncAllPlugins(onExecuteRef.current).catch(() => {});

    // Hot-reload: re-sync when app state changes (enable/disable)
    const unsub = subscribe(() => {
      if (cancelled) return;
      syncAllPlugins(onExecuteRef.current).catch(() => {});
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [core, core.isConnected]);
}
