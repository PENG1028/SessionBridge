// ─── StateBridge Core Types ──────────────────────────────────
// Cross-node state synchronization layer for SessionBridge.
//
// Design principle: every piece of shareable state lives under a
// namespaced key.  The StateBridge owner (the relay) is the single
// source of truth for its own node's state.  Remote peers read
// through the sync engine, not through ad-hoc message passing.
//
// Plugin authors extend StateBridge by declaring state namespaces
// in their plugin.yaml manifest.

// ─── Key ─────────────────────────────────────────────────
// state://<namespace>/<path>
//
// Namespace kinds:
//   global/     — cluster-wide (node list, topology, registry)
//   node:<id>/  — owned by one specific node
//   plugin:<id>/— owned by a plugin instance
//   local/      — never leaves the device (UI theme, prefs)
//
// Examples:
//   state://global/network/nodes
//   state://node:inst_26/terminals/list
//   state://node:inst_26/tabs/active
//   state://plugin:editor/buffers
//   state://local/ui/theme

export type StateKey = string & { __stateKey: never };

export function stateKey(namespace: string, path: string): StateKey {
  // Strip trailing/leading slashes, normalize
  const ns = namespace.replace(/^state:\/+|\/+$/g, '');
  const p = path.replace(/^\/+|\/+$/g, '');
  return `state://${ns}/${p}` as StateKey;
}

