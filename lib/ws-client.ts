// ─── WebSocket Client ───────────────────────────────────────────
// Handles JSON serialization, reconnection, and message routing.

export type StatusInfo = {
  authenticated: boolean;
  sessionId?: string;
  retryCount?: number;
};

export type SessionInfo = {
  id: string;
  directory: string;
  label: string;
  hasBridge: boolean;
  hasClient: boolean;
  webUrl: string;
};

export type InstanceInfo = {
  id: string;
  dir: string;
  label: string;
  status: string;
  source: string;
  adapterId?: string;
  model: string | null;
  blockCount: number;
  outputSize: number;
  checkpointCount: number;
  createdAt: number;
};

export type CommandResult = {
  name: string;
  success: boolean;
  data?: Record<string, any>;
  error?: string;
};

export type QueueStatus = {
  processing: boolean;
  source: string | null;
  queueDepth: number;
};

export type WSCallback = {
  onStatusChange: (status: StatusInfo) => void;
  onOutput: (data: string) => void;
  onBlock?: (block: any) => void;
  onCommandResult: (result: CommandResult) => void;
  onError: (message: string) => void;
  onDisconnect: () => void;
  onQueueStatus?: (status: QueueStatus) => void;
  // Workspace mode callbacks
  onSessionsList?: (sessions: SessionInfo[]) => void;
  onSessionAdded?: (session: SessionInfo) => void;
  onSessionRemoved?: (sessionId: string) => void;
  onWorkspaceConnected?: () => void;
  // Instance management callbacks
  onInstanceList?: (instances: InstanceInfo[], activeId: string | null) => void;
  onInstanceAdded?: (instance: InstanceInfo) => void;
  onInstanceRemoved?: (instanceId: string) => void;
  onInstanceSwitched?: (instanceId: string) => void;
  onInstanceUpdated?: (instance: InstanceInfo) => void;
  /** Catch-all for unhandled message types */
  onSystemMessage?: (msg: any) => void;
  /** System notifications routed to toast UI */
  onSystemNotify?: (notification: { id?: string; type: string; title: string; message?: string; scenarioId?: string; duration?: number; action?: { label: string; onClick: () => void } }) => void;
  /** Dismiss a previously shown notification by server-assigned ID */
  onSystemNotifyDismiss?: (id: string) => void;
};

import { VERSION } from '../version';
import { createCryptoSession, type BrowserCryptoSession } from '../app/crypto-client';

