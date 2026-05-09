'use client';

import { useCallback, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { PaneView } from './pane-view';
import type { LayoutNode, SplitNode, PaneState, PaneTab, ViewType, WorkbenchState, WorkbenchAction } from './workbench-state';
import { genTabId } from './workbench-state';
import { Terminal, X } from 'lucide-react';

interface WorkbenchLayoutProps {
  state: WorkbenchState;
  dispatch: (action: WorkbenchAction) => void;
  renderView: (viewType: ViewType, instanceId?: string) => ReactNode;
  onRequestView?: (paneId: string, tabId: string, viewType: ViewType) => void;
  onContextTab?: (tab: PaneTab, e: React.MouseEvent) => void;
  onReorderTabs?: (paneId: string, tabId: string, targetId: string) => void;
}

// ─── Draggable divider ─────────────────────────────────────────

function Divider({
  direction,
  onMouseDown,
}: {
  direction: 'horizontal' | 'vertical';
  onMouseDown: (e: ReactMouseEvent) => void;
}) {
  const baseClass = direction === 'horizontal' ? 'w-[3px] cursor-col-resize' : 'h-[3px] cursor-row-resize';
  return (
    <div
      className={`${baseClass} bg-gray-800 hover:bg-purple-500/60 active:bg-purple-500 transition-colors shrink-0 relative z-10 group`}
      onMouseDown={onMouseDown}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-purple-500/20" />
    </div>
  );
}

// ─── Layout node renderer ──────────────────────────────────────

function LayoutNodeRenderer({
  node,
  activePaneId,
  onFocusPane,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onRequestView,
  renderView,
  onContextTab,
  onReorderTabs,
}: {
  node: LayoutNode;
  activePaneId: string;
  onFocusPane: (id: string) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onAddTab: (paneId: string) => void;
  onRequestView?: (paneId: string, tabId: string, viewType: ViewType) => void;
  renderView: (viewType: ViewType, instanceId?: string) => ReactNode;
  onContextTab?: (tab: PaneTab, e: React.MouseEvent) => void;
  onReorderTabs?: (paneId: string, tabId: string, targetId: string) => void;
}) {
  if (node.kind === 'pane') {
    const isActive = node.id === activePaneId;
    return (
      <div
        className={`flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden ${
          isActive ? 'ring-1 ring-inset ring-purple-500/20' : ''
        }`}
      >
        <PaneView
          pane={node}
          isActive={isActive}
          onFocus={() => onFocusPane(node.id)}
          onSelectTab={(tabId) => onSelectTab(node.id, tabId)}
          onCloseTab={(tabId) => onCloseTab(node.id, tabId)}
          onAddTab={() => onAddTab(node.id)}
          onRequestView={(tabId, viewType) => onRequestView?.(node.id, tabId, viewType)}
          renderView={renderView}
          onContextTab={onContextTab}
          onReorderTabs={(tabId, targetId) => onReorderTabs?.(node.id, tabId, targetId)}
        />
      </div>
    );
  }

  return <SplitRenderer
    split={node}
    activePaneId={activePaneId}
    onFocusPane={onFocusPane}
    onSelectTab={onSelectTab}
    onCloseTab={onCloseTab}
    onAddTab={onAddTab}
    onRequestView={onRequestView}
    renderView={renderView}
    onContextTab={onContextTab}
    onReorderTabs={onReorderTabs}
  />;
}

// ─── Split renderer with draggable dividers ────────────────────

function SplitRenderer({
  split,
  activePaneId,
  onFocusPane,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onRequestView,
  renderView,
  onContextTab,
  onReorderTabs,
}: {
  split: SplitNode;
  activePaneId: string;
  onFocusPane: (id: string) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onAddTab: (paneId: string) => void;
  onRequestView?: (paneId: string, tabId: string, viewType: ViewType) => void;
  renderView: (viewType: ViewType, instanceId?: string) => ReactNode;
  onContextTab?: (tab: PaneTab, e: React.MouseEvent) => void;
  onReorderTabs?: (paneId: string, tabId: string, targetId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ index: number; start: number; startSizes: number[] } | null>(null);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent, index: number) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const isHorizontal = split.direction === 'horizontal';
      const start = isHorizontal ? e.clientX : e.clientY;
      const children = containerRef.current?.children || [];
      const startSizes: number[] = [];
      let childIdx = 0;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        if (el.classList.contains('layout-child')) {
          startSizes.push(isHorizontal ? el.offsetWidth : el.offsetHeight);
          childIdx++;
        }
      }
      setDragging({ index, start, startSizes });

      const handleMouseMove = (ev: globalThis.MouseEvent) => {
        if (!containerRef.current) return;
        const current = isHorizontal ? ev.clientX : ev.clientY;
        const delta = current - start;
        const containerSize = isHorizontal
          ? containerRef.current.offsetWidth
          : containerRef.current.offsetHeight;
        const minSize = 120;
        const maxSize = containerSize - minSize;

        let childIdx = 0;
        for (let i = 0; i < containerRef.current.children.length; i++) {
          const el = containerRef.current.children[i] as HTMLElement;
          if (!el.classList.contains('layout-child')) continue;
          const isLeft = childIdx <= index;
          const newSize = isLeft
            ? Math.max(minSize, Math.min(maxSize, startSizes[childIdx] + delta))
            : startSizes[childIdx];
          el.style.flex = `${newSize} 1 0`;
          if (childIdx === index) {
            const rightIdx = index + 1;
            if (rightIdx < startSizes.length) {
              const rightSize = Math.max(minSize, Math.min(maxSize, startSizes[rightIdx] - delta));
              el.style.flex = `${newSize} 1 0`;
              // Need to set right element too - we'll find it next iteration
              const nextEl = containerRef.current.children[i + 2] as HTMLElement;
              if (nextEl?.classList.contains('layout-child')) {
                nextEl.style.flex = `${rightSize} 1 0`;
                childIdx++; // skip the next child since we already set it
              }
            }
          }
          childIdx++;
        }
      };

      const handleMouseUp = () => {
        setDragging(null);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [split],
  );

  const dirClass = split.direction === 'horizontal' ? 'flex-row' : 'flex-col';

  return (
    <div ref={containerRef} className={`flex ${dirClass} flex-1 min-w-0 min-h-0 overflow-hidden`}>
      {split.children.map((child, index) => {
        const isLast = index === split.children.length - 1;
        return (
          <div key={child.kind === 'pane' ? child.id : child.id} className="layout-child flex flex-col min-w-0 min-h-0 overflow-hidden" style={{ flex: '1 1 0' }}>
            <LayoutNodeRenderer
              node={child}
              activePaneId={activePaneId}
              onFocusPane={onFocusPane}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              onAddTab={onAddTab}
              onRequestView={onRequestView}
              renderView={renderView}
              onContextTab={onContextTab}
              onReorderTabs={onReorderTabs}
            />
          </div>
        );
      }).reduce((acc, el, idx) => {
        if (idx < split.children.length - 1) {
          return [...acc, el, <Divider key={`div-${idx}`} direction={split.direction} onMouseDown={(e) => handleMouseDown(e, idx)} />];
        }
        return [...acc, el];
      }, [] as ReactNode[])}
    </div>
  );
}

