'use client';

import { cn } from './cn';

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'info';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-800 text-gray-400',
  success: 'bg-green-900/30 text-green-400',
  danger: 'bg-red-900/30 text-red-400',
  warning: 'bg-amber-900/20 text-amber-500 border border-amber-700/30',
  info: 'bg-blue-900/30 text-blue-400',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', variantStyles[variant], className)}>
      {children}
    </span>
  );
}
