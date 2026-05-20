'use client';

import type { ComponentType } from 'react';
import type { SurfaceRenderContext } from '../surface/surface-types';
import type { CoreClient } from '../core/core-types';

// ─── HostComponentProps — props for host-rendered components ───
export interface HostComponentProps {
  core: CoreClient;
  config: {
    componentId: string;
    pluginId: string;
    title: string;
    icon?: string;
  };
  container: {
    surface: string;
    width: number;
    height: number;
  };
  session?: { id: string; kind: string; status: string };
  node?: { id: string; name: string };
}

// ─── HostComponentRegistry — maps componentId to React component ──
export class HostComponentRegistry {
  private _components = new Map<string, ComponentType<HostComponentProps>>();

  register(componentId: string, component: ComponentType<HostComponentProps>): void {
    this._components.set(componentId, component);
  }

  get(componentId: string): ComponentType<HostComponentProps> | undefined {
    return this._components.get(componentId);
  }

  has(componentId: string): boolean {
    return this._components.has(componentId);
  }

  getAll(): Map<string, ComponentType<HostComponentProps>> {
    return new Map(this._components);
  }
}

export const hostComponentRegistry = new HostComponentRegistry();

// ─── Placeholder host-rendered components for Phase 1 ──────────

import React from 'react';

export function PluginCacheTable(_props: HostComponentProps) {
  return (
    <div className="p-4 text-sm text-gray-500">
      <p className="font-medium mb-2">Cache</p>
      <p>Plugin cache management (host-rendered). Core API: plugin.cache.list</p>
      <p className="text-xs text-gray-400 mt-1">TODO: Full implementation</p>
    </div>
  );
}

export function PluginPermissionPanel(_props: HostComponentProps) {
  return (
    <div className="p-4 text-sm text-gray-500">
      <p className="font-medium mb-2">Permissions</p>
      <p>Plugin permission management (host-rendered). Core API: plugin.permissions.*</p>
      <p className="text-xs text-gray-400 mt-1">TODO: Full implementation</p>
    </div>
  );
}

export function PluginConfigForm(_props: HostComponentProps) {
  return (
    <div className="p-4 text-sm text-gray-500">
      <p className="font-medium mb-2">Configuration</p>
      <p>Plugin configuration form (host-rendered). Core API: plugin.config.*</p>
      <p className="text-xs text-gray-400 mt-1">TODO: Full implementation</p>
    </div>
  );
}

export function PluginFilesTable(_props: HostComponentProps) {
  return (
    <div className="p-4 text-sm text-gray-500">
      <p className="font-medium mb-2">Files</p>
      <p>Plugin file locations (host-rendered). Core API: plugin.files.list</p>
      <p className="text-xs text-gray-400 mt-1">TODO: Full implementation</p>
    </div>
  );
}

export function PluginInstallHistoryPanel(_props: HostComponentProps) {
  return (
    <div className="p-4 text-sm text-gray-500">
      <p className="font-medium mb-2">Install History</p>
      <p>Plugin install history (host-rendered). Core API: plugin.history</p>
      <p className="text-xs text-gray-400 mt-1">TODO: Full implementation</p>
    </div>
  );
}

// ─── Register built-in host-rendered components ────────────────
export function registerBuiltinHostComponents(): void {
  hostComponentRegistry.register('PluginCacheTable', PluginCacheTable);
  hostComponentRegistry.register('PluginPermissionPanel', PluginPermissionPanel);
  hostComponentRegistry.register('PluginConfigForm', PluginConfigForm);
  hostComponentRegistry.register('PluginFilesTable', PluginFilesTable);
  hostComponentRegistry.register('PluginInstallHistoryPanel', PluginInstallHistoryPanel);
}
