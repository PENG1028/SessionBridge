// ─── Cross-Adapter Communication EventBus ───────────────────────
// Typed event relay for adapter-to-adapter and adapter-to-core messaging.
// Instantiatable (not hardcoded singleton) — consumers create one per scope.

export type EventHandler = (data: Record<string, unknown> & { event?: string }) => void;

export interface EventMap {
  'instance.created': { instanceId: string; label: string };
  'instance.destroyed': { instanceId: string };
  'instance.status': { instanceId: string; status: string; previousStatus?: string };
  'agent.connected': { instanceId: string; label: string; version: string };
  'agent.disconnected': { instanceId: string; label: string };
  'config.updated': { key: string; value: unknown; source: string };
  'task.progress': { taskId: string; percent: number; message: string };
  'audit.log': { action: string; detail: Record<string, unknown>; timestamp: number };
}

export class RelayEventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private maxListeners: number;

  constructor(maxListeners = 50) {
    this.maxListeners = maxListeners;
  }

  on<K extends keyof EventMap>(type: K | '*', handler: EventHandler): () => void {
    let set = this.listeners.get(type as string);
    if (!set) {
      set = new Set();
      this.listeners.set(type as string, set);
    }
    set.add(handler);
    if (set.size > this.maxListeners) {
      console.warn(
        `RelayEventBus: listener count for event "${type as string}" exceeds limit of ${this.maxListeners}`,
      );
    }
    return () => {
      this.off(type as string, handler);
    };
  }

  emit<K extends keyof EventMap>(type: K, data: EventMap[K]): void {
    const specific = this.listeners.get(type as string);
    if (specific) {
      for (const handler of specific) {
        handler(data as Record<string, unknown>);
      }
    }
    const wildcard = this.listeners.get('*');
    if (wildcard && wildcard.size > 0) {
      const wData: Record<string, unknown> & { event: string } = { event: type as string, ...(data as Record<string, unknown>) };
      for (const handler of wildcard) {
        handler(wData);
      }
    }
  }

  off(type: string, handler: EventHandler): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(handler);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
