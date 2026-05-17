// ─── Sync Engine ──────────────────────────────────────────
// Pushes state deltas to connected remote peers and receives
// deltas from them.  The engine is message-protocol agnostic
// (WebSocket, HTTP long-poll, whatever) — it works through a
// narrow transport interface.
//
// Architecture:
//   Local StateBus  ←→  SyncEngine  ←→  Transport  ←→  Remote SyncEngine
//
// The engine only sends entries that the remote peer has
// permission to read.  Permission check happens here, not in
// the transport layer.

import type {
  StateEntry,
  StateChange,
  StateKey,
  ChangeCallback,
  SyncMode,
  MergeStrategy,
  EngineEvent,
  EngineEventCallback,
  NodeIdentity,
} from './types';
import { parseStateKey } from './types';
import { PermissionGate, type PermissionContext } from './permission-gate';
import { SubscriptionManager } from './subscription';

// ─── Transport — narrow interface that any transport must satisfy ──

export interface SyncTransport {
  /** Unique peer node ID. */
  readonly peerId: string;
  /** Peer identity (available after handshake). */
  readonly identity?: NodeIdentity;

  /** Send a snapshot (full set of entries) to this peer. */
  sendSnapshot(entries: StateEntry[]): void;
  /** Send a delta (one changed entry) to this peer. */
  sendDelta(change: StateChange): void;
  /** Send a batch of deltas. */
  sendBatch(changes: StateChange[]): void;
  /** Request a specific key from the peer. */
  sendRequest(keys: StateKey[]): void;

  /** Close the transport. */
  close(): void;
}

// ─── SyncEngine ──────────────────────────────────────────

export class SyncEngine {
  private transports = new Map<string, SyncTransport>();
  private permission = new PermissionGate();
  private engineSubs = new Set<EngineEventCallback>();

  constructor(
    /** Reference to the local state entry store. */
    private getEntry: (key: StateKey) => StateEntry | undefined,
    /** List all entries matching a prefix pattern. */
    private listEntries: (pattern: string) => StateEntry[],
    /** Apply a remote change to local store. */
    private applyRemote: (change: StateChange) => boolean,
  ) {}

  // ── Events ──

  onEvent(cb: EngineEventCallback): () => void {
    this.engineSubs.add(cb);
    return () => this.engineSubs.delete(cb);
  }

  private emit(event: EngineEvent): void {
    for (const cb of this.engineSubs) cb(event);
  }

  // ── Connection lifecycle ──

  /**
   * Called when a remote peer connects.  Performs the initial
   * sync: pushes the local entries the peer is allowed to read,
   * and stores the transport for future deltas.
   */
  connect(transport: SyncTransport): void {
    this.transports.set(transport.peerId, transport);

    // Build permission context for this peer
    const ctx = this.ctxFor(transport);

    // Collect readable entries and send snapshot
    const readable: StateEntry[] = [];
    for (const entry of this.listEntries('*')) {
      if (entry.sync.mode === 'local-only') continue;
      if (this.permission.canRead(entry, ctx) !== null) continue;
      readable.push(entry);
    }
    transport.sendSnapshot(readable);

    this.emit({
      kind: 'node.connected',
      nodeId: transport.peerId,
      timestamp: Date.now(),
    });
  }

  /**
   * Called when a remote peer disconnects.
   */
  disconnect(peerId: string): void {
    this.transports.delete(peerId);
    this.emit({
      kind: 'node.disconnected',
      nodeId: peerId,
      timestamp: Date.now(),
    });
  }

  // ── Incoming — called by transport when data arrives from peer ──

