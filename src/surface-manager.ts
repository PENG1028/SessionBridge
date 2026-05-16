// ─── SharedSurface Manager ───────────────────────────────────
// Manages SharedSurface lifecycle, scoped subscribers, runtime
// replay for late joiners, and permissions. Mirrors the
// RemoteOperationManager pattern but operates at the surface
// (user-visible tab) level rather than the operation level.
//
// Key behaviors:
//   - surface.subscribe triggers full replay (history + live)
//   - surface.subscribeNode returns all node surfaces + replay
//   - Output buffering follows replayPolicy (tail/latest/events/none/full)
//   - Terminal default: { mode: 'tail', lines: 5000, bytes: 500_000 }

import type { WebSocket } from "ws";
import type {
  SharedSurface,
  ReplayPolicy,
  RuntimeOutputChunk,
  RuntimeEvent,
  RuntimeState,
  SurfacePermission,
} from "../extensions/types";

// ─── Buffer caps ────────────────────────────────────────────

const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB per surface
const MAX_CHUNK_BYTES = 64 * 1024;   // 64KB per individual chunk
const DEFAULT_TAIL_LINES = 5000;
const DEFAULT_TAIL_BYTES = 500_000;

// ─── ID generation ──────────────────────────────────────────

let surfaceCounter = 0;
function nextSurfaceId(): string {
  surfaceCounter++;
  return `surf_${surfaceCounter}_${Date.now().toString(36)}`;
}

// ─── Helpers ────────────────────────────────────────────────

function defaultReplayPolicy(viewType: string): ReplayPolicy {
  if (viewType === 'terminal') {
    return { mode: 'tail', lines: DEFAULT_TAIL_LINES, bytes: DEFAULT_TAIL_BYTES };
  }
  return { mode: 'none' };
}

export type SendFn = (ws: WebSocket, msg: any) => void;
export type EnvelopeFn = (type: string, body: Record<string, unknown>) => any;

// ── Debug event ring buffer ───────────────────────────────────

export interface SurfaceDebugEvent {
  ts: number;
  kind:
    | 'surface.publish.request'
    | 'surface.publish.created'
    | 'surface.publish.duplicate'
    | 'surface.publish.upstream'
    | 'surface.subscribeNode'
    | 'surface.subscribe'
    | 'surface.list.sent'
    | 'runtime.output'
    | 'runtime.replay'
    | 'runtime.input'
    | 'runtime.status'
    | 'runtime.result'
    | 'surface.close'
    | 'surface.import'
    | 'surface.error';
  surfaceId?: string;
  nodeId?: string;
  instanceId?: string;
  operationId?: string;
  clientRole?: string;
  message?: string;
  extra?: Record<string, unknown>;
}

const MAX_DEBUG_EVENTS = 200;

export interface SurfaceDebugSnapshot {
  surfaces: Array<{
    surfaceId: string;
    nodeId: string;
    title: string;
    viewType: string;
    scope: string;
    shared: boolean;
    runtimeRef?: {
      kind: string;
      instanceId?: string;
      operationId?: string;
    };
    replayPolicy?: unknown;
    subscriberCount: number;
    outputBufferSize: number;
    eventBufferSize: number;
    createdAt: number;
    updatedAt: number;
  }>;
  events: SurfaceDebugEvent[];
}

export interface SurfaceCreateOpts {
  title: string;
  viewType: string;
  pluginId?: string;
  scope?: 'local' | 'node' | 'network';
  shared?: boolean;
  runtimeRef?: SharedSurface['runtimeRef'];
  replayPolicy?: ReplayPolicy;
  permissions?: SharedSurface['permissions'];
  createdBy?: string;
}

// ─── Manager ────────────────────────────────────────────────

export class SurfaceManager {
  private surfaces = new Map<string, SharedSurface>();
  private subscribers = new Map<string, Set<WebSocket>>();     // surfaceId → subscribers
  private nodeSubscribers = new Map<string, Set<WebSocket>>(); // nodeId → subscribers
  private runtimeStates = new Map<string, RuntimeState>();
  private operationToSurface = new Map<string, string>();       // operationId → surfaceId
  private debugEvents: SurfaceDebugEvent[] = [];

  // ── Debug ring buffer ──────────────────────────────────────

