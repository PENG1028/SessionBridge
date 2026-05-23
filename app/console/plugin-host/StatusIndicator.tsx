'use client';

import { cn } from '../components/cn';

type Status = 'running' | 'online' | 'offline' | 'connecting' | 'error' | 'stopped' | 'idle';

interface StatusIndicatorProps {
  status: Status;
  label?: string;
  pulse?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const statusStyles: Record<Status, string> = {
  running: 'bg-green-500',
  online: 'bg-green-500',
  connecting: 'bg-yellow-500',
  error: 'bg-red-500',
  stopped: 'bg-gray-600',
  offline: 'bg-gray-600',
  idle: 'bg-gray-500',
};

export function StatusIndicator({ status, label, pulse, size = 'sm', className }: StatusIndicatorProps) {
  const dotSize = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5';

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          dotSize,
          'rounded-full shrink-0',
          statusStyles[status] || 'bg-gray-600',
          pulse && 'animate-pulse',
        )}
      />
      {label && <span className="text-[10px] text-gray-400">{label}</span>}
    </span>
  );
}
