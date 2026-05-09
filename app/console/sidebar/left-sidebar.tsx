'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getPanels } from '../panels/panel-registry';
import { PanelDndWrapper, loadPanelOrder, savePanelOrder, applyPanelOrder } from './panel-dnd-wrapper';
import { useFocus } from '../workbench/focus-context';

interface LeftSidebarProps {
  fileTree: Record<string, { items: any[]; loaded: boolean }>;
  expandedDirs: Set<string>;
  onToggleDir: (dirPath: string) => void;
  onOpenFile: (filePath: string) => void;
  onSendFile: (filePath: string) => void;
  instances: any[];
  activeInstanceId: string | null;
  onActivateInstance: (id: string) => void;
  onCreateInstance: (dir: string, model?: string, adapterId?: string) => void;
  onKillInstance: (id: string) => void;
  onQuickAction: (cmd: string) => void;
  onRewind: () => void;
  projectCwd: string;
}

export function LeftSidebar(props: LeftSidebarProps) {
  const { whenContext } = useFocus();
  // Must memoize: getPanels creates a new array every call, and without memo the
  // registryPanels → panelIds → useEffect([panelIds]) chain causes an infinite loop.
  const registryPanels = useMemo(() => getPanels('left', whenContext), [whenContext]);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    setSavedOrder(loadPanelOrder('left'));
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
      savePanelOrder('left', next);
      return next;
    });
  }, [registryPanels]);

  return (
    <aside className="w-56 border-r border-gray-800 bg-[#0d0d0d] flex flex-col hidden md:flex shrink-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {panels.map((p, i) => {
          const PanelComponent = p.component;
          return (
            <PanelDndWrapper key={p.id} panelId={p.id} index={i} title={p.title} onReorder={handleReorder}>
              <div className="overflow-y-auto max-h-[60vh]">
                <PanelComponent {...props} />
              </div>
            </PanelDndWrapper>
          );
        })}
      </div>
    </aside>
  );
}
