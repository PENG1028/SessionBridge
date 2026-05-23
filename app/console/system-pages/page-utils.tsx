'use client';

import React from 'react';

// ─── Shared page state types ───────────────────────────────────
export type PageState = 'loading' | 'ready' | 'error' | 'empty' | 'offline' | 'permission_denied';

export interface UsePageDataResult<T> {
  state: PageState;
  data: T | null;
  error: string | null;
  retry: () => void;
}

// ─── Data fetcher hook ─────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import type { CoreClient } from '../core/core-types';

export function usePageData<T>(
  core: CoreClient | null,
  fetchFn: () => Promise<T>,
  deps: unknown[] = [],
): UsePageDataResult<T> {
  const [state, setState] = useState<PageState>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  const retry = useCallback(() => setRetryCounter(c => c + 1), []);

  useEffect(() => {
    if (!core || !core.isConnected) {
      setState('offline');
      return;
    }

    let cancelled = false;
    setState('loading');
    setError(null);

    fetchFn()
      .then(result => {
        if (cancelled) return;
        if (Array.isArray(result) && result.length === 0) {
          setState('empty');
          setData(result as T);
        } else {
          setState('ready');
          setData(result);
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState('error');
        setError(err.message || 'Unknown error');
      });

    return () => { cancelled = true; };
  }, [core, retryCounter, ...deps]);

  return { state, data, error, retry };
}

// ─── Reusable state components ─────────────────────────────────

export function PageLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 bg-[#1a1a1a] rounded border border-gray-800" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
      <div className="text-red-400 text-[11px] font-mono mb-2">Error</div>
      <p className="text-gray-400 text-[10px] mb-4 max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-300 rounded text-[10px] transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function PageEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
      <div className="text-gray-500 text-[11px] font-mono mb-2">{title}</div>
      {description && <p className="text-gray-600 text-[10px] max-w-md">{description}</p>}
    </div>
  );
}

export function PageOffline() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
      <div className="text-yellow-500 text-[11px] font-mono mb-2">Offline</div>
      <p className="text-gray-500 text-[10px]">Core connection lost. Showing last known data.</p>
    </div>
  );
}

export function PagePermissionDenied() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
      <div className="text-gray-500 text-[11px] font-mono mb-2">Permission Denied</div>
      <p className="text-gray-600 text-[10px]">You do not have permission to view this page.</p>
    </div>
  );
}

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800">
      <span className="text-[11px] font-mono tracking-wider uppercase text-gray-300">{title}</span>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
