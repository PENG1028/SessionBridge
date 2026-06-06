/**
 * SessionBridge Desktop Shell (Electron) — Main Process
 *
 * Responsibilities:
 *  1. Open a BrowserWindow loading the SessionBridge Web UI
 *  2. Expose native Notification API to the renderer via preload
 *  3. Tray icon — minimize to tray instead of quit
 *  4. Single-instance lock — prevent duplicate shells
 *
 * How to debug:
 *   F5 in VS Code with "Electron: Desktop Shell" launch config (see ../../.vscode/launch.json)
 *   Renderer: open DevTools in the BrowserWindow (Ctrl+Shift+I)
 */

import { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain } from 'electron';
import * as path from 'path';

// ─── Configuration — change via env / electron-builder extraMetadata ────────

const CONFIG = {
  /** Production URL to load (set via SB_WEB_URL env var). */
  webUrl: process.env.SB_WEB_URL || 'http://localhost:3000',
  /** Window title shown in title bar and task switcher. */
  appName: 'SessionBridge',
  /** Window size — mobile-first 390×844, user can resize. */
  windowWidth: Number(process.env.SB_WINDOW_WIDTH) || 390,
  windowHeight: Number(process.env.SB_WINDOW_HEIGHT) || 844,
  /** Hide window instead of closing (minimize to tray). */
  trayOnClose: process.env.SB_TRAY_ON_CLOSE !== '0',
  /** Dev mode — open DevTools on start. */
  devMode: process.argv.includes('--dev'),
} as const;

// ─── Global state ───────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ─── Single instance lock ───────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── Window factory ─────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: CONFIG.windowWidth,
    height: CONFIG.windowHeight,
    title: CONFIG.appName,
    // Dark frame to match SessionBridge theme
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Security: disable nodeIntegration in renderer
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    autoHideMenuBar: true,
    show: false,
  });

  // Graceful load
  win.once('ready-to-show', () => {
    win.show();
    if (CONFIG.devMode) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Navigate to Web UI
  win.loadURL(CONFIG.webUrl).catch((err) => {
    console.error('[shell] Failed to load', CONFIG.webUrl, err.message);
    if (CONFIG.webUrl !== 'http://localhost:3000') {
      console.log('[shell] Retrying with localhost:3000...');
      win.loadURL('http://localhost:3000');
    }
  });

  // Handle external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Window close → hide to tray (unless quitting)
  win.on('close', (event) => {
    if (!isQuitting && CONFIG.trayOnClose) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

// ─── Tray ────────────────────────────────────────────────────────────────────

function createTray(): Tray | null {
  try {
    // 16×16 tray icon — will be transparent until real icon is provided
    // Replace with: nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'))
    const icon = nativeImage.createEmpty();
    const trayIcon = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show SessionBridge',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    trayIcon.setToolTip(CONFIG.appName);
    trayIcon.setContextMenu(contextMenu);

    trayIcon.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    return trayIcon;
  } catch (err) {
    console.warn('[shell] Tray creation failed (headless?):', err);
    return null;
  }
}

// ─── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  mainWindow = createWindow();
  if (CONFIG.trayOnClose) {
    tray = createTray();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

// ─── IPC: notification from renderer ────────────────────────────────────────

ipcMain.on('sb:notify', (_event: any, data: { title: string; body?: string; onClickAction?: string }) => {
  const notif = new Notification({
    title: data.title,
    body: data.body || '',
    silent: false,
  });

  notif.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  notif.show();
});
