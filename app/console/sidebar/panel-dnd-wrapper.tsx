'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode, type DragEvent } from 'react';
import { GripVertical, ChevronRight } from 'lucide-react';

// ── Collapse Context ─────────────────────────────────────────
// Lets panel components render their own collapse toggle inline.

interface PanelCollapseValue {
  collapsed: boolean;
  onToggle: () => void;
}

const PanelCollapseContext = createContext<PanelCollapseValue | null>(null);

export function usePanelCollapse(): PanelCollapseValue {
  const ctx = useContext(PanelCollapseContext);
  return ctx ?? { collapsed: false, onToggle: () => {} };
}

// ── PanelDndWrapper ──────────────────────────────────────────

interface PanelDndWrapperProps {
  panelId: string;
  index: number;
  title: string;
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

export function PanelDndWrapper({ panelId, index, title, children, onReorder }: PanelDndWrapperProps) {
  const [dragOver, setDragOver] = useState(false);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed().includes(panelId));
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
    <PanelCollapseContext.Provider value={{ collapsed, onToggle: toggleCollapse }}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group relative transition-colors ${
          dragOver ? 'border-l-2 border-purple-500' : ''
        }`}
      >
        {collapsed ? (
          // Compact bar when collapsed — draggable to reorder, click to expand
          <div
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={toggleCollapse}
            className="flex items-center gap-2 h-8 px-2 text-[10px] text-gray-600 border-b border-gray-800 bg-[#111] cursor-pointer hover:text-gray-400 hover:bg-gray-800/30 transition-colors select-none"
          >
            <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
            <span className="truncate font-medium">{title}</span>
          </div>
        ) : (
          /* Expanded: drag handle on top (hover visible), content below is NOT draggable for text selection */
          <>
            <div
              draggable
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              className="flex justify-center cursor-grab active:cursor-grabbing hover:bg-gray-800/30 transition-colors select-none opacity-0 group-hover:opacity-100 h-4 items-center border-b border-transparent group-hover:border-gray-800"
            >
              <GripVertical className="w-2.5 h-2.5 text-gray-600" />
            </div>
            <div draggable={false} className="select-text">
              {children}
            </div>
          </>
        )}
      </div>
    </PanelCollapseContext.Provider>
  );
}

// ── Panel order persistence ──────────────────────────────────

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
