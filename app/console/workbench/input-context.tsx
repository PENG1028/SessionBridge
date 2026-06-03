'use client';

import { createContext, useContext, type ReactNode, type RefObject } from 'react';

// ── Context value type ─────────────────────────────────────

export interface InputContextValue {
  inputValue: string;
  setInputValue: (v: string) => void;
  handleSubmit: (overrideCmd?: string) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  showFileSuggest: boolean;
  fileSuggestions: unknown[];
  handleFileSuggestionClick: (item: unknown) => void;
  showCommands: boolean;
  setShowCommands: React.Dispatch<React.SetStateAction<boolean>>;
  handleCommandClick: (cmd: string) => void;
  cmdPanelRef: RefObject<HTMLDivElement | null>;
}

// ── Context ────────────────────────────────────────────────

const InputContext = createContext<InputContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────

export function InputProvider({
  value,
  children,
}: {
  value: InputContextValue;
  children: ReactNode;
}) {
  return (
    <InputContext.Provider value={value}>
      {children}
    </InputContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────

export function useInputContext(): InputContextValue {
  const ctx = useContext(InputContext);
  if (!ctx) throw new Error('useInputContext must be used within an InputProvider');
  return ctx;
}
