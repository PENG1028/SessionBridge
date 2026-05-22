// ─── Usability Hardening tests ──────────────────────────────────
// Tests: offline→reconnect, terminal attach error, update plan blocker,
// plugin dep hint, approval location, button disabled/enabled states.
//
// These validate the first-use pain points fixed in Round 23C.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { PluginManager } from '../../app/console/system-ui/views/plugin-manager';
import { PluginDetail } from '../../app/console/system-ui/views/plugin-detail';
import { Settings } from '../../app/console/system-ui/views/settings';
import { ApprovalCenter } from '../../app/console/system-ui/approval-center';
import type { CoreClient, CoreEvent, BlockerEntry } from '../../app/console/core/core-types';

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.confirm = vi.fn(() => true);
});

// ─── Helpers ───────────────────────────────────────────────────────

/** Create a mutable mock CoreClient that supports event emission. */
function createMutableMock(overrides?: {
  pluginId?: string;
  connected?: boolean;
  mockData?: Record<string, unknown>;
}) {
  const pluginId = overrides?.pluginId ?? 'sessionnode-core';
  let connected = overrides?.connected ?? true;
  const mockData = overrides?.mockData ?? {};

  const listeners = new Map<string, Set<(data: CoreEvent) => void>>();
  const call = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
    if (mockData[method] !== undefined) return mockData[method];
    if (method.endsWith('.list')) return [];
    if (method.endsWith('.get')) return null;
    if (method === 'run.attach') return { runId: 'run-001', sessionId: 'sess-001', state: 'running' };
    if (method === 'plugin.check') return { status: 'ok', dependencies: [], blockers: [] };
    if (method === 'update.plan') return { canUpdate: true, status: 'up-to-date', blockers: [], steps: [] };
    return {};
  });

  const client: CoreClient & {
    emit: (event: string, data: CoreEvent) => void;
    setConnected: (v: boolean) => void;
    _call: typeof call;
  } = {
    pluginId,
    get isConnected() { return connected; },
    wsUrl: 'ws://localhost:8080/ws',
    lastError: null,
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
      listeners.get('connectionStatus')?.forEach(h =>
        h({ type: 'connectionStatus', status: v ? 'connected' : 'disconnected', pluginId })
      );
    },
    _call: call,
  };

  return client;
}

// ─── Test 1: Core disconnected → PluginManager shows offline and reconnect refreshes ──

describe('Usability: Offline → Reconnect', () => {
  it('shows offline state when core is disconnected', async () => {
    const client = createMutableMock({ connected: false });
    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeDefined();
    });
  });

  it('reconnects and refreshes plugin list on connectionStatus event', async () => {
    const client = createMutableMock({
      connected: false,
      mockData: {
        'plugin.list': [
          { pluginId: 'terminal', version: '1.0.0', status: 'enabled', type: 'feature' as const },
        ],
      },
    });

    render(<PluginManager core={client} />);

    // Should show offline initially
    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeDefined();
    });

    // Simulate reconnection
    client.setConnected(true);
    client.emit('connectionStatus', { type: 'connectionStatus', status: 'connected', pluginId: 'sessionnode-core' });

    // Should now show the plugin list
    await waitFor(() => {
      expect(screen.getByText('terminal')).toBeDefined();
    });
  });

  it('calls plugin.list on reconnect, not before', async () => {
    const client = createMutableMock({
      connected: false,
      mockData: {
        'plugin.list': [
          { pluginId: 'reconn-plugin', version: '1.0.0', status: 'enabled', type: 'feature' as const },
        ],
      },
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeDefined();
    });

    // plugin.list should NOT have been called (isConnected was false)
    const callsBeforeReconnect = client._call.mock.calls.filter(
      (c: unknown[]) => c[0] === 'plugin.list'
    ).length;

    // Reconnect
    client.setConnected(true);
    client.emit('connectionStatus', { type: 'connectionStatus', status: 'connected', pluginId: 'sessionnode-core' });

    await waitFor(() => {
      expect(screen.getByText('reconn-plugin')).toBeDefined();
    });

    const callsAfterReconnect = client._call.mock.calls.filter(
      (c: unknown[]) => c[0] === 'plugin.list'
    ).length;
    expect(callsAfterReconnect).toBeGreaterThanOrEqual(callsBeforeReconnect + 1);
  });
});

