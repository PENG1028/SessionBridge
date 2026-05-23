// ─── Go Core plugin adapter → App UI registry descriptors ──
// Maps plugin.get adapters.system-ui into shapes consumed by App UI registries:
// panel-registry, chrome-registry, command-registry, contribution-registry.

import { registerCommand, getCommand } from '../commands/command-registry';

// ─── Local chrome types ──
export interface StatusBarChromeContribution {
  id: string;
  text: string;
  icon?: string;
  command?: string;
  side: 'left' | 'right';
  order: number;
}

export interface ChromeContributions {
  statusBar?: StatusBarChromeContribution[];
}

// ─── Go Core raw types (what plugin.info / plugin.get actually return) ──

export interface GoCoreUIView {
  id: string;
  surface: string;
  type: string;
  entry?: string;
  componentId?: string;
  title?: string;
  icon?: string;
}

export interface GoCoreUIPanel {
  id: string;
  surface: string;
  type: string;
  entry?: string;
  componentId?: string;
  title?: string;
}

export interface GoCoreUICommand {
  id: string;
  title: string;
  command?: string;
}

export interface GoCoreUIStatus {
  id: string;
  label: string;
  icon?: string;
  command?: string;
}

export interface GoCoreSystemUI {
  views?: GoCoreUIView[];
  panels?: GoCoreUIPanel[];
  commands?: GoCoreUICommand[];
  status?: GoCoreUIStatus[];
}

export interface GoCoreAdapters {
  'system-ui'?: GoCoreSystemUI;
  cli?: unknown;
}

export interface GoCorePluginDetail {
  pluginId: string;
  version: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  trusted?: boolean;
  manifestVersion?: string;
  core?: Record<string, unknown>;
  adapters?: GoCoreAdapters;
}

// ─── Mappers ──────────────────────────────────────────────────────

/**
 * Build adapterView map from system-ui view declarations.
 * adapterViews: Record<viewId, adapterId>
 */
export function mapViewsToAdapterViews(
  views: GoCoreUIView[] | undefined,
): Record<string, string> {
  if (!views) return {};
  const map: Record<string, string> = {};
  for (const v of views) {
    if (v.id && v.surface) {
      map[v.id] = v.surface;
    }
  }
  return map;
}

/**
 * Build panel lists from system-ui panel declarations.
 * Returns { 'sidebar-left': [...], 'sidebar-right': [...] } shape.
 */
export function mapPanelsToSidebarViews(
  panels: GoCoreUIPanel[] | undefined,
): Record<string, Array<{ id: string; title: string; icon: string; defaultVisible: boolean; order?: number }>> {
  if (!panels || panels.length === 0) return {};
  const left: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; order?: number }> = [];
  const right: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; order?: number }> = [];

  for (const p of panels) {
    const entry = {
      id: p.id,
      title: p.title || p.id,
      icon: 'PanelRight', // default icon name
      defaultVisible: true,
    };
    // surface "left" → sidebar-left, everything else → sidebar-right
    if (p.surface === 'left') {
      left.push(entry);
    } else {
      right.push(entry);
    }
  }
  return { 'sidebar-left': left, 'sidebar-right': right };
}

/**
 * Build chrome contributions from system-ui status items.
 */
export function mapStatusToChrome(
  statusItems: GoCoreUIStatus[] | undefined,
): ChromeContributions {
  if (!statusItems || statusItems.length === 0) return {};
  const statusBar: StatusBarChromeContribution[] = statusItems.map((s, i) => ({
    id: s.id,
    text: s.label,
    icon: s.icon,
    command: s.command,
    side: 'left' as const,
    order: i,
  }));
  return { statusBar };
}

/**
 * Register commands from system-ui command declarations.
 * Each command is registered as: <pluginId>.<commandId>
 * The handler callback receives the full command ID for dispatch.
 */
export function registerManifestCommands(
  pluginId: string,
  commands: GoCoreUICommand[] | undefined,
  onExecute: (commandId: string) => void,
): void {
  if (!commands) return;
  for (const c of commands) {
    const fullId = c.command || `${pluginId}.${c.id}`;
    if (getCommand(fullId)) continue; // built-in or already registered takes precedence
    registerCommand({
      id: fullId,
      title: c.title,
      category: pluginId,
      handler: () => onExecute(fullId),
    });
  }
}
