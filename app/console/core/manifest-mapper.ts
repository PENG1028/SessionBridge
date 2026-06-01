// ─── App manifest → App UI registry descriptors ──
// Maps adapters.system-ui from plugin manifests into shapes consumed
// by App UI registries: panel-registry, chrome-registry, command-registry,
// contribution-registry. Manifests are now read by the App Registry
// (/api/apps/*) instead of Core plugin.* APIs.
//
// These input types match the shape of adapters.system-ui in plugin.yaml.

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

// ─── Input types (from plugin.yaml adapters.system-ui) ──

export interface ManifestView {
  id: string;
  surface: string;
  type: string;
  entry?: string;
  componentId?: string;
  title?: string;
  icon?: string;
}

export interface ManifestPanel {
  id: string;
  surface: string;
  type: string;
  entry?: string;
  componentId?: string;
  title?: string;
  icon?: string;
}

export interface ManifestCommand {
  id: string;
  title: string;
  command?: string;
}

export interface ManifestStatus {
  id: string;
  label: string;
  icon?: string;
  command?: string;
}

export interface ManifestSystemUI {
  views?: ManifestView[];
  panels?: ManifestPanel[];
  commands?: ManifestCommand[];
  status?: ManifestStatus[];
}

// ─── Mappers ──────────────────────────────────────────────────────

/**
 * Build adapterView map from system-ui view declarations.
 * adapterViews: Record<viewId, adapterId>
 */
export function mapViewsToAdapterViews(
  views: ManifestView[] | undefined,
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
 * Skips panels whose surface is not 'left' or 'right' (e.g. 'panel.bottom').
 */
export function mapPanelsToSidebarViews(
  panels: ManifestPanel[] | undefined,
): Record<string, Array<{ id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; order?: number }>> {
  if (!panels || panels.length === 0) return {};
  const left: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; order?: number }> = [];
  const right: Array<{ id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; order?: number }> = [];

  for (const p of panels) {
    const entry = {
      id: p.id,
      title: p.title || p.id,
      icon: 'PanelRight', // default icon name
      defaultVisible: true,
      componentId: p.componentId,
    };
    if (p.surface === 'left') {
      left.push(entry);
    } else if (p.surface === 'right') {
      right.push(entry);
    }
    // Other surfaces (e.g. 'panel.bottom') are not sidebar panels — skip
  }
  return { 'sidebar-left': left, 'sidebar-right': right };
}

/**
 * Build chrome contributions from system-ui status items.
 */
export function mapStatusToChrome(
  statusItems: ManifestStatus[] | undefined,
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
  commands: ManifestCommand[] | undefined,
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
