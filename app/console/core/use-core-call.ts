'use client';

// ─── Unified hook wrapping core.call() with classified errors ──
// Components use this instead of calling core.call() directly.
// Always returns { data, error, loading, execute } — never throws.
// The error is a CoreError with a category, so UI can branch on it.

import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import { useCore } from './core-client-provider';
import { CoreError, classifyCoreError, type CoreErrorCategory } from './core-error';

export interface CoreCallState<T> {
  data: T | null;
  error: CoreError | null;
  loading: boolean;
  /** Re-run the call (e.g. on retry). Pass params overrides. */
  execute: (paramsOverride?: Record<string, unknown>) => Promise<T | null>;
  /** Reset data/error/loading to initial. */
  reset: () => void;
}

type UseCoreCallOptions = {
  /** If true, fires execute() on mount. Default true. */
  immediate?: boolean;
  /** Called with the classified error when a call fails. Components can
   *  use this to e.g. show a toast or mark a global error. */
  onError?: (err: CoreError) => void;
};

/**
 * useCoreCall — unified Core call hook.
 *
 * Usage:
 *   const { data, error, loading, execute } = useCoreCall<{cwd: string}>('env.cwd');
 *   // or with params:
 *   const { data, error, loading } = useCoreCall('node.info', { nodeId: 'abc' });
 */
export function useCoreCall<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  options?: UseCoreCallOptions,
): CoreCallState<T> {
  const core = useCore();
  const ctx = useContext(CoreErrorContext);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<CoreError | null>(null);
  const [loading, setLoading] = useState(options?.immediate !== false);
  const mountedRef = useRef(true);
  const callIdRef = useRef(0);

  // Cleanup: mark unmounted so pending async callbacks skip setState
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  const execute = useCallback(async (paramsOverride?: Record<string, unknown>): Promise<T | null> => {
    const id = ++callIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await core.call<T>(method, paramsOverride ?? params);
      if (mountedRef.current && id === callIdRef.current) {
        setData(result);
        setLoading(false);
      }
      return result;
    } catch (raw: unknown) {
      const classified = classifyCoreError(raw);
      if (mountedRef.current && id === callIdRef.current) {
        setError(classified);
        setLoading(false);
      }
      ctx.reportError({ method, error: classified, timestamp: Date.now() });
      options?.onError?.(classified);
      return null;
    }
  }, [core, method, params, options, ctx]);

  // Auto-execute on mount (via useEffect to avoid setState during render)
  useEffect(() => {
    if (options?.immediate !== false) {
      execute();
    }
    // Only fire on mount — execute identity is stable per method+params
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, error, loading, execute, reset };
}

/**
 * useCoreCallLazy — same as useCoreCall but never fires on mount.
 * Caller must call execute() manually.
 */
export function useCoreCallLazy<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  options?: UseCoreCallOptions,
): CoreCallState<T> {
  return useCoreCall<T>(method, params, { ...options, immediate: false });
}

// ─── CoreErrorContext — global error aggregation ──────────────

export interface CoreErrorEntry {
  method: string;
  error: CoreError;
  timestamp: number;
}

interface CoreErrorContextValue {
  errors: CoreErrorEntry[];
  /** Latest error by category (one per category, overwritten by new ones). */
  latestByCategory: Partial<Record<CoreErrorCategory, CoreErrorEntry>>;
  /** Register an error (called by useCoreCall internally). */
  reportError: (entry: CoreErrorEntry) => void;
  clearErrors: () => void;
  clearCategory: (cat: CoreErrorCategory) => void;
}

export const CoreErrorContext = createContext<CoreErrorContextValue>({
  errors: [],
  latestByCategory: {},
  reportError: () => {},
  clearErrors: () => {},
  clearCategory: () => {},
});

export function useCoreErrors(): CoreErrorContextValue {
  return useContext(CoreErrorContext);
}