// ─── Bottom dock ───────────────────────────────────────────────

function BottomDock({
  pane,
  dispatch,
  renderView,
}: {
  pane: PaneState;
  dispatch: (action: WorkbenchAction) => void;
  renderView: (viewType: ViewType, instanceId?: string) => ReactNode;
}) {
  const activeTab = pane.tabs.find(t => t.id === pane.activeTabId) || pane.tabs[0];

  return (
    <div className="border-t border-gray-700 shrink-0 flex flex-col bg-[#0d0d0d]" style={{ height: pane.minSize || 180 }}>
      {/* Bottom dock tab bar */}
      <div className="flex items-center h-7 bg-[#0a0a0a] border-b border-gray-800 shrink-0">
        <div className="flex items-center">
          {pane.tabs.map(tab => {
            const isActive = tab.id === pane.activeTabId;
            return (
              <button
                key={tab.id}
                onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', paneId: pane.id, tabId: tab.id })}
                className={`flex items-center gap-1 px-2 h-full text-[10px] border-r border-gray-800 transition-colors ${
                  isActive
                    ? 'bg-[#111] text-gray-200 border-b-2 border-b-purple-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Terminal className="w-2.5 h-2.5" />
                <span className="truncate max-w-[80px]">{tab.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE_TAB', paneId: pane.id, tabId: tab.id }); }}
                  className="text-gray-600 hover:text-red-400 ml-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => {
            dispatch({ type: 'ADD_BOTTOM_PANE' });
          }}
          className="px-1.5 h-full text-gray-500 hover:text-gray-200 hover:bg-[#0a0a0a] border-l border-gray-800 transition-colors"
          title="Add terminal"
        >
          <Terminal className="w-3 h-3" />
        </button>
        <button
          onClick={() => dispatch({ type: 'CLOSE_BOTTOM_PANE' })}
          className="px-1.5 h-full text-gray-500 hover:text-red-400 hover:bg-[#0a0a0a] border-l border-gray-800 transition-colors"
          title="Close bottom panel"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab && renderView(activeTab.viewType, activeTab.instanceId)}
      </div>
    </div>
  );
}

// ─── Main layout ───────────────────────────────────────────────

export function WorkbenchLayout({ state, dispatch, renderView, onRequestView, onContextTab, onReorderTabs }: WorkbenchLayoutProps) {
  const onFocusPane = useCallback((id: string) => {
    dispatch({ type: 'FOCUS_PANE', paneId: id });
  }, [dispatch]);

  const onSelectTab = useCallback((paneId: string, tabId: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', paneId, tabId });
  }, [dispatch]);

  const onCloseTab = useCallback((paneId: string, tabId: string) => {
    dispatch({ type: 'CLOSE_TAB', paneId, tabId });
  }, [dispatch]);

  const onAddTab = useCallback((paneId: string) => {
    const tabId = genTabId();
    dispatch({
      type: 'ADD_TAB',
      paneId,
      tab: { id: tabId, title: 'New', viewType: 'empty' },
    });
  }, [dispatch]);

  const handleReorderTabs = useCallback((paneId: string, tabId: string, targetId: string) => {
    dispatch({ type: 'REORDER_TABS', paneId, tabId, targetId });
  }, [dispatch]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Main area */}
      <LayoutNodeRenderer
        node={state.root}
        activePaneId={state.activePaneId}
        onFocusPane={onFocusPane}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onAddTab={onAddTab}
        onRequestView={onRequestView}
        renderView={renderView}
        onContextTab={onContextTab}
        onReorderTabs={handleReorderTabs}
      />

      {/* Bottom dock */}
      {state.bottom && (
        <BottomDock pane={state.bottom} dispatch={dispatch} renderView={renderView} />
      )}
    </div>
  );
}
