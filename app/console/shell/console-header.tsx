'use client';

import { Cpu } from 'lucide-react';
import { useFocus } from '../workbench/focus-context';
import { useRuntimePolicy } from '../workbench/runtime-policy-context';
import { getAdapterMeta, getViewEntry, getAdapterCapabilities, type ChromePolicy } from '../main/view-registry';
import type { ActionRunContext } from '../actions/action-types';
import { useCoreStatus } from '../core/core-client-provider';
import { HeaderChrome } from './header-chrome';

export interface ConsoleHeaderProps {
  onMobileOpen: () => void;
  onMobileRightOpen?: () => void;
  statusColor: string;
  statusText: string;
  connStatus: { status: string };
  phaseColor: string;
  phaseLabel: string;
  phase: string;
  currentActivity: string | null;
  parsed?: { model?: string; cost?: string };
  openSearchPanel: () => void;
  showDirSwitcher: boolean;
  onToggleDirSwitcher: () => void;
  projectInfo: { projectName: string; cwd: string } | null;
  switchDirLocal: string;
  onSwitchDirLocalChange: (v: string) => void;
  switching: boolean;
  onSwitchDir: (dir: string) => void;
  savedSessions: { id: string; label: string; dir: string; ts: string }[];
  onSelectSavedSession: (s: { label: string; dir: string }) => void;
  onOpenSettings?: () => void;
  onToggleCommandPalette?: () => void;
  leftSidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  /** Chrome policy from the active view. */
  chromePolicy?: ChromePolicy;
  /** Connection/server label shown in place of brand name. */
  connectionLabel?: string;
  /** Open connection manager to switch/add servers. */
  onOpenConnectionManager?: () => void;
  /** Connection is unstable (momentarily lost, within 30s grace window). */
  connectionUnstable?: boolean;
  /** View identity label (e.g. "View on Core 294d9778c9a1"). */
  viewLabel?: string;
}

