'use client';

import { forwardRef } from 'react';
import { cn } from './cn';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, className, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'bg-gray-800 text-gray-200 px-2 py-0.5 rounded text-xs font-mono outline-none border border-gray-800',
          'focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500/50',
          'appearance-none cursor-pointer',
          className,
        )}
        {...props}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  },
);
Select.displayName = 'Select';
