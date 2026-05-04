'use client';

import type { ComponentType } from 'react';
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

export type { ClaudeChatViewProps };
