/**
 * SessionBridge Desktop Shell (Electron) — Preload Script
 *
 * Injects `window.electronAPI` into the renderer (Web UI).
 * The Web UI checks for this API to decide whether to use native notifications.
 *
 * Security: exposes only the minimum necessary API surface.
 *   contextBridge ensures renderer cannot access Node.js APIs directly.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronNotificationOptions {
  title: string;
  body?: string;
  /** Unique tag — used for deduplication. */
  tag?: string;
  /** Action name passed back on notification click. */
  onClickAction?: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Show a native OS notification.
   * Falls through to main process which uses Electron's Notification API.
   */
  showNotification: (opts: ElectronNotificationOptions) => {
    ipcRenderer.send('sb:notify', {
      title: opts.title,
      body: opts.body,
      onClickAction: opts.onClickAction,
    });
  },

  /**
   * Read-only flag so the Web UI can detect Electron environment.
   */
  isElectron: true,
});
