'use client';

import { useMemo, useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getPanels } from '../panels/panel-registry';
import { useFocus } from '../workbench/focus-context';

interface MobileRightPanelProps {
  open: boolean;
  onClose: () => void;
  activeTasks: Map<string, any>;
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

export function MobileRightPanel(props: MobileRightPanelProps) {
  const { open, onClose, ...panelProps } = props;
  const { whenContext } = useFocus();
  const panels = useMemo(() => {
    const all = getPanels('right', whenContext);
    // Filter for mobile-suitable panels — prefer those with mobile.placement != 'hidden'.
    // When no mobile-specific preference exists, show all right panels.
    const mobileFriendly = all.filter(p =>
      !p.mobile || p.mobile.placement !== 'hidden'
    );
    return mobileFriendly.length > 0 ? mobileFriendly : all;
  }, [whenContext]);
  // Swipe-left-to-close gesture
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch.clientX > window.innerWidth - 40) setTouchStart(touch.clientX);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStart === null) return;
    // Visual feedback could go here
  }, [touchStart]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStart === null) return;
    const dx = touchStart - e.changedTouches[0].clientX;
    if (dx > 80) onClose();
    setTouchStart(null);
  }, [touchStart, onClose]);

  if (!open) return null;

  return (
    <div className="md:hidden fixed inset-0 z-50 flex" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Sheet — slides in from right */}
      <div className="relative w-80 max-w-[85vw] ml-auto bg-[#0d0d0d] border-l border-gray-800 flex flex-col overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
          <span className="text-[10px] font-bold text-gray-500 tracking-wider uppercase">Panels</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Panels */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {panels.length === 0 ? (
            <div className="text-[10px] text-gray-700 italic px-4 py-6 text-center">No panels available.</div>
          ) : (
            panels.map((p) => {
              const PanelComponent = p.component;
              return (
                <div key={p.id} className="border-b border-gray-800/60 last:border-b-0">
                  {/* Panel title */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0a] border-b border-gray-800/40">
                    {p.icon && <p.icon className="w-3 h-3 text-gray-400" />}
                    <span className="text-[9px] font-bold text-gray-500 tracking-wider uppercase">{p.title}</span>
                  </div>
                  {/* Panel body */}
                  <div className="px-1.5 py-1">
                    <PanelComponent {...panelProps as any} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
