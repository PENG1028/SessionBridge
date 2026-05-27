'use client';

import { useEffect, useCallback } from 'react';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, actions, className }: ModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'fixed z-50 bg-[#0d0d0d] border border-gray-700 rounded-lg shadow-2xl flex flex-col',
          'min-w-[320px] max-w-[90vw] max-h-[85vh]',
          className,
        )}
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        {/* Header */}
        <div className="h-8 px-3 bg-gray-900 border-b border-gray-700 flex items-center shrink-0">
          <span className="text-[10px] font-bold text-gray-400 tracking-wider">{title}</span>
          <button
            onClick={onClose}
            className="ml-auto text-gray-600 hover:text-gray-300 text-sm leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">{children}</div>
        {/* Actions */}
        {actions && (
          <div className="shrink-0 px-4 py-3 border-t border-gray-800 flex items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </>
  );
}
