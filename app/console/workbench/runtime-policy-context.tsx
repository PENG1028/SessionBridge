'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFocus } from './focus-context';

// ── Types ─────────────────────────────────────────────────────

export type PermissionMode = 'default' | 'acceptEdits' | 'plan';
export type EffortLevel = 'low' | 'medium' | 'high';

export interface RuntimePolicy {
  permissionMode: PermissionMode;
  effortLevel: EffortLevel;
}

const DEFAULT_POLICY: RuntimePolicy = {
  permissionMode: 'default',
  effortLevel: 'low',
};

const STORAGE_KEY = 'sessionbridge-policies';

// ── Context ───────────────────────────────────────────────────

interface RuntimePolicyContextValue {
  /** Resolved policy for the active scope (merged with global fallback). */
  activePolicy: RuntimePolicy;
  /** The scope key currently in effect. */
  activeScope: string;
  /** Update the policy for a specific scope. */
  setPolicy: (scope: string, partial: Partial<RuntimePolicy>) => void;
  /** Update the global fallback policy. */
  setGlobalPolicy: (partial: Partial<RuntimePolicy>) => void;
  /** Get policy for a specific scope (returns fallback if not set). */
  getPolicy: (scope: string) => RuntimePolicy;
}

const RuntimePolicyCtx = createContext<RuntimePolicyContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────

export function RuntimePolicyProvider({ children }: { children: ReactNode }) {
  const { instanceId } = useFocus();
  const activeScope = instanceId ?? '_global';

  const [policies, setPolicies] = useState<Record<string, RuntimePolicy>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (_e) {
      return {};
    }
  });

  // Debounced persist
  const persistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistRef.current) clearTimeout(persistRef.current);
    persistRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(policies));
      } catch (_e) {}
    }, 500);
    return () => {
      if (persistRef.current) clearTimeout(persistRef.current);
    };
  }, [policies]);

  const resolvePolicy = useCallback((scope: string): RuntimePolicy => {
    return policies[scope] ?? policies['_global'] ?? DEFAULT_POLICY;
  }, [policies]);

  const setPolicy = useCallback((scope: string, partial: Partial<RuntimePolicy>) => {
    setPolicies(prev => {
      const current = prev[scope] ?? DEFAULT_POLICY;
      return { ...prev, [scope]: { ...current, ...partial } };
    });
  }, []);

  const setGlobalPolicy = useCallback((partial: Partial<RuntimePolicy>) => {
    setPolicy('_global', partial);
  }, [setPolicy]);

  const activePolicy = resolvePolicy(activeScope);

  const value: RuntimePolicyContextValue = {
    activePolicy,
    activeScope,
    setPolicy,
    setGlobalPolicy,
    getPolicy: resolvePolicy,
  };

  return (
    <RuntimePolicyCtx.Provider value={value}>
      {children}
    </RuntimePolicyCtx.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────

export function useRuntimePolicy(): RuntimePolicyContextValue {
  const ctx = useContext(RuntimePolicyCtx);
  if (!ctx) throw new Error('useRuntimePolicy must be used within a RuntimePolicyProvider');
  return ctx;
}
