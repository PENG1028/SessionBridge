'use client';

// ─── useAppChrome ─────────────────────────────────────────────────
// Manages the shell UI chrome state: banners, command palette, sidebar
// visibility, and chrome policy derived from the active view.
// Extracted from page.tsx.

import { useState, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useLayout } from '../workbench';
import type { ConnStatus } from '../../../lib/use-ws';
import type { PaneTab } from '../stage/workbench-state';
import { getViewEntry, resolveChromePolicy } from '../main/view-registry';

export interface AppChromeState {
  showBanner: boolean;
  showCommandPalette: boolean;
  setShowCommandPalette: Dispatch<SetStateAction<boolean>>;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  effectiveLeftOpen: boolean;
  effectiveRightOpen: boolean;
  showStatusBar: boolean;
  chromePolicy: ReturnType<typeof resolveChromePolicy>;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
}

export function useAppChrome(
  connStatus: ConnStatus,
  paneFocus: { paneId: string; viewType: string; instanceId?: string | null } | null,
  noActiveNode: boolean,
): AppChromeState {
  const { state, dispatch } = useLayout();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 30s grace before showing disconnect banner ──
  const [showBanner, setShowBanner] = useState(false);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (connStatus.status === 'connected') {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setShowBanner(false);
    } else if (!disconnectTimerRef.current) {
      disconnectTimerRef.current = setTimeout(() => setShowBanner(true), 30000);
    }
    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    };
  }, [connStatus.status]);

  // ── Command palette ──
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // ── Chrome policy from active view ──
  const activeViewChrome = paneFocus
    ? getViewEntry(paneFocus.viewType)?.meta.chrome
    : undefined;
  const chromePolicy = resolveChromePolicy(activeViewChrome);
  const showStatusBar = chromePolicy.statusBar !== 'hidden';

  // ── Sidebar requirements per view ──
  const activeSidebarReqs = paneFocus
    ? getViewEntry(paneFocus.viewType)?.meta.sidebarRequirements
    : undefined;

  // Sidebar visibility: sidebarRequirements drive defaults; manual toggle takes precedence.
  const effectiveLeftOpen = noActiveNode
    ? false
    : state.sidebarOverride
      ? state.leftSidebarOpen
      : activeSidebarReqs?.left === 'hidden'
        ? false
        : activeSidebarReqs?.left === 'shown'
          ? true
          : state.leftSidebarOpen;

  const effectiveRightOpen = noActiveNode
    ? false
    : state.sidebarOverride
      ? state.rightSidebarOpen
      : activeSidebarReqs?.right === 'hidden'
        ? false
        : activeSidebarReqs?.right === 'shown'
          ? true
          : state.rightSidebarOpen;

  const toggleLeftSidebar = () => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'left' });
  const toggleRightSidebar = () => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'right' });

  return {
    showBanner,
    showCommandPalette, setShowCommandPalette,
    settingsOpen, setSettingsOpen,
    effectiveLeftOpen, effectiveRightOpen,
    showStatusBar, chromePolicy,
    toggleLeftSidebar, toggleRightSidebar,
  };
}
