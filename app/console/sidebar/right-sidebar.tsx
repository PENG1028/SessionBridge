'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getPanels } from '../panels/panel-registry';
import { DockPanelFrame } from './panel-dnd-wrapper';
import { loadPanelOrder, savePanelOrder, applyPanelOrder } from './dock-profile';
import { useFocus } from '../workbench/focus-context';

const MIN_W = 160;
const MAX_W = 600;
const DEFAULT_W = 288;

interface RightSidebarProps {
  activeTasks: Map<string, any>;
  queueInfo: { isProcessing: boolean; queueDepth: number; queue: any[] };
  onNewSession: () => void;
  onQuickCompact: () => void;
  onSaveSnapshot: () => void;
  snapshots: { id: string; name: string; msgs: any[]; ts: string }[];
  onLoadSnapshot: (id: string) => void;
  onForkSnapshot: (id: string) => void;
  knownFiles: Map<string, string>;
  onOpenFile: (filePath: string) => void;
  shortenPath: (p: string) => string;
  logs: string[];
  msgLog: any[];
  terminalTab: 'log' | 'raw';
  onTerminalTabChange: (tab: 'log' | 'raw') => void;
  logsEndRef: React.RefObject<HTMLDivElement | null>;
  // ── Path bookmarks ──
  onNavigatePath?: (path: string) => void;
  currentActiveDir?: string;
}

export function RightSidebar(props: RightSidebarProps) {
  const { whenContext, dockProfileKey } = useFocus();
  const registryPanels = useMemo(() => getPanels('right', whenContext), [whenContext]);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    setSavedOrder(loadPanelOrder('right', dockProfileKey));
  }, [dockProfileKey]);

  const panelIds = useMemo(() => registryPanels.map(p => p.id), [registryPanels]);
  useEffect(() => {
    setSavedOrder(prev => {
      if (!prev) return panelIds;
      const merged = prev.filter(id => panelIds.includes(id));
      for (const id of panelIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      return merged;
    });
  }, [panelIds]);

  const panels = useMemo(() => applyPanelOrder(registryPanels, savedOrder),
    [registryPanels, savedOrder]);

  const handleReorder = useCallback((dragId: string, targetId: string) => {
    setSavedOrder(prev => {
      const current = prev || registryPanels.map(p => p.id);
      const fromIdx = current.indexOf(dragId);
      const toIdx = current.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...current];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, dragId);
      savePanelOrder('right', dockProfileKey, next);
      return next;
    });
  }, [registryPanels, dockProfileKey]);

  // ── Drag resize ──────────────────────────────────────────────
  const [width, setWidth] = useState(DEFAULT_W);
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sb-right-width');
      if (saved) setWidth(Math.min(MAX_W, Math.max(MIN_W, parseInt(saved, 10) || DEFAULT_W)));
    } catch {}
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = true;
    startXRef.current = e.clientX;
    startWRef.current = widthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      // For right sidebar, dragging LEFT decreases width: clientX delta is inverted
      const w = Math.min(MAX_W, Math.max(MIN_W, startWRef.current - (e.clientX - startXRef.current)));
      setWidth(w);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('sb-right-width', String(widthRef.current)); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <aside
      className="bg-[#0d0d0d] flex flex-col hidden lg:flex shrink-0 overflow-hidden relative"
      style={{ width }}
    >
      {/* Drag handle — left edge */}
      <div
        className="absolute inset-y-0 left-0 w-1 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 z-10"
        onMouseDown={onDragStart}
      />
      <div className="flex-1 overflow-y-auto">
        {panels.map((p) => {
          const PanelComponent = p.component;
          return (
            <DockPanelFrame key={p.id} panelId={p.id} title={p.title} icon={p.icon && <p.icon className="w-3 h-3" />} profileKey={dockProfileKey} actions={p.getActions?.(props)} onReorder={handleReorder}>
              <PanelComponent {...props} />
            </DockPanelFrame>
          );
        })}
      </div>
    </aside>
  );
}
