'use client';

import { createContext, useContext, type ReactNode } from 'react';

// ── Context value type ─────────────────────────────────────

interface ToolActivity {
  id: string;
  toolName: string;
  detail: string;
  semantic: string;
  status: 'running' | 'done' | 'error';
}

export interface ToolActivityContextValue {
  toolActivities: Map<string, ToolActivity>;
  setToolActivities: React.Dispatch<React.SetStateAction<Map<string, ToolActivity>>>;
  expandedToolOutputs: Set<string>;
  setExpandedToolOutputs: React.Dispatch<React.SetStateAction<Set<string>>>;
}

// ── Context ────────────────────────────────────────────────

const ToolActivityContext = createContext<ToolActivityContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────

export function ToolActivityProvider({
  value,
  children,
}: {
  value: ToolActivityContextValue;
  children: ReactNode;
}) {
  return (
    <ToolActivityContext.Provider value={value}>
      {children}
    </ToolActivityContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────

export function useToolActivityContext(): ToolActivityContextValue {
  const ctx = useContext(ToolActivityContext);
  if (!ctx) throw new Error('useToolActivityContext must be used within a ToolActivityProvider');
  return ctx;
}
