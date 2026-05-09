'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getPanels } from '../panels/panel-registry';
import { PanelDndWrapper, loadPanelOrder, savePanelOrder, applyPanelOrder } from './panel-dnd-wrapper';
import { useFocus } from '../workbench/focus-context';

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
}

export function RightSidebar(props: RightSidebarProps) {
  const { whenContext } = useFocus();
  const registryPanels = useMemo(() => getPanels('right', whenContext), [whenContext]);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    setSavedOrder(loadPanelOrder('right'));
  }, []);

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
      savePanelOrder('right', next);
      return next;
    });
  }, [registryPanels]);

  return (
    <aside className="w-72 border-l border-gray-800 bg-[#0d0d0d] flex flex-col hidden lg:flex shrink-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {panels.map((p, i) => {
          const PanelComponent = p.component;
          return (
            <PanelDndWrapper key={p.id} panelId={p.id} index={i} title={p.title} onReorder={handleReorder}>
              <div className="overflow-y-auto max-h-[50vh]">
                <PanelComponent {...props} />
              </div>
            </PanelDndWrapper>
          );
        })}
      </div>
    </aside>
  );
}
