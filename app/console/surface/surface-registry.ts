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

  /** @deprecated Built-in contributions replaced by plugin manifest discovery. */
}

// ─── Singleton instance ─────────────────────────────────────────
export const surfaceRegistry = new SurfaceRegistry();
