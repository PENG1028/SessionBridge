'use client';

// ── Unified Command Dispatch ──────────────────────────────────
// Phase 4L: Single entry point for all command execution across
// all action surfaces (context menu, command palette, header,
// status bar, contextControls, quick actions, keybindings).
//
// Every surface that needs to execute a command uses this instead
// of replicating "action registry → fallback" logic.
//
// Dispatch chain:
//   1. Action registry (getAction / runAction)
//   2. Legacy command registry (getCommand / executeCommand)
//   3. sendCommand fallback (adapter/runtime commands)

import { getAction } from './action-registry';
import { getCommand } from '../commands/command-registry';
import type { ActionRunContext } from './action-types';

export interface WorkbenchCommandRequest {
  /** Command ID to execute */
  command: string;
  /** Extra arguments passed to the command */
  args?: Record<string, unknown>;
  /** Target payload (from context menu, drag-drop, etc.) */
  target?: Record<string, unknown>;
}

/**
 * Execute a command through the unified dispatch chain.
 *
 * 1. Action registry (getAction → run with merged ctx)
 * 2. Legacy command registry (getCommand → handler)
 * 3. sendCommand fallback with { args, target } payload
 *
 * In dev mode, unknown commands produce a console.warn.
 */
export function runWorkbenchCommand(
  request: WorkbenchCommandRequest,
  ctx: ActionRunContext,
): void {
  const { command, args, target } = request;

  // 1. Action registry
  const action = getAction(command);
  if (action) {
    action.run({
      ...ctx,
      ...(args ? { args } : {}),
      ...(target ? { target } : {}),
    } as ActionRunContext & { args?: Record<string, unknown>; target?: Record<string, unknown> } as any);
    return;
  }

  // 2. Legacy command registry
  const cmd = getCommand(command);
  if (cmd) {
    cmd.handler(args, target);
    return;
  }

  // 3. sendCommand fallback (adapter/runtime)
  if (ctx.sendCommand) {
    const payload = {
      ...(args || {}),
      ...(target ? { target } : {}),
    };
    ctx.sendCommand(command, payload);
    return;
  }

  if (process.env.NODE_ENV === 'development') {
    console.warn(`[dispatch] No handler for command "${command}": not in action registry, command registry, or sendCommand`);
  }
}
