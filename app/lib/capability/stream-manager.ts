// ─── Stream Manager — stream lifecycle state machine ──────────────
// Manages the full lifecycle of a Core stream subscription:
// subscribe → replay → live → disconnect → reconnect → live
//
// Used by TerminalView and any component that subscribes to stream.chunk.
// Pure class — no React dependency. Use with useSyncExternalStore.

export type StreamState =
  | { type: 'idle' }
  | { type: 'subscribing'; sessionId: string }
  | { type: 'replaying'; sessionId: string }
  | { type: 'live'; sessionId: string; lastSeq: { stdout: number; stderr: number } }
  | { type: 'disconnected'; sessionId: string; lastSeq: { stdout: number; stderr: number } }
  | { type: 'reconnecting'; sessionId: string; lastSeq: { stdout: number; stderr: number }; attempt: number }
  | { type: 'error'; message: string };

export interface StreamCallbacks {
  onSubscribe: (sessionId: string) => Promise<void>;
  onReplay: (sessionId: string, fromSeq: { stdout: number; stderr: number }) => Promise<void>;
  onUnsubscribe: (sessionId: string) => void;
}

type Listener = () => void;

export class StreamManager {
  private _state: StreamState = { type: 'idle' };
  private _listeners = new Set<Listener>();
  private _callbacks: StreamCallbacks;

  // Timeouts
  private _subTimeout: ReturnType<typeof setTimeout> | null = null;
  private _replayTimeout: ReturnType<typeof setTimeout> | null = null;
  private static SUBSCRIBE_TIMEOUT = 10_000;
  private static REPLAY_TIMEOUT = 15_000;
  private static MAX_RECONNECT_ATTEMPTS = 10;

  constructor(callbacks: StreamCallbacks) {
    this._callbacks = callbacks;
  }

  // ── Public API ──

  get state(): StreamState { return this._state; }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  getSnapshot = (): StreamState => this._state;

  /** Start subscribing to a session's streams. */
  async start(sessionId: string): Promise<void> {
    this.transition({ type: 'subscribing', sessionId });
    this._subTimeout = setTimeout(() => {
      this.transition({ type: 'error', message: 'Subscribe timed out' });
    }, StreamManager.SUBSCRIBE_TIMEOUT);

    try {
      await this._callbacks.onSubscribe(sessionId);
      if (this._subTimeout) clearTimeout(this._subTimeout);

      this.transition({ type: 'replaying', sessionId });
      this._replayTimeout = setTimeout(() => {
        // Replay timeout is not fatal — go live with what we have
        this.transition({ type: 'live', sessionId, lastSeq: { stdout: 0, stderr: 0 } });
      }, StreamManager.REPLAY_TIMEOUT);

      await this._callbacks.onReplay(sessionId, { stdout: 0, stderr: 0 });
      if (this._replayTimeout) clearTimeout(this._replayTimeout);

      this.transition({ type: 'live', sessionId, lastSeq: { stdout: 0, stderr: 0 } });
    } catch (err) {
      this.transition({ type: 'error', message: String(err) });
    }
  }

  /** Called when a stream.chunk event arrives. Updates seq tracking. */
  onChunk(streamType: 'stdout' | 'stderr', seq?: number): void {
    if (this._state.type !== 'live') return;
    if (typeof seq === 'number' && seq > this._state.lastSeq[streamType]) {
      this._state.lastSeq[streamType] = seq;
    }
  }

  /** Called when the connection drops. */
  onDisconnect(): void {
    if (this._state.type === 'live') {
      this.transition({ type: 'disconnected', sessionId: this._state.sessionId, lastSeq: { ...this._state.lastSeq } });
    } else if (this._state.type === 'replaying') {
      this.transition({ type: 'disconnected', sessionId: this._state.sessionId, lastSeq: { stdout: 0, stderr: 0 } });
    }
  }

  /** Called when the connection is restored. Re-subscribes and replays from last known seq. */
  async onReconnect(): Promise<void> {
    const prev = this._state;
    if (prev.type !== 'disconnected') return;

    const attempt = (this._state.type === 'reconnecting' ? this._state.attempt : 0) + 1;
    if (attempt > StreamManager.MAX_RECONNECT_ATTEMPTS) {
      this.transition({ type: 'error', message: `Reconnect failed after ${StreamManager.MAX_RECONNECT_ATTEMPTS} attempts` });
      return;
    }

    this.transition({ type: 'reconnecting', sessionId: prev.sessionId, lastSeq: { ...prev.lastSeq }, attempt });

    try {
      await this._callbacks.onSubscribe(prev.sessionId);
      await this._callbacks.onReplay(prev.sessionId, {
        stdout: prev.lastSeq.stdout + 1,
        stderr: prev.lastSeq.stderr + 1,
      });
      this.transition({ type: 'live', sessionId: prev.sessionId, lastSeq: { ...prev.lastSeq } });
    } catch (err) {
      this.transition({ type: 'error', message: `Reconnect failed: ${err}` });
    }
  }

  /** Clean stop — unsubscribe and return to idle. */
  stop(): void {
    if (this._state.type === 'idle') return;
    const sid = 'sessionId' in this._state ? this._state.sessionId : '';
    if (sid) this._callbacks.onUnsubscribe(sid);
    this.clearTimers();
    this.transition({ type: 'idle' });
  }

  destroy(): void {
    this.stop();
    this._listeners.clear();
  }

  // ── Internal ──

  private transition(next: StreamState): void {
    this._state = next;
    this._listeners.forEach(fn => { try { fn(); } catch (_e) { /* ignore */ } });
  }

  private clearTimers(): void {
    if (this._subTimeout) { clearTimeout(this._subTimeout); this._subTimeout = null; }
    if (this._replayTimeout) { clearTimeout(this._replayTimeout); this._replayTimeout = null; }
  }
}
