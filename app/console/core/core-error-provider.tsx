'use client';

// ─── CoreErrorProvider — collects all core.call() errors globally ──
// Wraps the app so any component using useCoreCall can report errors
// up to a central place. The header can then show a dismissible banner.

import { useState, useCallback, type ReactNode } from 'react';
import { CoreErrorContext } from './use-core-call';
import type { CoreErrorEntry } from './use-core-call';
import type { CoreErrorCategory } from './core-error';

export function CoreErrorProvider({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<CoreErrorEntry[]>([]);
  const [latestByCategory, setLatestByCategory] = useState<Partial<Record<CoreErrorCategory, CoreErrorEntry>>>({});

  const reportError = useCallback((entry: CoreErrorEntry) => {
    setErrors(prev => [entry, ...prev].slice(0, 50)); // keep last 50
    setLatestByCategory(prev => ({ ...prev, [entry.error.category]: entry }));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setLatestByCategory({});
  }, []);

  const clearCategory = useCallback((cat: CoreErrorCategory) => {
    setLatestByCategory(prev => {
      const next = { ...prev };
      delete next[cat];
      return next;
    });
    setErrors(prev => prev.filter(e => e.error.category !== cat));
  }, []);

  return (
    <CoreErrorContext.Provider value={{ errors, latestByCategory, reportError, clearErrors, clearCategory }}>
      {children}
    </CoreErrorContext.Provider>
  );
}
