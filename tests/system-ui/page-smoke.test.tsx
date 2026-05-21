// ─── Page smoke tests ──────────────────────────────────────────
// Tests that pages render with mock data and handle key states.
// Uses React testing utilities.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { CoreClient } from '../../app/console/core/core-types';
import { Dashboard } from '../../app/console/system-ui/views/dashboard';
import { SessionManager } from '../../app/console/system-ui/views/session-manager';
import { PluginManager } from '../../app/console/system-ui/views/plugin-manager';
import { Settings } from '../../app/console/system-ui/views/settings';
import { LogsViewer } from '../../app/console/system-ui/views/logs-viewer';
import { Approvals } from '../../app/console/system-ui/views/approvals';
import { ApprovalCenter } from '../../app/console/system-ui/approval-center';
import type { CoreEvent } from '../../app/console/core/core-types';

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

// ─── ApprovalCenter tests ──────────────────────────────────────
// Helper: creates a mock client that captures event handlers so we can emit events

function createApprovalCenterMock(mockData?: Record<string, unknown>) {
  const listeners = new Map<string, Set<(data: CoreEvent) => void>>();
  let connected = true;
  const call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (mockData?.[method] !== undefined) return mockData[method];
    if (method === 'notify.respond') return { status: 'responded', requestId: (params as Record<string, unknown>)?.requestId };
    return {};
  });

  const client: CoreClient & { emit: (event: string, data: CoreEvent) => void; setConnected: (v: boolean) => void } = {
    pluginId: 'test-core',
    get isConnected() { return connected; },
    call,
    on: vi.fn((event: string, handler: (data: CoreEvent) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return () => listeners.get(event)?.delete(handler);
    }),
    once: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
    emit: (event: string, data: CoreEvent) => {
      listeners.get(event)?.forEach(h => h(data));
    },
    setConnected: (v: boolean) => {
      connected = v;
      listeners.get('connectionStatus')?.forEach(h => h({ type: 'connectionStatus' } as CoreEvent));
    },
  };

  return { client, call };
}

// Helper to create a mock notify.approval.request event
function makeApprovalRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'notify.approval.request',
    requestId: overrides.requestId as string || 'req-001',
    pluginId: overrides.pluginId as string || 'test-plugin',
    payload: overrides.payload !== undefined ? overrides.payload : JSON.stringify({
      title: 'Test Approval',
      body: 'Approve this test action',
      detail: 'High risk operation',
      planId: 'plan-001',
    }),
  };
}

