'use client';

import { createContext, useContext, useReducer, useEffect, useState, type ReactNode } from 'react';
import { getAllViewEntries } from '../main/view-registry';

// ── Platform Capabilities ────────────────────────────────────────

export interface PlatformCapabilities {
  platform: 'desktop' | 'mobile' | 'tablet';
  ui: {
    modal: { type: 'centered-draggable' | 'fullscreen-bottom' };
    floatingWindow: { available: boolean };
    splitPane: { type: 'side-by-side' | 'stacked' };
    popover: { available: boolean };
    dragAndDrop: { available: boolean };
    sidebars: { left: 'fixed' | 'overlay'; right: 'fixed' | 'overlay' };
  };
}

function detectPlatform(): PlatformCapabilities {
  if (typeof window === 'undefined') {
    return { platform: 'desktop', ui: { modal: { type: 'centered-draggable' }, floatingWindow: { available: true }, splitPane: { type: 'side-by-side' }, popover: { available: true }, dragAndDrop: { available: true }, sidebars: { left: 'fixed', right: 'fixed' } } };
  }
  const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent) || window.innerWidth < 768;
  if (isMobile) {
    return { platform: 'mobile', ui: { modal: { type: 'fullscreen-bottom' }, floatingWindow: { available: false }, splitPane: { type: 'stacked' }, popover: { available: false }, dragAndDrop: { available: false }, sidebars: { left: 'overlay', right: 'overlay' } } };
  }
  const isTablet = window.innerWidth >= 768 && window.innerWidth < 1024;
  if (isTablet) {
    return { platform: 'tablet', ui: { modal: { type: 'fullscreen-bottom' }, floatingWindow: { available: false }, splitPane: { type: 'stacked' }, popover: { available: false }, dragAndDrop: { available: false }, sidebars: { left: 'overlay', right: 'overlay' } } };
  }
  return { platform: 'desktop', ui: { modal: { type: 'centered-draggable' }, floatingWindow: { available: true }, splitPane: { type: 'side-by-side' }, popover: { available: true }, dragAndDrop: { available: true }, sidebars: { left: 'fixed', right: 'fixed' } } };
}

// ── Layout State ────────────────────────────────────────────────

export interface LayoutState {
  activeViewId: string;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  sidebarOverride: boolean;
}

type LayoutAction =
  | { type: 'SET_ACTIVE_VIEW'; viewId: string }
  | { type: 'TOGGLE_SIDEBAR'; position: 'left' | 'right' }
  | { type: 'SET_SIDEBAR'; position: 'left' | 'right'; open: boolean }
  | { type: 'RESTORE'; state: { activeViewId: string; leftSidebarOpen: boolean; rightSidebarOpen: boolean } };

const STORAGE_KEY = 'sessionbridge-layout';

function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'SET_ACTIVE_VIEW':
      return { ...state, activeViewId: action.viewId, sidebarOverride: false };
    case 'TOGGLE_SIDEBAR':
      if (action.position === 'left') return { ...state, leftSidebarOpen: !state.leftSidebarOpen, sidebarOverride: true };
      return { ...state, rightSidebarOpen: !state.rightSidebarOpen, sidebarOverride: true };
    case 'SET_SIDEBAR':
      if (action.position === 'left') return { ...state, leftSidebarOpen: action.open, sidebarOverride: true };
      return { ...state, rightSidebarOpen: action.open, sidebarOverride: true };
    case 'RESTORE':
      return { ...state, activeViewId: action.state.activeViewId, leftSidebarOpen: action.state.leftSidebarOpen, rightSidebarOpen: action.state.rightSidebarOpen };
    default:
      return state;
  }
}

// ── Context ─────────────────────────────────────────────────────

export interface LayoutContextValue {
  state: LayoutState;
  dispatch: React.Dispatch<LayoutAction>;
  platform: PlatformCapabilities;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────

function getDefaultViewId(): string {
  const entries = getAllViewEntries();
  const first = entries.find(([id]) => id !== 'empty');
  return first?.[0] || 'empty';
}

const initialState: LayoutState = {
  activeViewId: getDefaultViewId(),
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  sidebarOverride: false,
};

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(layoutReducer, initialState);
  const [platform, setPlatform] = useState<PlatformCapabilities>(detectPlatform);

  useEffect(() => {
    const handler = () => setPlatform(detectPlatform());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Restore persisted layout on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        dispatch({ type: 'RESTORE', state: { activeViewId: parsed.activeViewId || getDefaultViewId(), leftSidebarOpen: parsed.leftSidebarOpen ?? true, rightSidebarOpen: parsed.rightSidebarOpen ?? true } });
      }
    } catch (_e) {}
  }, []);

  // Persist layout state changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeViewId: state.activeViewId,
        leftSidebarOpen: state.leftSidebarOpen,
        rightSidebarOpen: state.rightSidebarOpen,
      }));
    } catch (_e) {}
  }, [state.activeViewId, state.leftSidebarOpen, state.rightSidebarOpen]);

  return (
    <LayoutContext.Provider value={{ state, dispatch, platform }}>
      {children}
    </LayoutContext.Provider>
  );
}

// ── Hooks ───────────────────────────────────────────────────────

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within a LayoutProvider');
  return ctx;
}

export function usePlatform(): PlatformCapabilities {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('usePlatform must be used within a LayoutProvider');
  return ctx.platform;
}
