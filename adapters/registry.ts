// ─── Remote Agent Console — Adapter Registry ──────────────────────
// Central registry for all AgentAdapter implementations.
// Adapters register themselves and are looked up by ID or capability.

import type { AgentAdapter, AdapterCapabilities, RuntimeInfo } from './types';

class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) {
      console.warn(`[AdapterRegistry] Overwriting adapter: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  unregister(id: string): boolean {
    return this.adapters.delete(id);
  }

  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  /** Find adapters that can run on the given runtime */
  async detectForRuntime(runtime: RuntimeInfo): Promise<AgentAdapter[]> {
    const results = await Promise.all(
      this.list().map(async (adapter) => {
        try {
          const ok = await adapter.detect(runtime);
          return ok ? adapter : null;
        } catch {
          return null;
        }
      })
    );
    return results.filter((a): a is AgentAdapter => a !== null);
  }

  /** Find adapters matching specific capabilities */
  findByCapability<K extends keyof AdapterCapabilities>(
    capability: K,
    value: AdapterCapabilities[K]
  ): AgentAdapter[] {
    return this.list().filter((a) => a.getCapabilities()[capability] === value);
  }

  /** Get the default adapter for a runtime (first detected) */
  async getDefaultForRuntime(runtime: RuntimeInfo): Promise<AgentAdapter | undefined> {
    const detected = await this.detectForRuntime(runtime);
    return detected[0];
  }
}

/** Global singleton registry */
export const adapterRegistry = new AdapterRegistry();

/** Convenience function: register an adapter */
export function registerAdapter(adapter: AgentAdapter): void {
  adapterRegistry.register(adapter);
}
