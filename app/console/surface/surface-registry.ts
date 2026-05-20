'use client';

import type { ComponentType } from 'react';
import type { SurfaceType, SurfaceContribution, SurfaceRenderContext, TabProjection, SessionViewMapping } from './surface-types';

// ─── SurfaceRegistry — unified registry for all surface contributions ──
export class SurfaceRegistry {
  private _contributions = new Map<string, SurfaceContribution>();
  private _sessionViewMappings = new Map<string, SessionViewMapping>();

  register(contribution: SurfaceContribution): void {
    this._contributions.set(contribution.id, contribution);
  }

  unregister(id: string): void {
    this._contributions.delete(id);
  }

  get(id: string): SurfaceContribution | undefined {
    return this._contributions.get(id);
  }

  /** Get all contributions for a given surface type, sorted by order. */
  getContributions(type: SurfaceType): SurfaceContribution[] {
    const result: SurfaceContribution[] = [];
    for (const contrib of this._contributions.values()) {
      const types = Array.isArray(contrib.surfaceType) ? contrib.surfaceType : [contrib.surfaceType];
      if (types.includes(type)) {
        result.push(contrib);
      }
    }
    result.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    return result;
  }

  /** Resolve a React component for a given render context. */
  resolve(context: SurfaceRenderContext): ComponentType<unknown> | null {
    const contrib = this._contributions.get(context.viewId ?? context.panelId ?? '');
    if (contrib?.component) {
      return contrib.component;
    }
    return null;
  }

  /** Register a mapping from (pluginId, kind) to viewType for tab reconstruction. */
  registerSessionViewMapping(pluginId: string, kind: string, viewType: string, defaultTitle: string): void {
    const key = `${pluginId}:${kind}`;
    this._sessionViewMappings.set(key, { kind, viewType, defaultTitle });
  }

  getSessionView(pluginId: string, kind: string): SessionViewMapping | undefined {
    return this._sessionViewMappings.get(`${pluginId}:${kind}`);
  }

  /** Register built-in system-ui contributions. */
  registerBuiltins(): void {
    // Core system pages
    this.register({
      id: 'system-ui.dashboard',
      pluginId: 'system-ui',
      surfaceType: 'main.editor',
      componentType: 'builtin',
      title: 'Dashboard',
      icon: 'layout-dashboard',
      order: 1,
    });

    this.register({
      id: 'system-ui.nodes',
      pluginId: 'system-ui',
      surfaceType: 'main.editor',
      componentType: 'builtin',
      title: 'Nodes',
      icon: 'server',
      order: 2,
    });

    this.register({
      id: 'system-ui.sessions',
      pluginId: 'system-ui',
      surfaceType: 'main.editor',
      componentType: 'builtin',
      title: 'Sessions',
      icon: 'terminal',
      order: 3,
    });

    this.register({
      id: 'system-ui.plugins',
      pluginId: 'system-ui',
      surfaceType: 'main.editor',
      componentType: 'builtin',
      title: 'Plugins',
      icon: 'puzzle',
      order: 4,
    });

    this.register({
      id: 'system-ui.settings',
      pluginId: 'system-ui',
      surfaceType: 'settings.page',
      componentType: 'builtin',
      title: 'Settings',
      icon: 'settings',
      order: 5,
    });

    this.register({
      id: 'system-ui.logs',
      pluginId: 'system-ui',
      surfaceType: 'main.editor',
      componentType: 'builtin',
      title: 'Logs & Audit',
      icon: 'scroll-text',
      order: 6,
    });

    this.register({
      id: 'system-ui.approvals',
      pluginId: 'system-ui',
      surfaceType: 'notification.center',
      componentType: 'builtin',
      title: 'Approvals',
      icon: 'check-circle',
      order: 7,
    });
  }

  /** Built-in system navigation routes. */
  getNavItems(): Array<{ id: string; label: string; icon: string; route: string }> {
    return [
      { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', route: '/dashboard' },
      { id: 'nodes', label: 'Nodes', icon: 'server', route: '/nodes' },
      { id: 'sessions', label: 'Sessions', icon: 'terminal', route: '/sessions' },
      { id: 'plugins', label: 'Plugins', icon: 'puzzle', route: '/plugins' },
      { id: 'logs', label: 'Logs & Audit', icon: 'scroll-text', route: '/logs' },
      { id: 'approvals', label: 'Approvals', icon: 'check-circle', route: '/approvals' },
      { id: 'settings', label: 'Settings', icon: 'settings', route: '/settings' },
      { id: 'access-control', label: 'Access Control', icon: 'shield', route: '/access-control' },
    ];
  }
}

// ─── Singleton instance ─────────────────────────────────────────
export const surfaceRegistry = new SurfaceRegistry();