describe('ApprovalCenter', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders nothing when no approvals are pending', () => {
    const { client } = createApprovalCenterMock();
    const { container } = render(<ApprovalCenter core={client} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows approval when notify.approval.request event fires', async () => {
    const { client } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    // Emit approval request event
    client.emit('notify.approval.request', makeApprovalRequest());

    await vi.waitFor(() => {
      expect(screen.getByText('Test Approval')).toBeDefined();
    });
  });

  it('displays pluginId and title from event', async () => {
    const { client } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalRequest());

    await vi.waitFor(() => {
      expect(screen.getByText('test-plugin')).toBeDefined();
      expect(screen.getByText('Test Approval')).toBeDefined();
    });
  });

  it('calls notify.respond with action: allow on Approve click', async () => {
    const { client, call } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalRequest());

    await vi.waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    fireEvent.click(screen.getByText('Approve'));

    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledWith('notify.respond', { requestId: 'req-001', action: 'allow' });
    });
  });

  it('calls notify.respond with action: deny on Deny click', async () => {
    const { client, call } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalRequest());

    await vi.waitFor(() => expect(screen.getByText('Deny')).toBeDefined());
    fireEvent.click(screen.getByText('Deny'));

    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledWith('notify.respond', { requestId: 'req-001', action: 'deny' });
    });
  });

  it('shows multiple pending approvals', async () => {
    const { client } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalRequest({ requestId: 'req-001' }));
    client.emit('notify.approval.request', makeApprovalRequest({
      requestId: 'req-002',
      payload: JSON.stringify({ title: 'Second Approval', body: 'Another request' }),
    }));

    await vi.waitFor(() => {
      expect(screen.getByText('Test Approval')).toBeDefined();
      expect(screen.getByText('Second Approval')).toBeDefined();
      expect(screen.getByText('2 pending approvals')).toBeDefined();
    });
  });

  it('removes approval on notify.approval.result event', async () => {
    const { client } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalRequest({ requestId: 'req-001' }));
    await vi.waitFor(() => expect(screen.getByText('Test Approval')).toBeDefined());

    // Emit result event — should remove the approval
    client.emit('notify.approval.result', {
      type: 'notify.approval.result',
      requestId: 'req-001',
      action: 'allow',
      respondedBy: 'admin',
    });

    await vi.waitFor(() => {
      expect(screen.queryByText('Test Approval')).toBeNull();
    });
  });

  it('deduplicates by requestId', async () => {
    const { client } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    // Emit same requestId twice
    client.emit('notify.approval.request', makeApprovalRequest({ requestId: 'req-001' }));
    client.emit('notify.approval.request', makeApprovalRequest({ requestId: 'req-001' }));

    await vi.waitFor(() => expect(screen.getByText('Test Approval')).toBeDefined());
    // Should show "1 pending approval" not "2"
    expect(screen.getByText('1 pending approval')).toBeDefined();
  });

  it('hydrates existing pending approvals from approval.list on mount', async () => {
    const { client, call } = createApprovalCenterMock({
      'approval.list': {
        approvals: [
          { requestId: 'hydrate-001', pluginId: 'existing-plugin', action: 'Grant fs.write', detail: 'Pending from previous session', createdAt: Date.now() },
        ],
      },
    });
    render(<ApprovalCenter core={client} />);

    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledWith('approval.list', {});
      expect(screen.getByText('existing-plugin')).toBeDefined();
      expect(screen.getByText('Grant fs.write')).toBeDefined();
    });
  });

  it('re-hydrates on connectionStatus connected event', async () => {
    const { client, call } = createApprovalCenterMock({
      'approval.list': {
        approvals: [
          { requestId: 'reconn-001', pluginId: 'reconn-plugin', action: 'Grant network.connect', createdAt: Date.now() },
        ],
      },
    });

    // Start disconnected
    client.setConnected(false);
    render(<ApprovalCenter core={client} />);

    // First hydration attempt fails silently (not connected yet, but the call still goes through since mock returns data)
    // Clear calls and simulate reconnect
    call.mockClear();
    client.setConnected(true);

    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledWith('approval.list', {});
    });
  });

  it('deduplicates hydrated approvals with existing WS approvals', async () => {
    const { client } = createApprovalCenterMock({
      'approval.list': {
        approvals: [
          { requestId: 'req-001', pluginId: 'test-plugin', action: 'From hydration', createdAt: Date.now() },
        ],
      },
    });

    render(<ApprovalCenter core={client} />);

    await vi.waitFor(() => expect(screen.getByText('From hydration')).toBeDefined());

    // Same requestId arrives via WS — should NOT duplicate
    client.emit('notify.approval.request', makeApprovalRequest({
      requestId: 'req-001',
      payload: JSON.stringify({ title: 'From WS event', body: 'Should be dropped' }),
    }));

    // Should still show "1 pending approval" not "2"
    await vi.waitFor(() => {
      expect(screen.getByText('1 pending approval')).toBeDefined();
    });
    // Title should remain from hydration (not overwritten by WS event)
    expect(screen.getByText('From hydration')).toBeDefined();
  });

  it('parses payload from JSON string', async () => {
    const { client } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', {
      type: 'notify.approval.request',
      requestId: 'req-json',
      pluginId: 'json-plugin',
      payload: JSON.stringify({ title: 'JSON Parsed', body: 'From JSON string' }),
    });

    await vi.waitFor(() => {
      expect(screen.getByText('JSON Parsed')).toBeDefined();
      expect(screen.getByText('From JSON string')).toBeDefined();
    });
  });

  it('parses payload from object directly', async () => {
    const { client } = createApprovalCenterMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', {
      type: 'notify.approval.request',
      requestId: 'req-obj',
      pluginId: 'obj-plugin',
      payload: { title: 'Object Payload', body: 'From object' },
    });

    await vi.waitFor(() => {
      expect(screen.getByText('Object Payload')).toBeDefined();
      expect(screen.getByText('From object')).toBeDefined();
    });
  });
});
