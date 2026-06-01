'use client';

import React, { useState, useEffect, type ComponentType } from 'react';
import { useCore } from '../core/core-client-provider';
import { contributionRegistry } from './contribution-registry';
import { hostComponentRegistry } from './host-component-registry';
import type { HostComponentProps } from './host-component-registry';
import { pluginComponents } from '../../plugins/registry';

interface PluginManifestViewRendererProps {
  viewId: string;
  instanceId?: string;
  _surfaceId?: string;
}

/**
 * Renders a view registered from a plugin manifest's adapters.system-ui.views.
 *
 * Lookup chain:
 *   viewId → contributionRegistry.getView(viewId) → PluginViewContribution
 *     → host-rendered  → componentId → hostComponentRegistry.get(componentId) → render
 *     → custom-react   → pluginComponents[id] → dynamic import → render with HostComponentProps
 *     → unknown type   → error
 */
export function PluginManifestViewRenderer({ viewId, instanceId, _surfaceId }: PluginManifestViewRendererProps) {
  const core = useCore();
  const viewEntry = contributionRegistry.getView(viewId);

  if (!viewEntry) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[11px] text-gray-500 font-mono text-center px-4">
          <div>View not found in plugin registry</div>
          <div className="text-[10px] text-gray-600 mt-1">{viewId}</div>
        </div>
      </div>
    );
  }

  const { view, manifest, surface } = viewEntry;

  // ── host-rendered ──
  if (view.type === 'host-rendered') {
    if (!view.componentId) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-[11px] text-red-400 font-mono text-center px-4">
            <div>host-rendered view is missing componentId</div>
            <div className="text-[10px] text-gray-600 mt-1">view: {viewId}</div>
          </div>
        </div>
      );
    }

    const Component = hostComponentRegistry.get(view.componentId);
    if (!Component) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-[11px] text-red-400 font-mono text-center px-4">
            <div>Unknown host component: {view.componentId}</div>
            <div className="text-[10px] text-gray-600 mt-1">view: {viewId}</div>
          </div>
        </div>
      );
    }

    return (
      <Component
        core={core}
        config={{
          componentId: view.componentId,
          pluginId: manifest.id,
          title: view.title || viewId,
        }}
        container={{ surface, width: 0, height: 0 }}
      />
    );
  }

  // ── custom-react — self-contained plugin component ──
  if (view.type === 'custom-react') {
    const loader = pluginComponents[manifest.id];
    if (!loader) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-[11px] text-yellow-400 font-mono text-center max-w-md px-4">
            <div>Plugin &quot;{manifest.id}&quot; has no custom component registered</div>
            <div className="text-[10px] text-gray-600 mt-1">
              Add it to app/plugins/registry.ts
            </div>
          </div>
        </div>
      );
    }
    return <CustomReactLoader loader={loader} core={core} config={{
      componentId: viewId,
      pluginId: manifest.id,
      title: view.title || viewId,
    }} surface={surface} />;
  }

  // ── unknown type ──
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
      <div className="text-[11px] text-red-400 font-mono text-center px-4">
        <div>Unknown view type: {view.type}</div>
        <div className="text-[10px] text-gray-600 mt-1">view: {viewId}</div>
      </div>
    </div>
  );
}

// ─── CustomReactLoader — lazy-loads a self-contained plugin component ──
function CustomReactLoader({
  loader,
  core,
  config,
  surface,
}: {
  loader: () => Promise<{ default: ComponentType<HostComponentProps> }>;
  core: ReturnType<typeof useCore>;
  config: { componentId: string; pluginId: string; title: string };
  surface: string;
}) {
  const [Component, setComponent] = useState<ComponentType<HostComponentProps> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loader()
      .then(mod => { if (!cancelled) setComponent(() => mod.default); })
      .catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [loader]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[11px] text-red-400 font-mono text-center max-w-md px-4">
          <div>Failed to load plugin {config.pluginId}</div>
          <div className="text-[10px] text-gray-600 mt-1">{error}</div>
        </div>
      </div>
    );
  }

  if (!Component) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
        <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono">
          <div className="w-3 h-3 border-2 border-gray-600 border-t-purple-500 rounded-full animate-spin" />
          Loading {config.title}...
        </div>
      </div>
    );
  }

  return (
    <Component
      core={core}
      config={config}
      container={{ surface, width: 0, height: 0 }}
    />
  );
}
