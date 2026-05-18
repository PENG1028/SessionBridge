// ─── Remote Operation Manager ────────────────────────────────
// Unified model for all remote execution: terminal, plugin, adapter
// command, background task. Enforces routing invariants at one
// choke point instead of per-handler.
//
// Invariants (enforced by validateTarget):
//   R1: Target node MUST exist → TARGET_NOT_FOUND
//   R2: Remote agent MUST be connected → AGENT_DISCONNECTED
//   R3: NEVER fallback to local execution
//   R4: Output SCOPE to operation subscribers only
//   R5: Status changes broadcast to subscribers
//   R6: Late joiners get full replay

import type { WebSocket } from "ws";
import type { InstanceData } from "./instance-manager";

// ─── Types ─────────────────────────────────────────────────

export type OperationKind = "terminal" | "plugin" | "adapter_command" | "task";

export type OperationStatus =
  | "pending"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface OperationInput {
  text?: string;
  [key: string]: unknown;
}

export interface OperationOutput {
  seq: number;
  stream: "stdout" | "stderr" | "structured";
  data: string;
  timestamp: number;
}

export interface OperationResult {
  success: boolean;
  data?: Record<string, unknown>;
  exitCode?: number;
  error?: string;
}

export interface RemoteOperation {
  operationId: string;
  nodeId: string;
  instanceId?: string;
  kind: OperationKind;
  status: OperationStatus;
  pluginId?: string;
  command?: string;
  input?: OperationInput;
  createdBy: string;
  createdAt: number;
  completedAt?: number;
  outputBuffer: OperationOutput[];
  outputSize: number;
  result?: OperationResult;
  error?: string;
  subscribers: Set<WebSocket>;
}

export class OperationError extends Error {
  constructor(
    public code: string,
    message: string,
    public reported: boolean = true,
  ) {
    super(message);
    this.name = "OperationError";
    // Mark as already reported so outer catch doesn't double-send
    (this as any)._reported = reported;
  }
}

// ─── Output buffer caps ────────────────────────────────────

const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB per operation

// ─── Manager ───────────────────────────────────────────────

export class RemoteOperationManager {
  private operations = new Map<string, RemoteOperation>();
  private opCounter = 0;

  // ── Validation (R1, R2, R3) ─────────────────────────────

  /**
   * Validate that a remote target exists and its agent is connected.
   * Returns the instance on success, throws OperationError on failure.
   * This is THE choke point — NO remote operation bypasses this.
   */
  validateTarget(
    nodeId: string,
    instanceGetter: (id: string) => InstanceData | undefined,
  ): InstanceData {
    const instance = instanceGetter(nodeId);
    if (!instance) {
      throw new OperationError(
        "TARGET_NOT_FOUND",
        `Node ${nodeId} not found`,
      );
    }

    if (instance.source === "remote") {
      if (
        !instance.agentConnection ||
        instance.agentConnection.readyState !== 1 // WebSocket.OPEN
      ) {
        throw new OperationError(
          "AGENT_DISCONNECTED",
          `Agent for ${nodeId} (${instance.label}) is not connected`,
        );
      }
    }
    // Local instances ok — they run on this relay
    return instance;
  }

  // ── CRUD ─────────────────────────────────────────────────

  create(
    nodeId: string,
    kind: OperationKind,
    opts: {
      instanceId?: string;
      pluginId?: string;
      command?: string;
      input?: OperationInput;
      createdBy: string;
    },
  ): RemoteOperation {
    const operationId = `op_${++this.opCounter}_${Date.now().toString(36)}`;
    const op: RemoteOperation = {
      operationId,
      nodeId,
      instanceId: opts.instanceId || nodeId,
      kind,
      status: "starting",
      pluginId: opts.pluginId,
      command: opts.command,
      input: opts.input,
      createdBy: opts.createdBy,
      createdAt: Date.now(),
      outputBuffer: [],
      outputSize: 0,
      subscribers: new Set(),
    };
    this.operations.set(operationId, op);
    return op;
  }

  get(operationId: string): RemoteOperation | undefined {
    return this.operations.get(operationId);
  }

