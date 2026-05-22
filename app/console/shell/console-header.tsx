'use client';

import { Cpu, Search, Settings, LayoutDashboard, Terminal } from 'lucide-react';
import { useFocus } from '../workbench/focus-context';
import { useRuntimePolicy } from '../workbench/runtime-policy-context';
import { getAdapterMeta, getViewEntry, getAdapterCapabilities, type ChromePolicy } from '../main/view-registry';
import { getActions } from '../actions/action-registry';
import { runWorkbenchCommand } from '../actions/workbench-command-dispatch';
import type { ActionRunContext, WorkbenchAction } from '../actions/action-types';
import type { LucideIcon } from 'lucide-react';
import { getHeaderChromeItems, getContextControls } from '../chrome/chrome-registry';

// ── Icon name → Lucide component map ──────────────────────────
const ICON_MAP: Record<string, LucideIcon> = {
  search: Search,
  'layout-dashboard': LayoutDashboard,
  settings: Settings,
  terminal: Terminal,
};

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
  onToggleDashboard?: () => void;
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
  onToggleDashboard,
  onToggleCommandPalette,
  leftSidebarOpen,
  rightSidebarOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  chromePolicy,
  connectionLabel,
  onOpenConnectionManager,
  connectionUnstable,
}: ConsoleHeaderProps) {
  const policy = chromePolicy || { header: 'full', statusBar: 'auto', commandPalette: true, globalShortcuts: true };

  // hidden → render nothing
  if (policy.header === 'hidden') return null;

  const isMinimal = policy.header === 'minimal';

  // Hooks must be called unconditionally
  const focus = useFocus();
  const { activePolicy } = useRuntimePolicy();

  // Built-in runtime status badge — driven by adapter capability "modes".
  // This is a host-level built-in element, not a plugin-contributed slot.
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
  } catch {}

  // Chrome items + action context — always resolved (never inside try-catch)
  const headerRightActions: WorkbenchAction[] = getActions('header.right', focus.whenContext as Record<string, unknown>);
  const headerChromeItems: any[] = getHeaderChromeItems(focus.whenContext);
  const headerContextControls = getContextControls(focus.whenContext).filter(c => c.placement === 'header-right');
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
        {/* Hamburger for mobile */}
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

        {/* Dashboard button — uses onToggleDashboard with real dispatch */}
        {onToggleDashboard && (
          <button onClick={onToggleDashboard}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
            title="Dashboard"
          >
            <LayoutDashboard className="w-3 h-3" />
          </button>
        )}

        {/* Header chrome: actions (registry) + contributions (manifests) */}
        <div className="flex items-center gap-2">
          {!isMinimal && headerRightActions.map(a => {
            const IconComp = a.icon ? ICON_MAP[a.icon] : null;
            return (
              <button key={a.id}
                onClick={() => { if (actionCtx) a.run(actionCtx); }}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
                title={a.shortcut ? `${a.title} (${a.shortcut})` : a.title}
              >
                {IconComp && <IconComp className="w-3 h-3" />}
              </button>
            );
          })}

          {!isMinimal && headerChromeItems.map(item => {
            const IconComp = item.icon ? ICON_MAP[item.icon] : null;
            return (
            <button key={item.id}
              onClick={() => {
                if (item.command && actionCtx) {
                  runWorkbenchCommand({ command: item.command }, actionCtx);
                }
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
              title={item.title || item.text}
            >
              {IconComp && <IconComp className="w-3 h-3" />}
              {item.text || item.title}
            </button>
            );
          })}

          {!isMinimal && headerContextControls.map(cc => {
            const IconComp = cc.icon ? ICON_MAP[cc.icon] : null;
            const hasCommand = !!cc.command;

            // kind === 'button' renders as a standard button.
            // All other non-hint kinds (toggle, menu, progress, approval, jump) render as compact pills.
            if (cc.kind === 'button') {
              return (
                <button key={cc.id}
                  onClick={() => {
                    if (hasCommand && actionCtx) {
                      runWorkbenchCommand({ command: cc.command! }, actionCtx);
                    }
                  }}
                  disabled={!hasCommand}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={cc.label}
                >
                  {IconComp && <IconComp className="w-3 h-3" />}
                  {cc.label}
                </button>
              );
            }

            // Non-button kinds: render as compact pill
            return (
              <span key={cc.id}
                onClick={hasCommand ? () => {
                  if (actionCtx) {
                    runWorkbenchCommand({ command: cc.command! }, actionCtx);
                  }
                } : undefined}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 border border-gray-800 text-gray-500 text-[10px] ${hasCommand ? 'cursor-pointer hover:border-purple-500 hover:text-gray-300 transition-colors' : 'opacity-50'}`}
                title={cc.label}
                role={hasCommand ? 'button' : undefined}
              >
                {IconComp && <IconComp className="w-3 h-3" />}
                {cc.label}
              </span>
            );
          })}
        </div>
      </div>
      </div>
    </header>
  );
}
