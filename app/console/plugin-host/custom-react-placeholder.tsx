'use client';

import React from 'react';

// ─── Custom-React Placeholder ───────────────────────────────────
// custom-react views are rendered by the plugin itself.
// System UI only provides a container with error boundary and CoreClient injection.
// The actual plugin React component is loaded by the PluginHost at runtime.
//
// DOM isolation boundary: custom-react components MUST only operate within
// their allocated container DOM element. They MUST NOT:
//   - Manipulate the System UI shell (sidebar, header, status bar)
//   - Access or modify other plugin containers
//   - Modify global registries (commands, menus, panels)
//   - Create additional WebSocket/HTTP connections to Core
//
// For iframe sandbox: the same constraints apply via postMessage bridge.

interface CustomReactPlaceholderProps {
  pluginId: string;
  viewId: string;
  title: string;
  sandbox?: 'same-origin' | 'iframe';
}

export function CustomReactPlaceholder({ pluginId, viewId, title, sandbox = 'same-origin' }: CustomReactPlaceholderProps) {
  if (sandbox === 'iframe') {
    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
          <IframeSandboxPlaceholder pluginId={pluginId} viewId={viewId} title={title} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
        <SameOriginPlaceholder pluginId={pluginId} viewId={viewId} title={title} />
      </div>
    </div>
  );
}

function SameOriginPlaceholder({ pluginId, viewId, title }: CustomReactPlaceholderProps) {
  return (
    <div className="text-center p-8">
      <p className="text-sm font-medium text-gray-400">{title}</p>
      <p className="text-xs text-gray-500 mt-1">
        Plugin view: {pluginId}/{viewId}
      </p>
      <p className="text-xs text-gray-500 mt-1">
        Type: custom-react (same-origin)
      </p>
      <p className="text-xs text-gray-400 mt-2">
        DOM isolation boundary: only operates within this container.
        No access to System UI shell.
      </p>
    </div>
  );
}

function IframeSandboxPlaceholder({ pluginId, viewId, title }: CustomReactPlaceholderProps) {
  return (
    <div className="text-center p-8">
      <p className="text-sm font-medium text-gray-400">{title}</p>
      <p className="text-xs text-gray-500 mt-1">
        Plugin view: {pluginId}/{viewId}
      </p>
      <p className="text-xs text-gray-500 mt-1">
        Type: custom-react (iframe)
      </p>
      <p className="text-xs text-gray-500 mt-1">
        [iframe sandbox placeholder — postMessage bridge TBD]
      </p>
    </div>
  );
}
