'use client';

import { useCallback, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { X } from 'lucide-react';
import type { SplitLayout, SplitDirection } from './split-layout';

interface SplitPaneContainerProps {
  /** The layout configuration. */
  layout: SplitLayout;
  /** Render the content for a given instance ID. */
  renderPane: (instanceId: string) => ReactNode;
  /** Called when the user wants to close a pane. */
  onClosePane?: (instanceId: string) => void;
}

/**
 * Multi-pane split container with draggable dividers.
 * Supports horizontal (side-by-side) and vertical (stacked) layouts.
 */
export function SplitPaneContainer({
  layout,
  renderPane,
  onClosePane,
}: SplitPaneContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ index: number; start: number; startSizes: number[] } | null>(null);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent, index: number) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const start = layout.direction === 'horizontal' ? e.clientX : e.clientY;
      const startSizes = layout.panes.map((_, i) => {
        if (i >= layout.panes.length - 1) return 0;
        const paneEl = (containerRef.current?.children[i] as HTMLElement);
        return layout.direction === 'horizontal' ? paneEl?.offsetWidth || 0 : paneEl?.offsetHeight || 0;
      });
      setDragging({ index, start, startSizes });

      const handleMouseMove = (ev: globalThis.MouseEvent) => {
        if (!containerRef.current) return;
        const current = layout.direction === 'horizontal' ? ev.clientX : ev.clientY;
        const delta = current - start;
        const containerSize = layout.direction === 'horizontal'
          ? containerRef.current.offsetWidth
          : containerRef.current.offsetHeight;
        const minSize = 200;
        const maxSize = containerSize - minSize;

        for (let i = 0; i < layout.panes.length - 1; i++) {
          const paneEl = containerRef.current.children[i] as HTMLElement;
          const isLeft = i <= index;
          const newSize = isLeft
            ? Math.max(minSize, Math.min(maxSize, startSizes[i] + delta / (layout.panes.length - 1)))
            : startSizes[i];
          paneEl.style.flex = `${newSize} 1 0`;
          paneEl.style.minWidth = layout.direction === 'horizontal' ? `${minSize}px` : '0';
          paneEl.style.minHeight = layout.direction === 'vertical' ? `${minSize}px` : '0';
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
    [layout],
  );

  const dirClass = layout.direction === 'horizontal' ? 'flex-row' : 'flex-col';
  const dividerClass = layout.direction === 'horizontal' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize';

  return (
    <div ref={containerRef} className={`flex ${dirClass} flex-1 min-w-0 min-h-0 overflow-hidden`}>
      {layout.panes.map((pane, index) => (
        <div key={pane.instanceId} className="flex flex-col min-w-0 min-h-0" style={{ flex: `${pane.size ?? 1} 1 0` }}>
          {/* Pane header */}
          <div className="flex items-center justify-between px-2 py-0.5 bg-[#0d0d0d] border-b border-gray-800 shrink-0">
            <span className="text-[9px] text-gray-600 truncate">{pane.instanceId.slice(0, 12)}</span>
            {onClosePane && layout.panes.length > 1 && (
              <button
                onClick={() => onClosePane(pane.instanceId)}
                className="text-gray-600 hover:text-red-400 transition-colors p-0.5"
                title="Close pane"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {/* Pane content */}
          <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
            {renderPane(pane.instanceId)}
          </div>
        </div>
      ))}
      {/* Dividers between panes */}
      {layout.panes.map((_, index) => {
        if (index >= layout.panes.length - 1) return null;
        return (
          <div
            key={`divider-${index}`}
            className={`${dividerClass} bg-gray-800 hover:bg-purple-600/50 transition-colors shrink-0 relative z-10`}
            onMouseDown={(e) => handleMouseDown(e, index)}
          />
        );
      })}
    </div>
  );
}
