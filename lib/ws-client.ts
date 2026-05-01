// ─── WebSocket Client ───────────────────────────────────────────
// Handles JSON serialization, reconnection, and message routing.

export type StatusInfo = {
  authenticated: boolean;
  sessionId?: string;
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
};

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

  constructor(url: string, token: string, cb: WSCallback) {
    this.url = url;
    this.token = token;
    this.cb = cb;
  }

  connect(cols?: number, rows?: number, workspace?: boolean) {
    if (this.closed) return;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      // Send hello for capability negotiation
      this.ws!.send(env("hello", {
        role: "browser",
        version: "0.5.0",
        features: ["claude_chat", "instance_list", "shell"],
        ...(this.token ? {} : { workspace: workspace ?? false }),
        cols: cols ?? 120,
        rows: rows ?? 40,
      }));
    };

    this.ws.onmessage = (ev) => {
      let msg: any;
      try {
        const parsed = JSON.parse(ev.data);
        // Handle both v1 envelope and legacy format
        if (parsed.v === 1 && parsed.body) {
          msg = { type: parsed.type, ...parsed.body };
        } else {
          msg = parsed;
        }
      } catch {
        return;
      }

      switch (msg.type) {
        case "welcome":
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

        case "claude.output":
          this.cb.onOutput(msg.data);
          break;

        case "claude.block":
          this.cb.onBlock?.(msg);
          break;

        case "claude.command_result":
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
      }
    };

    this.ws.onclose = () => {
      if (!this.closed) {
        this.cb.onDisconnect();
        setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  sendInput(data: string, sessionId?: string, instanceId?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const body: Record<string, unknown> = { data };
      if (sessionId) body.sessionId = sessionId;
      if (instanceId) body.instanceId = instanceId;
      this.ws.send(env("claude.input", body));
    }
  }

  sendCommand(name: string, args?: Record<string, string>, sessionId?: string, instanceId?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const body: Record<string, unknown> = { name, args };
      if (sessionId) body.sessionId = sessionId;
      if (instanceId) body.instanceId = instanceId;
      this.ws.send(env("claude.command", body));
    }
  }

  sendResize(cols: number, rows: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(env("claude.resize", { cols, rows }));
    }
  }

  requestSessions() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(env("session.list_req", {}));
    }
  }

  disconnect() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
