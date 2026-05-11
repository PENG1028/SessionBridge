'use client';

import { useState, useCallback, useRef, useEffect, type ReactNode, type DragEvent } from 'react';
import { GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { isPanelCollapsed, setPanelCollapsed, applyPanelOrder } from './dock-profile';

// ── DockPanelFrame ────────────────────────────────────────────
// Unified sidebar panel frame providing:
//   - Collapse/expand via chevron (persisted per Dock Profile)
//   - Drag-and-drop reorder via absolute-positioned drag handle
//   - Absolute drop indicator overlay (no layout shift)
//   - Action slot in the header from props (stable regardless of collapse)

export interface DockPanelFrameProps {
  panelId: string;
  title: string;
  icon?: ReactNode;
  /** Dock profile key for persisting collapse state. */
  profileKey: string;
  /** Action buttons rendered in the header. Resolved from panel
   *  registration at the sidebar level — always available even
   *  when the panel body is collapsed. */
  actions?: ReactNode;
  children: ReactNode;
  onReorder: (dragId: string, targetId: string) => void;
}

export function DockPanelFrame({ panelId, title, icon, profileKey, actions, children, onReorder }: DockPanelFrameProps) {
  const [dragOver, setDragOver] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<string | null>(null);

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      setPanelCollapsed(profileKey, panelId, next);
      return next;
    });
  }, [profileKey, panelId]);

  // Sync collapsed state when profileKey or panelId changes
  useEffect(() => {
    setCollapsed(isPanelCollapsed(profileKey, panelId));
  }, [profileKey, panelId]);

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>) => {
    dragRef.current = panelId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', panelId);
    const el = e.currentTarget;
    requestAnimationFrame(() => { el.classList.add('opacity-30'); });
  }, [panelId]);

  const handleDragEnd = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('opacity-30');
    setDragOver(false);
    dragRef.current = null;
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== panelId) {
      onReorder(draggedId, panelId);
    }
  }, [panelId, onReorder]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="group relative"
    >
      {/* Drop indicator overlay — absolute, no layout impact */}
      {dragOver && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-purple-500 z-20 pointer-events-none shadow-[0_0_6px_rgba(168,85,247,0.4)]" />
      )}

      {/* Drag handle — absolute left edge, visible on group hover */}
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className="absolute left-0 top-0 bottom-0 w-[3px] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 hover:bg-purple-500/40 transition-opacity z-10 rounded-full"
      >
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 bg-gray-700/80 rounded-sm p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-2 h-2 text-gray-400" />
        </div>
      </div>

      {/* Header — always visible, same density collapsed or expanded */}
      <div
        className={`flex items-center h-8 px-2 gap-1.5 border-b border-gray-800 bg-[#0d0d0d] select-none ${
          collapsed ? '' : ''
        }`}
      >
        <button
          onClick={toggleCollapse}
          className="text-gray-600 hover:text-gray-300 transition-colors p-0.5 -ml-0.5 shrink-0"
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>

        {icon && <span className="text-gray-500 shrink-0 [&>svg]:w-3 [&>svg]:h-3">{icon}</span>}

        <span className="text-[10px] font-bold text-gray-500 tracking-wider truncate">{title}</span>

        <div className="flex-1" />

        {/* Action slot — passed as prop from sidebar (resolved from registry), always visible */}
        {actions && (
          <div className="flex items-center gap-0.5 text-gray-600 [&>button]:hover:text-gray-300 [&>button]:transition-colors [&>button]:p-0.5">
            {actions}
          </div>
        )}
      </div>

      {/* Body — visually clipped when collapsed, but children still mount
          so panels that manage internal state (e.g. InstanceList polling)
          continue to work. */}
      <div className={collapsed ? 'hidden' : 'bg-[#0d0d0d]'}>
        {children}
      </div>
    </div>
  );
}
