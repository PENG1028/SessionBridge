// ─── StateBridge Relay Integration ─────────────────────────
// Bridges the StateBus (cross-node state middleware) into the
// relay server's existing surface/workbench/shell infrastructure.
//
// Provides backward-compatible APIs for the relay's message
// handlers while routing all state through StateBus entries.
//
// Mapping:
//   surfaceManager.create(nid, opts)   → stateBus.set(state://node:<nid>/surfaces/<sid>, data)
//   surfaceManager.get(sid)            → stateBus.get(state://global/surfaces/<sid>)
//   workbenchTabStore.get(nid)         → stateBus.get(state://node:<nid>/workbench/tabs)
//   broadcastShellOutput(id, data)     → stateBus.set(state://node:<nid>/shells/<id>/output, {data, stream})
//   subscribeShellOutput(id, cb)       → stateBus.subscribe(node:*/shells/<id>/output, cb)

import { WebSocket } from 'ws';
import type { SharedSurface, ReplayPolicy, RuntimeOutputChunk, RuntimeState } from '../../extensions/types';
import { StateBus } from './index';
import { stateKey, parseStateKey } from './types';
import type { StateKey, StateChange } from './types';

// ─── Keys ───────────────────────────────────────────────────

function surfaceGlobalKey(surfaceId: string): StateKey {
  return stateKey('global', `surfaces/${surfaceId}`);
}

function surfaceNodeKey(nodeId: string, surfaceId: string): StateKey {
  return stateKey('node', `${nodeId}/surfaces/${surfaceId}`);
}

function workbenchKey(nodeId: string): StateKey {
  return stateKey('node', `${nodeId}/workbench/tabs`);
}

function shellOutputKey(nodeId: string, instanceId: string): StateKey {
  return stateKey('node', `${nodeId}/shells/${instanceId}/output`);
}

function shellExitKey(nodeId: string, instanceId: string): StateKey {
  return stateKey('node', `${nodeId}/shells/${instanceId}/exit`);
}

function nodeSurfacesGlob(nodeId: string): string {
  return `node/${nodeId}/surfaces/*`;
}

// ─── Helpers ────────────────────────────────────────────────

