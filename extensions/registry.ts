// ─── Remote Agent Console — Adapter Registry ──────────────────────
// Central registry for all AgentAdapter implementations.
// Adapters register themselves and are looked up by ID or capability.

import type { AgentAdapter, AdapterCapabilities, RuntimeInfo, ExtensionManifest } from './types';

class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();
  /** Manifests loaded from sb-extension.json files. */
  private manifests = new Map<string, ExtensionManifest>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) {
      console.warn(`[AdapterRegistry] Overwriting adapter: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /** Register an adapter and associate it with a manifest. */
  registerFromManifest(adapter: AgentAdapter, manifest: ExtensionManifest): void {
    this.register(adapter);
    this.manifests.set(adapter.id, manifest);
  }

  unregister(id: string): boolean {
    this.manifests.delete(id);
    return this.adapters.delete(id);
  }

  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  /** Get the manifest for a registered adapter. */
  getManifest(id: string): ExtensionManifest | undefined {
    return this.manifests.get(id);
  }

  /** List all loaded manifests. */
  listManifests(): ExtensionManifest[] {
    return [...this.manifests.values()];
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

/** Get the most appropriate default adapter ID — first registered, or 'shell'. */
export function getDefaultAdapterId(): string {
  const list = adapterRegistry.list();
  return list[0]?.id || 'shell';
}

/** Resolve an adapter by ID, falling back to the first available adapter. */
export function resolveAdapter(adapterId?: string): AgentAdapter | undefined {
  if (adapterId) {
    const found = adapterRegistry.get(adapterId);
    if (found) return found;
  }
  return adapterRegistry.list()[0];
}

/** Resolve the first adapter matching a capability (e.g. terminal: true, structuredEvents: true). */
export function resolveAdapterByCapability<K extends keyof AdapterCapabilities>(
  key: K,
  value: AdapterCapabilities[K],
): AgentAdapter | undefined {
  const matches = adapterRegistry.findByCapability(key, value);
  return matches[0];
}

/** Get the first terminal-capable adapter ID, or undefined if none registered. */
export function getTerminalAdapterId(): string | undefined {
  const terminal = resolveAdapterByCapability('terminal', true);
  return terminal?.id;
}

/** Get the first structured-events-capable adapter ID, or undefined if none registered. */
export function getStructuredAdapterId(): string | undefined {
  const structured = resolveAdapterByCapability('structuredEvents', true);
  return structured?.id;
}
