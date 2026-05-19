// ─── ExtensionContext Implementation ───────────────────────────────
// VS Code-alike ExtensionContext with subscriptions/disposables.
// Provided to extension.activate() so extensions can manage their
// own lifecycle without leaking state on deactivation.

import type { AgentCapabilityHost, Disposable, ExtensionMode, ExtensionContext, StateStore, ExtensionLogger } from '../extensions/types';

// ─── State Store ─────────────────────────────────────────────────
class MemStateStore implements StateStore {
  private store = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set<T = unknown>(key: string, value: T): void {
    this.store.set(key, value);
  }
  delete(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  toJSON(): Record<string, unknown> {
    return Object.fromEntries(this.store);
  }
  load(data: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(data)) this.store.set(k, v);
  }
}

// ─── Logger ──────────────────────────────────────────────────────
class ExtensionLoggerImpl implements ExtensionLogger {
  constructor(
    private extensionId: string,
    private level: 'verbose' | 'info' | 'warn' | 'error',
  ) {}

  private prefix(level: string): string {
    return `[${this.extensionId}:${level}]`;
  }

  info(msg: string, data?: Record<string, unknown>): void {
    if (this.level === 'error') return;
    console.log(`${this.prefix('info')} ${msg}`, data ?? '');
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    if (this.level === 'error') return;
    console.warn(`${this.prefix('warn')} ${msg}`, data ?? '');
  }

  error(msg: string, data?: Record<string, unknown>): void {
    console.error(`${this.prefix('error')} ${msg}`, data ?? '');
  }

  verbose(msg: string, data?: Record<string, unknown>): void {
    if (this.level !== 'verbose') return;
    console.debug(`${this.prefix('verbose')} ${msg}`, data ?? '');
  }
}

// ─── Disposable helpers ──────────────────────────────────────────

export function toDisposable(fn: () => void): Disposable {
  return { dispose: fn };
}

export function disposeAll(disposables: Disposable[]): void {
  for (const d of [...disposables].reverse()) {
    try { d.dispose(); } catch { /* ignore individual dispose errors */ }
  }
  disposables.length = 0;
}

// ─── ExtensionContext ────────────────────────────────────────────

export class ExtensionContextImpl implements ExtensionContext {
  readonly id: string;
  readonly displayName: string;
  readonly extensionPath: string;
  readonly subscriptions: Disposable[] = [];
  readonly globalState: MemStateStore;
  readonly workspaceState: MemStateStore;
  readonly api: AgentCapabilityHost;
  readonly extensionMode: ExtensionMode;
  readonly log: ExtensionLoggerImpl;

  constructor(opts: {
    id: string;
    displayName: string;
    extensionPath: string;
    api: AgentCapabilityHost;
    extensionMode: ExtensionMode;
    logLevel: 'verbose' | 'info' | 'warn' | 'error';
    globalState?: Record<string, unknown>;
    workspaceState?: Record<string, unknown>;
  }) {
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.extensionPath = opts.extensionPath;
    this.api = opts.api;
    this.extensionMode = opts.extensionMode;
    this.log = new ExtensionLoggerImpl(this.id, opts.logLevel);
    this.globalState = new MemStateStore();
    this.workspaceState = new MemStateStore();
    if (opts.globalState) this.globalState.load(opts.globalState);
    if (opts.workspaceState) this.workspaceState.load(opts.workspaceState);
  }

  /** Dispose all subscriptions in reverse order — clean slate for hot-reload. */
  dispose(): void {
    this.log.verbose('dispose', { count: this.subscriptions.length });
    disposeAll(this.subscriptions);
  }
}
