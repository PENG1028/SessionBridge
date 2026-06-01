'use client';

// ─── Capability Guard ─────────────────────────────────────────────
// Permission check layer. Plugins should use this instead of calling
// core.call() directly. Checks getGrant() before each capability call.
//
// Usage:
//   import { guardCall } from '@/lib/capability-guard';
//   const result = await guardCall(core, 'terminal', 'process.spawn', params);

import type { CoreClient } from '../console/core/core-types';
import { getGrant } from './app-registry/app-registry';
import { CoreError } from '../console/core/core-error';

/**
 * Wraps core.call() with a permission check.
 * Throws CoreError('forbidden') if the app's grant is 'deny'.
 * If grant is 'ask', allows the call but marks it for approval UI.
 *
 * @param core   The CoreClient instance
 * @param appId  The plugin's ID (from plugin.yaml)
 * @param method The Core capability method name
 * @param params Optional parameters
 */
export async function guardCall<T = unknown>(
  core: CoreClient,
  appId: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const grant = getGrant(appId, method);

  if (grant === 'deny') {
    throw new CoreError(
      `Capability "${method}" is denied for app "${appId}"`,
      'forbidden',
    );
  }

  // 'ask' — allow the call, Core handles the approval flow
  // 'allow' — proceed normally
  return core.call<T>(method, params);
}

/**
 * Check if a capability is callable (not denied).
 * Returns false only if grant is 'deny'.
 */
export function canCall(appId: string, method: string): boolean {
  return getGrant(appId, method) !== 'deny';
}

/**
 * Returns the grant mode for a capability.
 * For use in UI to show/hide buttons.
 */
export function getGrantMode(appId: string, method: string): 'allow' | 'deny' | 'ask' {
  return getGrant(appId, method);
}
