'use client';

import { forwardRef } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white',
  secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-400',
  ghost: 'text-gray-500 hover:text-gray-300 bg-transparent',
  danger: 'bg-red-800 hover:bg-red-700 text-red-200',
  success: 'bg-green-800 hover:bg-green-700 text-green-200',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-2 py-0.5 text-[11px] gap-1',
  md: 'px-3 py-1.5 text-xs gap-1.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'sm', loading, icon: Icon, className, children, disabled, ...props }, ref) => {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center rounded font-medium transition-colors duration-150',
          variantStyles[variant],
          sizeStyles[size],
          isDisabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
        {...props}
      >
        {loading ? (
          <Spinner size={size === 'md' ? 'md' : 'sm'} />
        ) : Icon ? (
          <Icon className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