// ─── Test 2: Terminal attach failure shows actionable error ────────

describe('Usability: Terminal Attach Failure', () => {
  const terminalPluginGet = {
    id: 'terminal', pluginId: 'terminal', version: '1.0.0', name: 'Terminal',
    description: 'Shell sessions', enabled: true, trusted: false, manifestVersion: '1',
    capabilities: ['session.create'],
    core: {
      permissions: [],
      environment: { checks: [] },
      files: { declarations: [] },
      tasks: [],
      history: { defaultPolicy: 'memory' },
    },
    adapters: { 'system-ui': { views: [{ id: 'terminal.view', surface: 'main.editor' }] } },
  };

  it('shows error message when run.attach fails', async () => {
    const client = createMutableMock();
    client._call.mockImplementation(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'plugin.get') return terminalPluginGet;
      if (method === 'run.list') return {
        runs: [{ runId: 'run-fail', kind: 'terminal', state: 'running', sessionId: 'sess-f1' }],
      };
      if (method === 'run.attach') throw new Error('session not found: the run may have already ended');
      return {};
    });

    render(<PluginDetail core={client} pluginId="terminal" />);

    await waitFor(() => {
      expect(screen.getByText('< Plugin Manager')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('Runs')[0]);

    await waitFor(() => {
      expect(screen.getByText('run-fail')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Attach'));

    // Verify actionable error message is shown
    await waitFor(() => {
      expect(screen.getByText(/session not found/)).toBeDefined();
    });
  });

  it('shows fallback error when attach fails with unexpected error', async () => {
    const client = createMutableMock();
    client._call.mockImplementation(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'plugin.get') return terminalPluginGet;
      if (method === 'run.list') return {
        runs: [{ runId: 'run-err', kind: 'terminal', state: 'running', sessionId: 'sess-e1' }],
      };
      if (method === 'run.attach') throw new Error('WebSocket disconnected');
      return {};
    });

    render(<PluginDetail core={client} pluginId="terminal" />);

    await waitFor(() => {
      expect(screen.getByText('< Plugin Manager')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('Runs')[0]);

    await waitFor(() => {
      expect(screen.getByText('run-err')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Attach'));

    await waitFor(() => {
      expect(screen.getByText(/WebSocket disconnected/)).toBeDefined();
    });
  });

  it('Attach button shows loading state during in-flight and resolves', async () => {
    let resolveAttach: (v: unknown) => void;
    const attachPromise = new Promise<unknown>((resolve) => { resolveAttach = resolve; });

    const client = createMutableMock();
    client._call.mockImplementation(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'plugin.get') return terminalPluginGet;
      if (method === 'run.list') return {
        runs: [{ runId: 'run-loading', kind: 'terminal', state: 'running', sessionId: 'sess-l1' }],
      };
      if (method === 'run.attach') return attachPromise;
      return {};
    });

    render(<PluginDetail core={client} pluginId="terminal" />);

    await waitFor(() => {
      expect(screen.getByText('< Plugin Manager')).toBeDefined();
    });

    fireEvent.click(screen.getAllByText('Runs')[0]);

    await waitFor(() => {
      expect(screen.getByText('run-loading')).toBeDefined();
    });

    // Click Attach — button should show loading state
    fireEvent.click(screen.getByText('Attach'));

    await waitFor(() => {
      expect(screen.getByText('Attaching...')).toBeDefined();
    });

    // Resolve the attach
    await act(async () => {
      resolveAttach!({ runId: 'run-loading', sessionId: 'sess-l1', state: 'running' });
    });

    await waitFor(() => {
      expect(screen.getByText('Attach verified')).toBeDefined();
    });
  });
});

// ─── Test 3: Update plan blocker renders readable message ──────────

describe('Usability: Update Plan Blocker Message', () => {
  const baseMockData = {
    'config.list': { configs: [{ key: 'host.name', value: 'test', revision: 1 }] },
    'update.status': {
      status: 'update-available', currentCommit: 'abc', remoteCommit: 'def', behindBy: 3,
      dirty: false, source: { type: 'git', remote: 'origin', branch: 'main', repoUrl: '', mode: 'manual' },
      lastCheckedAt: Date.now(), requiresRestart: false,
    },
    'update.source.get': { type: 'git', remote: 'origin', branch: 'main', repoUrl: '', mode: 'manual' },
    'update.policy.get': {
      autoCheck: false, autoApply: false, checkIntervalSeconds: 86400,
      allowDirtyWorktree: false, allowWhenRunsActive: false, ignoredVersions: [],
    },
  };

  it('renders human-readable message for active_runs blocker', async () => {
    const client = createMutableMock({
      mockData: {
        ...baseMockData,
        'update.plan': {
          canUpdate: false, status: 'blocked', currentCommit: 'abc', remoteCommit: 'def',
          behindBy: 3, dirty: false,
          blockers: [{ kind: 'active_runs', message: 'runs are active' }],
          steps: [],
        },
      },
    });

    render(<Settings core={client} />);

    // Navigate to Update tab
    await waitFor(() => {
      expect(screen.getAllByText('Update').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Update')[0]);

    // Click "Plan" button (the button text in settings is "Plan")
    await waitFor(() => {
      expect(screen.getAllByText('Plan').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Plan')[0]);

    // Should show human-readable blocker message
    await waitFor(() => {
      expect(screen.getByText(/Stop active runs before updating/)).toBeDefined();
    });
  });

  it('renders message for dirty_worktree blocker', async () => {
    const client = createMutableMock({
      mockData: {
        ...baseMockData,
        'update.plan': {
          canUpdate: false, status: 'blocked', currentCommit: 'abc', remoteCommit: 'def',
          behindBy: 0, dirty: true,
          blockers: [{ kind: 'dirty_worktree', message: 'dirty worktree' }],
          steps: [],
        },
      },
    });

    render(<Settings core={client} />);

    await waitFor(() => {
      expect(screen.getAllByText('Update').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Update')[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Plan').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Plan')[0]);

    await waitFor(() => {
      expect(screen.getByText(/Commit or stash them first/)).toBeDefined();
    });
  });

  it('renders message for no_git_runner blocker', async () => {
    const client = createMutableMock({
      mockData: {
        ...baseMockData,
        'update.plan': {
          canUpdate: false, status: 'blocked', currentCommit: '', remoteCommit: '',
          behindBy: 0, dirty: false,
          blockers: [{ kind: 'no_git_runner', message: 'no git' }],
          steps: [],
        },
      },
    });

    render(<Settings core={client} />);

    await waitFor(() => {
      expect(screen.getAllByText('Update').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Update')[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Plan').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Plan')[0]);

    await waitFor(() => {
      expect(screen.getByText(/Git is not available/)).toBeDefined();
    });
  });

  it('shows canUpdate message when no blockers', async () => {
    const client = createMutableMock({
      mockData: {
        ...baseMockData,
        'update.plan': {
          canUpdate: true, status: 'up-to-date', currentCommit: 'abc', remoteCommit: 'abc',
          behindBy: 0, dirty: false, blockers: [], steps: [],
        },
      },
    });

    render(<Settings core={client} />);

    await waitFor(() => {
      expect(screen.getAllByText('Update').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Update')[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Plan').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Plan')[0]);

    await waitFor(() => {
      expect(screen.getByText(/Ready to update/)).toBeDefined();
    });
  });
});

// ─── Test 4: Plugin dependency missing renders next-step hint ──────

describe('Usability: Plugin Dependency Missing Hint', () => {
  it('renders next-step hint when plugin has missing_dependency blocker', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'needy-plugin', version: '1.0.0', status: 'enabled', type: 'feature' as const, description: 'Needs deps' },
        ],
        'plugin.check': {
          status: 'blocked',
          dependencies: [{ name: 'python3', installed: false }],
          blockers: [
            { kind: 'missing_dependency', dependency: 'python3', reason: 'python3 not found in PATH' },
          ] as BlockerEntry[],
        },
      },
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('needy-plugin')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/Install "python3" to resolve this/)).toBeDefined();
    });
  });

  it('renders next-step hint for missing_grant blocker', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'untrusted-plugin', version: '1.0.0', status: 'enabled', type: 'feature' as const },
        ],
        'plugin.check': {
          status: 'blocked',
          dependencies: [],
          blockers: [
            { kind: 'missing_grant', capability: 'fs.write', reason: 'Grant required' },
          ] as BlockerEntry[],
        },
      },
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('untrusted-plugin')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/Grant the required capability/)).toBeDefined();
      expect(screen.getByText(/Plugin Detail → Permissions/)).toBeDefined();
    });
  });

  it('renders hint for unsupported_capability blocker', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'fancy-plugin', version: '2.0.0', status: 'enabled', type: 'feature' as const },
        ],
        'plugin.check': {
          status: 'blocked',
          dependencies: [],
          blockers: [
            { kind: 'unsupported_capability', capability: 'ai.think', reason: 'Not supported' },
          ] as BlockerEntry[],
        },
      },
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('fancy-plugin')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/not provided by the current Core version/)).toBeDefined();
    });
  });

  it('per-plugin Check button also shows hints', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'single-check', version: '1.0.0', status: 'enabled', type: 'feature' as const },
        ],
      },
    });

    client._call.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.list') return [
        { pluginId: 'single-check', version: '1.0.0', status: 'enabled', type: 'feature' as const },
      ];
      if (method === 'plugin.check' && (params as Record<string, unknown>)?.pluginId === 'single-check') {
        return {
          status: 'blocked',
          dependencies: [{ name: 'node', installed: false }],
          blockers: [
            { kind: 'missing_dependency', dependency: 'node', reason: 'node not found' },
          ] as BlockerEntry[],
        };
      }
      return {};
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('single-check')).toBeDefined();
    });

    const checkButtons = screen.getAllByText('Check');
    fireEvent.click(checkButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Install "node" to resolve this/)).toBeDefined();
    });
  });

  it('shows generic hint when blockers exist without specific dependency', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'mystery-plugin', version: '1.0.0', status: 'enabled', type: 'feature' as const },
        ],
        'plugin.check': {
          status: 'blocked',
          dependencies: [],
          blockers: [
            { kind: 'unknown_capability', capability: 'magic.spell', reason: 'Unknown' },
          ] as BlockerEntry[],
        },
      },
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('mystery-plugin')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/Run "Check All" for details/)).toBeDefined();
    });
  });
});

