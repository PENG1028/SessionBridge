'use client';

// ─── Plugin Sync ──────────────────────────────────────────────────
// Unified register/unregister for ALL plugin UI contributions.
// One function handles views, panels, commands, status bar, and
// contribution registry — driven entirely by plugin.yaml manifests.
//
// This is the ONLY place that registers plugin contributions.
// No hardcoded registration in page.tsx, register-*.ts, or bootstrap.

import { Box } from 'lucide-react';
import type { AppManifest, AppSummary, AppSystemUI } from './app-types';
import { slotRegistry } from '../../../lib/slot-registry';
import { registerView, unregisterView } from '../../console/main/view-registry';
import { syncPluginPanels, clearPanels } from '../../console/panels/panel-registry';
import { syncChromeContributions, clearChromeContributions } from '../../console/chrome/chrome-registry';
import { registerCommand, unregisterCommand } from '../../console/commands/command-registry';
import { contributionRegistry } from '../../console/plugin-host/contribution-registry';
import { PluginManifestViewRenderer } from '../../console/plugin-host/plugin-manifest-view-renderer';
import type { PluginManifest, PluginViewContribution, PluginPanelContribution } from '../../console/plugin-host/plugin-manifest-types';
import { isEnabled } from './app-registry';

// ─── Track what we've registered so we can unregister ────────────
const _registeredViewIds = new Map<string, Set<string>>(); // appId → Set<viewId>
const _registeredCommandIds = new Map<string, Set<string>>(); // appId → Set<commandId>

let _syncLock = false;

/**
 * Sync ALL UI contributions for all enabled apps.
 * Call this on startup and when enable/disable state changes (hot-reload).
 * Guarded against concurrent calls.
 */
export async function syncAllPlugins(
  onExecuteCommand: (commandId: string) => void,
): Promise<void> {
  if (_syncLock) return;
  _syncLock = true;
  try {
    const { loadApps, getManifest, loadAppState } = await import('./app-registry');
    const apps = await loadApps();
    if (!apps.length) return;

    // Load all app states so isEnabled() returns correct values
    await Promise.all(apps.map((a: AppSummary) => loadAppState(a.id).catch(err => {
      console.warn(`[plugin-sync] Failed to load state for app "${a.id}":`, err);
    })));

  // Collect contributions from all enabled apps
  const allLeft: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; order?: number; pluginId?: string }> = [];
  const allRight: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; order?: number; pluginId?: string }> = [];
  const allStatusBar: Array<{ id: string; text: string; icon?: string; command?: string; side: 'left' | 'right'; order: number }> = [];

  // Clean up stale registrations from deleted plugins
  for (const appId of _registeredViewIds.keys()) {
    if (!apps.some(a => a.id === appId)) {
      unregisterApp(appId);
    }
  }

  for (const app of apps) {
    if (!isEnabled(app.id)) {
      unregisterApp(app.id);
      continue;
    }

    try {
      const manifest = await getManifest(app.id);
      if (!manifest?.adapters?.['system-ui']) continue;

      const ui = manifest.adapters['system-ui'] as AppSystemUI;
      registerAppContributions(app.id, manifest, ui, onExecuteCommand, allLeft, allRight, allStatusBar);
    } catch (err) {
      console.error(`[plugin-sync] Failed to sync plugin "${app.name || app.id}":`, err);
    }
  }

  // Bulk-sync panels and chrome (these registries use replace semantics)
  syncPluginPanels(
    allLeft.length > 0 ? allLeft : undefined,
    allRight.length > 0 ? allRight : undefined,
  );
  syncChromeContributions(allStatusBar.length > 0 ? { statusBar: allStatusBar as any } : undefined);
  } finally {
    _syncLock = false;
  }
}

/**
 * Unregister ALL contributions for a disabled app.
 */
function unregisterApp(appId: string): void {
  // Views
  const viewIds = _registeredViewIds.get(appId);
  if (viewIds) {
    for (const vid of viewIds) unregisterView(vid);
    _registeredViewIds.delete(appId);
  }

  // Commands
  const cmdIds = _registeredCommandIds.get(appId);
  if (cmdIds) {
    for (const cid of cmdIds) unregisterCommand(cid);
    _registeredCommandIds.delete(appId);
  }

  // Contribution registry
  contributionRegistry.unregisterManifest(appId);

  // Slot registry cleanup
  slotRegistry.unfill(appId);
}

/**
 * Ordering helper for configuration contributions.
 * System plugins get higher priority (lower number = shown first).
 */
function configOrder(type?: string): number {
  return type === 'system' ? 10 : 20;
}

