'use client';

import type { ReactNode } from 'react';

interface SidebarSlotProps {
  open: boolean;
  children: ReactNode;
}

export function SidebarSlot({ open, children }: SidebarSlotProps) {
  return (
    <div
      className={`overflow-hidden shrink-0 transition-all duration-200 ease-in-out ${
        open ? '' : 'w-0 opacity-0'
      }`}
      style={open ? undefined : { padding: 0, margin: 0, minWidth: 0 }}
    >
      {open ? children : null}
    </div>
  );
}
