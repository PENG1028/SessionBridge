'use client';

import { cn } from './cn';

interface SpinnerProps {
  size?: 'sm' | 'md';
  className?: string;
}

export function Spinner({ size = 'sm', className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        'animate-spin rounded-full border-2 border-gray-700 border-t-gray-300',
        size === 'sm' ? 'w-3 h-3' : 'w-4 h-4',
        className,
      )}
    />
  );
}