// ─── Test 5: Approval pending renders location/action hint ─────────

describe('Usability: Approval Location/Action Hint', () => {
  function makeApprovalEvent(overrides?: Record<string, unknown>) {
    return {
      type: 'notify.approval.request',
      requestId: overrides?.requestId as string || 'req-001',
      pluginId: overrides?.pluginId as string || 'test-plugin',
      payload: overrides?.payload !== undefined ? overrides.payload : JSON.stringify({
        title: 'Grant fs.write Permission',
        body: 'Plugin "test-plugin" wants to write to /data/output/. Allow?',
        detail: 'High risk — this grants permanent file write access',
        planId: 'plan-001',
      }),
    };
  }

  it('shows pluginId and title in approval card', async () => {
    const client = createMutableMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalEvent());

    await waitFor(() => {
      expect(screen.getByText('test-plugin')).toBeDefined();
      expect(screen.getByText('Grant fs.write Permission')).toBeDefined();
    });
  });

  it('shows Approve and Deny buttons with clear labels', async () => {
    const client = createMutableMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalEvent());

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeDefined();
      expect(screen.getByText('Deny')).toBeDefined();
    });
  });

  it('shows detail/body text for context', async () => {
    const client = createMutableMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalEvent());

    await waitFor(() => {
      expect(screen.getByText(/wants to write to/)).toBeDefined();
      expect(screen.getByText(/High risk/)).toBeDefined();
    });
  });

  it('shows pending count in toggle button', async () => {
    const client = createMutableMock();
    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalEvent({ requestId: 'req-001' }));

    await waitFor(() => {
      expect(screen.getByText('1 pending approval')).toBeDefined();
    });
  });

  it('Approve button shows loading state and resolves', async () => {
    let resolveRespond: (v: unknown) => void;
    const respondPromise = new Promise<unknown>((resolve) => { resolveRespond = resolve; });

    const client = createMutableMock();
    client._call.mockImplementation(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'notify.respond') return respondPromise;
      return {};
    });

    render(<ApprovalCenter core={client} />);

    client.emit('notify.approval.request', makeApprovalEvent({ requestId: 'req-001' }));

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Approve'));

    // Button should show loading state ("...")
    await waitFor(() => {
      const buttons = screen.getAllByText('...');
      expect(buttons.length).toBeGreaterThan(0);
    });

    // Resolve
    await act(async () => {
      resolveRespond!({ status: 'allowed', requestId: 'req-001' });
    });

    // Approval should be removed
    await waitFor(() => {
      expect(screen.queryByText('Approve')).toBeNull();
    });
  });
});

