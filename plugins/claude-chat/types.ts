'use client';

// ── Shared types for claude-chat plugin components ──
// Mirrors the runtime types from session/lib without importing app/console/.

export interface Block {
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
  cost?: string;
  tokens?: any;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  blocks: Block[];
  isPending: boolean;
  isCompactSummary?: boolean;
}

export type Turn = {
  userMsg: Message;
  assistantMsgs: Message[];
};

export type Phase = 'idle' | 'running' | 'done' | 'error';

export interface ToolActivity {
  id: string;
  toolName: string;
  detail: string;
  semantic: string;
  status: 'running' | 'done' | 'error';
}

export interface TokenStats {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}
