// ─── Reconnect Manager — exponential backoff ─────────────────────
// Manages reconnection with exponential backoff.
// Pure class — no React dependency. Use with useSyncExternalStore.

export type ReconnectState =
  | { type: 'connected' }
  | { type: 'disconnected', since: number }
  | { type: 'reconnecting', attempt: number, nextDelay: number, since: number }
  | { type: 'failed', reason: string };

type Listener = () => void;

export class ReconnectManager {
  private _state: ReconnectState = { type: 'disconnected', since: Date.now() };
  private _listeners = new Set<Listener>();
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _onConnect: () => Promise<void>;

  private static BASE_DELAY = 1000;
  private static MAX_DELAY = 30_000;
  private static MAX_ATTEMPTS = 10;

  constructor(onConnect: () => Promise<void>) {
    this._onConnect = onConnect;
  }

  get state(): ReconnectState { return this._state; }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  getSnapshot = (): ReconnectState => this._state;

  /** Call when connected. */
  markConnected(): void {
    this.clearTimer();
    this.transition({ type: 'connected' });
  }

  /** Call when disconnected. Starts backoff. */
  markDisconnected(): void {
    this.clearTimer();
    this.transition({ type: 'disconnected', since: Date.now() });
    this.scheduleReconnect(1);
  }

  /** Force a reconnect attempt now. */
  forceReconnect(): void {
    this.clearTimer();
    this.attemptReconnect(1);
  }

  destroy(): void {
    this.clearTimer();
    this._listeners.clear();
  }

  // ── Internal ──

  private scheduleReconnect(attempt: number): void {
    const delay = Math.min(ReconnectManager.BASE_DELAY * Math.pow(2, attempt - 1), ReconnectManager.MAX_DELAY);
    this.transition({ type: 'reconnecting', attempt, nextDelay: delay, since: Date.now() });
    this._timer = setTimeout(() => this.attemptReconnect(attempt), delay);
  }

  private async attemptReconnect(attempt: number): Promise<void> {
    if (attempt > ReconnectManager.MAX_ATTEMPTS) {
      this.transition({ type: 'failed', reason: `Max reconnect attempts (${ReconnectManager.MAX_ATTEMPTS}) exceeded` });
      return;
    }
    try {
      await this._onConnect();
      this.markConnected();
    } catch {
      this.scheduleReconnect(attempt + 1);
    }
  }

  private clearTimer(): void {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  private transition(next: ReconnectState): void {
    this._state = next;
    this._listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  }
}