export function ConsoleHeader({
  onMobileOpen,
  onMobileRightOpen,
  statusColor,
  statusText,
  connStatus,
  phaseColor,
  phaseLabel,
  phase,
  currentActivity,
  parsed,
  openSearchPanel,
  showDirSwitcher,
  onToggleDirSwitcher,
  projectInfo,
  switchDirLocal,
  onSwitchDirLocalChange,
  switching,
  onSwitchDir,
  savedSessions,
  onSelectSavedSession,
  onOpenSettings,
  onToggleCommandPalette,
  leftSidebarOpen,
  rightSidebarOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  chromePolicy,
  connectionLabel,
  onOpenConnectionManager,
  connectionUnstable,
  viewLabel,
}: ConsoleHeaderProps) {
  const policy = chromePolicy || { header: 'full', statusBar: 'auto', commandPalette: true, globalShortcuts: true };

  // hidden → render nothing
  if (policy.header === 'hidden') return null;

  const isMinimal = policy.header === 'minimal';

  // Hooks must be called unconditionally
  const focus = useFocus();
  const { activePolicy } = useRuntimePolicy();
  const coreStatus = useCoreStatus();

  // Built-in runtime status badge — driven by adapter capability "modes".
  let runtimeBadge: string | null = null;
  try {
    const { paneViewType, adapterId } = focus;
    const caps = getAdapterCapabilities(adapterId ?? '');
    if (caps?.modes === true) {
      const label = paneViewType
        ? getViewEntry(paneViewType)?.meta.title || paneViewType.charAt(0).toUpperCase() + paneViewType.slice(1)
        : getAdapterMeta(adapterId ?? undefined).label;
      const modeBadge = activePolicy.permissionMode === 'default' ? 'ASK'
        : activePolicy.permissionMode === 'acceptEdits' ? 'AUTO' : 'PLAN';
      const effortBadge = activePolicy.effortLevel === 'low' ? 'OFF'
        : activePolicy.effortLevel === 'medium' ? 'ON' : 'MAX';
      runtimeBadge = `${label} [${modeBadge}] T:${effortBadge}`;
    }
  } catch (_e) { console.debug('[console-header] failed to resolve runtime badge:', _e); }

  // Chrome items + action context — always resolved (never inside try-catch)
  const actionCtx: ActionRunContext = {
    view: focus.viewId,
    activeAdapterId: focus.adapterId || '',
    isRunning: focus.isRunning,
    instanceId: focus.instanceId,
    projectCwd: '',
    messages: [],
    workbenchState: null as unknown,
    workbenchDispatch: () => {},
    sendCommand: () => {},
    sendInput: () => {},
    createInstance: async () => undefined,
    killInstance: () => {},
    openSettings: () => onOpenSettings?.(),
    openSearch: () => openSearchPanel(),
    openCommandPalette: () => onToggleCommandPalette?.(),
    toggleLeftSidebar: () => {},
    toggleRightSidebar: () => {},
    notify: () => {},
  };

  return (
    <header className="h-11 px-4 border-b border-gray-800 bg-[#111] shrink-0 relative z-10">
      {/* ── Mobile layout ── */}
      <div className="flex md:hidden items-center justify-between h-full">
        <button className="text-gray-400 hover:text-gray-200 p-1 -ml-1"
          onClick={onMobileOpen}
          title="Menu"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          onClick={onOpenConnectionManager}
          className="text-purple-400 font-bold tracking-widest text-sm hover:text-purple-300 transition-colors"
          title="Switch connection"
        >
          {connectionLabel || 'Remote Console'}
        </button>
        {viewLabel && (
          <span className="hidden sm:inline text-[9px] text-gray-600 font-mono px-1.5 py-0.5 rounded border border-gray-800 bg-gray-900/50 ml-1">
            {viewLabel}
          </span>
        )}
        <button
          onClick={onMobileRightOpen}
          className="text-gray-400 hover:text-gray-200 p-1 -mr-1 text-lg leading-none tracking-wider"
          title="Panels"
        >
          ⋮
        </button>
      </div>

      {/* ── Desktop layout ── */}
      <div className="hidden md:flex items-center justify-between h-full">
        <div className="flex items-center space-x-4">
        {/* Hamburger for mobile */}
        <button className="md:hidden text-gray-400 hover:text-gray-200 p-1 -ml-1"
          onClick={onMobileOpen}
          title="Menu"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {/* Left sidebar toggle */}
        {onToggleLeftSidebar && (
          <button
            onClick={onToggleLeftSidebar}
            className="hidden md:flex items-center justify-center w-4 h-full text-gray-600 hover:text-gray-300 transition-colors shrink-0"
            title={`${leftSidebarOpen ? 'Collapse' : 'Expand'} sidebar (Ctrl+B)`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={leftSidebarOpen ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
            </svg>
          </button>
        )}
        <Cpu className="w-4 h-4 text-purple-500" />
        <button
          onClick={onOpenConnectionManager}
          className="text-purple-400 font-bold tracking-widest text-sm hover:text-purple-300 transition-colors"
          title="Switch connection"
        >
          {connectionLabel || 'Remote Console'}
        </button>
        <span className="text-gray-700">|</span>
        <span className="text-xs text-gray-400 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor} ${connStatus.status === 'connected' ? 'animate-pulse' : ''}`} />
          {statusText}{connectionUnstable ? <span className="text-yellow-500 animate-pulse">...</span> : null}
          {coreStatus !== 'connected' && coreStatus !== 'connecting' && (
            <span className="text-[9px] text-yellow-500/70 ml-1" title={`Core: ${coreStatus}`}>
              core:{coreStatus === 'error' ? 'err' : 'off'}
            </span>
          )}
        </span>

        {/* ── Minimal header: show only brand + connection, no chat-specific items ── */}
        {!isMinimal && (
          <>
            {/* Phase badge */}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${phaseColor} ${
              phase === 'idle' ? 'border-gray-700 bg-gray-900/50'
              : phase === 'running' ? 'border-purple-700 bg-purple-900/20 animate-pulse'
              : phase === 'done' ? 'border-emerald-700 bg-emerald-900/20'
              : 'border-red-700 bg-red-900/20'
            }`}>
              {phaseLabel}
            </span>
            {/* Runtime info badge */}
            {runtimeBadge && (
              <span className="text-[9px] text-gray-500 bg-gray-900/80 px-1.5 py-0.5 border border-gray-800 font-mono tracking-tight hidden md:inline">
                {runtimeBadge}
              </span>
            )}
            {/* Current activity */}
            {currentActivity && phase === 'running' && (
              <span className="text-[10px] text-purple-400 bg-purple-900/10 px-2 py-0.5 rounded-full border border-purple-800/30 truncate max-w-[200px] hidden sm:inline">
                {currentActivity}
              </span>
            )}
            {parsed?.model && (
              <span className="text-[10px] text-gray-500 bg-gray-900 px-2 py-0.5 rounded border border-gray-800 hidden md:inline">
                {parsed.model}
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center space-x-4 text-xs">
        {!isMinimal && parsed?.cost && <span className="text-gray-400 hidden sm:inline">TOKENS: <span className="text-gray-200">{parsed.cost}</span></span>}

        {/* Right sidebar toggle — shown in both full and minimal */}
        {onToggleRightSidebar && (
          <button
            onClick={onToggleRightSidebar}
            className="hidden lg:flex items-center justify-center w-4 h-full text-gray-600 hover:text-gray-300 transition-colors shrink-0"
            title={`${rightSidebarOpen ? 'Collapse' : 'Expand'} right sidebar`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={rightSidebarOpen ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
            </svg>
          </button>
        )}

        {/* Header chrome: actions (registry) + contributions (manifests) */}
        <HeaderChrome
          isMinimal={isMinimal}
          focusCtx={focus.whenContext as Record<string, unknown>}
          actionCtx={actionCtx}
        />
      </div>
      </div>
    </header>
  );
}
