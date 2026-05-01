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
};

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
      if (this.token) {
        this.ws!.send(JSON.stringify({ type: 'auth', token: this.token }));
      } else {
        this.ws!.send(JSON.stringify({
          type: 'direct',
          workspace: workspace ?? false,
          cols: cols ?? 120,
          rows: rows ?? 40,
        }));
      }
    };

    this.ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'auth_result':
          this.cb.onStatusChange({
            authenticated: msg.success,
            sessionId: msg.sessionId,
          });
          if (!msg.success) {
            this.cb.onError(msg.error ?? 'Authentication failed');
          }
          break;

        case 'workspace_connected':
          this.workspaceMode = true;
          this.cb.onWorkspaceConnected?.();
          this.cb.onStatusChange({ authenticated: true });
          break;

        case 'sessions_list':
          this.cb.onSessionsList?.(msg.sessions);
          break;

        case 'session_added':
          this.cb.onSessionAdded?.(msg);
          break;

        case 'session_removed':
          this.cb.onSessionRemoved?.(msg.sessionId);
          break;

        case 'output':
          this.cb.onOutput(msg.data);
          break;

        case 'block':
          this.cb.onBlock?.(msg);
          break;

        case 'command_result':
          this.cb.onCommandResult({
            name: msg.name,
            success: msg.success,
            data: msg.data,
            error: msg.error,
          });
          break;

        case 'queue_status':
          this.cb.onQueueStatus?.({
            processing: msg.processing || false,
            source: msg.source || null,
            queueDepth: msg.queueDepth || 0,
          });
          break;

        case 'error':
          this.cb.onError(msg.message);
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

  sendInput(data: string, sessionId?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const payload: any = { type: 'input', data };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendCommand(name: string, args?: Record<string, string>, sessionId?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const payload: any = { type: 'command', name, args };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendResize(cols: number, rows: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  requestSessions() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'list_sessions' }));
    }
  }

  disconnect() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
