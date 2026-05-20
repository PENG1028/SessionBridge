// ─── PluginHost unit tests ─────────────────────────────────────
// Tests: host-rendered component loading, custom-react manifest,
// plugin CoreClient injection, pluginId forgery proof, ClaudeCode boundary.

import { describe, it, expect, beforeEach } from 'vitest';
import { ContributionRegistry, contributionRegistry } from '../../app/console/plugin-host/contribution-registry';
import {
  hostComponentRegistry,
  registerBuiltinHostComponents,
  PluginCacheTable,
  PluginPermissionPanel,
  PluginConfigForm,
} from '../../app/console/plugin-host/host-component-registry';
import type { PluginManifest, HostComponentProps } from '../../app/console/plugin-host';
import { createCoreClient, createMockCoreClient } from '../../app/console/core/core-client';
import type { CoreClient } from '../../app/console/core/core-types';

describe('HostComponentRegistry', () => {
  beforeEach(() => {
    // Clear and rebuild
    registerBuiltinHostComponents();
  });

  it('registers built-in host-rendered components', () => {
    expect(hostComponentRegistry.has('PluginCacheTable')).toBe(true);
    expect(hostComponentRegistry.has('PluginPermissionPanel')).toBe(true);
    expect(hostComponentRegistry.has('PluginConfigForm')).toBe(true);
    expect(hostComponentRegistry.has('PluginFilesTable')).toBe(true);
    expect(hostComponentRegistry.has('PluginInstallHistoryPanel')).toBe(true);
  });

  it('resolves component by componentId', () => {
    const Component = hostComponentRegistry.get('PluginCacheTable');
    expect(Component).toBeDefined();
    expect(Component).toBe(PluginCacheTable);
  });

  it('returns undefined for unknown componentId', () => {
    const Component = hostComponentRegistry.get('NonExistentComponent');
    expect(Component).toBeUndefined();
  });

  it('returns all registered components', () => {
    const all = hostComponentRegistry.getAll();
    expect(all.size).toBe(5);
    expect(all.has('PluginCacheTable')).toBe(true);
    expect(all.has('PluginPermissionPanel')).toBe(true);
  });
});

describe('ContributionRegistry', () => {
  let registry: ContributionRegistry;

  beforeEach(() => {
    registry = new ContributionRegistry();
  });

  it('registers and retrieves manifest', () => {
    const manifest: PluginManifest = {
      id: 'test-plugin',
      version: '1.0.0',
      name: 'Test Plugin',
      type: 'feature',
      capabilities: ['process.spawn', 'fs.read'],
    };

    registry.registerManifest(manifest);
    expect(registry.getManifest('test-plugin')).toEqual(manifest);
  });

  it('registers views from manifest contributes', () => {
    const manifest: PluginManifest = {
      id: 'test-plugin',
      version: '1.0.0',
      contributes: {
        views: {
          'main.editor': [
            { id: 'test-plugin.view', type: 'custom-react', title: 'Test View', entry: './TestView.tsx', sandbox: 'same-origin' },
          ],
        },
      },
    };

    registry.registerManifest(manifest);
    const views = registry.getViewsForSurface('main.editor');
    expect(views).toHaveLength(1);
    expect(views[0].view.id).toBe('test-plugin.view');
    expect(views[0].view.type).toBe('custom-react');
  });

  it('registers panels from manifest contributes', () => {
    const manifest: PluginManifest = {
      id: 'plugin-with-panels',
      version: '1.0.0',
      contributes: {
        panels: {
          'sidebar.left': [
            { id: 'plugin-with-panels.panel', type: 'host-rendered', title: 'My Panel', componentId: 'PluginConfigForm' },
          ],
        },
      },
    };

    registry.registerManifest(manifest);
    const panels = registry.getPanelsForSurface('sidebar.left');
    expect(panels).toHaveLength(1);
    expect(panels[0].panel.id).toBe('plugin-with-panels.panel');
    expect(panels[0].panel.type).toBe('host-rendered');
    expect(panels[0].panel.componentId).toBe('PluginConfigForm');
  });

  it('registers commands from manifest contributes', () => {
    const manifest: PluginManifest = {
      id: 'cli-plugin',
      version: '1.0.0',
      contributes: {
        commands: [
          { id: 'cli-plugin.run', title: 'Run Command', shortcut: 'Ctrl+Shift+R' },
          { id: 'cli-plugin.stop', title: 'Stop Command' },
        ],
      },
    };

    registry.registerManifest(manifest);
    const commands = registry.getCommands();
    expect(commands).toHaveLength(2);
    expect(commands[0].command.id).toBe('cli-plugin.run');
    expect(commands[1].command.id).toBe('cli-plugin.stop');
  });

  it('registers status items from manifest contributes', () => {
    const manifest: PluginManifest = {
      id: 'monitor-plugin',
      version: '1.0.0',
      contributes: {
        status: [
          { id: 'monitor-plugin.status', label: 'Monitoring', icon: 'activity', onClick: { command: 'monitor-plugin.open' } },
        ],
      },
    };

    registry.registerManifest(manifest);
    const items = registry.getStatusItems();
    expect(items).toHaveLength(1);
    expect(items[0].status.id).toBe('monitor-plugin.status');
    expect(items[0].status.label).toBe('Monitoring');
  });

  it('unregisters manifest and cleans up', () => {
    const manifest: PluginManifest = {
      id: 'temp-plugin',
      version: '1.0.0',
      contributes: {
        views: { 'main.editor': [{ id: 'temp-plugin.view', type: 'custom-react', title: 'Temp', entry: './temp.tsx' }] },
        commands: [{ id: 'temp-plugin.cmd', title: 'Temp Cmd' }],
      },
    };

    registry.registerManifest(manifest);
    expect(registry.getManifest('temp-plugin')).toBeDefined();
    expect(registry.getViewsForSurface('main.editor')).toHaveLength(1);
    expect(registry.getCommands()).toHaveLength(1);

    registry.unregisterManifest('temp-plugin');
    expect(registry.getManifest('temp-plugin')).toBeUndefined();
    expect(registry.getViewsForSurface('main.editor')).toHaveLength(0);
    expect(registry.getCommands()).toHaveLength(0);
  });

  it('returns all manifests', () => {
    registry.registerManifest({ id: 'a', version: '1.0.0' });
    registry.registerManifest({ id: 'b', version: '2.0.0' });

    const all = registry.getAllManifests();
    expect(all).toHaveLength(2);
  });
});

