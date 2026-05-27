'use client';

import { forwardRef } from 'react';
import { cn } from './cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'ghost';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant = 'default', className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'text-gray-200 px-2 py-0.5 rounded font-mono text-xs outline-none transition-colors duration-150',
          'placeholder:text-gray-600',
          variant === 'default' && 'bg-gray-800 focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500/50 border border-gray-800',
          variant === 'ghost' && 'bg-transparent border border-transparent hover:border-gray-700 focus:border-blue-500/50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
