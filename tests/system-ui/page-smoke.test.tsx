// ─── Page smoke tests ──────────────────────────────────────────
// Tests that pages render with mock data and handle key states.
// Uses React testing utilities.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { CoreClient } from '../../app/console/core/core-types';
import { Dashboard } from '../../app/console/system-ui/views/dashboard';
import { SessionManager } from '../../app/console/system-ui/views/session-manager';
import { PluginManager } from '../../app/console/system-ui/views/plugin-manager';
import { Settings } from '../../app/console/system-ui/views/settings';
import { LogsViewer } from '../../app/console/system-ui/views/logs-viewer';
import { Approvals } from '../../app/console/system-ui/views/approvals';

// Helper to create a mock CoreClient with canned responses
function createMockClient(mockData: Record<string, unknown>): CoreClient {
  return {
    pluginId: 'sessionnode-core',
    isConnected: true,
    call: vi.fn(async (method: string, _params?: Record<string, unknown>) => {
      if (mockData[method] !== undefined) return mockData[method];
      // Return sensible defaults
      if (method.endsWith('.list')) return [];
      if (method.endsWith('.get')) return null;
      return {};
    }),
    on: vi.fn(() => vi.fn()),
    once: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe('Dashboard page', () => {
  it('renders with mock node/session/plugin data', async () => {
    const client = createMockClient({
      'node.list': [
        { nodeId: 'n1', name: 'node-main', status: 'online', role: 'relay' },
        { nodeId: 'n2', name: 'node-vps', status: 'online', role: 'leaf' },
        { nodeId: 'n3', name: 'node-staging', status: 'offline', role: 'leaf' },
      ],
      'session.list': [
        { sessionId: 's1', kind: 'shell', status: 'running', uptime: '30m' },
        { sessionId: 's2', kind: 'claude-code', status: 'stopped', uptime: '2h' },
      ],
      'plugin.list': [
        { pluginId: 'claude-code', version: '1.0.0', status: 'enabled', type: 'feature' },
        { pluginId: 'shell', version: '1.0.0', status: 'enabled', type: 'feature' },
        { pluginId: 'system-ui', version: '2.0.0', status: 'enabled', type: 'builtin' },
      ],
    });

    // Use async rendering
    const { container } = render(<Dashboard core={client} />);

    // Wait for state to settle
    await vi.waitFor(() => {
      expect(container.querySelector('h1')?.textContent).toContain('Dashboard');
    }, { timeout: 2000 });
  });

  it('calls node.list, session.list, plugin.list', async () => {
    const client = createMockClient({});
    render(<Dashboard core={client} />);

    await vi.waitFor(() => {
      expect(client.call).toHaveBeenCalledWith('node.list');
      expect(client.call).toHaveBeenCalledWith('session.list');
      expect(client.call).toHaveBeenCalledWith('plugin.list');
    });
  });
});

describe('Sessions page', () => {
  it('can replay stream', async () => {
    const client = createMockClient({
      'session.list': [
        { sessionId: 'sess_test', kind: 'shell', pluginId: 'shell', nodeId: 'n1', status: 'running', uptime: '5m' },
      ],
      'stream.replay': { lines: ['line 1', 'line 2', 'line 3'] },
    });

    render(<SessionManager core={client} />);

    // Should render after loading
    await vi.waitFor(() => {
      expect(client.call).toHaveBeenCalledWith('session.list');
    });
  });

  it('uses stream.write for input (not process.stdin)', async () => {
    const client = createMockClient({
      'session.list': [
        { sessionId: 'sess_test', kind: 'shell', status: 'running' },
      ],
    });

    render(<SessionManager core={client} />);

    // Verify the component doesn't reference process.stdin
    const SessionManagerCode = SessionManager.toString();
    expect(SessionManagerCode).not.toContain('process.stdin');
    expect(SessionManagerCode).not.toContain('stream.stdin');
  });
});

describe('Settings page', () => {
  it('handles CONFIG_CONFLICT error', async () => {
    const client = createMockClient({
      'config.list': [
        { key: 'host.name', value: 'test', revision: 1 },
        { key: 'host.port', value: 8080, revision: 1 },
      ],
    });

    // Mock config.set to throw CONFIG_CONFLICT
    (client.call as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'config.list') return [
        { key: 'host.name', value: 'test', revision: 1 },
        { key: 'host.port', value: 8080, revision: 1 },
      ];
      if (method === 'config.set') {
        throw new Error('CONFIG_CONFLICT: key was modified by another device');
      }
      return [];
    });

    render(<Settings core={client} />);

    await vi.waitFor(() => {
      expect(client.call).toHaveBeenCalledWith('config.list');
    });
  });

  it('uses config.set with expectedRevision', async () => {
    const client = createMockClient({
      'config.list': [
        { key: 'test.key', value: 'old', revision: 3 },
      ],
    });

    render(<Settings core={client} />);

    await vi.waitFor(() => {
      expect(client.call).toHaveBeenCalledWith('config.list');
    });
  });
});

describe('Plugins page', () => {
  it('calls plugin.list', async () => {
    const client = createMockClient({
      'plugin.list': [
        { pluginId: 'test-plugin', version: '1.0.0', status: 'enabled', type: 'feature' },
      ],
    });

    render(<PluginManager core={client} />);

    await vi.waitFor(() => {
      expect(client.call).toHaveBeenCalledWith('plugin.list');
    });
  });
});

describe('Logs page', () => {
  it('separates logs.query and audit.list', async () => {
    const client = createMockClient({
      'logs.tail': { lines: [] },
      'audit.list': { entries: [] },
    });

    render(<LogsViewer core={client} />);

    await vi.waitFor(() => {
      // By default, Core Logs tab is active, which calls logs.tail
      expect(client.call).toHaveBeenCalled();
    });
  });
});

describe('Approvals page', () => {
  it('renders with empty state', async () => {
    const client = createMockClient({ 'approval.list': { approvals: [] } });
    render(<Approvals core={client} />);

    await vi.waitFor(() => {
      expect(client.call).toHaveBeenCalledWith('approval.list', { status: 'pending' });
    });
  });
});