  /** Record a diagnostic event (max 200 entries, FIFO). Public so relay
   *  handlers can emit events for paths outside the manager (e.g. request
   *  received before surface creation, duplicate detection). */
  recordDebugEvent(ev: SurfaceDebugEvent): void {
    this.debugEvents.push(ev);
    while (this.debugEvents.length > MAX_DEBUG_EVENTS) {
      this.debugEvents.shift();
    }
  }

  private _record(kind: SurfaceDebugEvent['kind'], extra?: Partial<SurfaceDebugEvent>): void {
    this.recordDebugEvent({ ts: Date.now(), kind, ...extra });
  }

  /** Full diagnostic snapshot: all surfaces with runtime stats + event log. */
  getDebugSnapshot(): SurfaceDebugSnapshot {
    const surfaces: SurfaceDebugSnapshot['surfaces'] = [];
    for (const s of this.surfaces.values()) {
      const rt = this.runtimeStates.get(s.surfaceId);
      surfaces.push({
        surfaceId: s.surfaceId,
        nodeId: s.nodeId,
        title: s.title,
        viewType: s.viewType,
        scope: s.scope,
        shared: s.shared,
        runtimeRef: s.runtimeRef.kind === 'none' ? undefined : {
          kind: s.runtimeRef.kind,
          instanceId: s.runtimeRef.instanceId,
          operationId: s.runtimeRef.operationId,
        },
        replayPolicy: s.replayPolicy,
        subscriberCount: this.subscribers.get(s.surfaceId)?.size || 0,
        outputBufferSize: rt?.outputBuffer?.length || 0,
        eventBufferSize: rt?.eventBuffer?.length || 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    }
    return { surfaces, events: [...this.debugEvents] };
  }

  // ── CRUD ─────────────────────────────────────────────────

  create(nodeId: string, opts: SurfaceCreateOpts): SharedSurface {
    const surfaceId = nextSurfaceId();
    const now = Date.now();
    const policy = opts.replayPolicy || defaultReplayPolicy(opts.viewType);

    const surface: SharedSurface = {
      surfaceId,
      nodeId,
      title: opts.title,
      viewType: opts.viewType,
      pluginId: opts.pluginId,
      scope: opts.scope || 'node',
      shared: opts.shared !== false,
      runtimeRef: opts.runtimeRef || { kind: 'none' },
      replayPolicy: policy,
      permissions: opts.permissions,
      createdBy: opts.createdBy || 'unknown',
      createdAt: now,
      updatedAt: now,
    };

    this.surfaces.set(surfaceId, surface);

    this._record('surface.publish.created', {
      surfaceId, nodeId, instanceId: surface.runtimeRef.instanceId,
      operationId: surface.runtimeRef.operationId,
      extra: { viewType: surface.viewType, scope: surface.scope, shared: surface.shared },
    });

    // Initialize RuntimeState for surfaces with runtime
    if (surface.runtimeRef.kind !== 'none') {
      const runtimeState: RuntimeState = {
        operationId: surface.runtimeRef.operationId || '',
        nodeId,
        surfaceId,
        kind: surface.runtimeRef.kind === 'snapshot' ? 'plugin' :
              surface.runtimeRef.kind === 'terminal' ? 'terminal' : 'operation',
        status: 'starting',
        outputBuffer: [],
        eventBuffer: [],
        createdAt: now,
        updatedAt: now,
      };
      this.runtimeStates.set(surfaceId, runtimeState);
    }

    return surface;
  }

  get(surfaceId: string): SharedSurface | undefined {
    return this.surfaces.get(surfaceId);
  }

  listByNode(nodeId: string): SharedSurface[] {
    const results: SharedSurface[] = [];
    for (const s of this.surfaces.values()) {
      if (s.nodeId === nodeId) results.push(s);
    }
    return results;
  }

  update(surfaceId: string, patch: Partial<Pick<SharedSurface, 'title' | 'replayPolicy' | 'permissions' | 'scope'>>): SharedSurface | undefined {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return undefined;
    if (patch.title !== undefined) surface.title = patch.title;
    if (patch.replayPolicy !== undefined) surface.replayPolicy = patch.replayPolicy;
    if (patch.permissions !== undefined) surface.permissions = patch.permissions;
    if (patch.scope !== undefined) surface.scope = patch.scope;
    surface.updatedAt = Date.now();
    return surface;
  }

  delete(surfaceId: string): boolean {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return false;

    // Clean up operation mapping
    if (surface.runtimeRef.operationId) {
      this.operationToSurface.delete(surface.runtimeRef.operationId);
    }

    this.surfaces.delete(surfaceId);
    this.subscribers.delete(surfaceId);
    this.runtimeStates.delete(surfaceId);

    this._record('surface.close', { surfaceId, nodeId: surface.nodeId });

    return true;
  }

  findByOperationId(operationId: string): SharedSurface | undefined {
    const surfaceId = this.operationToSurface.get(operationId);
    if (surfaceId) return this.surfaces.get(surfaceId);
    return undefined;
  }

  findByInstanceId(instanceId: string): SharedSurface[] {
    const results: SharedSurface[] = [];
    for (const s of this.surfaces.values()) {
      if (s.runtimeRef.instanceId === instanceId) results.push(s);
    }
    return results;
  }

  linkOperation(surfaceId: string, operationId: string): void {
    this.operationToSurface.set(operationId, surfaceId);
    const surface = this.surfaces.get(surfaceId);
    if (surface) {
      surface.runtimeRef.operationId = operationId;
      surface.updatedAt = Date.now();
    }
    const rt = this.runtimeStates.get(surfaceId);
    if (rt) {
      rt.operationId = operationId;
      rt.updatedAt = Date.now();
    }
  }

  /** Generate a fresh operationId for input/replay binding without creating
   *  a full RemoteOperation. Used by terminal surfaces whose real runtime is
   *  the shell PTY (not an OperationRunner handler). */
  nextOperationId(): string {
    return `op_${++this._opCounter}_${Date.now().toString(36)}`;
  }
  private _opCounter = 0;

  // ── Subscriber management ─────────────────────────────────

  subscribe(
    surfaceId: string,
    ws: WebSocket,
    sendFn: SendFn,
    envelopeFn: EnvelopeFn,
  ): SharedSurface | null {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return null;

    // Add to per-surface subscriber set
    if (!this.subscribers.has(surfaceId)) {
      this.subscribers.set(surfaceId, new Set());
    }
    this.subscribers.get(surfaceId)!.add(ws);

    // Auto-unsubscribe on WS close
    const cleanup = () => {
      this.unsubscribe(surfaceId, ws);
    };
    ws.addEventListener('close', cleanup, { once: true });

    this._record('surface.subscribe', { surfaceId, nodeId: surface.nodeId });

    // Replay history for late joiner
    this.replayForSubscriber(surface, ws, sendFn, envelopeFn);

    return surface;
  }

  subscribeNode(
    nodeId: string,
    ws: WebSocket,
    sendFn: SendFn,
    envelopeFn: EnvelopeFn,
  ): SharedSurface[] {
    // Add to node subscriber set
    if (!this.nodeSubscribers.has(nodeId)) {
      this.nodeSubscribers.set(nodeId, new Set());
    }
    this.nodeSubscribers.get(nodeId)!.add(ws);

    const cleanup = () => {
      const subs = this.nodeSubscribers.get(nodeId);
      if (subs) { subs.delete(ws); if (subs.size === 0) this.nodeSubscribers.delete(nodeId); }
    };
    ws.addEventListener('close', cleanup, { once: true });

    // Return all surfaces for this node, triggering replay for each
    const surfaces = this.listByNode(nodeId);

    this._record('surface.subscribeNode', {
      nodeId, extra: { surfaceCount: surfaces.length, sharedCount: surfaces.filter(s => s.shared).length },
    });

    for (const surface of surfaces) {
      if (surface.shared) {
        this.subscribe(surface.surfaceId, ws, sendFn, envelopeFn);
      }
    }
    return surfaces;
  }

  unsubscribe(surfaceId: string, ws: WebSocket): void {
    const subs = this.subscribers.get(surfaceId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) this.subscribers.delete(surfaceId);
    }
  }

  unsubscribeNode(nodeId: string, ws: WebSocket): void {
    const subs = this.nodeSubscribers.get(nodeId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) this.nodeSubscribers.delete(nodeId);
    }
    // Also unsubscribe from all surfaces of this node
    for (const surface of this.listByNode(nodeId)) {
      this.unsubscribe(surface.surfaceId, ws);
    }
  }

