// @ts-nocheck — layout receives a large props bag from useConsoleController().
// Proper typing will be added in a follow-up as the hook is further split.
'use client';

import React, { useEffect, useState } from 'react';
import { ConsoleHeader } from '../shell/console-header';
import { LeftSidebar } from '../sidebar/left-sidebar';
import { RightSidebar } from '../sidebar/right-sidebar';
import { StatusBar } from '../shell/status-bar';
import { ConsoleOverlays } from '../overlays/console-overlays';
import { DisconnectBanner } from '../shell/disconnect-banner';
import { WorkbenchTopBar } from '../shell/workbench-top-bar';
import { NodeBar } from '../stage/node-bar';
import { NodeNetworkView } from '../../../plugins/mesh';
import { KeyHintOverlay } from '../chrome/key-hint-overlay';
// MobileKeyboardSlot is rendered inside ShellTerminal, not here.
// The global routeInput is unused since ShellTerminal passes handleUserInput directly.
import { MobileDebug } from '../chrome/mobile-debug-dashboard';
import { MobileSidebar } from '../sidebar/mobile-sidebar';
import { MobileRightPanel } from '../sidebar/mobile-right-panel';
import { CoreErrorBanner } from '../core/core-error-banner';
import { SidebarSlot, MainSlot, FocusProvider, RuntimePolicyProvider, WorkbenchProvider, SessionProvider, InputProvider, ToolActivityProvider } from '../workbench';
import { WorkbenchLayout } from '../stage/workbench-layout';
import { getAdapterViewId } from '../main/view-registry';
import type { AppWorkbenchState, AppWorkbenchAction, WorkbenchState, WorkbenchAction, PaneTab, ViewType } from '../stage/workbench-state';
import { appReducer } from '../stage/workbench-state';
import type { ConnStatus } from '../../../lib/use-ws';
import type { ContextMenuItem } from '../shell/context-menu';
import type { ChromePolicy } from '../main/view-registry';
import type { Phase, Turn, ToolActivity, TaskInfo } from '../../lib/session-types';

// ═══════════════════════════════════════════════════════════════
// ConsoleLayout — Pure JSX composition of all shell slots.
//
// Slot map (top to bottom, left to right):
//   HEADER    ConsoleHeader
//   BANNER    DisconnectBanner (30s grace)
//   NODEBAR   NodeBar (mesh node switcher)
//   ┌─────────────────────────────────────────┐
//   │ LEFT         CENTER              RIGHT  │
//   │ LeftSidebar  WorkbenchLayout     Right  │
//   │ (panels)     (tabs/views)        Sidebar│
//   │              or                 (panels)│
//   │              NodeNetworkView            │
//   └─────────────────────────────────────────┘
//   STATUS    StatusBar
//   OVERLAYS  ConsoleOverlays, KeyHintOverlay
//   MOBILE    MobileSidebar, MobileRightPanel
//
// All data dependencies come from useConsoleController().
// No business logic, no state, no effects — just the slot
// assignment and component wiring.
// ═══════════════════════════════════════════════════════════════

