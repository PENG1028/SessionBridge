'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ResolvedContextMenuItem } from '../menus/context-menu-types';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  /** Internal: sort group key, used during menu assembly. Not rendered. */
  group?: string;
  /** Internal: sort order within group, used during menu assembly. Not rendered. */
  order?: number;
  /** Optional icon name (host-mapped) */
  icon?: string;
  /** Show a checkmark */
  checked?: boolean;
  /** Reason shown when disabled */
  disabledReason?: string;
  /** Nested submenu */
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

/**
 * Convert ResolvedContextMenuItem to the renderer's ContextMenuItem.
 * Ensures the renderer always gets a valid action even for submenu parents.
 */
function toRenderItem(item: ResolvedContextMenuItem): ContextMenuItem {
  return {
    label: item.label,
    shortcut: item.shortcut,
    action: item.action || (() => {}),
    disabled: item.disabled,
    danger: item.danger,
    divider: item.divider,
    group: item.group,
    order: item.order,
    icon: item.icon,
    checked: item.checked,
    disabledReason: item.disabledReason,
    children: item.children?.map(toRenderItem),
  };
}

/** Submenu offset from parent edge */
const SUBMENU_OFFSET = 4;

function MenuItem({ item, depth, onClose }: { item: ContextMenuItem; depth: number; onClose: () => void }) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuPos, setSubmenuPos] = useState({ x: 0, y: 0 });
  const itemRef = useRef<HTMLButtonElement>(null);

  const hasChildren = item.children && item.children.length > 0;

  const handleClick = useCallback(() => {
    if (hasChildren) return; // parent item — toggle submenu
    item.action();
    onClose();
  }, [hasChildren, item, onClose]);

  const handleMouseEnter = useCallback(() => {
    if (hasChildren && itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      const subX = rect.right + SUBMENU_OFFSET;
      const subY = rect.top;
      // Clamp to viewport (width hint: ~160px)
      const clampedX = Math.min(subX, window.innerWidth - 166);
      const clampedY = Math.min(subY, window.innerHeight - item.children!.length * 32 - 16);
      setSubmenuPos({ x: clampedX, y: Math.max(0, clampedY) });
      setSubmenuOpen(true);
    }
  }, [hasChildren, item]);

  const handleMouseLeave = useCallback(() => {
    // Don't close immediately — submenu needs time to catch the hover
    // The submenu's own onClose will handle this when mouse leaves entirely
  }, []);

  if (item.divider) {
    return <div className="border-t border-gray-800 my-1" />;
  }

  return (
    <>
      <button
        ref={itemRef}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        disabled={item.disabled}
        className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-left transition-colors ${
          item.disabled ? 'text-gray-600 cursor-not-allowed'
          : item.danger ? 'text-red-400 hover:bg-red-900/20'
          : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
        } ${hasChildren ? 'relative' : ''}`}
        title={item.disabledReason}
      >
        <span className="flex items-center gap-2 min-w-0">
          {item.checked && <span className="text-purple-400 shrink-0">✓</span>}
          {item.icon && <span className="text-gray-500 text-[9px] shrink-0">{item.icon}</span>}
          <span className="truncate">{item.label}</span>
        </span>
        <span className="flex items-center gap-1 shrink-0 ml-2">
          {item.shortcut && <span className="text-gray-600 text-[10px]">{item.shortcut}</span>}
          {hasChildren && <span className="text-gray-600 text-[10px]">▸</span>}
        </span>
      </button>
      {hasChildren && submenuOpen && (
        <div
          className="fixed z-[101] bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden min-w-[140px] py-1"
          style={{ left: submenuPos.x + 'px', top: submenuPos.y + 'px' }}
          onMouseEnter={() => setSubmenuOpen(true)}
          onMouseLeave={() => setSubmenuOpen(false)}
        >
          {item.children!.map((child, i) => (
            <MenuItem key={child.label + i} item={child} depth={depth + 1} onClose={onClose} />
          ))}
        </div>
      )}
    </>
  );
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    window.addEventListener('scroll', onClose, { once: true });
    window.addEventListener('resize', onClose, { once: true });
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Clamp to viewport
  const menuWidth = 180;
  const itemHeight = 32;
  const clampedX = Math.min(x, window.innerWidth - menuWidth);
  const clampedY = Math.min(y, window.innerHeight - items.length * itemHeight - 16);

  return (
    <div
      ref={ref}
      className="fixed z-[100] bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden min-w-[160px] py-1"
      style={{ left: clampedX + 'px', top: Math.max(0, clampedY) + 'px' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <MenuItem key={item.label + i} item={item} depth={0} onClose={onClose} />
      ))}
    </div>
  );
}

export { toRenderItem };
