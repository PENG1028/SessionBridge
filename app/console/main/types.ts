// ─── Shared types for console components ──────────────────────

export type Phase = 'idle' | 'running' | 'done' | 'error';

export interface Block {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'unknown' | 'plan';
  semantic: string;
  toolName: string;
  detail: string;
  output: string;
  toolArgs: string;
  status: 'running' | 'done' | 'error';
  exitCode: number;
  content: string;
  rawData: string;
  isComplete?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  blocks: Block[];
  isPending: boolean;
  isCompactSummary?: boolean;
  isSystem?: boolean;
}

export type Turn = {
  userMsg: Message;
  assistantMsgs: Message[];
};