  cleanupWs(ws: WebSocket): void {
    for (const [surfaceId, subs] of this.subscribers) {
      subs.delete(ws);
      if (subs.size === 0) this.subscribers.delete(surfaceId);
    }
    for (const [nodeId, subs] of this.nodeSubscribers) {
      subs.delete(ws);
      if (subs.size === 0) this.nodeSubscribers.delete(nodeId);
    }
  }

  // ── Output / runtime data emission ─────────────────────────

  emitOutput(
    surfaceId: string,
    stream: 'stdout' | 'stderr' | 'structured',
    data: string,
    sendFn: SendFn,
    envelopeFn: EnvelopeFn,
  ): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;
    const runtime = this.runtimeStates.get(surfaceId);
    if (!runtime) return;

    // Enforce per-chunk byte cap
    const trimmed = data.length > MAX_CHUNK_BYTES ? data.slice(0, MAX_CHUNK_BYTES) : data;
    const chunk: RuntimeOutputChunk = {
      seq: runtime.outputBuffer.length,
      stream,
      data: trimmed,
      timestamp: Date.now(),
    };

    runtime.outputBuffer.push(chunk);
    runtime.updatedAt = Date.now();

    // Apply replay policy to trim buffer
    this.trimOutputBuffer(surface.replayPolicy, runtime);

