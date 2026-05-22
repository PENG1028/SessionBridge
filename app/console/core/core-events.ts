'use client';

import { useEffect, useCallback, useRef } from 'react';
import type { CoreClient, CoreEvent } from './core-types';

// ─── Hook: Subscribe to a Core event ───────────────────────────
export function useCoreEvent(
  core: CoreClient,
  event: string,
  handler: (data: CoreEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrapper = (data: CoreEvent) => handlerRef.current(data);
    return core.on(event, wrapper);
  }, [core, event]);
}

// ─── Hook: Subscribe to multiple Core events ───────────────────
export function useCoreEvents(
  core: CoreClient,
  handlers: Record<string, (data: CoreEvent) => void>,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    for (const [event, handler] of Object.entries(handlersRef.current)) {
      unsubs.push(core.on(event, handler));
    }
    return () => unsubs.forEach(fn => fn());
  }, [core]);
}

// ─── Event name constants (matches SYSTEM_UI_API_MAP.md) ───────
export const CoreEvents = {
  // node
  NODE_HEALTH: 'node.health',
  NODE_CONNECTED: 'node.connected',
  NODE_DISCONNECTED: 'node.disconnected',

  // session
  SESSION_CREATED: 'session.created',
  SESSION_STOPPED: 'session.stopped',

  // plugin
  PLUGIN_REGISTERED: 'plugin.registered',
  PLUGIN_UNREGISTERED: 'plugin.unregistered',

  // config
  CONFIG_CHANGED: 'config.changed',

  // logs
  LOGS_EVENT: 'logs.event',
  AUDIT_EVENT: 'audit.event',

  // approval
  APPROVAL_REQUEST: 'approval.request',
  APPROVAL_RESPONSE: 'approval.response',

  // notify
  NOTIFY_EVENT: 'notify.event',

  // task
  TASK_EVENT: 'task.event',
} as const;