let surfaceCounter = 0;
export function nextSurfaceId(): string {
  surfaceCounter++;
  return `surf_${surfaceCounter}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Surface Manager Adapter ───────────────────────────────

export class StateRelaySurfaceManager {
  constructor(private bus: StateBus) {}

  /** Create a surface entry in StateBus. Returns the surface data. */
  create(
    nodeId: string,
    opts: {
      title: string;
      viewType: string;
      pluginId?: string;
      scope?: 'local' | 'node' | 'network';
      shared?: boolean;
      runtimeRef?: SharedSurface['runtimeRef'];
      replayPolicy?: ReplayPolicy;
      permissions?: SharedSurface['permissions'];
      createdBy?: string;
    },
  ): SharedSurface {
    const surfaceId = nextSurfaceId();
    const now = Date.now();
    const nowSec = now;

    const surface: SharedSurface = {
      surfaceId,
      nodeId,
      title: opts.title,
      viewType: opts.viewType,
      pluginId: opts.pluginId,
      scope: opts.scope || 'node',
      shared: opts.shared !== false,
      runtimeRef: opts.runtimeRef || { kind: 'none' },
      replayPolicy: opts.replayPolicy || { mode: 'none' },
      permissions: opts.permissions,
      createdBy: opts.createdBy || 'unknown',
      createdAt: nowSec,
      updatedAt: nowSec,
      keep: true,
    };

    // Store in StateBus under both global index and node-local key
    this.bus.set(surfaceGlobalKey(surfaceId), surface, {
      permissions: { read: 'nodes', write: 'owner' },
    });
    this.bus.set(surfaceNodeKey(nodeId, surfaceId), surface, {
      permissions: { read: 'nodes', write: 'owner' },
    });

    return surface;
  }

  /** Get a surface by ID. */
  get(surfaceId: string): SharedSurface | undefined {
    return this.bus.get<SharedSurface>(surfaceGlobalKey(surfaceId));
  }

  /** Link an operation ID to a surface (for input/output routing). */
  private operationToSurface = new Map<string, string>();

  /** Find a surface by its linked operationId. */
  findByOperationId(operationId: string): SharedSurface | undefined {
    const surfaceId = this.operationToSurface.get(operationId);
    return surfaceId ? this.get(surfaceId) : undefined;
  }

  /** Link an operation to a surface. */
  linkOperation(surfaceId: string, operationId: string): void {
    this.operationToSurface.set(operationId, surfaceId);
    const surface = this.get(surfaceId);
    if (surface) {
      surface.runtimeRef = { ...surface.runtimeRef, operationId };
      this.bus.set(surfaceGlobalKey(surfaceId), surface);
      this.bus.set(surfaceNodeKey(surface.nodeId, surfaceId), surface);
    }
  }

  private _opCounter = 0;

  /** Generate a synthetic operation ID for operation-less surfaces. */
  nextOperationId(): string {
    return `op_${++this._opCounter}_${Date.now().toString(36)}`;
  }

  /** In-memory runtime state tracking (mimics old SurfaceManager). */
  private runtimeStates = new Map<string, RuntimeState>();

  /** Get runtime state for a surface (simple status-only wrapper). */
  getRuntime(surfaceId: string): { status: string; operationId: string } | undefined {
    const rt = this.runtimeStates.get(surfaceId);
    if (rt) return { status: rt.status, operationId: rt.operationId };
    // Fallback: derive from surface data when no explicit runtime was initialized
    const surface = this.get(surfaceId);
    if (!surface) return undefined;
    return { status: surface.orphaned ? 'orphaned' : 'idle', operationId: surface.runtimeRef?.operationId || '' };
  }

  /** Initialize runtime state for a surface. Called after create(). */
  initRuntime(surfaceId: string, kind: RuntimeState['kind'] = 'terminal'): void {
    const surface = this.get(surfaceId);
    if (!surface) return;
    const now = Date.now();
    const rt: RuntimeState = {
      operationId: surface.runtimeRef?.operationId || '',
      nodeId: surface.nodeId,
      surfaceId,
      kind,
      status: 'starting',
      outputBuffer: [],
      eventBuffer: [],
      createdAt: now,
      updatedAt: now,
    };
    this.runtimeStates.set(surfaceId, rt);
  }

  /** Update surface fields. */
  update(
    surfaceId: string,
    patch: Partial<Pick<SharedSurface, 'title' | 'replayPolicy' | 'permissions' | 'scope'>>,
  ): SharedSurface | undefined {
    const surface = this.get(surfaceId);
    if (!surface) return undefined;

    const updated: SharedSurface = {
      ...surface,
      ...patch,
      updatedAt: Date.now(),
    };

    this.bus.set(surfaceGlobalKey(surfaceId), updated);
    this.bus.set(surfaceNodeKey(surface.nodeId, surfaceId), updated);
    return updated;
  }

  /** Delete a surface. */
  delete(surfaceId: string): boolean {
    const surface = this.get(surfaceId);
    if (!surface) return false;
    const stack = new Error().stack?.split('\n').slice(2, 6).join('; ') || 'unknown';
    console.log('[DELETE-SURFACE] surfaceId=%s nodeId=%s title="%s" keep=%s instanceId=%s stack=[%s]', surfaceId, surface.nodeId, surface.title, surface.keep, surface.runtimeRef?.instanceId, stack);
    this.recordDebugEvent({ ts: Date.now(), kind: 'surface.close', surfaceId, nodeId: surface.nodeId, message: `surface deleted` });
    // Clean up operationToSurface mapping so stale entries don't shadow
    // future lookups (surface.publish reuses operationIds from shell.spawn).
    if (surface.runtimeRef?.operationId) {
      this.operationToSurface.delete(surface.runtimeRef.operationId);
    }
    this.bus.delete(surfaceGlobalKey(surfaceId));
    this.bus.delete(surfaceNodeKey(surface.nodeId, surfaceId));
    return true;
  }

  /** List all surfaces for a node. */
  listByNode(nodeId: string): SharedSurface[] {
    const results = this.bus.list(nodeSurfacesGlob(nodeId));
    return results.map(e => e.value as SharedSurface);
  }

  /** Find surfaces referencing a runtime instance. */
  findByInstanceId(instanceId: string): SharedSurface[] {
    const results: SharedSurface[] = [];
    for (const entry of this.bus.list('global/surfaces/*')) {
      const sfc = entry.value as SharedSurface;
      if (sfc.runtimeRef?.instanceId === instanceId) results.push(sfc);
    }
    return results;
  }

  /** List ALL surfaces across all nodes. */
  listAll(): SharedSurface[] {
    const results = this.bus.list('global/surfaces/*');
    return results.map(e => e.value as SharedSurface);
  }

  /** Clear orphaned flag on a surface. */
  clearOrphaned(surfaceId: string): void {
    const surface = this.get(surfaceId);
    if (surface) {
      const updated = { ...surface, orphaned: false, updatedAt: Date.now() };
      this.bus.set(surfaceGlobalKey(surfaceId), updated);
      this.bus.set(surfaceNodeKey(surface.nodeId, surfaceId), updated);
    }
  }

  /** Set orphaned flag. */
  setOrphaned(surfaceId: string): void {
    const surface = this.get(surfaceId);
    if (surface) {
      const updated = { ...surface, orphaned: true, updatedAt: Date.now() };
      this.bus.set(surfaceGlobalKey(surfaceId), updated);
      this.bus.set(surfaceNodeKey(surface.nodeId, surfaceId), updated);
    }
  }

  /** Set keep flag. */
  setKeep(surfaceId: string, keep: boolean): void {
    const surface = this.get(surfaceId);
    if (surface) {
      const updated = { ...surface, keep, updatedAt: Date.now() };
      this.bus.set(surfaceGlobalKey(surfaceId), updated);
      this.bus.set(surfaceNodeKey(surface.nodeId, surfaceId), updated);
    }
  }

  /** Check keep flag. */
  isKept(surfaceId: string): boolean {
    return this.get(surfaceId)?.keep === true;
  }

  /** Convert a surface to workbench tab format. */
  toWorkbenchTab(surface: SharedSurface): Record<string, unknown> {
    return {
      id: surface.surfaceId,
      title: surface.title,
      viewType: surface.viewType,
      instanceId: surface.runtimeRef?.instanceId || surface.nodeId,
      _surfaceId: surface.surfaceId,
      _operationId: surface.runtimeRef?.operationId,
      _keep: surface.keep ?? false,
      _orphaned: surface.orphaned ?? false,
    };
  }

  /** Serialize surface to plain JSON. */
  toJSON(surface: SharedSurface): Record<string, unknown> {
    return {
      surfaceId: surface.surfaceId,
      nodeId: surface.nodeId,
      title: surface.title,
      viewType: surface.viewType,
      pluginId: surface.pluginId,
      scope: surface.scope,
      shared: surface.shared,
      runtimeRef: surface.runtimeRef,
      replayPolicy: surface.replayPolicy,
      permissions: surface.permissions,
      createdBy: surface.createdBy,
      createdAt: surface.createdAt,
      updatedAt: surface.updatedAt,
      keep: surface.keep ?? false,
      orphaned: surface.orphaned ?? false,
    };
  }

  /** Import a surface from an upstream/peer relay. */
  importFromUpstream(surfaceData: Record<string, unknown>, remapNodeId: string): SharedSurface | undefined {
    const existing = this.get(String(surfaceData.surfaceId || ''));
    if (existing) return existing;

    const surface: SharedSurface = {
      surfaceId: String(surfaceData.surfaceId || nextSurfaceId()),
      nodeId: remapNodeId,
      title: String(surfaceData.title || 'Untitled'),
      viewType: (surfaceData.viewType as string) || 'terminal',
      pluginId: surfaceData.pluginId ? String(surfaceData.pluginId) : undefined,
      scope: (surfaceData.scope as SharedSurface['scope']) || 'node',
      shared: surfaceData.shared !== false,
      runtimeRef: (surfaceData.runtimeRef as SharedSurface['runtimeRef']) || { kind: 'none' },
      replayPolicy: (surfaceData.replayPolicy as ReplayPolicy) || { mode: 'none' },
      permissions: surfaceData.permissions as SharedSurface['permissions'],
      createdBy: 'upstream',
      createdAt: typeof surfaceData.createdAt === 'number' ? surfaceData.createdAt : Date.now(),
      updatedAt: Date.now(),
      keep: surfaceData.keep !== false,
      orphaned: true,
    };

    this.bus.set(surfaceGlobalKey(surface.surfaceId), surface);
    this.bus.set(surfaceNodeKey(remapNodeId, surface.surfaceId), surface);
    // Rebuild operationToSurface mapping so operation.input routing
    // works cross-relay (VPS → downstream) for terminal surfaces.
    if (surface.runtimeRef?.operationId) {
      this.operationToSurface.set(surface.runtimeRef.operationId, surface.surfaceId);
    }
    return surface;
  }

  // ── Subscriber tracking + output replay buffer ────────────

  private surfaceSubs = new Map<string, Set<WebSocket>>();
  private nodeSubs = new Map<string, Set<WebSocket>>();
  private outputBuffer = new Map<string, Array<{ stream: string; data: string; ts: number }>>();
  private lastResult = new Map<string, any>();
  private readonly MAX_REPLAY_LINES = 5000;

  /** Subscribe a WS to a specific surface's output events. */
  subscribe(
    surfaceId: string,
    ws: WebSocket,
    sendFn: (w: WebSocket, m: any) => void,
    envelopeFn: (t: string, b: Record<string, unknown>) => any,
  ): SharedSurface | null {
    const surface = this.get(surfaceId);
    if (!surface) return null;
    if (!this.surfaceSubs.has(surfaceId)) this.surfaceSubs.set(surfaceId, new Set());
    this.surfaceSubs.get(surfaceId)!.add(ws);

    // Replay buffered output to new subscriber
    const buf = this.outputBuffer.get(surfaceId);
    if (buf && buf.length > 0) {
      const outputs = buf.map(c => ({ data: c.data, stream: c.stream }));
      try { sendFn(ws, envelopeFn('runtime.replay', { surfaceId, outputs })); } catch {}
    }
    // Replay cached runtime.result (if operation already completed)
    const result = this.lastResult.get(surfaceId);
    if (result) {
      try { sendFn(ws, result); } catch {}
    }

    ws.addEventListener('close', () => {
      const subs = this.surfaceSubs.get(surfaceId);
      if (subs) { subs.delete(ws); if (subs.size === 0) this.surfaceSubs.delete(surfaceId); }
    }, { once: true });

    return surface;
  }

  /** Unsubscribe a WS from a surface. */
  unsubscribe(surfaceId: string, ws: WebSocket): void {
    const subs = this.surfaceSubs.get(surfaceId);
    if (subs) { subs.delete(ws); if (subs.size === 0) this.surfaceSubs.delete(surfaceId); }
  }

  /** Subscribe a WS to all surfaces for a node. */
  subscribeNode(
    nodeId: string,
    ws: WebSocket,
    sendFn: (w: WebSocket, m: any) => void,
    envelopeFn: (t: string, b: Record<string, unknown>) => any,
  ): SharedSurface[] {
    if (!this.nodeSubs.has(nodeId)) this.nodeSubs.set(nodeId, new Set());
    this.nodeSubs.get(nodeId)!.add(ws);

    ws.addEventListener('close', () => {
      const subs = this.nodeSubs.get(nodeId);
      if (subs) { subs.delete(ws); if (subs.size === 0) this.nodeSubs.delete(nodeId); }
    }, { once: true });

    const surfaces = this.listByNode(nodeId);
    for (const sfc of surfaces) {
      if (sfc.shared) this.subscribe(sfc.surfaceId, ws, sendFn, envelopeFn);
    }
    return surfaces;
  }

  /** Unsubscribe a WS from node updates. */
  unsubscribeNode(nodeId: string, ws: WebSocket): void {
    const subs = this.nodeSubs.get(nodeId);
    if (subs) { subs.delete(ws); if (subs.size === 0) this.nodeSubs.delete(nodeId); }
    // Also remove from individual surface subs for this node
    for (const sfc of this.listByNode(nodeId)) {
      this.unsubscribe(sfc.surfaceId, ws);
    }
  }

  /** Clean up all subscriptions for a closing WebSocket. */
  cleanupWs(ws: WebSocket): void {
    for (const [sid, subs] of this.surfaceSubs) {
      subs.delete(ws);
      if (subs.size === 0) this.surfaceSubs.delete(sid);
    }
    for (const [nid, subs] of this.nodeSubs) {
      subs.delete(ws);
      if (subs.size === 0) this.nodeSubs.delete(nid);
    }
  }

  /** Get subscribers for a surface. */
  getSubscribers(surfaceId: string): Set<WebSocket> | undefined {
    return this.surfaceSubs.get(surfaceId);
  }

  /** Get node subscribers. */
  getNodeSubscribers(nodeId: string): Set<WebSocket> | undefined {
    return this.nodeSubs.get(nodeId);
  }

  /** Broadcast to all subscribers of a node, optionally excluding a sender. */
  broadcastToNodeSubscribers(
    nodeId: string,
    sendFn: (w: WebSocket, m: any) => void,
    msg: any,
    excludeWs?: WebSocket,
  ): void {
    const subs = this.nodeSubs.get(nodeId);
    if (!subs) return;
    for (const ws of subs) {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) sendFn(ws, msg);
    }
  }

  /** Broadcast to all subscribers of a surface. */
  broadcastToSubscribers(
    surfaceId: string,
    sendFn: (w: WebSocket, m: any) => void,
    msg: any,
  ): void {
    // Buffer runtime.output for late-joining subscribers (replay).
    // Messages can arrive in envelope format ({ v, type, body: { data } })
    // or flat format ({ type, data }). Handle both.
    if (msg?.type === 'runtime.output') {
      const outputData = msg.data || msg.body?.data;
      if (outputData) {
        const buf = this.outputBuffer.get(surfaceId) || [];
        buf.push({ stream: msg.stream || msg.body?.stream || 'stdout', data: outputData, ts: Date.now() });
        while (buf.length > this.MAX_REPLAY_LINES) buf.shift();
        this.outputBuffer.set(surfaceId, buf);
      }
    }
    // Cache runtime.result so late-joining subscribers also receive it
    if (msg?.type === 'runtime.result') {
      this.lastResult.set(surfaceId, msg);
    }

    const subs = this.surfaceSubs.get(surfaceId);
    if (!subs) return;
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) sendFn(ws, msg);
    }
  }

  // ── Runtime event emitters (surface subscriber notifications) ──

  emitOutput(
    surfaceId: string,
    stream: 'stdout' | 'stderr' | 'structured',
    data: string,
    sendFn: (w: WebSocket, m: any) => void,
    envelopeFn: (t: string, b: Record<string, unknown>) => any,
  ): void {
    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.output', {
      surfaceId, stream, data,
    }));
  }

  emitStatus(
    surfaceId: string,
    status: string,
    detail: string | undefined,
    sendFn: (w: WebSocket, m: any) => void,
    envelopeFn: (t: string, b: Record<string, unknown>) => any,
  ): void {
    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.status', {
      surfaceId, status, detail,
    }));
  }

  emitResult(
    surfaceId: string,
    result: { success: boolean; data?: unknown; error?: string; exitCode?: number },
    sendFn: (w: WebSocket, m: any) => void,
    envelopeFn: (t: string, b: Record<string, unknown>) => any,
  ): void {
    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.result', {
      surfaceId, ...result,
    }));
    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.status', {
      surfaceId, status: result.success ? 'completed' : 'failed',
    }));
  }

  // ── Debug ───────────────────────────────────────────────────

  private debugEvents: Array<{ ts: number; kind: string; surfaceId?: string; nodeId?: string; instanceId?: string; operationId?: string; message: string; extra?: Record<string, unknown> }> = [];

  recordDebugEvent(ev: { ts: number; kind: string; surfaceId?: string; nodeId?: string; instanceId?: string; operationId?: string; message?: string; extra?: Record<string, unknown> }): void {
    this.debugEvents.push({
      ts: ev.ts,
      kind: ev.kind,
      surfaceId: ev.surfaceId,
      nodeId: ev.nodeId,
      instanceId: ev.instanceId,
      operationId: ev.operationId,
      message: ev.message || ev.kind,
      extra: ev.extra,
    });
    while (this.debugEvents.length > 200) this.debugEvents.shift();
  }

  getDebugSnapshot(): { surfaces: any[]; events: any[] } {
    return {
      surfaces: this.listAll().map(s => ({
        surfaceId: s.surfaceId,
        nodeId: s.nodeId,
        title: s.title,
        viewType: s.viewType,
        scope: s.scope,
        shared: s.shared,
        keep: s.keep,
        orphaned: s.orphaned,
        runtimeRef: s.runtimeRef,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      events: [...this.debugEvents],
    };
  }
}

// ─── Workbench Tab Store Adapter ───────────────────────────

export class StateRelayWorkbenchStore {
  private tabs = new Map<string, any[]>();
  private subscribers = new Map<string, Set<WebSocket>>();

  constructor(private bus: StateBus) {}

  get(nodeId: string): any[] | undefined {
    // Fast path: in-memory cache
    const cached = this.tabs.get(nodeId);
    if (cached !== undefined) return cached;
    // Fallback: restore from StateBus persistence (survives relay restart)
    const stored = this.bus.get<unknown[]>(workbenchKey(nodeId));
    if (stored !== undefined) {
      const restored = Array.isArray(stored) ? stored : [];
      this.tabs.set(nodeId, restored);
      return restored;
    }
    return undefined;
  }

  set(nodeId: string, tabs: any[]): void {
    this.tabs.set(nodeId, tabs);
    this.bus.set(workbenchKey(nodeId), tabs, {
      permissions: { read: 'nodes', write: 'owner' },
    });
  }

  broadcast(nodeId: string, tabs: any[], sender?: WebSocket): void {
    const subs = this.subscribers.get(nodeId);
    if (!subs) return;
    for (const ws of subs) {
      if (ws !== sender && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'workbench.tabs',
          nodeId,
          tabs,
        }));
      }
    }
  }

  delete(nodeId: string): void {
    this.tabs.delete(nodeId);
    this.bus.delete(workbenchKey(nodeId));
  }

  /** Remove ALL tabs and broadcasts cleanup to subscribers. */
  clear(): void {
    const allNodeIds = [...this.tabs.keys()];
    this.tabs.clear();
    for (const nid of allNodeIds) {
      this.bus.delete(workbenchKey(nid));
      this.broadcast(nid, []);
    }
  }

  /** Get all node IDs with workbench tab entries. */
  getAllNodeIds(): string[] {
    return Array.from(this.tabs.keys());
  }

  subscribe(nodeId: string, ws: WebSocket): any[] | undefined {
    if (!this.subscribers.has(nodeId)) this.subscribers.set(nodeId, new Set());
    this.subscribers.get(nodeId)!.add(ws);
    ws.addEventListener('close', () => {
      const subs = this.subscribers.get(nodeId);
      if (subs) { subs.delete(ws); if (subs.size === 0) this.subscribers.delete(nodeId); }
    }, { once: true });
    return this.tabs.get(nodeId);
  }

  unsubscribe(nodeId: string, ws: WebSocket): void {
    const subs = this.subscribers.get(nodeId);
    if (subs) { subs.delete(ws); if (subs.size === 0) this.subscribers.delete(nodeId); }
  }

  /** Check if a nodeId has any active WebSocket subscribers. */
  hasSubscribers(nodeId: string): boolean {
    const subs = this.subscribers.get(nodeId);
    return subs !== undefined && subs.size > 0;
  }

  cleanupWs(ws: WebSocket): void {
    for (const [nid, subs] of this.subscribers) {
      subs.delete(ws);
      if (subs.size === 0) this.subscribers.delete(nid);
    }
  }

  /** Diagnostic: return subscriber count per nodeId. */
  getSubscriberInfo(): Record<string, { count: number; label: string }> {
    const info: Record<string, { count: number; label: string }> = {};
    for (const [nid, subs] of this.subscribers) {
      const live = [...subs].filter(ws => ws.readyState === WebSocket.OPEN).length;
      if (live > 0 || subs.size > 0) info[nid] = { count: subs.size, label: '' };
    }
    return info;
  }
}

// ─── Shell Output Router Adapter ───────────────────────────

export class StateRelayShellRouter {
  private shellSubs = new Map<string, Set<WebSocket>>();

  constructor(private bus: StateBus) {}

  /** Subscribe a WebSocket to shell output for a specific instance. */
  subscribe(instanceId: string, ws: WebSocket): void {
    if (!this.shellSubs.has(instanceId)) this.shellSubs.set(instanceId, new Set());
    this.shellSubs.get(instanceId)!.add(ws);
    ws.addEventListener('close', () => {
      const subs = this.shellSubs.get(instanceId);
      if (subs) { subs.delete(ws); if (subs.size === 0) this.shellSubs.delete(instanceId); }
    }, { once: true });
  }

  /** Broadcast output to shell subscribers + surface subscribers. */
  broadcast(instanceId: string, data: string, stream: string, surfaceManager?: StateRelaySurfaceManager): void {
    const subs = this.shellSubs.get(instanceId);
    if (subs && subs.size > 0) {
      const msg = JSON.stringify({ type: 'shell.output', data, stream });
      for (const ws of subs) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        else subs.delete(ws);
      }
    }
    // Bridge to surface subscribers
    if (surfaceManager) {
      for (const sfc of surfaceManager.findByInstanceId(instanceId)) {
        surfaceManager.broadcastToSubscribers(
          sfc.surfaceId,
          (w, m) => { if (w.readyState === WebSocket.OPEN) w.send(typeof m === 'string' ? m : JSON.stringify(m)); },
          { type: 'runtime.output', surfaceId: sfc.surfaceId, stream, data },
        );
      }
    }
  }

  /** Broadcast shell exit to subscribers. */
  broadcastExit(instanceId: string, code: number | null, surfaceManager?: StateRelaySurfaceManager): void {
    const subs = this.shellSubs.get(instanceId);
    if (subs) {
      const msg = JSON.stringify({ type: 'shell.exit', code });
      for (const ws of subs) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      }
      this.shellSubs.delete(instanceId);
    }
    // Bridge to surface subscribers
    if (surfaceManager) {
      for (const sfc of surfaceManager.findByInstanceId(instanceId)) {
        surfaceManager.emitResult(
          sfc.surfaceId,
          { success: code === 0, exitCode: code ?? undefined },
          (w, m) => { if (w.readyState === WebSocket.OPEN) w.send(typeof m === 'string' ? m : JSON.stringify(m)); },
          (t, b) => ({ type: t, ...b }),
        );
      }
    }
  }

  /** Clean up all subscriptions for a closing WebSocket. */
  cleanupWs(ws: WebSocket): void {
    for (const [instId, subs] of this.shellSubs) {
      subs.delete(ws);
      if (subs.size === 0) this.shellSubs.delete(instId);
    }
  }

  /** Get subscribers for an instance (for iteration/cleanup). */
  getSubscribers(instanceId: string): Set<WebSocket> | undefined {
    return this.shellSubs.get(instanceId);
  }
}
