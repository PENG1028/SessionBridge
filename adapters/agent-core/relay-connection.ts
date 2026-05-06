// ─── Relay Connection ──────────────────────────────────────────
// Manages the WebSocket connection from agent to relay server.
// Handles: hello handshake, agent registration, message
// forwarding, heartbeat, and exponential-backoff reconnection.

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { envelope, parseMsg } from '../protocol';
import { VERSION } from '../version';
import type { NodeConfig } from './config';

export interface RelayConnectionEvents {
  registered: (instanceId: string) => void;
  stdin: (instanceId: string, data: string) => void;
  instanceSpawned: (requestId: string, instanceId: string) => void;
  instanceExit: (instanceId: string) => void;
  control: (requestId: string, request: string) => void;
  notification: (type: string, title: string, detail: string) => void;
  error: (code: string, message: string) => void;
  configPush: (entries: { key: string; value: unknown }[], requestId: string) => void;
  close: () => void;
}

export class RelayConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private closing = false;
  private _instanceId: string | null = null;

  constructor(private config: NodeConfig) {
    super();
  }

  get instanceId(): string | null { return this._instanceId; }

  /** Current WebSocket send buffer size (bytes). Used for backpressure control. */
  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  connect(): void {
    if (this.closing) return;

    this.ws = new WebSocket(this.config.upstreamRelay || `ws://127.0.0.1:${this.config.relayPort}`);

    this.ws.on('open', () => {
      this.reconnectDelay = 1000;
      // Send hello with capability negotiation
      this.ws!.send(JSON.stringify(envelope('hello', {
        role: 'agent',
        version: VERSION,
        features: ['agent_register', 'structured_events', 'shell', 'system_info'],
        ...(this.config.relayToken ? { token: this.config.relayToken } : {}),
      })));
    });

    this.ws.on('message', (raw) => {
      const msg = parseMsg(raw.toString());
      if (!msg) return;

      switch (msg.type) {
        case 'welcome':
          // Now register
          this.ws!.send(JSON.stringify(envelope('agent.register', {
            dir: this.config.workingDirectory,
            label: this.config.label,
          })));
          break;

        case 'agent.registered':
          this._instanceId = msg.instanceId;
          this.emit('registered', this._instanceId);
          break;

        case 'agent.stdin':
          this.emit('stdin', msg.instanceId || this._instanceId || '', msg.data);
          break;

        case 'agent.control':
          this.emit('control', msg.request_id, msg.request);
          break;

        case 'agent.instance.spawned':
          this.emit('instanceSpawned', msg.requestId || '', msg.instanceId);
          break;

        case 'agent.instance.exit':
          this.emit('instanceExit', msg.instanceId);
          break;

        case 'ping':
          this.ws!.send(JSON.stringify(envelope('pong', {})));
          break;

        case 'config.push':
          this.emit('configPush', msg.entries || [], msg.requestId || '');
          break;

        case 'system.notification':
          this.emit('notification', msg.type || 'info', msg.title || '', msg.detail || '');
          break;

        case 'error':
          this.emit('error', msg.code || '', msg.message || '');
          break;
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
      this._instanceId = null;
      this.emit('close');
      if (!this.closing) this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      // close event fires after this
    });
  }

  private static readonly MAX_CHUNK = 65536; // 64KB per chunk
  private _chunkSeq = 0;

  /** Split a large payload into chunked messages to avoid WebSocket frame limits. */
  private sendChunked(type: string, instanceId: string, field: string, payload: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (payload.length <= RelayConnection.MAX_CHUNK) {
      this.ws.send(JSON.stringify(envelope(type, { instanceId, [field]: payload })));
      return;
    }
    const msgId = `${instanceId}-${++this._chunkSeq}`;
    const total = Math.ceil(payload.length / RelayConnection.MAX_CHUNK);
    for (let seq = 0; seq < total; seq++) {
      const chunk = payload.slice(seq * RelayConnection.MAX_CHUNK, (seq + 1) * RelayConnection.MAX_CHUNK);
      this.ws.send(JSON.stringify(envelope(type, {
        instanceId,
        [field]: chunk,
        chunk: { msgId, seq, total },
      })));
    }
  }

  /** Send stdout data from a local adapter to relay. */
  sendStdout(line: string): void {
    if (!this._instanceId) return;
    this.sendChunked('agent.stdout', this._instanceId, 'line', line);
  }

  /** Send stderr data to relay. */
  sendStderr(data: string): void {
    if (!this._instanceId) return;
    this.sendChunked('agent.stderr', this._instanceId, 'data', data);
  }

  /** Send a notification to the relay (for forwarding to browsers). */
  sendNotification(scenarioId: string, title: string, detail?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope('agent.notification', { scenarioId, title, detail })));
    }
  }

  /** Request the relay to create a sub-instance for a bridge run shell. */
  sendInstanceSpawn(requestId: string, label: string, dir: string, command: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope('agent.instance.spawn', { requestId, label, dir, command })));
    }
  }

  /** Send stdout for a specific sub-instance. */
  sendStdoutForInstance(instanceId: string, line: string): void {
    this.sendChunked('agent.stdout', instanceId, 'line', line);
  }

  /** Send stderr for a specific sub-instance. */
  sendStderrForInstance(instanceId: string, data: string): void {
    this.sendChunked('agent.stderr', instanceId, 'data', data);
  }

  /** Notify relay that a sub-instance has exited. */
  sendInstanceExit(instanceId: string, exitCode: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope('agent.instance.exit', { instanceId, exitCode })));
    }
  }

  /** Send config ack back to relay after applying a config push. */
  sendConfigAck(requestId: string, applied: string[], rejected: { key: string; reason: string }[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope('config.ack', { requestId, applied, rejected })));
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(envelope('bye', { reason: 'shutdown' })));
      }
      this.ws.close();
      this.ws = null;
    }
  }
}
