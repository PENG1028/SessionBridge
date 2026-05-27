'use client';

import { cn } from './cn';

interface ToolbarProps {
  title?: string;
  children?: React.ReactNode;
  className?: string;
}

export function Toolbar({ title, children, className }: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900 shrink-0',
        className,
      )}
    >
      {title && <span className="text-xs text-gray-400 font-medium">{title}</span>}
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
