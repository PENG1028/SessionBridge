'use client';

import { cn } from './cn';
import { Button } from './Button';

interface EmptyStateProps {
  title?: string;
  message?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  title = 'No data',
  message,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('p-8 text-center', className)}>
      <p className="text-gray-500 text-xs font-medium">{title}</p>
      {message && <p className="text-gray-600 text-[10px] mt-1">{message}</p>}
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick} className="mt-3">
          {action.label}
        </Button>
      )}
    </div>
  );
}
