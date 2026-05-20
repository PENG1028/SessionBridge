'use client';

/**
 * Plugin Manifest Bridge — registers known plugin manifests into the
 * ContributionRegistry so that PluginHost can resolve views/panels.
 *
 * Phase 1: Manifests are defined here as a client-side bridge from
 * the Go Core-discovered plugins/ directory. In Phase 2, the Go Core
 * will serve full manifest data at runtime via a plugin.manifest
 * capability, making this hardcoded bridge unnecessary.
 */

import { contributionRegistry } from './contribution-registry';
import type { PluginManifest } from './plugin-manifest-types';

const builtinPluginManifests: PluginManifest[] = [
  // ── Terminal Plugin ──────────────────────────────────────────
  {
    id: 'terminal',
    version: '1.0.0',
    name: 'Terminal',
    description: 'Shell session management — create, stream, and replay terminal sessions',
    type: 'feature',
    capabilities: [
      'session.create',
      'session.list',
      'session.get',
      'session.stop',
      'stream.write',
      'stream.subscribe',
      'stream.replay',
      'stream.tail',
      'process.spawn',
      'process.signal',
      'process.resize',
      'node.list',
    ],
    contributes: {
      views: {
        'main.editor': [
          {
            id: 'terminal.view',
            type: 'host-rendered',
            componentId: 'TerminalView',
            title: 'Terminal',
          },
        ],
      },
      panels: {
        'panel.bottom': [
          {
            id: 'terminal.sessions',
            type: 'host-rendered',
            componentId: 'SessionListPanel',
            title: 'Sessions',
            icon: 'terminal',
          },
        ],
      },
    },
  },

  // ── System Info Plugin ───────────────────────────────────────
  {
    id: 'system-info',
    version: '1.0.0',
    name: 'System Info',
    description: 'System diagnostics, node health, and resource monitoring',
    type: 'feature',
    capabilities: [
      'system.info',
      'node.list',
      'node.info',
      'node.health',
    ],
    contributes: {
      panels: {
        'panel.bottom': [
          {
            id: 'system-info.panel',
            type: 'host-rendered',
            componentId: 'SystemInfoPanel',
            title: 'System',
            icon: 'activity',
          },
        ],
      },
    },
  },
];

/**
 * Register all known plugin manifests into the ContributionRegistry.
 * Call once at app initialization.
 */
export function registerPluginManifests(): void {
  for (const manifest of builtinPluginManifests) {
    contributionRegistry.registerManifest(manifest);
  }
}
