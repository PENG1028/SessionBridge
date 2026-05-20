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
import type { CoreClient } from '../../core/core-types';

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
    <div className="p-6 space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-gray-800 rounded" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-red-400 text-lg font-medium mb-2">Error</div>
      <p className="text-gray-400 text-sm mb-4 max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-sm transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function PageEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-gray-500 text-lg font-medium mb-2">{title}</div>
      {description && <p className="text-gray-600 text-sm max-w-md">{description}</p>}
    </div>
  );
}

export function PageOffline() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-yellow-500 text-lg font-medium mb-2">Offline</div>
      <p className="text-gray-500 text-sm">Core connection lost. Showing last known data.</p>
    </div>
  );
}

export function PagePermissionDenied() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-gray-500 text-lg font-medium mb-2">Permission Denied</div>
      <p className="text-gray-600 text-sm">You do not have permission to view this page.</p>
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
    <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
      <h1 className="text-lg font-semibold text-gray-100">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
