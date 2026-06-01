'use client';

// ── Command Registry ──────────────────────────────────────────
// Central registry for all commands — both built-in and extension.
// Phase 4E: Replaces ad-hoc dispatch with ID-based lookup.
//
// Usage:
//   registerCommand({ id: 'shell.clear', title: 'Clear Terminal',
//     handler: () => sendCommand('clear') });
//   executeCommand('shell.clear');

export interface Command {
  id: string;
  title: string;
  category?: string;
  handler: (...args: any[]) => void;
}

const _commands = new Map<string, Command>();

export function registerCommand(cmd: Command): void {
  _commands.set(cmd.id, cmd);
}

export function getCommand(id: string): Command | undefined {
  return _commands.get(id);
}

export function executeCommand(id: string, ...args: any[]): void {
  const cmd = _commands.get(id);
  if (cmd) {
    cmd.handler(...args);
  } else {
    console.warn(`[commands] No handler registered for "${id}"`);
  }
}

export function getAllCommands(): Command[] {
  return Array.from(_commands.values());
}

export function unregisterCommand(id: string): void {
  _commands.delete(id);
}

export function clearCommands(): void {
  _commands.clear();
}
