// ─── Permission Gate ──────────────────────────────────────
// Evaluates whether a request to read / write / subscribe to
// a state entry is allowed.
//
// Rules:
//   public  → any authenticated peer
//   nodes   → any node that has completed identity handshake
//   owner   → only the node whose ID matches the entry's owner
//   role:X  → any peer whose roles array includes X
//   scope:X → any peer whose granted scopes include X
//
// The gate is evaluated at two points:
//   1. On write (local set())  — fast path, no network
//   2. On read (sync out)      — before pushing to a remote peer

import type { StateEntry, PermissionLevel, NodeIdentity } from './types';

export interface PermissionContext {
  /** The requesting peer's identity (undefined for local writes). */
  identity?: NodeIdentity;
  /** Roles granted to the requesting peer. */
  roles: string[];
  /** Named scopes the peer has been granted (plugin-defined). */
  scopes: string[];
}

export class PermissionGate {
  /**
   * Check whether `ctx` may read `entry`.
   * Returns null if allowed, or a reason string if denied.
   */
  canRead(entry: StateEntry, ctx: PermissionContext): string | null {
    return this.evaluate(entry.permissions.read, entry.owner, ctx);
  }

  /**
   * Check whether `ctx` may write `entry`.
   * Returns null if allowed, or a reason string if denied.
   */
  canWrite(entry: StateEntry, ctx: PermissionContext): string | null {
    return this.evaluate(entry.permissions.write, entry.owner, ctx);
  }

  private evaluate(
    levels: PermissionLevel | PermissionLevel[],
    owner: string,
    ctx: PermissionContext,
  ): string | null {
    const list = Array.isArray(levels) ? levels : [levels];
    for (const level of list) {
      if (this.matches(level, owner, ctx)) return null;
    }
    return `access denied by ${list.join(',')}`;
  }

  private matches(level: PermissionLevel, owner: string, ctx: PermissionContext): boolean {
    switch (level) {
      case 'public':
        return true;

      case 'nodes':
        return ctx.roles.length > 0;

      case 'owner':
        return ctx.identity?.nodeId === owner;

      default: {
        // role:admin  → ctx.roles.includes('admin')
        if (level.startsWith('role:')) {
          const role = level.slice(5);
          return ctx.roles.includes(role);
        }
        // scope:editor → ctx.scopes.includes('editor')
        if (level.startsWith('scope:')) {
          const scope = level.slice(6);
          return ctx.scopes.includes(scope);
        }
        return false;
      }
    }
  }
}