export function parseStateKey(key: StateKey): {
  namespace: string;
  path: string;
  kind: 'global' | 'node' | 'plugin' | 'local';
  owner?: string;
} {
  const rest = key.replace(/^state:\/\//, '');
  const firstSlash = rest.indexOf('/');
  const namespace = firstSlash >= 0 ? rest.slice(0, firstSlash) : rest;
  const path = firstSlash >= 0 ? rest.slice(firstSlash + 1) : '';
  const colon = namespace.indexOf(':');
  const kind = colon >= 0 ? namespace.slice(0, colon) : namespace;
  const owner = colon >= 0 ? namespace.slice(colon + 1) : undefined;
  return { namespace, path, kind: kind as any, owner };
}

// ─── Permission ──────────────────────────────────────────

/** Who can read/write a state entry. */
export type PermissionLevel =
  | 'public'                             // any connected peer
  | 'nodes'                              // any authenticated node
  | 'owner'                              // only the owning node
  | `role:${string}`                     // nodes with a specific role
  | `scope:${string}`                    // named scope (plugin-defined groups)
  | (string & {});                       // future: custom

export interface StatePermissions {
  read: PermissionLevel | PermissionLevel[];
  write: PermissionLevel | PermissionLevel[];
}

// ─── Sync behaviour ──────────────────────────────────────

export type SyncMode =
  | 'auto'              // push changes immediately on every set()
  | 'batch'             // coalesce within a tick, then push
  | 'on-demand'         // only send when peer explicitly requests
  | 'local-only';       // never leaves this device

export type MergeStrategy =
  | 'last-writer-wins'  // default: highest version wins
  | 'keep-both'         // keep divergent copies (peer-aware)
  | 'custom'            // plugin provides merge function
  | (string & {});

// ─── State Entry ─────────────────────────────────────────

export interface StateEntry<T = unknown> {
  /** Fully qualified key: state://namespace/path */
  key: StateKey;

  /** The actual payload. Plugin-specific shape. */
  value: T;

  /**
   * Monotonic version number.  Starts at 1 when the entry is
   * first created and increments on every set().  Used by the
   * sync engine to compute diffs.
   */
  version: number;

  /** Node ID that owns this entry. */
  owner: string;

  /** Unix ms timestamp of last modification. */
  updatedAt: number;

  /** Sync behaviour — plugin can override at declaration time. */
  sync: {
    mode: SyncMode;
    merge: MergeStrategy;
  };

  /** Access control. Default: { read: 'nodes', write: 'owner' } */
  permissions: StatePermissions;

  /**
   * Plugin-specific metadata.  The bridge never inspects these;
   * they are forwarded verbatim to subscribers and peers.
   *
   * Use cases:
   *   - Hidden / internal-only fields
   *   - Display hints (icon, label, order)
   *   - UI state (folded, expanded, selected)
   *   - Encryption metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * If set, the entry is automatically deleted after ttl ms
   * from its last update.  Used for ephemeral state like
   * cursor positions, typing indicators, etc.
   */
  ttl?: number;

  /**
   * Whether the entry survives relay restart via disk snapshot.
   * Default is inferred from namespace:
   *   global → true, node:* → true, plugin:* → plugin opt-in, local → false
   */
  persist?: boolean;
}

// ─── Change Events ───────────────────────────────────────

export type StateChangeKind = 'set' | 'delete' | 'expire' | 'merge';

export interface StateChange<T = unknown> {
  kind: StateChangeKind;
  key: StateKey;
  value: T | undefined;       // undefined on delete/expire
  previous: T | undefined;
  version: number;
  owner: string;
  timestamp: number;
  /** Set by the sync engine when the change originated from a remote peer. */
  fromPeer?: string;
  metadata?: Record<string, unknown>;
}

export type ChangeCallback = (change: StateChange) => void;

// ─── Subscription ────────────────────────────────────────

export interface Subscription {
  /** Glob-style pattern.  Supports * (single segment) and ** (recursive). */
  pattern: string;
  callback: ChangeCallback;
  /**
   * If true, the subscriber immediately receives the current value
   * of every matching entry at subscribe time (one callback per entry).
   */
  withCurrent: boolean;
}

// ─── Plugin Declaration ─────────────────────────────────

/**
 * A state namespace that a plugin provides — declared in
 * plugin.yaml and passed to StateBridge at plugin activation time.
 */
export interface StateDeclaration {
  /** Namespace prefix, e.g. "plugin:editor" → state://plugin:editor/* */
  namespace: string;

  /** Human-readable label for admin UI. */
  label?: string;

  /** Default sync behaviour for entries in this namespace. */
  sync?: { mode: SyncMode; merge: MergeStrategy };

  /** Default permissions for entries in this namespace. */
  permissions?: StatePermissions;

  /** Whether entries in this namespace persist to disk. */
  persist?: boolean;
}

export interface StateRequirement {
  /** Glob pattern this plugin needs to subscribe to. */
  pattern: string;
  /** Human-readable justification (for permission dialogs). */
  reason?: string;
}

// ─── Node Identity ───────────────────────────────────────

export interface NodeIdentity {
  nodeId: string;
  label: string;
  roles: string[];
  publicKey?: string;
  connectedAt: number;
}

// ─── Engine-level events ─────────────────────────────────

export type EngineEventKind =
  | 'node.connected'
  | 'node.disconnected'
  | 'sync.start'
  | 'sync.complete'
  | 'sync.error'
  | 'permission.denied';

export interface EngineEvent {
  kind: EngineEventKind;
  nodeId?: string;
  entry?: StateEntry;
  error?: string;
  timestamp: number;
}

export type EngineEventCallback = (event: EngineEvent) => void;

// ─── Plugin lifecycle hooks ──────────────────────────────

export interface StatePluginHooks {
  /** Called once after the plugin's state namespace is registered. */
  onInit?: (ctx: PluginContext) => void;

  /** Called before every state change — can modify or block. */
  onBeforeChange?: (change: StateChange, ctx: PluginContext) => StateChange | null;

  /** Called after every state change. */
  onAfterChange?: (change: StateChange, ctx: PluginContext) => void;

  /** Called when a remote node connects. */
  onNodeConnect?: (nodeId: string, identity: NodeIdentity, ctx: PluginContext) => void;

  /** Called when a remote node disconnects. */
  onNodeDisconnect?: (nodeId: string, ctx: PluginContext) => void;

  /**
   * Custom merge function.  Called when two peers disagree on
   * the value for the same key.  Return the winning entry, or
   * null to keep both as divergent copies.
   */
  onMerge?: (local: StateEntry, remote: StateEntry, ctx: PluginContext) => StateEntry | null;
}

export interface PluginContext {
  pluginId: string;
  bus: import('./index').StateBus;
  namespace: string;
}

// ─── Plugin registrar — wraps the interface plugin authors see ──

export interface StatePluginRegistrar {
  id: string;
  namespace: string;
  provides: StateDeclaration[];
  hooks?: StatePluginHooks;
}
