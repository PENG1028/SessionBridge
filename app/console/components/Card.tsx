'use client';

import { cn } from './cn';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className, hover }: CardProps) {
  return (
    <div
      className={cn(
        'bg-gray-900 rounded-lg border border-gray-800',
        hover && 'hover:bg-gray-800/50 transition-colors',
        className,
      )}
    >
      {children}
    </div>
  );
}