  /** Find all operations on a node. */
  listByNode(nodeId: string): RemoteOperation[] {
    const result: RemoteOperation[] = [];
    for (const op of this.operations.values()) {
      if (op.nodeId === nodeId) result.push(op);
    }
    return result;
  }

  delete(operationId: string): boolean {
    return this.operations.delete(operationId);
  }

  // ── Subscribers (R4, R6) ─────────────────────────────────

  subscribe(
    operationId: string,
    ws: WebSocket,
    sendFn: (ws: WebSocket, msg: unknown) => void,
    envelopeFn: (type: string, body: Record<string, unknown>) => unknown,
  ): RemoteOperation | null {
    const op = this.operations.get(operationId);
    if (!op) return null;

    op.subscribers.add(ws);

    // Auto-cleanup on disconnect
    const onClose = () => {
      op.subscribers.delete(ws);
      if (op.subscribers.size === 0) {
        // Keep the operation in the map for replay/late joiners
        // Cleanup old completed operations periodically instead
      }
    };
    ws.addEventListener("close", onClose, { once: true });

    // Replay: send current status first
    sendFn(
      ws,
      envelopeFn("operation.status", {
        operationId,
        nodeId: op.nodeId,
        kind: op.kind,
        status: op.status,
        pluginId: op.pluginId,
        command: op.command,
        createdAt: op.createdAt,
      }),
    );

    // Replay: send buffered output
    for (const out of op.outputBuffer) {
      sendFn(
        ws,
        envelopeFn("operation.output", {
          operationId,
          seq: out.seq,
          stream: out.stream,
          data: out.data,
        }),
      );
    }

    // Replay: send result if terminal
    if (op.status === "completed" || op.status === "failed") {
      if (op.result) {
        sendFn(
          ws,
          envelopeFn("operation.result", {
            operationId,
            success: op.result.success,
            data: op.result.data,
            exitCode: op.result.exitCode,
            error: op.result.error,
          }),
        );
      }
    }

    return op;
  }

  unsubscribe(operationId: string, ws: WebSocket): void {
    const op = this.operations.get(operationId);
    if (!op) return;
    op.subscribers.delete(ws);
    if (op.subscribers.size === 0) {
      // Garbage-collect completed operations with no subscribers after 5 min
      if (op.status === "completed" || op.status === "failed" || op.status === "cancelled") {
        if (Date.now() - (op.completedAt || op.createdAt) > 300_000) {
          this.operations.delete(operationId);
        }
      }
    }
  }

  // ── Output (R4, R5) ──────────────────────────────────────

  emitOutput(
    operationId: string,
    stream: "stdout" | "stderr" | "structured",
    data: string,
    sendFn: (ws: WebSocket, msg: unknown) => void,
    envelopeFn: (type: string, body: Record<string, unknown>) => unknown,
  ): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    const capped = data.slice(0, 65536); // 64KB per message cap
    const seq = op.outputBuffer.length;
    const out: OperationOutput = {
      seq,
      stream,
      data: capped,
      timestamp: Date.now(),
    };

    op.outputBuffer.push(out);
    op.outputSize += capped.length;

    // Trim buffer if over size cap
    while (op.outputSize > MAX_OUTPUT_SIZE && op.outputBuffer.length > 0) {
      const removed = op.outputBuffer.shift()!;
      op.outputSize -= removed.data.length;
    }

    // Send to all subscribers (R4: scoped, not global)
    const msg = envelopeFn("operation.output", {
      operationId,
      seq: out.seq,
      stream: out.stream,
      data: out.data,
    });

