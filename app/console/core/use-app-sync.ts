'use client';

// ─── useAppSync ───────────────────────────────────────────────────
// Replaces useCorePluginSync. Reads app manifests from /api/apps/*
// (server-side YAML scan) instead of calling Core plugin.* APIs.
// Registers views, panels, commands, status items, and contributions
// into the App UI registries — just like the old hook did, but
// enable/disable state is now fully UI-controlled.

import { useEffect, useRef } from 'react';
import { Box } from 'lucide-react';
import type { CoreClient } from './core-types';
import { loadApps, getManifest, isEnabled } from '../app-registry/app-registry';
import type { AppManifest, AppSystemUI } from '../app-registry/app-types';
import { mapPanelsToSidebarViews, mapStatusToChrome, registerManifestCommands } from './manifest-mapper';
import { registerView } from '../main/view-registry';
import { syncPluginPanels } from '../panels/panel-registry';
import { syncChromeContributions } from '../chrome/chrome-registry';
import { contributionRegistry } from '../plugin-host/contribution-registry';
import type { PluginManifest, PluginViewContribution, PluginPanelContribution } from '../plugin-host/plugin-manifest-types';
import { PluginManifestViewRenderer } from '../plugin-host/plugin-manifest-view-renderer';

const registeredAppIds = new Set<string>();

/**
 * Syncs plugin manifests from /api/apps/* and registers UI contributions.
 * Enable/disable is checked via app-registry.isEnabled().
 * Does NOT call any Core plugin.* APIs.
 */
export function useAppSync(
  core: CoreClient,
  onExecuteCommand: (commandId: string) => void,
): void {
  const onExecuteRef = useRef(onExecuteCommand);
  onExecuteRef.current = onExecuteCommand;

  useEffect(() => {
    if (!core.isConnected) return;

    let cancelled = false;

    async function sync(): Promise<void> {
      try {
        const apps = await loadApps();
        if (cancelled || !apps.length) return;

        const allLeftPanels: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; order?: number }> = [];
        const allRightPanels: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; order?: number }> = [];
        const allStatusBar: Array<{ id: string; text: string; icon?: string; command?: string; side: 'left' | 'right'; order: number }> = [];

        for (const app of apps) {
          if (cancelled) return;
          // Skip disabled apps
          if (!isEnabled(app.id)) continue;

          try {
            const manifest = await getManifest(app.id);
            if (cancelled || !manifest?.adapters?.['system-ui']) continue;

            const sysUI = manifest.adapters['system-ui'] as AppSystemUI;

            // Register views via PluginManifestViewRenderer
            if (sysUI.views) {
              for (const v of sysUI.views) {
                if (!v.id || !v.surface) continue;
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
                    pluginId: app.id,
                  },
                });
              }
            }

            // Collect panels
            const panels = mapPanelsToSidebarViews(sysUI.panels);
            if (panels['sidebar-left']) allLeftPanels.push(...panels['sidebar-left']);
            if (panels['sidebar-right']) allRightPanels.push(...panels['sidebar-right']);

            // Collect status items
            const chrome = mapStatusToChrome(sysUI.status);
            if (chrome.statusBar) allStatusBar.push(...chrome.statusBar as any);

            // Register commands
            registerManifestCommands(app.id, sysUI.commands, onExecuteRef.current);

            // Register into contribution registry
            if (!registeredAppIds.has(app.id)) {
              const pm: PluginManifest = {
                id: app.id,
                version: manifest.version || '0.0.0',
                name: manifest.name || app.id,
                description: manifest.description || '',
                type: manifest.trusted ? 'builtin' : 'feature',
                capabilities: app.capabilities,
                contributes: {
                  views: {},
                  panels: {},
                  commands: sysUI.commands?.map(c => ({
                    id: c.command || `${app.id}.${c.id}`,
                    title: c.title,
                  })) || [],
                  status: sysUI.status?.map(s => ({
                    id: s.id,
                    label: s.label,
                    icon: s.icon,
                    command: s.command,
                  })) || [],
                },
              };

              if (sysUI.views) {
                const viewMap: Record<string, PluginViewContribution[]> = {};
                for (const v of sysUI.views) {
                  const surface = v.surface || 'main.editor';
                  if (!viewMap[surface]) viewMap[surface] = [];
                  viewMap[surface].push({
                    id: v.id,
                    type: v.type as PluginViewContribution['type'],
                    componentId: v.componentId,
                    title: v.title || v.id,
                  });
                }
                pm.contributes!.views = viewMap;
              }

              if (sysUI.panels) {
                const panelMap: Record<string, PluginPanelContribution[]> = {};
                for (const pn of sysUI.panels) {
                  const surface = pn.surface || 'panel.bottom';
                  if (!panelMap[surface]) panelMap[surface] = [];
                  panelMap[surface].push({
                    id: pn.id,
                    type: pn.type as PluginPanelContribution['type'],
                    componentId: pn.componentId,
                    title: pn.title || pn.id,
                  });
                }
                pm.contributes!.panels = panelMap;
              }

              contributionRegistry.registerManifest(pm);
              registeredAppIds.add(app.id);
            }
          } catch {
            // Individual manifest fetch failure shouldn't block others
          }
        }

        if (cancelled) return;

        if (allLeftPanels.length > 0 || allRightPanels.length > 0) {
          syncPluginPanels(
            allLeftPanels.length > 0 ? allLeftPanels : undefined,
            allRightPanels.length > 0 ? allRightPanels : undefined,
          );
        }

        if (allStatusBar.length > 0) {
          syncChromeContributions({ statusBar: allStatusBar } as any);
        }
      } catch {
        // /api/apps/list failed — server may not support it yet
      }
    }

    sync();

    return () => { cancelled = true; };
  }, [core, core.isConnected]);
}
