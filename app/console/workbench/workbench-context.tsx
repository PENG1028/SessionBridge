'use client';

import { createContext, useContext, type ReactNode, type RefObject } from 'react';

// ── Types shared with page.tsx ─────────────────────────────

type Phase = 'idle' | 'running' | 'done' | 'error';

interface Block {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'unknown';
  semantic: string;
  toolName: string;
  detail: string;
  output: string;
  toolArgs: string;
  status: 'running' | 'done' | 'error';
  exitCode: number;
  content: string;
  expanded: boolean;
  rawData: string;
  isComplete?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  blocks: Block[];
  isPending: boolean;
  isCompactSummary?: boolean;
}

type Turn = {
  userMsg: Message;
  assistantMsgs: Message[];
};

interface ToolActivity {
  id: string;
  toolName: string;
  detail: string;
  semantic: string;
  status: 'running' | 'done' | 'error';
}

// ── Context value type ─────────────────────────────────────

export interface WorkbenchContextValue {
  // Connection
  wsUrl: string;
  token: string | undefined;

  // Logs
  logs: string[];

  // Messages / Chat
  messages: Message[];
  turns: Turn[];
  phase: Phase;
  setPhase: (p: Phase) => void;
  currentActivity: string | null;
  setCurrentActivity: (a: string | null) => void;
  connStatus: { status: string };
  isRestoring: boolean;
  historyLoading: boolean;

  // Input
  inputValue: string;
  setInputValue: (v: string) => void;
  handleSubmit: (overrideCmd?: string) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;

  // Tool activities
  toolActivities: Map<string, ToolActivity>;
  setToolActivities: React.Dispatch<React.SetStateAction<Map<string, ToolActivity>>>;
  expandedToolOutputs: Set<string>;
  setExpandedToolOutputs: React.Dispatch<React.SetStateAction<Set<string>>>;

  // File suggestions
  showFileSuggest: boolean;
  fileSuggestions: unknown[];
  handleFileSuggestionClick: (item: unknown) => void;

  // Commands
  showCommands: boolean;
  setShowCommands: React.Dispatch<React.SetStateAction<boolean>>;
  handleCommandClick: (cmd: string) => void;
  cmdPanelRef: RefObject<HTMLDivElement | null>;

  // Actions
  sendCommand: (cmd: string, args?: Record<string, string>, sessionId?: string) => void;
  sendInput: (text: string, sessionId?: string) => void;
  handleInterrupt: () => void;
  setForkTarget: (v: number | null) => void;
  setForkPrompt: (v: string) => void;

  // Instance management (Phase 4F: explicit instance creation, no auto-bind)
  instances: any[];
  createInstance: (dir: string, label?: string, adapterId?: string) => Promise<any>;
  bindCurrentTabInstance: (instanceId: string, surface?: any) => void;
  ensureSurfacePublished: (instanceId: string) => boolean;
  activeInstanceId: string | null;
  projectCwd: string;
  activateInstance: (id: string) => void;

  // External session
  activeExternalSession: string | null;
  clearExternalSession: () => void;

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
