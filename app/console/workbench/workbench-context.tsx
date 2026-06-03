'use client';

import { createContext, useContext, type ReactNode, type RefObject } from 'react';

// ── Context value type (remaining after Session/Input/ToolActivity split) ──

export interface WorkbenchContextValue {
  // Connection
  wsUrl: string;
  token: string | undefined;

  // Logs
  logs: string[];

  // Instance management (Phase 4F: explicit instance creation, no auto-bind)
  instances: any[];
  createInstance: (dir: string, label?: string, adapterId?: string) => Promise<any>;
  bindCurrentTabInstance: (instanceId: string, surface?: any) => void;
  activeInstanceId: string | null;
  projectCwd: string;
  activeNodeWsUrl: string;
  activateInstance: (id: string) => void;

  // External session
  activeExternalSession: string | null;
  clearExternalSession: () => void;

  // Navigation
  onNavigatePath?: (path: string) => void;

  // Live working directory — single source of truth for all components.
  absoluteCwd: string;
  onCwdChange: (path: string) => void;

  // Refs
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  actionEndRef: RefObject<HTMLDivElement | null>;
}

// ── Context ────────────────────────────────────────────────

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────

export function WorkbenchProvider({
  value,
  children,
}: {
  value: WorkbenchContextValue;
  children: ReactNode;
}) {
  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────

export function useWorkbench(): WorkbenchContextValue {
  const ctx = useContext(WorkbenchContext);
  if (!ctx) throw new Error('useWorkbench must be used within a WorkbenchProvider');
  return ctx;
}
