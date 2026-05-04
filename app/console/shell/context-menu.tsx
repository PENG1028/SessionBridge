'use client';

import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Also close on scroll or resize
    window.addEventListener('mousedown', handler);
    window.addEventListener('scroll', onClose, { once: true });
    window.addEventListener('resize', onClose, { once: true });
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden min-w-[160px] py-1"
      style={{ left: Math.min(x, window.innerWidth - 180) + 'px', top: Math.min(y, window.innerHeight - items.length * 32 - 16) + 'px' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="border-t border-gray-800 my-1" />
        ) : (
          <button
            key={i}
            onClick={() => { item.action(); onClose(); }}
            disabled={item.disabled}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-left transition-colors ${
              item.disabled ? 'text-gray-600 cursor-not-allowed'
              : item.danger ? 'text-red-400 hover:bg-red-900/20'
              : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
            }`}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="text-gray-600 text-[10px] ml-4">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}
