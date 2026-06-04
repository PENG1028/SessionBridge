'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import type { SplitNode, LayoutNode, PaneTab, ViewType } from './workbench-state.types';
import { PaneView } from './pane-view';

// ═══════════════════════════════════════════════════════════════
// LayoutNodeRenderer — dispatches pane vs split
// ═══════════════════════════════════════════════════════════════

export function LayoutNodeRenderer({
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
  closedKeptTabs,
  onReopenKeptTab,
  persistentTabIds,
}: {
  node: LayoutNode;
  activePaneId: string;
  onFocusPane: (id: string) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onAddTab: (paneId: string) => void;
  onRequestView?: (paneId: string, tabId: string, viewType: ViewType) => void;
  renderView: (viewType: ViewType, instanceId?: string, tab?: PaneTab) => ReactNode;
  onContextTab?: (tab: PaneTab, e: React.MouseEvent) => void;
  onReorderTabs?: (paneId: string, tabId: string, targetId: string) => void;
  closedKeptTabs?: PaneTab[];
  onReopenKeptTab?: (tab: PaneTab) => void;
  persistentTabIds?: string[];
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
          closedKeptTabs={closedKeptTabs}
          onReopenKeptTab={onReopenKeptTab}
          persistentTabIds={persistentTabIds}
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
    closedKeptTabs={closedKeptTabs}
    onReopenKeptTab={onReopenKeptTab}
    persistentTabIds={persistentTabIds}
  />;
}

// ═══════════════════════════════════════════════════════════════
// Divider — draggable split handle
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// SplitRenderer — draggable split container
// ═══════════════════════════════════════════════════════════════

export function SplitRenderer({
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
  closedKeptTabs,
  onReopenKeptTab,
  persistentTabIds,
}: {
  split: SplitNode;
  activePaneId: string;
  onFocusPane: (id: string) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onAddTab: (paneId: string) => void;
  onRequestView?: (paneId: string, tabId: string, viewType: ViewType) => void;
  renderView: (viewType: ViewType, instanceId?: string, tab?: PaneTab) => ReactNode;
  onContextTab?: (tab: PaneTab, e: React.MouseEvent) => void;
  onReorderTabs?: (paneId: string, tabId: string, targetId: string) => void;
  closedKeptTabs?: PaneTab[];
  onReopenKeptTab?: (tab: PaneTab) => void;
  persistentTabIds?: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ index: number; start: number; startSizes: number[] } | null>(null);
  const dragCleanupRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        document.removeEventListener('mousemove', dragCleanupRef.current.move);
        document.removeEventListener('mouseup', dragCleanupRef.current.up);
        dragCleanupRef.current = null;
      }
    };
  }, []);

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

        let ci = 0;
        for (let i = 0; i < containerRef.current.children.length; i++) {
          const el = containerRef.current.children[i] as HTMLElement;
          if (!el.classList.contains('layout-child')) continue;
          const isLeft = ci <= index;
          const newSize = isLeft
            ? Math.max(minSize, Math.min(maxSize, startSizes[ci] + delta))
            : startSizes[ci];
          el.style.flex = `${newSize} 1 0`;
          if (ci === index) {
            const rightIdx = index + 1;
            if (rightIdx < startSizes.length) {
              const rightSize = Math.max(minSize, Math.min(maxSize, startSizes[rightIdx] - delta));
              el.style.flex = `${newSize} 1 0`;
              const nextEl = containerRef.current.children[i + 2] as HTMLElement;
              if (nextEl?.classList.contains('layout-child')) {
                nextEl.style.flex = `${rightSize} 1 0`;
                ci++;
              }
            }
          }
          ci++;
        }
      };

      const handleMouseUp = () => {
        setDragging(null);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        dragCleanupRef.current = null;
      };

      if (dragCleanupRef.current) {
        document.removeEventListener('mousemove', dragCleanupRef.current.move);
        document.removeEventListener('mouseup', dragCleanupRef.current.up);
      }
      dragCleanupRef.current = { move: handleMouseMove, up: handleMouseUp };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [split],
  );

  const dirClass = split.direction === 'horizontal' ? 'flex-row' : 'flex-col';

  return (
    <div ref={containerRef} className={`flex ${dirClass} flex-1 min-w-0 min-h-0 overflow-hidden`}>
      {split.children.map((child, index) => {
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
              closedKeptTabs={closedKeptTabs}
              onReopenKeptTab={onReopenKeptTab}
              persistentTabIds={persistentTabIds}
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
