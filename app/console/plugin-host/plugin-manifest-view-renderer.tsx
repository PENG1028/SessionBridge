'use client';

import { useCore } from '../core/core-client-provider';
import { contributionRegistry } from './contribution-registry';
import { hostComponentRegistry } from './host-component-registry';

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
 *     → custom-react   → not-implemented placeholder
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

  // ── custom-react ──
  if (view.type === 'custom-react') {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[11px] text-yellow-400 font-mono text-center max-w-md px-4">
          <div className="mb-2">custom-react views are not implemented yet</div>
          <div className="text-[10px] text-gray-600">
            entry: {view.entry || '(not set)'}
          </div>
          <div className="text-[10px] text-gray-600">
            view: {viewId}
          </div>
        </div>
      </div>
    );
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
