'use client';

import type {
  PluginManifest,
  PluginViewContribution,
  PluginPanelContribution,
  PluginCommandContribution,
  PluginStatusContribution,
} from './plugin-manifest-types';
import type { SurfaceType } from '../surface/surface-types';

// ─── ContributionRegistry — aggregate all plugin contributions ──
export class ContributionRegistry {
  private _manifests = new Map<string, PluginManifest>();
  private _views = new Map<string, { manifest: PluginManifest; view: PluginViewContribution; surface: SurfaceType }>();
  private _panels = new Map<string, { manifest: PluginManifest; panel: PluginPanelContribution; surface: SurfaceType }>();
  private _commands = new Map<string, { manifest: PluginManifest; command: PluginCommandContribution }>();
  private _statusItems = new Map<string, { manifest: PluginManifest; status: PluginStatusContribution }>();

  registerManifest(manifest: PluginManifest): void {
    this._manifests.set(manifest.id, manifest);

    // Register views
    if (manifest.contributes?.views) {
      for (const [surfaceKey, views] of Object.entries(manifest.contributes.views)) {
        const surfaceType = surfaceKey as SurfaceType;
        for (const view of views) {
          this._views.set(view.id, { manifest, view, surface: surfaceType });
        }
      }
    }

    // Register panels
    if (manifest.contributes?.panels) {
      for (const [surfaceKey, panels] of Object.entries(manifest.contributes.panels)) {
        const surfaceType = surfaceKey as SurfaceType;
        for (const panel of panels) {
          this._panels.set(panel.id, { manifest, panel, surface: surfaceType });
        }
      }
    }

    // Register commands
    if (manifest.contributes?.commands) {
      for (const command of manifest.contributes.commands) {
        this._commands.set(command.id, { manifest, command });
      }
    }

    // Register status items
    if (manifest.contributes?.status) {
      for (const status of manifest.contributes.status) {
        this._statusItems.set(status.id, { manifest, status });
      }
    }
  }

  unregisterManifest(pluginId: string): void {
    this._manifests.delete(pluginId);
    // Clean up derived registrations
    for (const [id] of this._views) {
      if (id.startsWith(`${pluginId}.`)) this._views.delete(id);
    }
    for (const [id] of this._panels) {
      if (id.startsWith(`${pluginId}.`)) this._panels.delete(id);
    }
    for (const [id] of this._commands) {
      if (id.startsWith(`${pluginId}.`)) this._commands.delete(id);
    }
    for (const [id] of this._statusItems) {
      if (id.startsWith(`${pluginId}.`)) this._statusItems.delete(id);
    }
  }

  getManifest(pluginId: string): PluginManifest | undefined {
    return this._manifests.get(pluginId);
  }

  getAllManifests(): PluginManifest[] {
    return Array.from(this._manifests.values());
  }

  getView(viewId: string): { manifest: PluginManifest; view: PluginViewContribution; surface: SurfaceType } | undefined {
    return this._views.get(viewId);
  }

  getViewsForSurface(surface: SurfaceType): Array<{ manifest: PluginManifest; view: PluginViewContribution }> {
    return Array.from(this._views.values()).filter(v => v.surface === surface);
  }

  getPanelsForSurface(surface: SurfaceType): Array<{ manifest: PluginManifest; panel: PluginPanelContribution }> {
    return Array.from(this._panels.values()).filter(p => p.surface === surface);
  }

  getCommands(): Array<{ manifest: PluginManifest; command: PluginCommandContribution }> {
    return Array.from(this._commands.values());
  }

  getStatusItems(): Array<{ manifest: PluginManifest; status: PluginStatusContribution }> {
    return Array.from(this._statusItems.values());
  }
}

// ─── Singleton ─────────────────────────────────────────────────
export const contributionRegistry = new ContributionRegistry();
