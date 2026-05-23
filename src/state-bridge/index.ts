// ─── StateBus — Cross-Node State Middleware ──────────────
// Central nervous system of the SessionBridge runtime.
//
// Every piece of shareable state is an entry here.  Local code
// reads/writes via get/set.  Remote peers sync through the
// SyncEngine.
//
// Plugin authors interact with StateBus through two paths:
//   1.  Direct API for imperative read/write/subscribe
//   2.  Plugin hooks for lifecycle interception (declared in
//       plugin.yaml, activated at plugin load time)

import type {
  StateEntry,
  StateChange,
  StateChangeKind,
  StateKey,
  ChangeCallback,
  SyncMode,
  MergeStrategy,
  StatePermissions,
  StatePluginRegistrar,
  StatePluginHooks,
  StateDeclaration,
} from './types';
import { parseStateKey, stateKey } from './types';
import { SubscriptionManager } from './subscription';
import { SyncEngine, type SyncTransport } from './sync-engine';
import { StateStorage } from './storage';

// ─── Default constants ───────────────────────────────────

const DEFAULT_SYNC: { mode: SyncMode; merge: MergeStrategy } = {
  mode: 'batch',
  merge: 'last-writer-wins',
};

const DEFAULT_PERMISSIONS: StatePermissions = {
  read: 'nodes',
  write: 'owner',
};

// ─── SetOptions — additional settings for a set() call ─────

export interface SetOptions {
  /** Override sync behaviour for this write. */
  sync?: { mode?: SyncMode; merge?: MergeStrategy };
  /** Override access control for this write. */
  permissions?: Partial<StatePermissions>;
  /** Plugin-defined metadata. */
  metadata?: Record<string, unknown>;
  /** Auto-expire after this many ms. */
  ttl?: number;
  /** Skip persistence even if namespace defaults to persist. */
  noPersist?: boolean;
}

// ─── StateBus ─────────────────────────────────────────────

export class StateBus {
  private entries = new Map<StateKey, StateEntry>();
  private subs = new SubscriptionManager();
  private plugins = new Map<string, StatePluginRegistrar>();
  private pluginHooks = new Map<string, StatePluginHooks>();

  /** Current node identity, set at startup. */
  private nodeId = '';
  private nodeRoles: string[] = ['leaf'];
  private nextVersion = 1;

  /** Persistence. */
  private storage: StateStorage;

  /** Sync engine — assembled after a relay handshake. */
  private syncEngine: SyncEngine;

  constructor(workDir: string) {
    this.storage = new StateStorage(workDir);

    this.syncEngine = new SyncEngine(
      (key) => this.entries.get(key),
      (pattern) => this.listForPattern(pattern),
      (change) => this.applyRemoteChange(change),
    );

    this.syncEngine.onEvent((event) => {
      if (event.kind === 'node.connected') this.notifyPlugins('onNodeConnect', event.nodeId!, { pluginId: '', bus: this, namespace: '' });
      if (event.kind === 'node.disconnected') this.notifyPlugins('onNodeDisconnect', event.nodeId!, { pluginId: '', bus: this, namespace: '' });
    });

    // Restore persisted entries
    const restored = this.storage.restore();
    for (const entry of restored) {
      this.entries.set(entry.key, entry);
    }
  }

  // ─── Identity ───────────────────────────────────────────

  setNodeId(id: string, roles?: string[]): void {
    this.nodeId = id;
    if (roles) this.nodeRoles = roles;
  }

  // ─── CRUD — Plugin API ─────────────────────────────────

  /**
   * Read a state entry.
   * Returns undefined if the key does not exist.
   */
  get<T = unknown>(key: StateKey): T | undefined {
    return this.entries.get(key)?.value as T | undefined;
  }

