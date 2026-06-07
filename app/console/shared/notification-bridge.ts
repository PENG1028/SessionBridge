/**
 * NotificationBridge — unified native-notification interface.
 *
 * Detects which shell (if any) is hosting the Web UI and routes
 * notifications to the right backend. If no native backend is
 * available the call is a silent no-op — the in-app ToastContainer
 * still shows the message regardless.
 *
 * Supported backends (auto-detected):
 *   1. Electron desktop shell  → window.electronAPI.showNotification()
 *   2. Capacitor mobile shell  → @capacitor/local-notifications
 *   3. Browser Web Notification → new Notification()
 *   4. Fallback                 → noop
 */

import type { AppNotification } from './notification-context';

export interface NotificationBridge {
  /** Fire a native OS notification. Silently skipped if unsupported. */
  show(n: AppNotification): void;
  /** Whether the current environment supports native notifications. */
  readonly supported: boolean;
  /** Human-readable label for debugging. */
  readonly backend: string;
}

// ─── Backend implementations ───────────────────────────────────────

let _backend: NotificationBridge | null = null;

function resolveBackend(): NotificationBridge {
  if (typeof window === 'undefined') return noopBridge;

  // 1. Electron shell
  const electronAPI = (window as any).electronAPI;
  if (electronAPI?.showNotification) {
    return electronBridge(electronAPI);
  }

  // 2. Capacitor mobile shell (async import, lazy)
  if ((window as any).Capacitor?.isPluginAvailable?.('LocalNotifications')) {
    return capacitorBridge;
  }

  // 3. Browser Web Notification API
  if ('Notification' in window && Notification.permission !== 'denied') {
    return webNotificationBridge;
  }

  // 4. Fallback
  return noopBridge;
}

// ─── Electron ──────────────────────────────────────────────────────

function electronBridge(api: any): NotificationBridge {
  return {
    backend: 'electron',
    supported: true,
    show(n: AppNotification) {
      api.showNotification({
        title: n.title,
        body: n.message || '',
        tag: n.id,
      });
    },
  };
}

// ─── Capacitor ─────────────────────────────────────────────────────

// Lazy — Capacitor LocalNotifications plugin is loaded on first call.
let _capPlugin: any = undefined;
let _capInit = false;

async function ensureCapPlugin(): Promise<any> {
  if (_capInit) return _capPlugin;
  _capInit = true;
  try {
    // Dynamic string concatenation prevents Turbopack from resolving
    // @capacitor/local-notifications at build time when the package is
    // not installed. The import only runs at runtime inside a try/catch,
    // so it's safe even if the package doesn't exist.
    const mod = await import('@capacitor' + '/local-notifications');
    _capPlugin = mod.LocalNotifications;
  } catch {
    /* plugin not registered — noop */
  }
  return _capPlugin;
}

const capacitorBridge: NotificationBridge = {
  backend: 'capacitor',
  get supported() {
    return typeof (window as any).Capacitor?.isPluginAvailable === 'function';
  },
  show(n: AppNotification) {
    ensureCapPlugin().then((LN) => {
      if (!LN) return;
      LN.schedule({
        notifications: [
          {
            id: hashId(n.id),
            title: n.title,
            body: n.message || '',
          },
        ],
      }).catch(() => {});
    });
  },
};

// ─── Web Notification API ──────────────────────────────────────────

const webNotificationBridge: NotificationBridge = {
  backend: 'web',
  supported: true,
  show(n: AppNotification) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') fireWebNotification(n);
      });
    } else {
      fireWebNotification(n);
    }
  },
};

function fireWebNotification(n: AppNotification) {
  try {
    const notif = new Notification(n.title, {
      body: n.message || '',
      tag: n.id,
    });
    if (n.action) {
      notif.onclick = n.action.onClick;
    }
  } catch {
    /* e.g. iframe without permission */
  }
}

// ─── Noop fallback ─────────────────────────────────────────────────

const noopBridge: NotificationBridge = {
  backend: 'none',
  supported: false,
  show() {},
};

// ─── Singleton ─────────────────────────────────────────────────────

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

/** Singleton bridge instance. Created once on first access. */
let _instance: NotificationBridge | null = null;

export function getNotificationBridge(): NotificationBridge {
  if (!_instance) {
    _instance = resolveBackend();
  }
  return _instance;
}

/** Re-resolve backend (e.g. after Capacitor plugin registers). */
export function resetNotificationBridge(): void {
  _instance = null;
}
