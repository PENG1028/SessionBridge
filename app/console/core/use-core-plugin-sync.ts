'use client';

import { useEffect, useRef } from 'react';
import { Box } from 'lucide-react';
import type { CoreClient } from './core-types';
import type { GoCorePluginDetail, GoCoreSystemUI } from './manifest-mapper';
import { mapPanelsToSidebarViews, mapStatusToChrome, registerManifestCommands } from './manifest-mapper';
import { registerView } from '../main/view-registry';
import { syncPluginPanels } from '../panels/panel-registry';
import { syncChromeContributions } from '../chrome/chrome-registry';
import { contributionRegistry } from '../plugin-host/contribution-registry';
import type { PluginManifest, PluginViewContribution, PluginPanelContribution } from '../plugin-host/plugin-manifest-types';
import { PluginManifestViewRenderer } from '../plugin-host/plugin-manifest-view-renderer';

// Track which plugin IDs have been registered, so we can skip re-registration
const registeredPluginIds = new Set<string>();

/**
 * Extracts plugin list from plugin.list response, which may be:
 * - Array<{ pluginId: string }>
 * - { plugins: Array<{ pluginId: string }> }
 */
function extractPluginList(raw: unknown): Array<{ pluginId: string }> {
  if (Array.isArray(raw)) return raw as Array<{ pluginId: string }>;
  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).plugins)) {
    return (raw as Record<string, unknown>).plugins as Array<{ pluginId: string }>;
  }
  return [];
}

/**
 * Fetches Go Core plugin manifests and directly registers adapters.system-ui
 * contributions into App UI registries (view-registry, panel-registry,
 * chrome-registry, command-registry, contribution-registry).
 *
 * Plugin views are registered with PluginManifestViewRenderer, which
 * resolves host-rendered → componentId → hostComponentRegistry at render time.
 *
 * Reads plugin manifests directly from Core. Does not use relay extension points.
 */
export function useCorePluginRegistrySync(
  core: CoreClient,
  onExecuteCommand: (commandId: string) => void,
): void {
  const onExecuteRef = useRef(onExecuteCommand);
  onExecuteRef.current = onExecuteCommand;

  useEffect(() => {
    if (!core.isConnected) return;

    let cancelled = false;

    async function sync() {
      try {
        const rawList = await core.call<unknown>('plugin.list');
        const plugins = extractPluginList(rawList);
        if (cancelled || !plugins.length) return;

        const allLeftPanels: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; order?: number }> = [];
        const allRightPanels: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; order?: number }> = [];
        const allStatusBar: Array<{ id: string; text: string; icon?: string; command?: string; side: 'left' | 'right'; order: number }> = [];

        for (const p of plugins) {
          if (cancelled) return;
          try {
            const info = await core.call<GoCorePluginDetail>('plugin.get', { pluginId: p.pluginId });
            if (cancelled || !info?.adapters?.['system-ui']) continue;

            const sysUI = info.adapters['system-ui'] as GoCoreSystemUI;
            const enabled = info.enabled !== false;

            // Register views from manifest — all use PluginManifestViewRenderer.
            // The renderer resolves host-rendered / custom-react / errors at render time.
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
                    launchable: enabled,
                    launchMode: enabled ? 'direct' : 'hidden',
                    showInSelector: enabled,
                    pluginId: p.pluginId,
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

            // Register commands (with duplicate guard)
            registerManifestCommands(p.pluginId, sysUI.commands, onExecuteRef.current);

            // Register into contribution registry (for PluginHost / Plugin Manager)
            if (!registeredPluginIds.has(p.pluginId)) {
              const manifest: PluginManifest = {
                id: p.pluginId,
                version: info.version || '0.0.0',
                name: info.name || p.pluginId,
                description: info.description || '',
                type: info.trusted ? 'builtin' : 'feature',
                capabilities: [],
                contributes: {
                  views: {},
                  panels: {},
                  commands: sysUI.commands?.map(c => ({
                    id: c.command || `${p.pluginId}.${c.id}`,
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
                manifest.contributes!.views = viewMap;
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
                manifest.contributes!.panels = panelMap;
              }

              contributionRegistry.registerManifest(manifest);
              registeredPluginIds.add(p.pluginId);
            }
          } catch {
            // Individual plugin.get failure shouldn't block others
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
        // plugin.list failed — core may not support it yet
      }
    }

    sync();

    return () => { cancelled = true; };
  }, [core, core.isConnected]);
}