  /**
   * Read the full entry (value + metadata + permissions).
   * Plugin authors use this when they need to inspect metadata
   * or permissions alongside the value.
   */
  getEntry(key: StateKey): StateEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * Write a state entry.  If the key already exists, the value
   * is merged according to the sync.merge strategy and the
   * version is bumped.
   *
   * This method:
   *   1.  Calls plugin onBeforeChange hooks (can reject/modify)
   *   2.  Updates the local store
   *   3.  Notifies local subscribers
   *   4.  Pushes to sync engine (→ remote peers)
   *   5.  Calls plugin onAfterChange hooks
   *   6.  Triggers persistence
   */
  set<T = unknown>(
    key: StateKey,
    value: T,
    options?: SetOptions,
  ): void {
    const existing = this.entries.get(key);
    const parsed = parseStateKey(key);
    const owner = parsed.kind === 'local' ? '' : this.nodeId;

    // Build new entry
    const now = Date.now();
    const entry: StateEntry<T> = {
      key,
      value,
      version: existing ? existing.version + 1 : this.nextVersion++,
      owner: existing?.owner || owner,
      updatedAt: now,
      sync: {
        mode: options?.sync?.mode || existing?.sync.mode || DEFAULT_SYNC.mode,
        merge: options?.sync?.merge || existing?.sync.merge || DEFAULT_SYNC.merge,
      },
      permissions: {
        read: options?.permissions?.read || existing?.permissions.read || DEFAULT_PERMISSIONS.read,
        write: options?.permissions?.write || existing?.permissions.write || DEFAULT_PERMISSIONS.write,
      },
      metadata: options?.metadata || existing?.metadata,
      ttl: options?.ttl ?? existing?.ttl,
      persist: options?.noPersist ? false : (existing?.persist ?? this.namespaceDefaultPersist(parsed.kind)),
    };

    // Schedule auto-expiry
    if (entry.ttl) {
      setTimeout(() => this.delete(key, 'expire'), entry.ttl);
    }

    // Build change event
    const change: StateChange = {
      kind: 'set' as StateChangeKind,
      key,
      value,
      previous: existing?.value,
      version: entry.version,
      owner: entry.owner,
      timestamp: now,
      metadata: entry.metadata,
    };

    // Run plugin hooks (can block or modify)
    const hookResult = this.runBeforeChangeHooks(change);
    if (hookResult === null) return; // blocked by plugin
    const finalChange = hookResult || change;

    // Store
    this.entries.set(key, entry as StateEntry);

    // Notify local subscribers
    this.notifySubscribers(finalChange);

    // Sync to remote peers
    this.syncEngine.onLocalChange(finalChange);

    // After-change hooks
    this.runAfterChangeHooks(finalChange);

    // Persist
    if (entry.persist) this.storage.save(() => [...this.entries.values()]);
  }

  /**
   * Delete a state entry.
   */
  delete(key: StateKey, kind: StateChangeKind = 'delete'): void {
    const existing = this.entries.get(key);
    if (!existing) return;

    this.entries.delete(key);

    const change: StateChange = {
      kind,
      key,
      value: undefined,
      previous: existing.value,
      version: existing.version,
      owner: existing.owner,
      timestamp: Date.now(),
    };

    this.notifySubscribers(change);
    this.syncEngine.onLocalChange(change);
    this.runAfterChangeHooks(change);

    if (existing.persist) this.storage.save(() => [...this.entries.values()]);
  }

  /**
   * List all entries matching a pattern.
   * Plugin-facing: use this to discover what's available.
   */
  list(pattern: string): StateEntry[] {
    return this.listForPattern(pattern);
  }

  // ─── Subscription — Plugin API ─────────────────────────

  /**
   * Subscribe to state changes matching a glob pattern.
   *
   * Examples:
   *   subscribe('node:abc123/terminals/foo', cb)   // node-scoped
   *   subscribe('plugin:editor/star/star', cb)      // plugin-scoped recursive
   *   subscribe('global/network/star', cb)          // global single-segment
   *
   * Returns an unsubscribe function.
   */
  subscribe(pattern: string, callback: ChangeCallback, withCurrent = false): () => void {
    const unsub = this.subs.subscribe(pattern, callback, withCurrent);

    // If withCurrent, immediately fire for matching entries
    if (withCurrent) {
      for (const [key, entry] of this.entries) {
        const subs = this.subs.match(key);
        for (const s of subs) {
          if (s.callback === callback) {
            s.callback({
              kind: 'set',
              key: entry.key,
              value: entry.value,
              previous: undefined,
              version: entry.version,
              owner: entry.owner,
              timestamp: entry.updatedAt,
              metadata: entry.metadata,
            });
          }
        }
      }
    }

    return unsub;
  }

  // ─── Plugin Registration ───────────────────────────────

  /**
   * Register a plugin's state namespace.
   * Called by the extension host when activating a plugin.
   *
   * Plugin authors declare state contributions in plugin.yaml;
   * the extension host calls this method at activation time.
   */
  registerPlugin(plugin: StatePluginRegistrar): void {
    this.plugins.set(plugin.id, plugin);
    if (plugin.hooks) {
      this.pluginHooks.set(plugin.id, plugin.hooks);
    }

    // Create namespace default entries if declared
    for (const decl of plugin.provides) {
      this.ensureNamespace(decl);
    }

    // Call onInit hook
    const hooks = plugin.hooks;
    if (hooks?.onInit) {
      hooks.onInit({
        pluginId: plugin.id,
        bus: this,
        namespace: plugin.namespace,
      });
    }
  }

  /**
   * Unregister a plugin and optionally clean up its entries.
   */
  unregisterPlugin(pluginId: string, cleanup = false): void {
    this.pluginHooks.delete(pluginId);
    this.plugins.delete(pluginId);

    if (cleanup) {
      const prefix = `state://plugin:${pluginId}/`;
      for (const key of this.entries.keys()) {
        if (key.startsWith(prefix)) {
          this.delete(key);
        }
      }
    }

    this.storage.save(() => [...this.entries.values()]);
  }

  // ─── Sync Engine Integration ───────────────────────────

  /**
   * Connect to a remote peer via a transport.
   * Called by the relay when a remote node connection is established.
   */
  connectPeer(transport: SyncTransport): void {
    this.syncEngine.connect(transport);
  }

