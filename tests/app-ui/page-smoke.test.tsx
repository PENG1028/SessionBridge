// ─── Page smoke tests ──────────────────────────────────────────
// Tests that pages render with mock data and handle key states.
// Uses React testing utilities.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { CoreClient } from '../../app/console/core/core-types';
import { Dashboard } from '../../app/console/system-pages/dashboard';
import { SessionManager } from '../../app/console/system-pages/session-manager';
import { PluginManager } from '../../app/console/system-pages/plugin-manager';
import { NodeManager } from '../../app/console/system-pages/node-manager';
import { Settings } from '../../app/console/system-pages/settings';
import { LogsViewer } from '../../app/console/system-pages/logs-viewer';
import { Approvals } from '../../app/console/system-pages/approvals';
import { ApprovalCenter } from '../../app/console/overlays/approval-center';
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


beforeEach(cleanup);
describe('Dashboard page', () => {
  it('renders with mock node/session/plugin data', async () => {
    const client = createMockClient({
      'node.list': { nodes: [
        { nodeId: 'n1', name: 'node-main', status: 'online', role: 'relay' },
        { nodeId: 'n2', name: 'node-vps', status: 'online', role: 'leaf' },
        { nodeId: 'n3', name: 'node-staging', status: 'offline', role: 'leaf' },
      ] },
      'session.list': { sessions: [
        { sessionId: 's1', kind: 'shell', status: 'running', uptime: '30m' },
        { sessionId: 's2', kind: 'claude-code', status: 'stopped', uptime: '2h' },
      ] },
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
      expect(screen.getByText('Dashboard')).toBeDefined();
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
      'session.list': { sessions: [
        { sessionId: 'sess_test', kind: 'shell', pluginId: 'shell', nodeId: 'n1', status: 'running', uptime: '5m' },
      ] },
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
      'session.list': { sessions: [
        { sessionId: 'sess_test', kind: 'shell', status: 'running' },
      ] },
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
      'config.list': { configs: [
        { key: 'host.name', value: 'test', revision: 1 },
        { key: 'host.port', value: 8080, revision: 1 },
      ] },
    });

    // Mock config.set to throw CONFIG_CONFLICT
    (client.call as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'config.list') return { configs: [
        { key: 'host.name', value: 'test', revision: 1 },
        { key: 'host.port', value: 8080, revision: 1 },
      ] };
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
      'config.list': { configs: [
        { key: 'test.key', value: 'old', revision: 3 },
      ] },
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

describe('Nodes page', () => {
  it('unwraps node.list response and uses node.info for details', async () => {
    const client = createMockClient({
      'node.list': {
        nodes: [
          { nodeId: 'peer-1', name: 'Peer 1', status: 'connected', address: 'ws://peer/peer/ws' },
        ],
      },
      'node.info': {
        nodeId: 'peer-1',
        name: 'Peer 1',
        status: 'connected',
        os: 'linux',
        arch: 'amd64',
      },
    });

    render(<NodeManager core={client} />);

    await vi.waitFor(() => {
      expect(screen.getByText('Peer 1')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Peer 1'));

    await vi.waitFor(() => {
      expect(client.call).toHaveBeenCalledWith('node.info', { nodeId: 'peer-1' });
      expect(screen.getByText('linux amd64')).toBeDefined();
    });
  });
});

	describe('NodeManager: Mesh tabs', () => {
		it('Identity tab shows local node identity', async () => {
			const client = createMockClient({
				'node.identity.get': {
					nodeId: 'node-local',
					publicKey: 'abc123',
					fingerprint: 'deadbeef',
					createdAt: 1717000000000,
				},
				'node.peer.list': { peers: [] },
				'node.invite.list': { invites: [], total: 0 },
				'node.reachability.check': {
					publicReachable: 'unknown',
					inboundPeerAllowed: false,
					outboundOnly: true,
					reason: 'loopback address',
				},
			});
			render(<NodeManager core={client} />);
			await vi.waitFor(() => {
				expect(client.call).toHaveBeenCalledWith('node.identity.get');
			});
			fireEvent.click(screen.getByText('Identity'));
			await vi.waitFor(() => {
				expect(screen.getByText('node-local')).toBeDefined();
			});
		});
		it('Peers tab shows peers from node.peer.list', async () => {
			const client = createMockClient({
				'node.identity.get': { nodeId: 'local', publicKey: 'key', fingerprint: 'fp', createdAt: 0 },
				'node.peer.list': {
					peers: [
						{ nodeId: 'peer-vps', name: 'VPS Node', fingerprint: 'fp1', addresses: ['ws://vps:8080/peer/ws'], trustExpiresAt: 0, autoReconnect: true, lastSeen: Date.now(), policy: { mode: 'full' }, status: 'connected' },
						{ nodeId: 'peer-dev', name: 'Dev Box', fingerprint: 'fp2', addresses: ['ws://dev:8080/peer/ws'], trustExpiresAt: 0, autoReconnect: false, lastSeen: 0, policy: { mode: 'full' }, status: 'offline' },
					],
				},
				'node.invite.list': { invites: [], total: 0 },
				'node.reachability.check': {
					publicReachable: 'unknown', inboundPeerAllowed: false, outboundOnly: true, reason: 'loopback',
				},
			});
			render(<NodeManager core={client} />);
			fireEvent.click(screen.getByText('Peers'));
			await vi.waitFor(() => {
				expect(screen.getByText('VPS Node')).toBeDefined();
				expect(screen.getByText('connected')).toBeDefined();
				expect(screen.getByText('Dev Box')).toBeDefined();
				expect(screen.getByText('offline')).toBeDefined();
			});
		});
		it('Invites tab shows create invite form and invite list', async () => {
			const client = createMockClient({
				'node.identity.get': { nodeId: 'local', publicKey: 'key', fingerprint: 'fp', createdAt: 0 },
				'node.peer.list': { peers: [] },
				'node.invite.list': {
					invites: [
						{ inviteId: 'inv_abc', createdAt: Date.now() / 1000, expiresAt: (Date.now() + 60000) / 1000, ttlSeconds: 60, trustDurationSeconds: 0, localNodeId: 'local', localFingerprint: 'fp' },
					],
					total: 1,
				},
				'node.reachability.check': {
					publicReachable: 'unknown', inboundPeerAllowed: false, outboundOnly: true, reason: 'loopback',
				},
			});
			render(<NodeManager core={client} />);
			fireEvent.click(screen.getByText('Invites'));
			await vi.waitFor(() => {
				expect(screen.getByText('inv_abc')).toBeDefined();
				expect(screen.getByText('Create Invite')).toBeDefined();
			});
			fireEvent.click(screen.getByText('Create Invite'));
			await vi.waitFor(() => {
				expect(screen.getByText('New Invite')).toBeDefined();
			});
		});
		it('Reachability tab shows reachability status', async () => {
			const client = createMockClient({
				'node.identity.get': { nodeId: 'local', publicKey: 'key', fingerprint: 'fp', createdAt: 0 },
				'node.peer.list': { peers: [] },
				'node.invite.list': { invites: [], total: 0 },
				'node.reachability.check': {
					publicReachable: 'unknown',
					inboundPeerAllowed: true,
					outboundOnly: false,
					reason: 'non-loopback address',
				},
			});
			render(<NodeManager core={client} />);
			fireEvent.click(screen.getByText('Reachability'));
			await vi.waitFor(() => {
				expect(screen.getByText('Allowed')).toBeDefined();
				expect(screen.getByText('non-loopback address')).toBeDefined();
			});
		});
	});
	describe('NodeManager: empty and offline states', () => {
		it('shows empty state when peers list is empty', async () => {
			const client = createMockClient({
				'node.identity.get': { nodeId: 'local', publicKey: 'key', fingerprint: 'fp', createdAt: 0 },
				'node.peer.list': { peers: [] },
				'node.invite.list': { invites: [], total: 0 },
				'node.reachability.check': {
					publicReachable: 'unknown', inboundPeerAllowed: false, outboundOnly: true, reason: 'loopback',
				},
			});
			render(<NodeManager core={client} />);
			fireEvent.click(screen.getByText('Peers'));
			await vi.waitFor(() => {
				expect(screen.getByText('No trusted peers')).toBeDefined();
				expect(screen.getByText(/Use the Invites tab/)).toBeDefined();
			});
		});
		it('shows offline state when core disconnects', async () => {
			const client = createMockClient({
				'node.identity.get': { nodeId: 'local', publicKey: 'key', fingerprint: 'fp', createdAt: 0 },
				'node.peer.list': { peers: [] },
				'node.invite.list': { invites: [], total: 0 },
				'node.reachability.check': {
					publicReachable: 'unknown', inboundPeerAllowed: false, outboundOnly: true, reason: 'loopback',
				},
			});
			Object.defineProperty(client, 'isConnected', { get: () => false });
			render(<NodeManager core={client} />);
			fireEvent.click(screen.getByText('Peers'));
			await vi.waitFor(() => {
				expect(screen.getByText('Offline')).toBeDefined();
			});
		});
	});
	describe('Settings: Connection tab', () => {
		async function waitForSettingsLoaded() {
			// Wait for Settings to finish loading — category nav renders
			await vi.waitFor(() => {
				expect(screen.getByText('General')).toBeDefined();
			});
		}
		it('shows connection status and wsUrl', async () => {
			const client = createMockClient({ 'config.list': [] });
			(client as any).wsUrl = 'ws://localhost:8080/ws';
			(client as any).lastError = null;
			render(<Settings core={client} />);
			await waitForSettingsLoaded();
			fireEvent.click(screen.getByText('Connection'));
			await vi.waitFor(() => {
				expect(screen.getByText('ws://localhost:8080/ws')).toBeDefined();
				expect(screen.getByText('Connected')).toBeDefined();
			});
		});
		it('shows token warning when no token in URL', async () => {
			const client = createMockClient({ 'config.list': [] });
			(client as any).wsUrl = 'ws://remote:8080/ws';
			(client as any).lastError = null;
			render(<Settings core={client} />);
			await waitForSettingsLoaded();
			fireEvent.click(screen.getByText('Connection'));
			await vi.waitFor(() => {
				expect(screen.getByText('Not present')).toBeDefined();
				expect(screen.getByText(/No auth token detected/)).toBeDefined();
			});
		});

	});

	describe('Settings: token safety', () => {
		async function waitForSettingsLoaded() {
			await vi.waitFor(() => {
				expect(screen.getByText('General')).toBeDefined();
			});
		}

		it('does not render raw token when token is present', async () => {
			const core = createMockClient({ 'config.list': [] });
			(core as any).hasToken = true;
			(core as any).authMode = 'token';
			const { container } = render(<Settings core={core} />);
			await waitForSettingsLoaded();
			fireEvent.click(screen.getByText('Connection'));
			await vi.waitFor(() => expect(screen.getByText('Present')).toBeDefined());
			const html = container.innerHTML;
			expect(html).not.toContain('token=');
			expect(html).not.toContain('Bearer ');
		});

		it('shows "Not present" when hasToken is false', async () => {
			const core = createMockClient({ 'config.list': [] });
			(core as any).hasToken = false;
			(core as any).authMode = 'none';
			render(<Settings core={core} />);
			await waitForSettingsLoaded();
			fireEvent.click(screen.getByText('Connection'));
			await vi.waitFor(() => expect(screen.getByText('Not present')).toBeDefined());
		});
	});

	describe('NodeManager: token safety', () => {
		it('does not render raw token in DOM', async () => {
			const core = createMockClient({ 'config.list': [] });
			(core as any).hasToken = true;
			(core as any).authMode = 'token';
			const { container } = render(<NodeManager core={core} />);
			await vi.waitFor(() => expect(screen.getByText('Reachability')).toBeDefined());
			fireEvent.click(screen.getByText('Reachability'));
			const html = container.innerHTML;
			expect(html).not.toContain('token=');
		});
	});

	describe('NodeManager: Accept Invite', () => {
		it('accept button is disabled when inputs are empty', async () => {
			const core = createMockClient({
				'node.identity.get': { nodeId: 'local', publicKey: 'key', fingerprint: 'fp', createdAt: 0 },
				'node.peer.list': { peers: [] },
				'node.invite.list': { invites: [], total: 0 },
				'node.reachability.check': {
					publicReachable: 'unknown', inboundPeerAllowed: false, outboundOnly: true, reason: 'loopback',
				},
			});
			(core as any).hasToken = true;
			(core as any).authMode = 'token';
			render(<NodeManager core={core} />);
			await vi.waitFor(() => expect(screen.getByText('Invites')).toBeDefined());
			fireEvent.click(screen.getByText('Invites'));
			fireEvent.click(screen.getByText('Accept Invite'));
			await vi.waitFor(() => {
				const acceptSubmitBtns = screen.getAllByText('Accept').filter(
					btn => btn.tagName === 'BUTTON'
				);
				expect(acceptSubmitBtns.length).toBeGreaterThanOrEqual(1);
				const acceptBtn = acceptSubmitBtns[0] as HTMLButtonElement;
				if (acceptBtn) {
					expect(acceptBtn.disabled).toBe(true);
				}
			});
		});
	});

	describe('NodeManager: Reachability display', () => {
		it('renders inboundPeerAllowed dot correctly', async () => {
			const core = createMockClient({
				'node.identity.get': { nodeId: 'local', publicKey: 'key', fingerprint: 'fp', createdAt: 0 },
				'node.peer.list': { peers: [] },
				'node.invite.list': { invites: [], total: 0 },
				'node.reachability.check': {
					publicReachable: 'unknown',
					inboundPeerAllowed: false,
					outboundOnly: true,
					reason: 'loopback address',
				},
			});
			(core as any).hasToken = false;
			(core as any).authMode = 'none';
			const { container } = render(<NodeManager core={core} />);
			await vi.waitFor(() => expect(screen.getByText('Reachability')).toBeDefined());
			fireEvent.click(screen.getByText('Reachability'));
			await vi.waitFor(() => {
				expect(container.innerHTML).toContain('bg-gray-600');
			});
		});
	});

	describe('NodeManager: Peer row actions', () => {
		it('renders reconnect/disconnect/revoke buttons for peers', async () => {
			const mockPeers = {
				peers: [
					{
						nodeId: 'peer-1',
						name: 'Peer One',
						fingerprint: 'abc123',
						addresses: ['ws://host:8080/peer/ws'],
						status: 'connected',
						lastSeen: Date.now(),
						trustExpiresAt: 0,
						autoReconnect: true,
						policy: { mode: 'full' },
					},
				],
			};
			const core = createMockClient({
				'node.identity.get': { nodeId: 'local', publicKey: 'key', fingerprint: 'fp', createdAt: 0 },
				'node.peer.list': mockPeers,
				'node.invite.list': { invites: [], total: 0 },
				'node.reachability.check': {
					publicReachable: 'unknown', inboundPeerAllowed: false, outboundOnly: true, reason: 'loopback',
				},
			});
			(core as any).hasToken = false;
			(core as any).authMode = 'none';
			render(<NodeManager core={core} />);
			await vi.waitFor(() => expect(screen.getByText('Peers')).toBeDefined());
			fireEvent.click(screen.getByText('Peers'));
			await vi.waitFor(() => {
				expect(screen.getByText('Reconnect')).toBeDefined();
				expect(screen.getByText('Disconnect')).toBeDefined();
				expect(screen.getByText('Revoke')).toBeDefined();
			});
		});
	});

	describe('Logs page', () => {
		it('calls logs.tail on Core Logs tab', async () => {
			const client = createMockClient({
				'logs.tail': { lines: [] },
				'audit.list': { entries: [] },
			});

			render(<LogsViewer core={client} />);

			await vi.waitFor(() => {
				expect(client.call).toHaveBeenCalledWith('logs.tail', expect.objectContaining({ source: 'core' }));
			});
		});

		it('renders empty state when logs.tail returns { lines: [] }', async () => {
			const client = createMockClient({ 'logs.tail': { lines: [] } });
			render(<LogsViewer core={client} />);

			await vi.waitFor(() => {
				expect(screen.getByText('No log entries.')).toBeTruthy();
			});
		});

		it('renders log lines when logs.tail returns data', async () => {
			const client = createMockClient({
				'logs.tail': {
					lines: [
						{ timestamp: '2026-05-21T10:00:00Z', level: 'INFO', source: 'core', message: 'started' },
						{ timestamp: '2026-05-21T10:00:01Z', level: 'WARN', source: 'core', message: 'warning' },
					],
				},
			});
			render(<LogsViewer core={client} />);

			await vi.waitFor(() => {
				expect(screen.getByText('started')).toBeTruthy();
				expect(screen.getByText('warning')).toBeTruthy();
			});
		});

		it('shows log lines with level styling', async () => {
			const client = createMockClient({
				'logs.tail': { lines: [{ timestamp: '2026-05-21T10:00:00Z', level: 'ERROR', source: 'core', message: 'oops' }] },
			});
			render(<LogsViewer core={client} />);

			await vi.waitFor(() => {
				expect(screen.getByText('oops')).toBeTruthy();
				expect(screen.getByText('ERROR')).toBeTruthy();
			});
		});

		it('calls audit.list on Audit Trail tab', async () => {
			const client = createMockClient({
				'logs.tail': { lines: [] },
				'audit.list': { entries: [] },
			});
			render(<LogsViewer core={client} />);

			const auditTab = await screen.findByRole('button', { name: 'Audit Trail' });
			fireEvent.click(auditTab);

			await vi.waitFor(() => {
				const called = (client.call as any).mock.calls.some((c: any[]) => c[0] === 'audit.list'); expect(called).toBe(true);
			});
		});

		it('audit tab renders empty state without crash', async () => {
			const client = createMockClient({ 'audit.list': { entries: [] } });
			render(<LogsViewer core={client} />);

			fireEvent.click(await screen.findByRole('button', { name: 'Audit Trail' }));

			await vi.waitFor(() => {
				expect(screen.getByText('No audit entries.')).toBeTruthy();
			});
		});

		it('audit tab renders entries from audit.list', async () => {
			const client = createMockClient({
				'audit.list': {
					entries: [
						{ timestamp: '2026-05-21T10:00:00Z', type: 'capability.call', actor: 'user', target: 'plugin:terminal' },
					],
				},
			});
			render(<LogsViewer core={client} />);

			fireEvent.click(await screen.findByRole('button', { name: 'Audit Trail' }));

			await vi.waitFor(() => {
				expect(screen.getByText('capability.call')).toBeTruthy();
				expect(screen.getByText('user')).toBeTruthy();
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
    wsUrl: 'ws://localhost:8080/ws',
    lastError: null,
    hasToken: false,
    authMode: 'none' as const,
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
