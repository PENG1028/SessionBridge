'use client';

import React from 'react';
import type { SurfaceRenderContext } from '../surface/surface-types';
import type { CoreClient } from '../core/core-types';
import { contributionRegistry } from './contribution-registry';
import { hostComponentRegistry } from './host-component-registry';
import { getPanelComponentOverride } from '../panels/panel-registry';
import { CustomReactPlaceholder } from './custom-react-placeholder';

// ─── PluginHost Props ──────────────────────────────────────────
interface PluginHostProps {
  surface: SurfaceRenderContext;
  core: CoreClient;
}

/**
 * PluginHost — loads and renders the appropriate component for a
 * plugin contribution based on its type (custom-react vs host-rendered).
 *
 * Each plugin receives a plugin-scoped CoreClient with an immutable pluginId
 * set to the plugin's manifest ID. The plugin cannot forge another pluginId
 * because the CoreClient is injected by the host and the pluginId is baked
 * into the instance at construction time.
 *
 * For host-rendered: looks up the componentId in hostComponentRegistry
 *   and renders with HostComponentProps.
 *
 * For custom-react: renders a placeholder container that will later
 *   load the plugin's own React component.
 *
 * Surface lifecycle:
 *   MOUNT → resolve contribution → create CoreClient → render
 *   UNMOUNT → CoreClient.disconnect() → cleanup
 */
export function PluginHost({ surface, core }: PluginHostProps) {
  const pluginId = surface.pluginId;
  const viewId = surface.viewId;
  const panelId = surface.panelId;
  const contributionId = viewId || panelId || '';

  if (!pluginId) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">No pluginId in surface context</div>;
  }

  // Look up contribution via registry
  const manifest = contributionRegistry.getManifest(pluginId);
  if (!manifest) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">Plugin not registered: {pluginId}</div>;
  }

  // Create a plugin-scoped CoreClient with immutable pluginId
  const pluginCore = createPluginScopedCore(core, pluginId);

  // Check if it's a view contribution
  if (viewId) {
    const views = manifest.contributes?.views;
    for (const viewsOfSurface of Object.values(views ?? {})) {
      const view = viewsOfSurface.find((v: { id: string }) => v.id === viewId);
      if (view) {
        return renderContribution(view.type, view, pluginId, viewId, manifest, pluginCore, surface);
      }
    }
  }

  // Check if it's a panel contribution
  if (panelId) {
    const panels = manifest.contributes?.panels;
    for (const panelsOfSurface of Object.values(panels ?? {})) {
      const panel = panelsOfSurface.find((p: { id: string }) => p.id === panelId);
      if (panel) {
        return renderContribution(panel.type, panel, pluginId, panelId, manifest, pluginCore, surface);
      }
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
      Contribution not found: {contributionId} in plugin {pluginId}
    </div>
  );
}

/**
 * A CoreClient that also exposes createScopedClient for the PluginHost
 * to create plugin-scoped CoreClients. The scoped client returned does
 * NOT expose createScopedClient itself, so plugins cannot forge identities.
 */
type ScopedCoreClientFactory = CoreClient & { createScopedClient(pluginId: string): CoreClient };

/**
 * Type guard: checks if a CoreClient supports createScopedClient.
 */
function isScopedCoreClientFactory(core: CoreClient): core is ScopedCoreClientFactory {
  return typeof (core as ScopedCoreClientFactory).createScopedClient === 'function';
}

/**
 * Create a plugin-scoped CoreClient for the given pluginId.
 * If the pluginId matches the host's core, returns the host core directly.
 * If the host core supports createScopedClient (CoreClientImpl), uses it.
 * Otherwise falls back to the host core.
 */
function createPluginScopedCore(hostCore: CoreClient, pluginId: string): CoreClient {
  // Same pluginId as host — use host core directly
  if (hostCore.pluginId === pluginId) return hostCore;

  // CoreClientImpl and MockCoreClient both have createScopedClient
  if (isScopedCoreClientFactory(hostCore)) {
    return hostCore.createScopedClient(pluginId);
  }

  // Fallback: host core as-is
  return hostCore;
}

function renderContribution(
  type: 'custom-react' | 'host-rendered',
  contrib: { id: string; title: string; type: string; componentId?: string; sandbox?: string },
  pluginId: string,
  viewId: string,
  _manifest: unknown,
  core: CoreClient,
  surface: SurfaceRenderContext,
) {
  if (type === 'host-rendered') {
    const componentId = contrib.componentId;
    if (!componentId) {
      return <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">host-rendered view missing componentId: {viewId}</div>;
    }

    // Resolve component: hostComponentRegistry first, then panel component overrides
    const Component = hostComponentRegistry.get(componentId) ?? getPanelComponentOverride(componentId) as React.ComponentType<import('./host-component-registry').HostComponentProps> | undefined;
    if (!Component) {
      return <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">Host component not found: {componentId}</div>;
    }

    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <Component
          core={core}
          config={{
            componentId,
            pluginId,
            title: contrib.title,
          }}
          container={{
            surface: surface.type,
            width: 800,
            height: 600,
          }}
          {...(surface.sessionId ? { session: { id: surface.sessionId, kind: '', status: 'running' } } : {})}
          {...(surface.nodeId ? { node: { id: surface.nodeId, name: surface.nodeId } } : {})}
        />
      </div>
    );
  }

  // custom-react
  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0" data-plugin-container={`${pluginId}/${viewId}`}>
      <CustomReactPlaceholder
        pluginId={pluginId}
        viewId={viewId}
        title={contrib.title}
        sandbox={(contrib.sandbox as 'same-origin' | 'iframe') || 'same-origin'}
      />
    </div>
  );
}
