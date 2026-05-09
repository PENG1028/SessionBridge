'use client';

import { useState, useCallback, useRef, useEffect, type ReactNode, type DragEvent } from 'react';
import { GripVertical, ChevronDown, ChevronRight } from 'lucide-react';

// ── DockPanelFrame ────────────────────────────────────────────
// Unified sidebar panel frame providing:
//   - Collapse/expand via chevron (persisted to localStorage)
//   - Drag-and-drop reorder via absolute-positioned drag handle
//   - Absolute drop indicator overlay (no layout shift)
//   - Action slot in the header from props (stable regardless of collapse)

interface DockPanelFrameProps {
  panelId: string;
  title: string;
  icon?: ReactNode;
  /** Action buttons rendered in the header. Resolved from panel
   *  registration at the sidebar level — always available even
   *  when the panel body is collapsed. */
  actions?: ReactNode;
  children: ReactNode;
  onReorder: (dragId: string, targetId: string) => void;
}

const COLLAPSE_KEY = 'sessionbridge-collapsed-panels';

function loadCollapsed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveCollapsed(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(ids)); } catch {}
}

export function DockPanelFrame({ panelId, title, icon, actions, children, onReorder }: DockPanelFrameProps) {
  const [dragOver, setDragOver] = useState(false);
  // Initialized to false for SSR/hydration consistency — read from
  // localStorage happens in the useEffect below, which flips the state
  // on mount if the panel was previously collapsed by the user.
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<string | null>(null);

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      const ids = loadCollapsed();
      if (next) {
        if (!ids.includes(panelId)) ids.push(panelId);
      } else {
        const idx = ids.indexOf(panelId);
        if (idx >= 0) ids.splice(idx, 1);
      }
      saveCollapsed(ids);
      return next;
    });
  }, [panelId]);

  // Sync collapsed state when panelId changes (DnD replacement)
  useEffect(() => {
    setCollapsed(loadCollapsed().includes(panelId));
  }, [panelId]);

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

// ── Panel order persistence (kept from PanelDndWrapper) ───────

const ORDER_KEY = 'sessionbridge-sidebar-order';

export function loadPanelOrder(side: 'left' | 'right'): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(ORDER_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed[side] || null;
    }
  } catch {}
  return null;
}

export function savePanelOrder(side: 'left' | 'right', order: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = JSON.parse(localStorage.getItem(ORDER_KEY) || '{}');
    existing[side] = order;
    localStorage.setItem(ORDER_KEY, JSON.stringify(existing));
  } catch {}
}

export function applyPanelOrder<T extends { id: string }>(panels: T[], savedOrder: string[] | null): T[] {
  if (!savedOrder || savedOrder.length === 0) return panels;
  const panelMap = new Map(panels.map(p => [p.id, p]));
  const ordered: T[] = [];
  const remaining = new Set(panels.map(p => p.id));

  for (const id of savedOrder) {
    if (remaining.has(id)) {
      ordered.push(panelMap.get(id)!);
      remaining.delete(id);
    }
  }
  for (const p of panels) {
    if (remaining.has(p.id)) {
      ordered.push(p);
    }
  }
  return ordered;
}