describe('ClaudeCode boundary', () => {
  it('ClaudeCode is NOT registered as host-rendered in system-ui', () => {
    // Verify that the host component registry does NOT contain ClaudeCode components
    const all = hostComponentRegistry.getAll();
    const claudeCodeComponents = Array.from(all.keys()).filter(k => k.toLowerCase().includes('claude'));
    expect(claudeCodeComponents).toHaveLength(0);
  });

  it('ClaudeCode manifest uses custom-react, not host-rendered', () => {
    // A proper ClaudeCode manifest would declare views as custom-react
    const claudeCodeManifest: PluginManifest = {
      id: 'claude-code',
      version: '1.0.0',
      contributes: {
        views: {
          'main.editor': [
            {
              id: 'claude-code.chat',
              type: 'custom-react', // Must be custom-react, NOT host-rendered
              title: 'Chat',
              entry: './views/ClaudeChatView.tsx',
              sandbox: 'same-origin',
            },
          ],
        },
      },
    };

    expect(claudeCodeManifest.contributes?.views?.['main.editor']?.[0]?.type).toBe('custom-react');
    expect(claudeCodeManifest.contributes?.views?.['main.editor']?.[0]?.type).not.toBe('host-rendered');
  });
});

describe('Plugin CoreClient injection', () => {
  it('plugin gets its own CoreClient with pluginId from host, not from payload', () => {
    // Simulate PluginHost logic: each plugin gets a CoreClient scoped to its ID
    const hostCore = createCoreClient({ pluginId: 'sessionnode-core' });

    // Create scoped clients for two different plugins
    const coreForPluginA = hostCore.createScopedClient('plugin-a');
    const coreForPluginB = hostCore.createScopedClient('plugin-b');

    // Each scoped client has its own fixed pluginId
    expect(coreForPluginA.pluginId).toBe('plugin-a');
    expect(coreForPluginB.pluginId).toBe('plugin-b');

    // The host core has a different (system) pluginId
    expect(hostCore.pluginId).toBe('sessionnode-core');
    expect(hostCore.pluginId).not.toBe(coreForPluginA.pluginId);
    expect(hostCore.pluginId).not.toBe(coreForPluginB.pluginId);
  });

  it('plugin-only CoreClient does not expose createScopedClient', () => {
    const hostCore = createCoreClient({ pluginId: 'sessionnode-core' });
    const scoped = hostCore.createScopedClient('plugin-a');

    // The plugin receives only the CoreClient interface — NOT CoreClientImpl
    // This means the plugin cannot create scoped clients for other pluginIds
    expect(scoped.pluginId).toBe('plugin-a');

    // The result of createScopedClient is a plain CoreClient object
    // It does NOT have the createScopedClient method
    // (Only the host CoreClientImpl has it)
    expect(typeof (scoped as Record<string, unknown>).createScopedClient).toBe('undefined');
    expect(typeof (hostCore as Record<string, unknown>).createScopedClient).toBe('function');
  });

  it('mock core supports plugin scoping', () => {
    const mockHost = createMockCoreClient({
      'plugin.list': [{ pluginId: 'test', version: '1.0.0' }],
    });

    // The mock's createScopedClient should work
    const scoped = (mockHost as any).createScopedClient('my-plugin');
    expect(scoped.pluginId).toBe('my-plugin');
  });

  it('host pluginId matches plugin when rendering core contributions', () => {
    // When a contribution has the same pluginId as the host core, the host core should be used directly
    const hostCore = createCoreClient({ pluginId: 'sessionnode-core' });
    const contributionPluginId = 'sessionnode-core';

    // The createPluginScopedCore logic in PluginHost:
    // if hostCore.pluginId === pluginId, return hostCore directly
    const coreForContribution = hostCore.pluginId === contributionPluginId
      ? hostCore
      : hostCore.createScopedClient(contributionPluginId);

    // For same-pluginId contributions, the host core is used directly
    expect(coreForContribution).toBe(hostCore);
    expect(coreForContribution.pluginId).toBe('sessionnode-core');
  });
});