    this._record('runtime.output', {
      surfaceId, nodeId: surface.nodeId, operationId: runtime.operationId,
      extra: { stream, dataLen: trimmed.length, bufferSize: runtime.outputBuffer.length },
    });

    // Broadcast live to surface subscribers
    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.output', {
      surfaceId,
      operationId: runtime.operationId,
      stream,
      data: trimmed,
      seq: chunk.seq,
    }));
  }

  emitStatus(
    surfaceId: string,
    status: RuntimeState['status'],
    detail: string | undefined,
    sendFn: SendFn,
    envelopeFn: EnvelopeFn,
  ): void {
    const runtime = this.runtimeStates.get(surfaceId);
    if (!runtime) return;
    runtime.status = status;
    runtime.updatedAt = Date.now();

    this._record('runtime.status', { surfaceId, operationId: runtime.operationId, extra: { status, detail } });

    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.status', {
      surfaceId,
      operationId: runtime.operationId,
      status,
      detail,
    }));
  }

  emitResult(
    surfaceId: string,
    result: { success: boolean; data?: unknown; error?: string; exitCode?: number },
    sendFn: SendFn,
    envelopeFn: EnvelopeFn,
  ): void {
    const runtime = this.runtimeStates.get(surfaceId);
    if (!runtime) return;
    const newStatus = result.success ? 'completed' as const : 'failed' as const;
    runtime.status = result.error ? 'failed' : 'completed';
    runtime.latest = result.data;
    runtime.updatedAt = Date.now();

    this._record('runtime.result', { surfaceId, operationId: runtime.operationId, extra: { success: result.success, exitCode: result.exitCode } });

    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.result', {
      surfaceId,
      operationId: runtime.operationId,
      ...result,
    }));

    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.status', {
      surfaceId,
      operationId: runtime.operationId,
      status: runtime.status,
    }));
  }

  emitEvent(
    surfaceId: string,
    event: string,
    data: unknown,
    sendFn: SendFn,
    envelopeFn: EnvelopeFn,
  ): void {
    const runtime = this.runtimeStates.get(surfaceId);
    if (!runtime) return;
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;

    const evt: RuntimeEvent = {
      seq: runtime.eventBuffer.length,
      event,
      data,
      timestamp: Date.now(),
    };

    runtime.eventBuffer.push(evt);
    runtime.updatedAt = Date.now();

    this._record('runtime.output', {
      surfaceId, nodeId: surface.nodeId, operationId: runtime.operationId,
      extra: { event, dataType: typeof data },
    });

    // Trim events per replayPolicy
    const policy = surface.replayPolicy;
    if (policy.mode === 'events' && policy.count) {
      while (runtime.eventBuffer.length > policy.count) {
        runtime.eventBuffer.shift();
      }
    }

    this.broadcastToSubscribers(surfaceId, sendFn, envelopeFn('runtime.output', {
      surfaceId,
      operationId: runtime.operationId,
      stream: 'structured',
      event,
      data,
      seq: evt.seq,
    }));
  }

  // ── Replay ──────────────────────────────────────────────────

  replayForSubscriber(
    surface: SharedSurface,
    ws: WebSocket,
    sendFn: SendFn,
    envelopeFn: EnvelopeFn,
  ): void {
    const runtime = this.runtimeStates.get(surface.surfaceId);
    if (!runtime) return;

    this._record('runtime.replay', {
      surfaceId: surface.surfaceId, nodeId: surface.nodeId, operationId: runtime.operationId,
      extra: { outputCount: runtime.outputBuffer.length, eventCount: runtime.eventBuffer.length, mode: surface.replayPolicy.mode },
    });

    // 1. Send current status
    sendFn(ws, envelopeFn('runtime.status', {
      surfaceId: surface.surfaceId,
      operationId: runtime.operationId,
      status: runtime.status,
    }));

    // 2. Replay output per replayPolicy
    const policy = surface.replayPolicy;

    if (policy.mode === 'none') {
      // No replay
    } else if (policy.mode === 'latest') {
      // Only the last output chunk
      if (runtime.outputBuffer.length > 0) {
        const last = runtime.outputBuffer[runtime.outputBuffer.length - 1];
        sendFn(ws, envelopeFn('runtime.replay', {
          surfaceId: surface.surfaceId,
          operationId: runtime.operationId,
          outputs: [last],
          events: runtime.eventBuffer.slice(-1),
        }));
      }
    } else if (policy.mode === 'tail' || policy.mode === 'full') {
      // Send buffered outputs
      const outputs = policy.mode === 'full'
        ? runtime.outputBuffer
        : runtime.outputBuffer; // trimOutputBuffer already enforced limits

      if (outputs.length > 0 || runtime.eventBuffer.length > 0) {
        sendFn(ws, envelopeFn('runtime.replay', {
          surfaceId: surface.surfaceId,
          operationId: runtime.operationId,
          outputs,
          events: runtime.eventBuffer,
        }));
      }
    } else if (policy.mode === 'events') {
      // Send event buffer
      if (runtime.eventBuffer.length > 0) {
        sendFn(ws, envelopeFn('runtime.replay', {
          surfaceId: surface.surfaceId,
          operationId: runtime.operationId,
          outputs: runtime.outputBuffer,
          events: runtime.eventBuffer,
        }));
      }
    }

    // 3. Send result if terminal
    if (runtime.status === 'completed' || runtime.status === 'failed' || runtime.status === 'cancelled') {
      sendFn(ws, envelopeFn('runtime.result', {
        surfaceId: surface.surfaceId,
        operationId: runtime.operationId,
        success: runtime.status === 'completed',
        data: runtime.latest,
        error: runtime.status === 'failed' ? 'Operation failed' : undefined,
      }));
    }
  }

  // ── Permissions ────────────────────────────────────────────

  checkPermission(
    surface: SharedSurface,
    _clientToken: string,
    action: SurfacePermission,
  ): { allowed: boolean; reason?: string } {
    // Minimal implementation: shared surfaces allow read+input to all
    // Permissions field is reserved for future fine-grained access control
    if (!surface.permissions) return { allowed: true };

    const allowedList = surface.permissions[action];
    if (!allowedList || allowedList.length === 0) {
      // No explicit allowlist → default allow for read/input on shared surfaces
      if (action === 'read' || action === 'input') {
        return { allowed: surface.shared };
      }
      // cancel/admin require explicit grant
      return { allowed: false, reason: `No ${action} permission granted` };
    }

    // Future: check _clientToken against allowedList
    return { allowed: true };
  }

  getRuntime(surfaceId: string): RuntimeState | undefined {
    return this.runtimeStates.get(surfaceId);
  }

  getSubscribers(surfaceId: string): Set<WebSocket> | undefined {
    return this.subscribers.get(surfaceId);
  }

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
    };
  }

  // ── Backward-compat projection ──────────────────────────────

  toWorkbenchTab(surface: SharedSurface): {
    id: string;
    title: string;
    viewType: string;
    instanceId?: string;
    pluginId?: string;
    _surfaceId: string;
    _operationId?: string;
  } {
    return {
      id: surface.surfaceId,
      title: surface.title,
      viewType: surface.viewType,
      instanceId: surface.runtimeRef.instanceId,
      pluginId: surface.pluginId,
      _surfaceId: surface.surfaceId,
      _operationId: surface.runtimeRef.operationId,
    };
  }

  /** Import a surface from an upstream relay with instanceId remapping.
   *  Uses the same surfaceId so cross-relay update/close messages match.
   *  Generates a new local operationId for terminal surfaces. */
  importFromUpstream(
    surfaceData: {
      surfaceId: string;
      nodeId: string;
      title: string;
      viewType: string;
      pluginId?: string;
      scope: string;
      shared: boolean;
      runtimeRef: SharedSurface['runtimeRef'];
      replayPolicy?: ReplayPolicy;
      permissions?: SharedSurface['permissions'];
      createdBy?: string;
      createdAt?: number;
    },
    remappedInstanceId: string,
  ): SharedSurface | null {
    // Skip if already exists
    if (this.surfaces.has(surfaceData.surfaceId)) {
      this._record('surface.publish.duplicate', { surfaceId: surfaceData.surfaceId, nodeId: surfaceData.nodeId });
      return this.surfaces.get(surfaceData.surfaceId)!;
    }
    const now = Date.now();
    const policy = surfaceData.replayPolicy || defaultReplayPolicy(surfaceData.viewType);
    const remappedRuntimeRef = {
      ...surfaceData.runtimeRef,
      instanceId: remappedInstanceId,
      // operationId from upstream is relay-local; we'll generate a new one
    };
    const surface: SharedSurface = {
      surfaceId: surfaceData.surfaceId,
      nodeId: remappedInstanceId,
      title: surfaceData.title,
      viewType: surfaceData.viewType,
      pluginId: surfaceData.pluginId,
      scope: (surfaceData.scope as SharedSurface['scope']) || 'node',
      shared: surfaceData.shared !== false,
      runtimeRef: remappedRuntimeRef,
      replayPolicy: policy,
      permissions: surfaceData.permissions,
      createdBy: surfaceData.createdBy || 'upstream',
      createdAt: surfaceData.createdAt || now,
      updatedAt: now,
    };
    this.surfaces.set(surface.surfaceId, surface);
    this._record('surface.import', {
      surfaceId: surface.surfaceId, nodeId: remappedInstanceId,
      instanceId: surface.runtimeRef.instanceId,
      extra: { originalNodeId: surfaceData.nodeId, viewType: surface.viewType },
    });
    // Generate local operationId for terminal surfaces
    if (surface.runtimeRef.kind === 'terminal') {
      const localOpId = this.nextOperationId();
      this.linkOperation(surface.surfaceId, localOpId);
    }
    return surface;
  }

  // ── Internal helpers ────────────────────────────────────────

  /** Send a message to all browser subscribers observing a given node. */
  broadcastToNodeSubscribers(
    nodeId: string,
    sendFn: SendFn,
    msg: any,
  ): void {
    const subs = this.nodeSubscribers.get(nodeId);
    if (!subs || subs.size === 0) return;
    for (const ws of subs) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        sendFn(ws, msg);
      } else {
        subs.delete(ws);
      }
    }
  }

  private broadcastToSubscribers(
    surfaceId: string,
    sendFn: SendFn,
    msg: any,
  ): void {
    const subs = this.subscribers.get(surfaceId);
    if (!subs || subs.size === 0) return;
    for (const ws of subs) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        sendFn(ws, msg);
      } else {
        subs.delete(ws);
      }
    }
  }

  private trimOutputBuffer(policy: ReplayPolicy, runtime: RuntimeState): void {
    let totalBytes = 0;
    for (const c of runtime.outputBuffer) {
      totalBytes += c.data.length;
    }

    if (policy.mode === 'none') {
      runtime.outputBuffer = [];
      return;
    }

    if (policy.mode === 'latest') {
      // Keep only the last chunk
      if (runtime.outputBuffer.length > 1) {
        runtime.outputBuffer = [runtime.outputBuffer[runtime.outputBuffer.length - 1]];
      }
      return;
    }

    if (policy.mode === 'tail') {
      const maxLines = policy.lines || DEFAULT_TAIL_LINES;
      const maxBytes = policy.bytes || DEFAULT_TAIL_BYTES;

      // Trim by lines (each chunk ≈ 1 line for terminal output)
      while (runtime.outputBuffer.length > maxLines) {
        runtime.outputBuffer.shift();
      }

      // Trim by bytes
      while (totalBytes > maxBytes && runtime.outputBuffer.length > 0) {
        const removed = runtime.outputBuffer.shift()!;
        totalBytes -= removed.data.length;
      }
      return;
    }

    if (policy.mode === 'events') {
      const maxEvents = policy.count || 100;
      while (runtime.eventBuffer.length > maxEvents) {
        runtime.eventBuffer.shift();
      }
      // Also trim output buffer to event count
      while (runtime.outputBuffer.length > maxEvents) {
        runtime.outputBuffer.shift();
      }
      return;
    }

    if (policy.mode === 'full') {
      const maxBytes = policy.maxBytes || MAX_OUTPUT_SIZE;
      while (totalBytes > maxBytes && runtime.outputBuffer.length > 0) {
        const removed = runtime.outputBuffer.shift()!;
        totalBytes -= removed.data.length;
      }
    }
  }
}