/**
 * Register ALL contributions for an enabled app.
 */
function registerAppContributions(
  appId: string,
  manifest: AppManifest,
  ui: AppSystemUI,
  onExecuteCommand: (commandId: string) => void,
  allLeft: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; order?: number; pluginId?: string }>,
  allRight: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; order?: number; pluginId?: string }>,
  allStatusBar: Array<{ id: string; text: string; icon?: string; command?: string; side: 'left' | 'right'; order: number }>,
): void {
  const viewIds: string[] = [];
  const cmdIds: string[] = [];

  // ── Views ──
  if (ui.views) {
    for (const v of ui.views) {
      if (!v.id) continue;
      registerView(v.id, {
        component: PluginManifestViewRenderer,
        meta: {
          title: v.title || v.id,
          icon: Box,
          category: 'plugin',
          viewType: 'main.editor',
          launchable: true,
          launchMode: 'direct',
          showInSelector: true,
          pluginId: appId,
        },
      });
      viewIds.push(v.id);
    }
  }
  _registeredViewIds.set(appId, new Set(viewIds));

  // ── Panels (collected, then bulk-synced by caller) ──
  if (ui.panels) {
    for (const p of ui.panels) {
      if (!p.id) continue;
      const entry: {
        id: string; title: string; icon: string; defaultVisible: boolean;
        componentId?: string; when?: string; order?: number; alwaysVisible?: boolean;
        pluginId?: string;
      } = {
        id: p.id,
        title: p.title || p.id,
        icon: p.icon || 'PanelRight',
        defaultVisible: true,
        componentId: p.componentId,
        pluginId: appId,
      };
      if (p.when) entry.when = p.when;
      if (p.order !== undefined) entry.order = p.order;
      if (p.alwaysVisible) entry.alwaysVisible = true;
      if (p.surface === 'left') allLeft.push(entry);
      else if (p.surface === 'right') allRight.push(entry);
    }
  }

  // ── Commands ──
  if (ui.commands) {
    for (const c of ui.commands) {
      if (!c.id) continue;
      const fullId = c.command || `${appId}.${c.id}`;
      registerCommand({
        id: fullId,
        title: c.title,
        category: appId,
        handler: () => onExecuteCommand(fullId),
      });
      cmdIds.push(fullId);
    }
  }
  _registeredCommandIds.set(appId, new Set(cmdIds));

  // ── Status Bar ──
  if (ui.status) {
    for (let i = 0; i < ui.status.length; i++) {
      const s = ui.status[i];
      allStatusBar.push({
        id: s.id,
        text: s.label,
        icon: s.icon,
        command: s.command,
        side: 'left',
        order: i,
      });
    }
  }

  // ── Contribution Registry ──
  const pm: PluginManifest = {
    id: appId,
    version: manifest.version,
    name: manifest.name || appId,
    description: manifest.description || '',
    type: manifest.trusted ? 'builtin' : 'feature',
    capabilities: [],
    contributes: {
      views: {},
      panels: {},
      commands: ui.commands?.map(c => ({
        id: c.command || `${appId}.${c.id}`,
        title: c.title,
      })) || [],
      status: ui.status?.map(s => ({
        id: s.id,
        label: s.label,
        icon: s.icon,
        command: s.command,
      })) || [],
    },
  };

  if (ui.views) {
    const vm: Record<string, PluginViewContribution[]> = {};
    for (const v of ui.views) {
      const surface = v.surface || 'main.editor';
      if (!vm[surface]) vm[surface] = [];
      vm[surface].push({ id: v.id, type: v.type as any, componentId: v.componentId, title: v.title || v.id });
    }
    pm.contributes!.views = vm;
  }
  if (ui.panels) {
    const pm2: Record<string, PluginPanelContribution[]> = {};
    for (const p of ui.panels) {
      const surface = p.surface || 'panel.bottom';
      if (!pm2[surface]) pm2[surface] = [];
      pm2[surface].push({ id: p.id, type: p.type as any, componentId: p.componentId, title: p.title || p.id });
    }
    pm.contributes!.panels = pm2;
  }

  contributionRegistry.registerManifest(pm);

  // ── Configuration / Settings (slot-registry) ──
  if (ui.configuration) {
    slotRegistry.fill({
      slotId: 'settings.section.plugin-config',
      fillingId: `${appId}.config`,
      pluginId: appId,
      content: {
        pluginId: appId,
        pluginName: manifest.name || appId,
        title: ui.configuration.title,
        properties: ui.configuration.properties,
      },
      order: configOrder(manifest.type),
    });
  }
}
