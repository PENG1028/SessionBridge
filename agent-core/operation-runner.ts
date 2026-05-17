// ─── Agent-Side Operation Runner ────────────────────────────
// Receives relay.operation.* messages and dispatches them to
// registered handlers. Each handler runs on the agent device
// and sends back agent.operation.{status,output,result}.
//
// Mirrors the relay-side RemoteOperationManager protocol.

import os from 'os';
import { getSystemState } from './introspection';

// ── Types ──────────────────────────────────────────────────

export type OperationKind = 'plugin' | 'adapter_command' | 'terminal' | 'task';

export interface OperationContext {
  operationId: string;
  kind: OperationKind;
  pluginId?: string;
  command?: string;
  input?: unknown;
  nodeId?: string;
  instanceId?: string;
  dir?: string;
  createdAt: number;
}

export interface OperationTransport {
  send(type: string, body: Record<string, unknown>): void;
}

export type OperationHandler = (
  ctx: OperationContext,
  transport: OperationTransport,
  onCancel?: (cb: () => void) => void,
) => Promise<void> | void;

// ── Runner ─────────────────────────────────────────────────

export class OperationRunner {
  private handlers = new Map<string, OperationHandler>();
  private operations = new Map<string, OperationContext>();
  private cancelCallbacks = new Map<string, () => void>();

  constructor(private transport: OperationTransport) {
    this.registerBuiltins();
  }

  // ── Handler registration ──────────────────────────────────

  /** Register a handler for a given kind (e.g. "plugin", "adapter_command"). */
  registerHandler(kind: string, handler: OperationHandler): void {
    this.handlers.set(kind, handler);
  }

  /** Return all currently tracked operations (for agent inventory). */
  listActive(): OperationContext[] {
    return Array.from(this.operations.values());
  }

  // ── Message dispatch (call from relayMessage handler) ──────

  handleMessage(msg: any): boolean {
    switch (msg.type) {
      case 'relay.operation.start':
        this.start(msg);
        return true;
      case 'relay.operation.input':
        this.input(msg.operationId, msg.data);
        return true;
      case 'relay.operation.cancel':
        this.cancel(msg.operationId);
        return true;
      default:
        return false;
    }
  }

  // ── Operation lifecycle ───────────────────────────────────

  private async start(msg: any): Promise<void> {
    const operationId = String(msg.operationId || '');
    const kind = (msg.kind || 'plugin') as OperationKind;
    const pluginId = msg.pluginId ? String(msg.pluginId) : undefined;
    const command = msg.command ? String(msg.command) : undefined;

    if (!operationId) return;

    const ctx: OperationContext = {
      operationId,
      kind,
      pluginId,
      command,
      input: msg.input,
      nodeId: msg.nodeId,
      instanceId: msg.instanceId,
      dir: msg.dir,
      createdAt: Date.now(),
    };

    this.operations.set(operationId, ctx);

    const handler = this.handlers.get(kind);
    if (!handler) {
      this.transport.send('agent.operation.status', {
        operationId,
        kind,
        status: 'failed',
        detail: `No handler registered for kind "${kind}"`,
      });
      this.transport.send('agent.operation.result', {
        operationId,
        success: false,
        error: `No handler for kind "${kind}"`,
      });
      return;
    }

    this.transport.send('agent.operation.status', {
      operationId,
      kind,
      status: 'running',
      detail: `Executing ${pluginId || kind}${command ? '/' + command : ''}`,
    });

    try {
      await handler(ctx, this.transport, (cb) => {
        this.cancelCallbacks.set(operationId, cb);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.transport.send('agent.operation.status', {
        operationId,
        kind,
        status: 'failed',
        detail: message,
      });
      this.transport.send('agent.operation.result', {
        operationId,
        success: false,
        error: message,
      });
    } finally {
      this.cancelCallbacks.delete(operationId);
    }
  }

  private input(operationId: string, data: string): void {
    // For process-based operations, stdin would be written here.
    // For now, handlers receive input via the start message input field.
    // Future: relay.operation.input can be forwarded to process.stdin.
    if (!this.operations.has(operationId)) return;
    // Stored for potential use by handlers polling ctx.input
    const ctx = this.operations.get(operationId)!;
    this.transport.send('agent.operation.output', {
      operationId,
      stream: 'stdin_echo',
      data,
    });
  }

  cancel(operationId: string): void {
    const cb = this.cancelCallbacks.get(operationId);
    if (cb) {
      cb();
      this.cancelCallbacks.delete(operationId);
    }
    const ctx = this.operations.get(operationId);
    if (ctx) {
      this.transport.send('agent.operation.status', {
        operationId,
        kind: ctx.kind,
        status: 'cancelled',
        detail: 'Cancelled by user',
      });
    }
  }

  // ── Built-in handlers ─────────────────────────────────────

  private registerBuiltins(): void {
    // mock-echo: the minimal round-trip proof
    this.registerHandler('plugin', async (ctx, transport, onCancel) => {
      if (ctx.pluginId === 'mock-echo' && ctx.command === 'echo') {
        const input = (ctx.input as any) || {};
        const text = input.text || 'no input';
        const hostname = os.hostname();

        let cancelled = false;
        onCancel?.(() => { cancelled = true; });

        // Simulate work then echo
        await new Promise(r => setTimeout(r, 50));
        if (cancelled) return;

        transport.send('agent.operation.output', {
          operationId: ctx.operationId,
          stream: 'structured',
          seq: 1,
          data: JSON.stringify({ echoed: text, node: hostname, time: Date.now() }),
        });

        transport.send('agent.operation.result', {
          operationId: ctx.operationId,
          success: true,
          data: { echoed: text, node: hostname },
        });
        return;
      }

      // system-info: runs on the agent device, returns real system state.
      // Proves remote execution by surfacing agent hostname/platform, not relay's.
      if (ctx.pluginId === 'system-info') {
        const state = getSystemState();

        transport.send('agent.operation.output', {
          operationId: ctx.operationId,
          stream: 'structured',
          seq: 1,
          data: JSON.stringify(state),
        });

        transport.send('agent.operation.result', {
          operationId: ctx.operationId,
          success: true,
          data: {
            platform: state.platform,
            hostname: state.hostname,
            arch: state.arch,
            cpus: state.cpus,
            memory_total: state.memory.total,
            memory_free: state.memory.free,
            uptime: state.uptime,
            nodeVersion: state.nodeVersion,
          },
        });
        return;
      }

      // Unknown plugin: fail gracefully
      transport.send('agent.operation.status', {
        operationId: ctx.operationId,
        kind: ctx.kind,
        status: 'failed',
        detail: `Unknown plugin: ${ctx.pluginId || 'none'}`,
      });
      transport.send('agent.operation.result', {
        operationId: ctx.operationId,
        success: false,
        error: `Unknown plugin: ${ctx.pluginId || 'none'}`,
      });
    });

    // adapter_command: used by adapter runtime operations
    this.registerHandler('adapter_command', async (ctx, transport) => {
      transport.send('agent.operation.status', {
        operationId: ctx.operationId,
        kind: ctx.kind,
        status: 'running',
        detail: `Adapter command: ${ctx.command || 'unknown'}`,
      });

      transport.send('agent.operation.output', {
        operationId: ctx.operationId,
        stream: 'structured',
        seq: 1,
        data: JSON.stringify({ adapter: ctx.pluginId, command: ctx.command, node: os.hostname() }),
      });

      transport.send('agent.operation.result', {
        operationId: ctx.operationId,
        success: true,
        data: { node: os.hostname() },
      });
    });
  }
}