/** Envelope helper for client-side sends. */
function env(type: string, body: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, ts: Date.now(), type, body });
}

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private cb: WSCallback;
  private closed = false;
  private workspaceMode = false;
  private _crypto: BrowserCryptoSession | null = null;
  private retryCount = 0;
  private baseRetryInterval = 1000;
  private maxRetryInterval = 30000;
  private retryMultiplier = 1.5;

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  constructor(url: string, token: string, cb: WSCallback) {
    this.url = url;
    this.token = token;
    this.cb = cb;
  }

  connect(cols?: number, rows?: number, workspace?: boolean) {
    if (this.closed) return;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = async () => {
      this.retryCount = 0; // Reset retry counter on successful connection
      // Create crypto session for ECDH + AES-256-GCM encryption
      this._crypto = await createCryptoSession();

      // Send hello for capability negotiation
      const helloBody: Record<string, unknown> = {
        role: "browser",
        version: VERSION,
        features: ["crypto_v1", "structured_chat", "instance_list", "shell"],
        cols: cols ?? 120,
        rows: rows ?? 40,
      };
      if (this._crypto) {
        helloBody.ephemeralKey = this._crypto.localPublicKey;
      }
      if (this.token) {
        helloBody.token = this.token;
      } else {
        helloBody.workspace = workspace ?? false;
      }
      // Persistent browser ID for self-identification (filter self from VIEW)
      try {
        const existing = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('bridge-browser-id') : null;
        if (existing) {
          helloBody.clientToken = existing;
        } else {
          const newId = 'browser_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          helloBody.clientToken = newId;
          if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('bridge-browser-id', newId);
        }
      } catch {}
      this.ws!.send(env("hello", helloBody));
    };

    this.ws.onmessage = async (ev) => {
      // Decrypt if crypto is established
      let data = ev.data;
      if (this._crypto?.isEstablished) {
        const decrypted = await this._crypto.decrypt(data);
        if (decrypted) data = decrypted;
      }

      let msg: any;
      try {
        const parsed = JSON.parse(data);
        // Handle both v1 envelope and legacy format
        if (parsed.v === 1 && parsed.body) {
          msg = { ...parsed.body, type: parsed.type };
          if (parsed.body.type) msg.severity = parsed.body.type;
        } else {
          msg = parsed;
        }
      } catch {
        return;
      }

      switch (msg.type) {
        case "ping":
          void this.sendEnv("pong");
          break;

        case "welcome":
          // Complete crypto handshake if server supports it
          if (this._crypto && msg.staticKey && msg.ephemeralKey) {
            await this._crypto.handshake(
              msg.staticKey,
              msg.ephemeralKey,
            );
          }
          this.cb.onStatusChange({
            authenticated: true,
            sessionId: msg.sessionId,
          });
          if (msg.instances) {
            this.cb.onInstanceList?.(msg.instances, msg.sessionId || null);
          }
          break;

        case "workspace_connected":
          this.workspaceMode = true;
          this.cb.onWorkspaceConnected?.();
          this.cb.onStatusChange({ authenticated: true });
          break;

        // Legacy auth_result (backward compat)
        case "auth_result":
          this.cb.onStatusChange({
            authenticated: msg.success,
            sessionId: msg.sessionId,
          });
          if (!msg.success) {
            this.cb.onError(msg.error ?? 'Authentication failed');
          }
          if (msg.instances) {
            this.cb.onInstanceList?.(msg.instances, msg.sessionId || null);
          }
          break;

        case "session.list":
          this.cb.onSessionsList?.(msg.sessions);
          break;

        case "session.added":
          this.cb.onSessionAdded?.(msg);
          break;

        case "session.removed":
          this.cb.onSessionRemoved?.(msg.sessionId);
          break;

        case "instance.output":
          this.cb.onOutput(msg.data);
          break;

        case "instance.block":
          this.cb.onBlock?.(msg);
          break;

        case "instance.command_result":
          this.cb.onCommandResult({
            name: msg.name,
            success: msg.success,
            data: msg.data,
            error: msg.error,
          });
          break;

        case "queue.status":
          this.cb.onQueueStatus?.({
            processing: msg.processing || false,
            source: msg.source || null,
            queueDepth: msg.queueDepth || 0,
          });
          break;

        case "error":
          this.cb.onError(msg.message);
          break;

        // Instance management
        case "instance.list":
          this.cb.onInstanceList?.(msg.instances, msg.activeId);
          break;

        case "instance.added":
          this.cb.onInstanceAdded?.(msg.instance);
          break;

        case "instance.removed":
          this.cb.onInstanceRemoved?.(msg.instanceId);
          break;

        case "instance.switched":
          this.cb.onInstanceSwitched?.(msg.instanceId);
          break;

        case "instance.updated":
          this.cb.onInstanceUpdated?.(msg.instance);
          break;

        // Legacy types (backward compat with old relay)
        case "sessions_list":
          this.cb.onSessionsList?.(msg.sessions);
          break;

        case "session_added":
          this.cb.onSessionAdded?.(msg);
          break;

        case "session_removed":
          this.cb.onSessionRemoved?.(msg.sessionId);
          break;

        case "output":
          this.cb.onOutput(msg.data);
          break;

        case "block":
          this.cb.onBlock?.(msg);
          break;

        case "command_result":
          this.cb.onCommandResult({
            name: msg.name,
            success: msg.success,
            data: msg.data,
            error: msg.error,
          });
          break;

        case "queue_status":
          this.cb.onQueueStatus?.({
            processing: msg.processing || false,
            source: msg.source || null,
            queueDepth: msg.queueDepth || 0,
          });
          break;

        case "instance_list":
          this.cb.onInstanceList?.(msg.instances, msg.activeId);
          break;

        case "instance_added":
          this.cb.onInstanceAdded?.(msg.instance);
          break;

        case "instance_removed":
          this.cb.onInstanceRemoved?.(msg.instanceId);
          break;

        case "instance_switched":
          this.cb.onInstanceSwitched?.(msg.instanceId);
          break;

        case "system.notification":
          this.cb.onSystemNotify?.({
            id: msg.id,
            type: msg.severity || 'info',
            title: msg.title || '',
            message: msg.detail || msg.message,
            scenarioId: msg.scenarioId,
            duration: msg.duration,
          });
          this.cb.onSystemMessage?.(msg);
          break;

        case "system.notification_dismiss":
          this.cb.onSystemNotifyDismiss?.(msg.id);
          break;

        case "update.available":
          this.cb.onSystemNotify?.({
            type: 'warning',
            title: `Update available: v${msg.latest}`,
            message: `Current: v${msg.current}`,
            scenarioId: 'update',
            duration: 0, // persistent until dismissed
            action: { label: 'Upgrade now', onClick: () => this.sendCommand('bridge-update') },
          });
          this.cb.onSystemMessage?.(msg);
          break;

        default:
          this.cb.onSystemMessage?.(msg);
          break;
      }
    };

    this.ws.onclose = () => {
      if (!this.closed) {
        this.cb.onDisconnect();
        // Exponential backoff: 1s * 1.5^retry, capped at 30s, ±500ms jitter
        const delay = Math.min(
          this.baseRetryInterval * Math.pow(this.retryMultiplier, this.retryCount),
          this.maxRetryInterval
        );
        const jitter = (Math.random() - 0.5) * 1000;
        const finalDelay = Math.max(100, Math.round(delay + jitter));
        this.retryCount++;
        this.cb.onStatusChange?.({ authenticated: false, retryCount: this.retryCount });
        setTimeout(() => this.connect(), finalDelay);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  /** Send an envelope, encrypted if crypto is established. */
  private async sendEnv(type: string, body: Record<string, unknown> = {}): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const payload = env(type, body);
    if (this._crypto?.isEstablished) {
      this.ws.send(await this._crypto.encrypt(payload));
    } else {
      this.ws.send(payload);
    }
  }

  async sendInput(data: string, sessionId?: string, instanceId?: string) {
    const body: Record<string, unknown> = { data };
    if (sessionId) body.sessionId = sessionId;
    if (instanceId) body.instanceId = instanceId;
    await this.sendEnv("instance.input", body);
  }

  /** Send raw terminal input (escape sequences, ctrl+key, arrows). */
  async sendShellInput(data: string, instanceId: string) {
    await this.sendEnv("shell.input", { data, instanceId });
  }

  async sendCommand(name: string, args?: Record<string, string>, sessionId?: string, instanceId?: string) {
    const body: Record<string, unknown> = { name, args };
    if (sessionId) body.sessionId = sessionId;
    if (instanceId) body.instanceId = instanceId;
    await this.sendEnv("instance.command", body);
  }

  async sendResize(cols: number, rows: number) {
    await this.sendEnv("shell.resize", { cols, rows });
  }

  async requestSessions() {
    await this.sendEnv("session.list_req", {});
  }

  /** Send an arbitrary message type to the server. */
  async send(type: string, body: Record<string, unknown> = {}) {
    await this.sendEnv(type, body);
  }

  disconnect() {
    this.closed = true;
    this._crypto = null;
    this.ws?.close();
    this.ws = null;
  }
}