export function ConsoleLayout(props: Record<string, any>) {
  const {
    instances, activeInstanceId, state, sessionKey, paneFocus,
    chromePolicy, connStatus, connectionUnstable,
    statusColor, statusText, phaseColor, phaseLabel, phase, currentActivity,
    showBanner, showCommandPalette, setShowCommandPalette, showSearch,
    effectiveLeftOpen, effectiveRightOpen,
    fileTree, expandedDirs, toggleDir,
    appState, activeWorkbenchState, activeWorkbenchDispatch,
    handleRequestView, handleContextTab, handleReorderTabs, handleCloseTab,
    closedKeptTabs, handleReopenKeptTab,
    handleNewSessionWrapper, loadSnapshotWrapper, forkFromSnapshotWrapper,
    handleQuickCompact, handleSwitchDir,
    saveSnapshot, snapshots, knownFiles,
    handleOpenFile, onNavigatePath, shortenPath,
    logs, msgLog, activeTasks,
    terminalTab, setTerminalTab,
    logsEndRef, actionEndRef,
    absoluteCwd, projectInfo, activeNodeProjectInfo,
    showDirSwitcher, setShowDirSwitcher,
    switchDirLocal, setSwitchDirLocal, switching, savedSessions,
    setInputValue, addLog,
    handleEnterNode, handleGoToConsole, setAppState,
    setSettingsOpen, settingsOpen,
    showRemoteOverlay, reachabilityNodeId, overlayStatus, localNodeId, isLocalPage,
    setMobileOpen, setMobileRightOpen, mobileOpen, mobileRightOpen,
    focusViewId, focusWhenContext,
    connectionLabel, showStatusBar,
    sessionContextValue, inputContextValue, toolActivityContextValue,
    workbenchContextValue, actionRunContext,
    runWorkbenchCommand,
    openSearchPanel, dispatch,
    queueStatus, setMode, setEffort,
    searchPanelRef, searchQuery, searchInputRef,
    handleSearchInput, searchLoading, setShowSearch,
    searchResults, handleLoadSession,
    paletteCommands, handlePaletteSelect,
    viewingFile, setViewingFile,
    forkTarget, turns, forkPrompt, setForkPrompt,
    handleForkRewind, handleForkSnapshot, handleForkWithPrompt,
    ctxMenu, handleWorkbenchContextMenu, closeContextMenu,
    onReconnect,
    createNodeInstance, killInstance, activateInstance,
    handleBindCurrentTabInstance,
    addPathBookmark,
  } = props;

  return (
    <FocusProvider instances={instances} activeInstanceId={activeInstanceId} activeViewId={state.activeViewId} sessionKey={sessionKey} paneFocus={paneFocus}>
      <RuntimePolicyProvider>
    <div className="flex flex-col h-screen dvh-screen bg-[#0a0a0a] text-gray-300 font-mono text-sm overflow-hidden selection:bg-purple-900 selection:text-white relative" onContextMenu={handleWorkbenchContextMenu}>
      <CoreErrorBanner />
      <ConsoleHeader
        chromePolicy={chromePolicy}
        onMobileOpen={() => setMobileOpen(true)}
        onMobileRightOpen={() => setMobileRightOpen(true)}
        mobileOpen={mobileOpen}
        mobileRightOpen={mobileRightOpen}
        statusColor={statusColor}
        statusText={statusText}
        connStatus={connStatus}
        connectionUnstable={connectionUnstable}
        phaseColor={phaseColor}
        phaseLabel={phaseLabel}
        phase={phase}
        currentActivity={currentActivity}
        parsed={{}}
        openSearchPanel={openSearchPanel}
        showDirSwitcher={showDirSwitcher}
        onToggleDirSwitcher={() => setShowDirSwitcher(v => !v)}
        projectInfo={projectInfo}
        switchDirLocal={switchDirLocal}
        onSwitchDirLocalChange={setSwitchDirLocal}
        switching={switching}
        onSwitchDir={handleSwitchDir}
        savedSessions={savedSessions}
        onSelectSavedSession={(s: any) => {
          addLog(`[System] Previous session: ${s.label} (${s.dir})`);
          setShowDirSwitcher(false);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleCommandPalette={() => setShowCommandPalette(v => !v)}
        leftSidebarOpen={effectiveLeftOpen}
        rightSidebarOpen={effectiveRightOpen}
        onToggleLeftSidebar={() => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'left' })}
        onToggleRightSidebar={() => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'right' })}
        connectionLabel={connectionLabel}
        onOpenConnectionManager={handleGoToConsole}
        viewLabel={localNodeId ? `View on Core ${localNodeId.slice(0, 12)}` : undefined}
      />

      <DisconnectBanner showBanner={showBanner} connStatus={connStatus} statusColor={statusColor} />

      <NodeBar
        activeNodeId={appState.activeInstanceId}
        onEnterNode={handleEnterNode}
        onOpenConnection={() => setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }))}
      />

      <div className="flex flex-1 overflow-hidden">
        <SidebarSlot open={effectiveLeftOpen}>
          <LeftSidebar
          fileTree={fileTree}
          expandedDirs={expandedDirs}
          onToggleDir={toggleDir}
          onOpenFile={handleOpenFile}
          onSendFile={(filePath) => {
            setInputValue(prev => prev + `@${filePath} `);
          }}
          onBookmarkDir={(dirPath) => {
            addPathBookmark(dirPath);
          }}
          onCommand={(cmdId) => runWorkbenchCommand({ command: cmdId }, actionRunContext)}
          projectCwd={activeNodeProjectInfo?.cwd || '.'}
          absoluteCwd={absoluteCwd || activeNodeProjectInfo?.cwd || '.'}
          instances={instances.filter((i: any) => appState.workbenchInstanceIds.includes(i.id) && (i.status === 'running' || i.status === 'starting'))}
          activeInstanceId={activeInstanceId}
          onActivateInstance={activateInstance}
          onCreateInstance={(opts) => createNodeInstance(opts)}
          onKillInstance={killInstance}
        />
        </SidebarSlot>

        <main className="flex-1 flex flex-col relative bg-black min-w-0 min-h-0" data-copyable="true" style={{ userSelect: 'text' as any }}>
          {showRemoteOverlay && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/80 backdrop-blur-sm">
              <div className="bg-[#111] border border-gray-800 rounded px-6 py-4 text-center max-w-sm">
                {overlayStatus === 'rejected' ? (
                  <>
                    <div className="text-[10px] font-mono tracking-wider uppercase text-red-500 mb-2">配对已失效</div>
                    <p className="text-[11px] text-gray-400 mb-3">对方不再信任此节点的连接，需要在节点管理页面重新配对。</p>
                    <button
                      onClick={() => props.onOpenConnection?.()}
                      className="text-[10px] px-3 py-1.5 bg-red-900/30 text-red-400 border border-red-800/40 rounded hover:bg-red-900/50 transition-colors"
                    >打开连接管理器</button>
                    <div className="mt-2">
                      <span className="text-[9px] text-gray-600 font-mono">{reachabilityNodeId}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[10px] font-mono tracking-wider uppercase text-gray-500 mb-2">远端节点离线</div>
                    <p className="text-[11px] text-gray-400 mb-3">目标节点 mesh 连接已断开，当前功能不可用。
                      请在节点管理页面重新连接。</p>
                    <span className="text-[9px] text-gray-600 font-mono">{reachabilityNodeId}</span>
                  </>
                )}
              </div>
            </div>
          )}
          <SessionProvider value={sessionContextValue}>
          <InputProvider value={inputContextValue}>
          <ToolActivityProvider value={toolActivityContextValue}>
          <WorkbenchProvider value={workbenchContextValue}>
          <div className="flex flex-col flex-1 min-h-0 min-w-0" style={{ display: appState.activeInstanceId ? 'flex' : 'none' }}>
          <WorkbenchTopBar />

          <WorkbenchLayout
            state={activeWorkbenchState}
            dispatch={activeWorkbenchDispatch}
            onRequestView={handleRequestView}
            onContextTab={handleContextTab}
            onReorderTabs={handleReorderTabs}
            closedKeptTabs={closedKeptTabs}
            onReopenKeptTab={handleReopenKeptTab}
            onCloseTab={handleCloseTab}
            persistentTabIds={appState.persistentTabs.map(t => t.id)}
            renderView={(viewType, instanceId, tab) => {
              const boundInstance = instanceId ? instances.find((i: any) => i.id === instanceId) : null;
              const resolvedViewId = boundInstance?.adapterId
                ? getAdapterViewId(boundInstance.adapterId) || viewType
                : viewType;
              return <MainSlot viewId={resolvedViewId} instanceId={instanceId} _surfaceId={tab?._surfaceId} />;
            }}
          />
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto" style={{ display: appState.activeInstanceId ? 'none' : 'flex' }}>
              <div className="p-6 space-y-6 max-w-3xl mx-auto w-full">
                <NodeNetworkView
                  onEnterNode={handleEnterNode}
                  isLocalPage={isLocalPage}
                />
              </div>
          </div>
          </WorkbenchProvider>
          </ToolActivityProvider>
          </InputProvider>
          </SessionProvider>
        </main>

        <SidebarSlot open={effectiveRightOpen}>
          <RightSidebar
          activeTasks={activeTasks}
          onNewSession={handleNewSessionWrapper}
          onQuickCompact={handleQuickCompact}
          onSaveSnapshot={() => saveSnapshot()}
          snapshots={snapshots}
          onLoadSnapshot={loadSnapshotWrapper}
          onForkSnapshot={forkFromSnapshotWrapper}
          knownFiles={knownFiles}
          onOpenFile={handleOpenFile}
          shortenPath={shortenPath}
          logs={logs}
          msgLog={msgLog}
          terminalTab={terminalTab}
          onTerminalTabChange={setTerminalTab}
          logsEndRef={logsEndRef}
          onNavigatePath={onNavigatePath}
          currentActiveDir={absoluteCwd || '.'}
        />
        </SidebarSlot>
      </div>

      {showStatusBar && (
        <StatusBar
          queueStatus={queueStatus}
          onSetMode={setMode}
          onSetEffort={setEffort}
          absoluteCwd={absoluteCwd || '.'}
          terminalCwd={absoluteCwd || '.'}
          onNavigatePath={onNavigatePath}
        />
      )}

      <style>{`
        /* On mobile with keyboard open, use dynamic viewport height so
         * the layout exactly matches the visible area. Without this,
         * 100vh stays at the layout viewport height (unchanged), and
         * content gets pushed above the visual viewport, causing scroll
         * conflicts with the keyboard toolbar and bad auto-scroll. */
        .dvh-screen { height: 100vh; height: 100dvh; }
        /* Prevent pull-to-refresh and overscroll on mobile, which
         * conflicts with terminal scroll and keyboard positioning. */
        body { overscroll-behavior: none; }
        .prose-container p { margin: 0; overflow-wrap: break-word; line-height: 1.55; }
        .prose-container code { font-size: 11px; }
        .prose-container pre { margin: 4px 0; }
        .prose-container ul, .prose-container ol { margin: 2px 0; }
        .prose-container li { overflow-wrap: break-word; }
      `}</style>

      {/* Hydration indicator — shows whether React successfully mounted.
           Green = hydrated, Red/gray = React failed to hydrate (common on mobile via LAN IP in dev mode).
           Only visible when ?hydrate-debug is in the URL or on mobile (<768px). */}
      <HydrateIndicator />

    </div>

      <ConsoleOverlays
        showSearch={showSearch}
        searchPanelRef={searchPanelRef}
        searchQuery={searchQuery}
        searchInputRef={searchInputRef}
        handleSearchInput={handleSearchInput}
        searchLoading={searchLoading}
        onCloseSearch={() => setShowSearch(false)}
        searchResults={searchResults}
        addLog={addLog}
        handleLoadSession={handleLoadSession}
        showCommandPalette={showCommandPalette}
        extCommands={paletteCommands}
        onCommand={handlePaletteSelect}
        onCloseCommandPalette={() => setShowCommandPalette(false)}
        viewingFile={viewingFile}
        onCloseFileViewer={() => setViewingFile(null)}
        forkTarget={forkTarget}
        turns={turns}
        forkPrompt={forkPrompt}
        setForkPrompt={setForkPrompt}
        onCloseFork={() => setForkTarget(null)}
        onRewind={handleForkRewind}
        onForkSnapshot={handleForkSnapshot}
        onForkWithPrompt={handleForkWithPrompt}
        ctxMenu={ctxMenu}
        onCloseContextMenu={closeContextMenu}
        settingsOpen={settingsOpen}
        onCloseSettings={() => setSettingsOpen(false)}
        onReconnect={onReconnect}
      />

      <KeyHintOverlay whenContext={focusWhenContext} onCommand={handlePaletteSelect} />

      <MobileSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        fileTree={fileTree}
        expandedDirs={expandedDirs}
        onToggleDir={toggleDir}
        onOpenFile={handleOpenFile}
        onSendFile={(filePath) => {
          setInputValue(prev => prev + `@${filePath} `);
        }}
        onBookmarkDir={(dirPath) => {
          addPathBookmark(dirPath);
        }}
        activeInstanceId={activeInstanceId}
        onKill={killInstance}
        onCommand={handlePaletteSelect}
        activeView={focusViewId}
        absoluteCwd={absoluteCwd || undefined}
      />
      <MobileRightPanel
        open={mobileRightOpen}
        onClose={() => setMobileRightOpen(false)}
        activeTasks={activeTasks}
        onNewSession={handleNewSessionWrapper}
        onQuickCompact={handleQuickCompact}
        onSaveSnapshot={() => saveSnapshot()}
        snapshots={snapshots}
        onLoadSnapshot={loadSnapshotWrapper}
        onForkSnapshot={forkFromSnapshotWrapper}
        knownFiles={knownFiles}
        onOpenFile={handleOpenFile}
        shortenPath={shortenPath}
        logs={logs}
        msgLog={msgLog}
        terminalTab={terminalTab}
        onTerminalTabChange={setTerminalTab}
        logsEndRef={logsEndRef}
      />
      <MobileDebug />
      </RuntimePolicyProvider>
    </FocusProvider>
  );
}

// ─── HydrateIndicator ─────────────────────────────────────────
// Tiny visual dot showing React hydration status.
// - Green: React hydrated (page should be interactive)
// - Red: React NOT hydrated (page is dead SSR — dev mode LAN issue)
// Only shows in dev mode (?hydrate-debug or on mobile viewport).
function HydrateIndicator() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Show on mobile or when ?hydrate-debug is present
    if (typeof window === 'undefined') return;
    setShow(
      window.innerWidth < 768 ||
      new URL(window.location.href).searchParams.has('hydrate-debug')
    );
  }, []);
  if (!show) return null;
  return (
    <div
      title={hydrated ? 'React hydrated — interactive' : 'React NOT hydrated — page may be dead'}
      className={`fixed bottom-1 right-1 w-2 h-2 rounded-full z-[9999] border border-gray-800 transition-colors ${
        hydrated ? 'bg-green-500' : 'bg-red-500 animate-pulse'
      }`}
    />
  );
}