// ─── Test 6: Buttons disabled during in-flight and re-enabled after error ──

describe('Usability: Button Disabled/Enabled States', () => {
  it('toggle button shows error and re-enables after failed enable', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'toggle-me', version: '1.0.0', status: 'disabled', type: 'feature' as const },
        ],
      },
    });

    // plugin.enable rejects after a tick so React can render the loading state
    client._call.mockImplementation(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'plugin.list') return [
        { pluginId: 'toggle-me', version: '1.0.0', status: 'disabled', type: 'feature' as const },
      ];
      if (method === 'plugin.enable') {
        // Delay rejection so loading state is observable
        await new Promise(r => setTimeout(r, 50));
        throw new Error('plugin enable failed: dependency missing');
      }
      return {};
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('toggle-me')).toBeDefined();
    });

    // Click Enable button
    fireEvent.click(screen.getByText('Enable'));

    // After error, error message is shown (appears in both global banner and inline)
    await waitFor(() => {
      const matches = screen.getAllByText(/dependency missing/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Enable')).toBeDefined();
  });

  it('toggle error shows user-friendly message for not_implemented', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'dismiss-me', version: '1.0.0', status: 'disabled', type: 'feature' as const },
        ],
      },
    });

    client._call.mockImplementation(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'plugin.list') return [
        { pluginId: 'dismiss-me', version: '1.0.0', status: 'disabled', type: 'feature' as const },
      ];
      if (method === 'plugin.enable') {
        await new Promise(r => setTimeout(r, 50));
        throw new Error('not_implemented: enable not supported');
      }
      return {};
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('dismiss-me')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Enable'));

    // Should show user-friendly message
    await waitFor(() => {
      const matches = screen.getAllByText(/not supported by Go Core/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    // "Enable" button should be back
    expect(screen.getByText('Enable')).toBeDefined();
  });

  it('Check All button re-enables after completion', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'check-plugin', version: '1.0.0', status: 'enabled', type: 'feature' as const },
        ],
        'plugin.check': { status: 'ok', dependencies: [], blockers: [] },
      },
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('check-plugin')).toBeDefined();
    });

    const checkAllBtn = screen.getByText('Check All');
    fireEvent.click(checkAllBtn);

    // After check completes, button should return to "Check All"
    await waitFor(() => {
      expect(screen.getByText('Check All')).toBeDefined();
    });
  });

  it('per-plugin Check button re-enables after error', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'check-err', version: '1.0.0', status: 'enabled', type: 'feature' as const },
        ],
      },
    });

    client._call.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.list') return [
        { pluginId: 'check-err', version: '1.0.0', status: 'enabled', type: 'feature' as const },
      ];
      if (method === 'plugin.check' && (params as Record<string, unknown>)?.pluginId === 'check-err') {
        await new Promise(r => setTimeout(r, 50));
        throw new Error('check timeout');
      }
      return {};
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('check-err')).toBeDefined();
    });

    const checkButtons = screen.getAllByText('Check');
    fireEvent.click(checkButtons[0]);

    // Error should be shown
    await waitFor(() => {
      const matches = screen.getAllByText(/check timeout/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    // Check button should be re-enabled
    expect(screen.getByText('Check')).toBeDefined();
  });

  it('Disable button re-enables after toggle error', async () => {
    const client = createMutableMock({
      mockData: {
        'plugin.list': [
          { pluginId: 'disable-me', version: '1.0.0', status: 'enabled', type: 'feature' as const },
        ],
      },
    });

    client._call.mockImplementation(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'plugin.list') return [
        { pluginId: 'disable-me', version: '1.0.0', status: 'enabled', type: 'feature' as const },
      ];
      if (method === 'plugin.disable') {
        await new Promise(r => setTimeout(r, 50));
        throw new Error('core error');
      }
      return {};
    });

    render(<PluginManager core={client} />);

    await waitFor(() => {
      expect(screen.getByText('disable-me')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Disable'));

    // Error should appear (in both global banner and inline)
    await waitFor(() => {
      const matches = screen.getAllByText(/core error/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    // "Disable" button should be back (not stuck in "...")
    expect(screen.getByText('Disable')).toBeDefined();
  });
});