  /** Apply a snapshot received from a peer. */
  receiveSnapshot(entries: StateEntry[], fromPeer: string): void {
    for (const entry of entries) {
      const local = this.getEntry(entry.key);
      if (!local) {
        // New entry — apply
        this.applyRemote({
          kind: 'set',
          key: entry.key,
          value: entry.value,
          previous: undefined,
          version: entry.version,
          owner: entry.owner,
          timestamp: entry.updatedAt,
          fromPeer,
          metadata: entry.metadata,
        });
      } else {
        // Existing — merge
        this.mergeRemote(local, entry, fromPeer);
      }
    }
    this.emit({
      kind: 'sync.complete',
      nodeId: fromPeer,
      timestamp: Date.now(),
    });
  }

  /** Apply a single delta from a peer. */
  receiveDelta(change: StateChange, fromPeer: string): void {
    const tagged = { ...change, fromPeer };
    const local = this.getEntry(change.key);
    if (!local) {
      this.applyRemote(tagged);
    } else {
      this.mergeRemote(local, {
        key: change.key,
        value: change.value,
        version: change.version,
        owner: change.owner,
        updatedAt: change.timestamp,
        sync: { mode: 'auto', merge: 'last-writer-wins' },
        permissions: { read: 'nodes', write: 'owner' },
      } as StateEntry, fromPeer);
    }
  }

  /** Handle a request from a peer for specific keys. */
  receiveRequest(keys: StateKey[], fromPeer: string): void {
    const transport = this.transports.get(fromPeer);
    if (!transport) return;
    const ctx = this.ctxFor(transport);
    const entries: StateEntry[] = [];
    for (const key of keys) {
      const entry = this.getEntry(key);
      if (entry && this.permission.canRead(entry, ctx) === null) {
        entries.push(entry);
      }
    }
    if (entries.length > 0) transport.sendSnapshot(entries);
  }

  // ── Outgoing — called by StateBus when local state changes ──

  /**
   * Called when a local entry changes.  Pushes to all connected
   * peers that have permission to read it.
   */
  onLocalChange(change: StateChange): void {
    const entry = this.getEntry(change.key);
    if (!entry) return;
    if (entry.sync.mode === 'local-only') return;

    for (const [peerId, transport] of this.transports) {
      const ctx = this.ctxFor(transport);
      if (this.permission.canRead(entry, ctx) !== null) continue;
      transport.sendDelta(change);
    }
  }

  // ── On-demand ──

  /** Request specific keys from a connected peer. */
  requestKeys(peerId: string, keys: StateKey[]): void {
    const transport = this.transports.get(peerId);
    if (!transport) return;
    transport.sendRequest(keys);
  }

  // ── Internal ──

  private ctxFor(transport: SyncTransport): PermissionContext {
    return {
      identity: transport.identity,
      roles: transport.identity?.roles ?? [],
      scopes: [],
    };
  }

  private mergeRemote(local: StateEntry, remote: StateEntry, fromPeer: string): void {
    const strategy: MergeStrategy = local.sync.merge || 'last-writer-wins';

    switch (strategy) {
      case 'last-writer-wins':
        if (remote.version > local.version) {
          this.applyRemote({
            kind: 'merge',
            key: remote.key,
            value: remote.value,
            previous: local.value,
            version: remote.version,
            owner: remote.owner,
            timestamp: remote.updatedAt,
            fromPeer,
            metadata: remote.metadata,
          });
        }
        break;

      case 'keep-both':
        // Store remote under a divergent key
        this.applyRemote({
          kind: 'set',
          key: `${remote.key}@${fromPeer}` as StateKey,
          value: remote.value,
          previous: undefined,
          version: remote.version,
          owner: remote.owner,
          timestamp: remote.updatedAt,
          fromPeer,
          metadata: remote.metadata,
        });
        break;

      default:
        // 'custom' or unknown: fall back to last-writer-wins
        if (remote.version > local.version) {
          this.applyRemote({
            kind: 'merge',
            key: remote.key,
            value: remote.value,
            previous: local.value,
            version: remote.version,
            owner: remote.owner,
            timestamp: remote.updatedAt,
            fromPeer,
            metadata: remote.metadata,
          });
        }
        break;
    }
  }
}
