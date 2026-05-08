'use client';

import { Cpu, Folder, FileCode, Search, ChevronDown, Settings, LayoutDashboard, Terminal } from 'lucide-react';
import { useFocus } from '../workbench/focus-context';
import { useRuntimePolicy } from '../workbench/runtime-policy-context';
import { getAdapterMeta, getViewEntry } from '../main/view-registry';

export interface ConsoleHeaderProps {
  onMobileOpen: () => void;
  statusColor: string;
  statusText: string;
  connStatus: { status: string };
  phaseColor: string;
  phaseLabel: string;
  phase: string;
  currentActivity: string | null;
  parsed: { model?: string; cost?: string };
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
  showDashboard?: boolean;
  onToggleCommandPalette?: () => void;
  leftSidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
}

export function ConsoleHeader({
  onMobileOpen,
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
  showDashboard,
  onToggleCommandPalette,
  leftSidebarOpen,
  rightSidebarOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: ConsoleHeaderProps) {
  let runtimeBadge: string | null = null;
  try {
    const { paneViewType, adapterId } = useFocus();
    const { activePolicy } = useRuntimePolicy();
    const label = paneViewType
      ? getViewEntry(paneViewType)?.meta.title || paneViewType.charAt(0).toUpperCase() + paneViewType.slice(1)
      : getAdapterMeta(adapterId ?? undefined).label;
    const modeBadge = activePolicy.permissionMode === 'default' ? 'ASK'
      : activePolicy.permissionMode === 'acceptEdits' ? 'AUTO' : 'PLAN';
    const effortBadge = activePolicy.effortLevel === 'low' ? 'OFF'
      : activePolicy.effortLevel === 'medium' ? 'ON' : 'MAX';
    runtimeBadge = `${label} [${modeBadge}] T:${effortBadge}`;
  } catch {}
  return (
    <header className="h-11 flex items-center justify-between px-4 border-b border-gray-800 bg-[#111] shrink-0">
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
        <span className="text-purple-400 font-bold tracking-widest text-sm">SESSIONBRIDGE</span>
        <span className="text-gray-700">|</span>
        <span className="text-xs text-gray-400 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor} ${connStatus.status === 'connected' ? 'animate-pulse' : ''}`} />
          {statusText}
        </span>
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
        {parsed.model && (
          <span className="text-[10px] text-gray-500 bg-gray-900 px-2 py-0.5 rounded border border-gray-800 hidden md:inline">
            {parsed.model}
          </span>
        )}
      </div>
      <div className="flex items-center space-x-4 text-xs">
        {parsed.cost && <span className="text-gray-400 hidden sm:inline">TOKENS: <span className="text-gray-200">{parsed.cost}</span></span>}
        {/* Right sidebar toggle */}
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
        {/* Project info */}
        <div className="flex items-center gap-2 relative">
          {/* Search sessions button */}
          <button
            onClick={openSearchPanel}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
            title="Search past sessions"
          >
            <Search className="w-3 h-3" />
          </button>

          {/* Dashboard button */}
              {onToggleDashboard && (
                <button
                  onClick={onToggleDashboard}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] transition-colors ${
                    showDashboard
                      ? 'bg-purple-900/30 border-purple-600 text-purple-300'
                      : 'bg-[#1a1a1a] border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500'
                  }`}
                  title="Dashboard"
                >
                  <LayoutDashboard className="w-3 h-3" />
                </button>
              )}

          {/* Settings button */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
              title="Settings"
            >
              <Settings className="w-3 h-3" />
            </button>
          )}

          {/* Command palette button */}
          {onToggleCommandPalette && (
            <button
              onClick={onToggleCommandPalette}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
              title="Commands (Ctrl+Shift+P)"
            >
              <Terminal className="w-3 h-3" />
            </button>
          )}

          <button
            onClick={onToggleDirSwitcher}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors max-w-[200px]"
            title={projectInfo ? `${projectInfo.projectName} — ${projectInfo.cwd}` : 'Select project directory'}
          >
            <Folder className="w-3 h-3 shrink-0 text-yellow-600" />
            <span className="truncate">{projectInfo?.projectName || 'No project'}</span>
            <ChevronDown className="w-2.5 h-2.5 shrink-0" />
          </button>

          {/* Directory switcher dropdown */}
          {showDirSwitcher && (
              <div className="absolute top-full right-0 mt-1 z-50 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden" style={{ minWidth: '280px' }}>
                <div className="p-2 border-b border-gray-800 text-[10px] text-gray-500 px-3 py-1.5 font-bold tracking-wider">
                  SWITCH PROJECT
                </div>
                <div className="p-2">
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    if (switchDirLocal.trim()) onSwitchDir(switchDirLocal.trim());
                  }} className="flex gap-1">
                    <input type="text" value={switchDirLocal}
                      onChange={e => onSwitchDirLocalChange(e.target.value)}
                      placeholder="Directory path..."
                      className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 outline-none focus:border-purple-500"
                      autoFocus
                    />
                    <button type="submit" disabled={switching}
                      className="px-2 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] rounded border border-purple-600">
                      {switching ? '...' : 'Go'}
                    </button>
                  </form>
                </div>
                {/* Saved sessions */}
                {savedSessions.length > 0 && (
                  <div className="border-t border-gray-800">
                    <div className="px-3 py-1 text-[9px] text-gray-600 font-bold">HISTORY</div>
                    {savedSessions.slice(-10).reverse().map(s => (
                      <button key={s.id}
                        onClick={() => onSelectSavedSession(s)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 text-left transition-colors"
                      >
                        <FileCode className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                        <span className="text-[10px] text-gray-400 truncate">{s.label}</span>
                        <span className="text-[8px] text-gray-700 ml-auto shrink-0">{s.ts.slice(5, 16)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
    </header>
  );
}
