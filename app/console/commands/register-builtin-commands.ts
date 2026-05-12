'use client';

// ── Built-in Command Registrations ───────────────────────────
// Phase 4E: Wires manifest-declared commands (shell.clear, claude.compact,
// system.refresh) to real handler closures provided by page.tsx.
//
// Call registerBuiltinCommands() once at render time with the real
// sendCommand/sendInput/killInstance/reload functions from page.tsx.

import { registerCommand } from './command-registry';

export interface BuiltinHandlers {
  sendCommand: (cmd: string, args?: Record<string, string>) => void;
  sendInput: (text: string) => void;
  killInstance: (id: string) => void;
  reload: () => void;
}

export function registerBuiltinCommands(h: BuiltinHandlers): void {
  // ── Shell ──
  registerCommand({ id: 'shell.clear', title: 'Clear Terminal', handler: () => h.sendCommand('clear') });
  registerCommand({ id: 'shell.kill', title: 'Kill Instance', handler: (instanceId?: string) => { if (instanceId) h.killInstance(instanceId); } });

  // ── Claude ──
  registerCommand({ id: 'claude.compact', title: 'Compact Conversation', category: 'Claude', handler: () => h.sendInput('/compact') });
  registerCommand({ id: 'claude.clearHistory', title: 'Clear History', category: 'Claude', handler: () => h.sendCommand('clear') });
  registerCommand({ id: 'claude.restart', title: 'Restart Session', category: 'Claude', handler: () => h.sendCommand('clear') });

  // ── Host ──
  registerCommand({ id: 'host.npmTest', title: 'npm test', category: 'Host', handler: () => h.sendInput('npm test') });
  registerCommand({ id: 'host.gitStatus', title: 'git status', category: 'Host', handler: () => h.sendInput('git status') });

  // ── System ──
  registerCommand({ id: 'system.refresh', title: 'Reload Page', category: 'System', handler: () => h.reload() });
}