  /**
   * Disconnect a remote peer.
   */
  disconnectPeer(peerId: string): void {
    this.syncEngine.disconnect(peerId);
  }

  /**
   * Handle incoming snapshot from a peer.
   */
  receiveSnapshot(entries: StateEntry[], fromPeer: string): void {
    this.syncEngine.receiveSnapshot(entries, fromPeer);
  }

  /**
   * Handle incoming delta from a peer.
   */
  receiveDelta(change: StateChange, fromPeer: string): void {
    this.syncEngine.receiveDelta(change, fromPeer);
  }

  /**
   * Handle incoming key request from a peer.
   */
  receiveRequest(keys: StateKey[], fromPeer: string): void {
    this.syncEngine.receiveRequest(keys, fromPeer);
  }

  // ─── Persistence ───────────────────────────────────────

  /** Force an immediate flush to disk. */
  flush(): void {
    this.storage.flush(() => [...this.entries.values()]);
  }

  // ─── Internal ──────────────────────────────────────────

  private listForPattern(pattern: string): StateEntry[] {
    const results: StateEntry[] = [];
    for (const entry of this.entries.values()) {
      if (this.subs.test(pattern, entry.key)) {
        results.push(entry);
      }
    }
    return results;
  }

  private notifySubscribers(change: StateChange): void {
    const subs = this.subs.match(change.key);
    for (const sub of subs) {
      try { sub.callback(change); } catch {}
    }
  }

  private namespaceDefaultPersist(kind: string): boolean {
    switch (kind) {
      case 'global': return true;
      case 'node': return true;
      case 'plugin': return true;
      case 'local': return false;
      default: return true;
    }
  }

  private ensureNamespace(decl: StateDeclaration): void {
    // Create a namespace marker entry if it doesn't exist
    const marker = stateKey(decl.namespace, '_namespace');
    if (!this.entries.has(marker)) {
      this.entries.set(marker, {
        key: marker,
        value: { label: decl.label || decl.namespace, provides: true },
        version: this.nextVersion++,
        owner: this.nodeId,
        updatedAt: Date.now(),
        sync: { mode: decl.sync?.mode || 'on-demand', merge: decl.sync?.merge || 'last-writer-wins' },
        permissions: decl.permissions || { read: 'nodes', write: 'owner' },
        persist: decl.persist !== false,
      });
    }
  }

  private runBeforeChangeHooks(change: StateChange): StateChange | null {
    for (const [id, hooks] of this.pluginHooks) {
      if (hooks.onBeforeChange) {
        const result = hooks.onBeforeChange(change, {
          pluginId: id,
          bus: this,
          namespace: this.plugins.get(id)?.namespace || '',
        });
        if (result === null) return null; // blocked
      }
    }
    return change;
  }

  private runAfterChangeHooks(change: StateChange): void {
    for (const [id, hooks] of this.pluginHooks) {
      try {
        hooks.onAfterChange?.(change, {
          pluginId: id,
          bus: this,
          namespace: this.plugins.get(id)?.namespace || '',
        });
      } catch {}
    }
  }

  private notifyPlugins(
    hookName: 'onNodeConnect' | 'onNodeDisconnect',
    nodeId: string,
    ctx: { pluginId: string; bus: StateBus; namespace: string },
  ): void {
    for (const [id, hooks] of this.pluginHooks) {
      try {
        if (hookName === 'onNodeConnect') {
          hooks.onNodeConnect?.(nodeId, { nodeId, label: '', roles: [], connectedAt: Date.now() }, { ...ctx, pluginId: id });
        } else {
          hooks.onNodeDisconnect?.(nodeId, { ...ctx, pluginId: id });
        }
      } catch {}
    }
  }

  private applyRemoteChange(change: StateChange): boolean {
    if (change.kind === 'delete' || change.kind === 'expire') {
      this.entries.delete(change.key);
      this.notifySubscribers(change);
      return true;
    }

    const existing = this.entries.get(change.key);
    const entry: StateEntry = {
      key: change.key,
      value: change.value,
      version: change.version,
      owner: change.owner,
      updatedAt: change.timestamp,
      sync: existing?.sync || DEFAULT_SYNC,
      permissions: existing?.permissions || DEFAULT_PERMISSIONS,
      metadata: change.metadata || existing?.metadata,
      persist: existing?.persist ?? true,
    } as StateEntry;

    this.entries.set(change.key, entry);
    this.notifySubscribers(change);
    if (entry.persist) this.storage.save(() => [...this.entries.values()]);
    return true;
  }
}

// ─── Singleton ───────────────────────────────────────────
// The relay creates ONE StateBus at startup.  Plugins and
// internal code import this singleton.

let _instance: StateBus | null = null;

export function createStateBus(workDir: string): StateBus {
  if (_instance) throw new Error('StateBus already created. Use getStateBus().');
  _instance = new StateBus(workDir);
  return _instance;
}

export function getStateBus(): StateBus {
  if (!_instance) throw new Error('StateBus not yet created. Call createStateBus() first.');
  return _instance;
}
