// ─── Relay Connection ──────────────────────────────────────────
// Manages the WebSocket connection from agent to relay server.
// Handles: hello handshake with ECDH crypto, agent registration,
// message forwarding, heartbeat, and exponential-backoff reconnection.

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { envelope, parseMsg } from '../extensions/protocol';
import { VERSION } from '../extensions/version';
import { CryptoStream } from '../src/crypto-stream';
import { tryDecrypt } from '../src/crypto-layer';
import { loadOrCreateIdentity } from '../src/identity-manager';
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
  /** Catch-all for messages not handled by the switch (e.g. workbench.*). */
  relayMessage: (msg: any) => void;
}

export class RelayConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private closing = false;
  private _instanceId: string | null = null;
  private _cryptoStream: CryptoStream | null = null;
  private _identity: ReturnType<typeof loadOrCreateIdentity>;
  /** Network role: 'relay' or 'leaf'. Set before connect() if known. */
  private _role: string = 'leaf';
  private _status: 'idle' | 'connecting' | 'connected' | 'registered' | 'closed' | 'error' = 'idle';
  private _lastError = '';

  constructor(private config: NodeConfig) {
    super();
    this._identity = loadOrCreateIdentity(config.identityPath);
  }

  get instanceId(): string | null { return this._instanceId; }
  get status(): string { return this._status; }
  get lastError(): string { return this._lastError; }
  get upstreamRelay(): string | undefined { return this.config.upstreamRelay; }
  setRole(role: 'relay' | 'leaf'): void { this._role = role; }

  async reconnectTo(upstreamRelay: string): Promise<void> {
    await this.shutdown();
    this.config.upstreamRelay = upstreamRelay;
    this.closing = false;
    this.connect();
  }

  async disconnectUpstream(): Promise<void> {
    await this.shutdown();
    this.config.upstreamRelay = undefined;
  }

  /** Current WebSocket send buffer size (bytes). Used for backpressure control. */
  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  /** Send a raw string, encrypted if crypto is established. */
  private sendRaw(data: string): void {
    if (this._cryptoStream?.isEstablished) {
      this._cryptoStream.send(data);
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /** Send an arbitrary enveloped message upstream. */
  async send(type: string, body: Record<string, unknown> = {}): Promise<void> {
    this.sendRaw(JSON.stringify(envelope(type, body)));
  }

  connect(): void {
    if (this.closing) return;

    this._status = 'connecting';
    this._lastError = '';
    this.ws = new WebSocket(this.config.upstreamRelay || `ws://127.0.0.1:${this.config.relayPort}`);

    this.ws.on('open', () => {
      this.reconnectDelay = 1000;
      this._status = 'connected';

      // Create crypto stream for ECDH handshake
      const cryptoStream = new CryptoStream(this.ws!, this._identity);
      this._cryptoStream = cryptoStream;

      // Send hello with capability negotiation + crypto keys
      const helloBody: Record<string, unknown> = {
        role: 'agent',
        version: VERSION,
        features: ['crypto_v1', 'agent_register', 'structured_events', 'shell', 'system_info'],
        ...(this.config.relayToken ? { token: this.config.relayToken } : {}),
        staticKey: cryptoStream.staticKey,
        ephemeralKey: cryptoStream.ephemeralKey,
      };
      this.sendRaw(JSON.stringify(envelope('hello', helloBody)));
    });

    this.ws.on('message', (raw) => {
      // Decrypt if crypto is established
      const rawStr = this._cryptoStream?.isEstablished
        ? tryDecrypt(this._cryptoStream.sessionKey, raw.toString())
        : raw.toString();

      const msg = parseMsg(rawStr);
      if (!msg) return;

      switch (msg.type) {
        case 'welcome':
          // Complete crypto handshake if server supports it
          if (this._cryptoStream && msg.staticKey && msg.ephemeralKey) {
            this._cryptoStream.handshake(
              String(msg.ephemeralKey),
              String(msg.staticKey),
            );
          }
          // Now register
          this.sendRaw(JSON.stringify(envelope('agent.register', {
            dir: this.config.workingDirectory,
            label: this.config.label,
            role: this._role,
          })));
          break;

        case 'agent.registered':
          this._instanceId = msg.instanceId;
          this._status = 'registered';
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
          this.sendRaw(JSON.stringify(envelope('pong', {})));
          break;

        case 'config.push':
          this.emit('configPush', msg.entries || [], msg.requestId || '');
          break;

        case 'node.external.inspect':
          this.emit('nodeExternalInspect', msg.requestId || '');
          break;

        case 'node.external.set':
          this.emit('nodeExternalSet', msg.requestId || '', msg.enable === true);
          break;

        case 'system.notification':
          this.emit('notification', msg.type || 'info', msg.title || '', msg.detail || '');
          break;

        case 'error':
          this.emit('error', msg.code || '', msg.message || '');
          break;

        default:
          this.emit('relayMessage', msg);
          break;
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
      this._instanceId = null;
      this._cryptoStream = null;
      this._status = this.closing ? 'closed' : 'error';
      this.emit('close');
      if (!this.closing) this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this._status = 'error';
      this._lastError = err instanceof Error ? err.message : String(err);
      // close event fires after this
    });
  }

  waitUntilRegistered(timeoutMs = 5000): Promise<boolean> {
    if (this._instanceId) return Promise.resolve(true);
    return new Promise((resolve) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off('registered', onRegistered);
        this.off('error', onDone);
        this.off('close', onDone);
      };
      const onRegistered = () => {
        cleanup();
        resolve(true);
      };
      const onDone = () => {
        cleanup();
        resolve(false);
      };
      const timer = setTimeout(onDone, timeoutMs);
      this.once('registered', onRegistered);
      this.once('error', onDone);
      this.once('close', onDone);
    });
  }

  private static readonly MAX_CHUNK = 65536; // 64KB per chunk
  private _chunkSeq = 0;

  /** Split a large payload into chunked messages to avoid WebSocket frame limits. */
  private sendChunked(type: string, instanceId: string, field: string, payload: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN && !this._cryptoStream?.isEstablished) return;
    if (payload.length <= RelayConnection.MAX_CHUNK) {
      this.sendRaw(JSON.stringify(envelope(type, { instanceId, [field]: payload })));
      return;
    }
    const msgId = `${instanceId}-${++this._chunkSeq}`;
    const total = Math.ceil(payload.length / RelayConnection.MAX_CHUNK);
    for (let seq = 0; seq < total; seq++) {
      const chunk = payload.slice(seq * RelayConnection.MAX_CHUNK, (seq + 1) * RelayConnection.MAX_CHUNK);
      this.sendRaw(JSON.stringify(envelope(type, {
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
    this.sendRaw(JSON.stringify(envelope('agent.notification', { scenarioId, title, detail })));
  }

  /** Request the relay to create a sub-instance for a bridge run shell. */
  sendInstanceSpawn(requestId: string, label: string, dir: string, command: string): void {
    this.sendRaw(JSON.stringify(envelope('agent.instance.spawn', { requestId, label, dir, command })));
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
    this.sendRaw(JSON.stringify(envelope('agent.instance.exit', { instanceId, exitCode })));
  }

  /** Send config ack back to relay after applying a config push. */
  sendConfigAck(requestId: string, applied: string[], rejected: { key: string; reason: string }[]): void {
    this.sendRaw(JSON.stringify(envelope('config.ack', { requestId, applied, rejected })));
  }

  /** Send operation output (scoped to operationId). */
  sendOperationOutput(operationId: string, stream: string, data: string, seq?: number): void {
    const body: Record<string, unknown> = { operationId, stream, data };
    if (seq !== undefined) body.seq = seq;
    this.sendRaw(JSON.stringify(envelope('agent.operation.output', body)));
  }

  /** Send operation status update. */
  sendOperationStatus(operationId: string, status: string, kind?: string, detail?: string): void {
    const body: Record<string, unknown> = { operationId, status };
    if (kind) body.kind = kind;
    if (detail) body.detail = detail;
    this.sendRaw(JSON.stringify(envelope('agent.operation.status', body)));
  }

  /** Send operation final result. */
  sendOperationResult(operationId: string, success: boolean, data?: unknown, error?: string, exitCode?: number): void {
    const body: Record<string, unknown> = { operationId, success };
    if (data !== undefined) body.data = data;
    if (error) body.error = error;
    if (exitCode !== undefined) body.exitCode = exitCode;
    this.sendRaw(JSON.stringify(envelope('agent.operation.result', body)));
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
    if (this._cryptoStream) { this._cryptoStream.close(); this._cryptoStream = null; }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw(JSON.stringify(envelope('bye', { reason: 'shutdown' })));
      }
      this.ws.close();
      this.ws = null;
    }
  }
}