    for (const ws of op.subscribers) {
      if (ws.readyState === 1) sendFn(ws, msg);
      else op.subscribers.delete(ws);
    }
  }

  emitStatus(
    operationId: string,
    status: OperationStatus,
    detail: string | undefined,
    sendFn: (ws: WebSocket, msg: unknown) => void,
    envelopeFn: (type: string, body: Record<string, unknown>) => unknown,
  ): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    op.status = status;

    const msg = envelopeFn("operation.status", {
      operationId,
      nodeId: op.nodeId,
      kind: op.kind,
      status,
      detail,
    });

    // R5: broadcast to all subscribers
    for (const ws of op.subscribers) {
      if (ws.readyState === 1) sendFn(ws, msg);
      else op.subscribers.delete(ws);
    }
  }

  complete(
    operationId: string,
    result: OperationResult,
    sendFn: (ws: WebSocket, msg: unknown) => void,
    envelopeFn: (type: string, body: Record<string, unknown>) => unknown,
  ): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    op.status = result.success ? "completed" : "failed";
    op.completedAt = Date.now();
    op.result = result;
    if (result.error) op.error = result.error;

    const msg = envelopeFn("operation.result", {
      operationId,
      success: result.success,
      data: result.data,
      exitCode: result.exitCode,
      error: result.error,
    });

    // Send to all subscribers
    for (const ws of op.subscribers) {
      if (ws.readyState === 1) sendFn(ws, msg);
      else op.subscribers.delete(ws);
    }

    // Also send final status
    this.emitStatus(operationId, op.status, undefined, sendFn, envelopeFn);
  }

  // ── Agent forwarding ─────────────────────────────────────

  /** Forward operation.start to the agent via its WebSocket. */
  forwardToAgent(
    op: RemoteOperation,
    instance: InstanceData,
    sendFn: (ws: WebSocket, msg: unknown) => void,
    envelopeFn: (type: string, body: Record<string, unknown>) => unknown,
  ): boolean {
    if (
      !instance.agentConnection ||
      instance.agentConnection.readyState !== 1
    ) {
      return false;
    }

    sendFn(
      instance.agentConnection,
      envelopeFn("relay.operation.start", {
        operationId: op.operationId,
        kind: op.kind,
        pluginId: op.pluginId,
        command: op.command,
        input: op.input,
        dir: instance.dir,
        instanceId: op.instanceId,
      }),
    );
    return true;
  }

  /** Forward operation input to the agent. */
  forwardInputToAgent(
    operationId: string,
    data: string,
    instanceGetter: (id: string) => InstanceData | undefined,
    sendFn: (ws: WebSocket, msg: unknown) => void,
    envelopeFn: (type: string, body: Record<string, unknown>) => unknown,
  ): boolean {
    const op = this.operations.get(operationId);
    if (!op) return false;

    const instance = instanceGetter(op.instanceId || op.nodeId);
    if (!instance || !instance.agentConnection || instance.agentConnection.readyState !== 1) {
      return false;
    }

    sendFn(
      instance.agentConnection,
      envelopeFn("relay.operation.input", {
        operationId,
        data,
      }),
    );
    return true;
  }

  /** Get operation metadata (read-only public accessor). */
  getOperation(operationId: string): RemoteOperation | undefined {
    return this.operations.get(operationId);
  }

  /** Cancel an operation. */
  cancel(
    operationId: string,
    sendFn: (ws: WebSocket, msg: unknown) => void,
    envelopeFn: (type: string, body: Record<string, unknown>) => unknown,
  ): boolean {
    const op = this.operations.get(operationId);
    if (!op) return false;
    if (op.status === "completed" || op.status === "failed" || op.status === "cancelled") {
      return false;
    }

    this.emitStatus(operationId, "cancelled", "Cancelled by user", sendFn, envelopeFn);
    return true;
  }

  // ── Queries ──────────────────────────────────────────────

  /** Find an operation by instanceId + kind. Used for shell.spawn backward compat. */
  findByInstanceAndKind(instanceId: string, kind: OperationKind): RemoteOperation | undefined {
    for (const op of this.operations.values()) {
      if (op.instanceId === instanceId && op.kind === kind) return op;
    }
    return undefined;
  }

  toJSON(operationId: string): Record<string, unknown> | null {
    const op = this.operations.get(operationId);
    if (!op) return null;

    return {
      operationId: op.operationId,
      nodeId: op.nodeId,
      instanceId: op.instanceId,
      kind: op.kind,
      status: op.status,
      pluginId: op.pluginId,
      command: op.command,
      createdBy: op.createdBy,
      createdAt: op.createdAt,
      completedAt: op.completedAt,
      outputSize: op.outputSize,
      outputCount: op.outputBuffer.length,
      subscriberCount: op.subscribers.size,
      result: op.result,
      error: op.error,
    };
  }
}
