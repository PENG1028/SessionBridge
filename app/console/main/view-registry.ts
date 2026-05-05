'use client';

import type { ComponentType } from 'react';
import { Sparkles, Terminal as TerminalIcon, Cpu } from 'lucide-react';
import { ClaudeChatView } from './claude-chat-view';
import { TerminalView } from './terminal-view';
import type { ClaudeChatViewProps } from './claude-chat-view';

/** Maps adapter viewId to the React component that renders it. */
export const viewRegistry: Record<string, ComponentType<any>> = {
  'claude-chat': ClaudeChatView,
  'terminal': TerminalView,
};

/** Map adapter ID to its view component ID. */
export const adapterToViewId: Record<string, string> = {
  'claude-code': 'claude-chat',
  'shell': 'terminal',
};

/** Display metadata for each adapter. */
export interface AdapterMeta {
  icon: ComponentType<{ className?: string }>;
  label: string;
  emoji: string;
}

export const adapterMeta: Record<string, AdapterMeta> = {
  'claude-code': { icon: Sparkles, label: 'Claude Code', emoji: '💬' },
  'shell': { icon: TerminalIcon, label: 'Terminal', emoji: '⌨' },
};

const fallbackMeta: AdapterMeta = { icon: Cpu, label: 'Unknown', emoji: '▶' };
export function getAdapterMeta(adapterId?: string): AdapterMeta {
  return adapterMeta[adapterId || 'shell'] || fallbackMeta;
}

export type { ClaudeChatViewProps };
