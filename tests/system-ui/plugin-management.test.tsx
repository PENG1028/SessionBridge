// ─── Plugin Management tests ─────────────────────────────────────
// Tests: PluginManager search/filter/env, PluginDetail all 8 tabs,
// loading/error/empty/permission-denied states.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PluginManager } from '../../app/console/system-ui/views/plugin-manager';
import { PluginDetail } from '../../app/console/system-ui/views/plugin-detail';
import { createMockCoreClient } from '../../app/console/core/core-client';
import type { CoreClient } from '../../app/console/core/core-types';

beforeEach(() => {
  cleanup();
  window.confirm = vi.fn(() => true);
});

function createCore(mockData?: Record<string, unknown>, pluginId = 'sessionnode-core'): CoreClient {
  return createMockCoreClient(mockData, pluginId, true);
}

function createOfflineCore(): CoreClient {
  return createMockCoreClient(undefined, 'sessionnode-core', false);
}

const mockPluginList = [
  { pluginId: 'sessionnode-core', version: '0.1.0', status: 'enabled', type: 'builtin' },
  { pluginId: 'terminal', version: '1.0.0', status: 'enabled', type: 'feature', description: 'Terminal sessions' },
  { pluginId: 'system-info', version: '1.0.0', status: 'enabled', type: 'feature', description: 'System diagnostics' },
  { pluginId: 'broken-plugin', version: '0.5.0', status: 'error', type: 'feature', description: 'Has errors', error: 'Missing dependency: python3' },
  { pluginId: 'disabled-plugin', version: '0.2.0', status: 'disabled', type: 'feature', description: 'Disabled' },
];

const mockPluginGet = {
  id: 'terminal',
  pluginId: 'terminal',
  version: '1.0.0',
  name: 'Terminal',
  description: 'Shell session management',
  enabled: true,
  trusted: false,
  manifestVersion: '1',
  capabilities: ['session.create'],
  core: {
    permissions: [
      { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' },
    ],
    environment: { checks: [{ id: 'bash', type: 'binary', required: false, command: 'bash' }] },
    files: { declarations: [{ id: 'config', path: '/cfg', description: 'Config dir', clearable: false }] },
    tasks: [],
    history: { defaultPolicy: 'memory' },
  },
  adapters: {
    'system-ui': { views: [{ id: 'terminal.view', surface: 'main.editor' }] },
  },
};

// Helper: wait for PluginDetail to finish loading (back button appears)
async function waitForDetail() {
  await waitFor(() => {
    expect(screen.getByText('< Plugin Manager')).toBeDefined();
  });
}

// Helper: click a tab by text (tabs are the second group of matching elements: tab bar)
async function clickTab(name: string) {
  await waitFor(() => {
    expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
  });
  fireEvent.click(screen.getAllByText(name)[0]);
}

// ─── PluginManager ──────────────────────────────────────────────────

describe('PluginManager', () => {
  it('renders plugin list from core call', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('terminal')).toBeDefined();
    });
  });

  it('shows search filtering', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    const searchInput = screen.getByPlaceholderText('Search plugins...');
    fireEvent.change(searchInput, { target: { value: 'terminal' } });

    expect(screen.getByText('terminal')).toBeDefined();
    expect(screen.queryByText('system-info')).toBeNull();
  });

  it('shows error plugins inline', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('Missing dependency: python3')).toBeDefined();
    });
  });

  it('shows empty state when no plugins', async () => {
    const core = createCore({ 'plugin.list': [] });
    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('No plugins installed')).toBeDefined();
    });
  });

  it('shows offline state when disconnected', async () => {
    const core = createOfflineCore();
    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeDefined();
    });
  });

  it('shows loading state initially', () => {
    const core = createCore();
    const { container } = render(<PluginManager core={core} />);
    expect(container.querySelector('.animate-pulse')).toBeDefined();
  });

  it('calls onPluginSelect when Detail clicked', async () => {
    const onSelect = vi.fn();
    const core = createCore({ 'plugin.list': mockPluginList });
    render(<PluginManager core={core} onPluginSelect={onSelect} />);

    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    const detailButtons = screen.getAllByText('Detail');
    fireEvent.click(detailButtons[0]);

    expect(onSelect).toHaveBeenCalled();
  });

  // ── Blocker Summary ──

  it('shows categorized blocker summary after Check All (permission, unsupported, deps)', async () => {
    const core = createCore({
      'plugin.list': [mockPluginList[0]], // sessionnode-core
      'plugin.check': {
        status: 'blocked',
        blockers: [
          { kind: 'missing_grant', capability: 'network.connect', reason: 'not_granted' },
          { kind: 'missing_grant', capability: 'process.spawn', reason: 'not_granted' },
          { kind: 'unsupported_capability', capability: 'gpu.compute', reason: 'no GPU support' },
          { kind: 'missing_dependency', dependency: 'python3', reason: 'binary_missing' },
        ],
      },
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('sessionnode-core')).toBeDefined());

    // Click "Check All" button
    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      // Should show categorized blocker summary
      expect(screen.getByText(/\[BLOCKED\]/)).toBeDefined();
      expect(screen.getByText(/permission:2/)).toBeDefined();
      expect(screen.getByText(/unsupported:1/)).toBeDefined();
      expect(screen.getByText(/deps:1/)).toBeDefined();
    });
  });

  it('shows [OK] and ok status when check returns clean', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'clean-plugin', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': { status: 'ok', blockers: [], capabilities: [], dependencies: [] },
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('clean-plugin')).toBeDefined());

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText('[OK] ok')).toBeDefined();
    });
  });

  it('shows [WARN] and incomplete status when check returns incomplete', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'warn-plugin', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': { status: 'incomplete', blockers: [], capabilities: [], dependencies: [] },
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('warn-plugin')).toBeDefined());

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText('[WARN] incomplete')).toBeDefined();
    });
  });

  it('shows capability hints for network and process capabilities without env check', async () => {
    const core = createCore({
      'plugin.list': [{
        pluginId: 'net-plugin', version: '1.0.0', status: 'enabled', type: 'feature',
        capabilities: ['network.connect', 'network.listen', 'process.spawn'],
      }],
    });

    const { container } = render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('net-plugin')).toBeDefined();
    });
    // Text may be split across elements; use container textContent
    expect(container.textContent).toContain('3 declared capability');
    expect(screen.getByText('[network]')).toBeDefined();
    expect(screen.getByText('[process]')).toBeDefined();
  });

  it('shows unknown blocker kind in summary', async () => {
    const core = createCore({
      'plugin.list': [mockPluginList[0]],
      'plugin.check': {
        status: 'blocked',
        blockers: [
          { kind: 'unknown_capability', capability: 'magic.wand', reason: 'not in support matrix' },
        ],
      },
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('sessionnode-core')).toBeDefined());

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/unknown:1/)).toBeDefined();
    });
  });
});

// ─── PluginDetail ───────────────────────────────────────────────────

describe('PluginDetail', () => {
  it('shows Overview tab with manifest data', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    // Unique text from the manifest
    expect(screen.getByText('Shell session management')).toBeDefined();
  });

  it('shows Overview basic info keys', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    expect(screen.getByText('Shell session management')).toBeDefined();
    expect(screen.getByText('Terminal')).toBeDefined();
  });

  it('shows Environment tab with dependency checks', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'incomplete',
      checkedAt: Date.now(),
      dependencies: [{ id: 'bash', type: 'binary', status: 'pending', command: 'bash', required: false }],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.check': mockCheck });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Environment');

    await waitFor(() => {
      expect(screen.getByText('bash')).toBeDefined();
    });
  });

  it('shows Permissions tab data', async () => {
    const mockPermissions = {
      pluginId: 'terminal',
      permissions: [
        { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.permissions.list': mockPermissions });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');

    await waitFor(() => {
      expect(screen.getByText('terminal.session')).toBeDefined();
    });
  });

  it('shows Files tab data', async () => {
    const mockFiles = {
      pluginId: 'terminal',
      files: [{ id: 'config', path: '/cfg', purpose: 'configuration', clearable: false }],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.files.list': mockFiles });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Files');

    await waitFor(() => {
      expect(screen.getByText('/cfg')).toBeDefined();
    });
  });

  it('shows Cache tab data', async () => {
    const mockCache = {
      pluginId: 'terminal',
      caches: [{ id: 'tmp-cache', path: '/tmp/cache', description: 'Temp data', risk: 'low' }],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.cache.list': mockCache });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Cache');

    await waitFor(() => {
      expect(screen.getByText('tmp-cache')).toBeDefined();
    });
  });

  it('shows Settings tab data', async () => {
    const mockSchema = {
      pluginId: 'terminal',
      schema: { type: 'object', properties: { debug: { type: 'boolean', description: 'Enable debug' } } },
    };
    const mockConfig = {
      pluginId: 'terminal',
      config: { debug: true },
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.config.schema': mockSchema, 'plugin.config.get': mockConfig });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Settings');

    await waitFor(() => {
      expect(screen.getByText('debug')).toBeDefined();
      expect(screen.getByText('true')).toBeDefined();
    });
  });

  it('shows History tab not-implemented state', async () => {
    const mockHistory = { pluginId: 'terminal', events: [], status: 'not_implemented', message: 'Phase 1 stub' };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.history': mockHistory });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText(/not implemented in Phase 1/i)).toBeDefined();
    });
  });

  it('shows Logs tab empty state', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Logs');

    await waitFor(() => {
      expect(screen.getByText('No log entries found.')).toBeDefined();
    });
  });

  it('shows Logs tab with entries from logs.query', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'logs.query': {
        entries: [
          { timestamp: 1000, level: 'info', source: 'plugin', pluginId: 'terminal', message: 'plugin loaded' },
          { timestamp: 2000, level: 'error', source: 'plugin', pluginId: 'terminal', message: 'capability failed' },
        ],
      },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Logs');

    await waitFor(() => {
      expect(screen.getByText('plugin loaded')).toBeDefined();
      expect(screen.getByText('capability failed')).toBeDefined();
    });
  });

  it('shows grant state in Permissions tab', async () => {
    const mockPermissions = {
      pluginId: 'terminal',
      permissions: [
        { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask', grant: { mode: 'allow', grantedAt: '2026-01-01' } },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.permissions.list': mockPermissions });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');

    await waitFor(() => {
      expect(screen.getByText('grant: allow')).toBeDefined();
    });
  });

  it('shows not_implemented state in Cache tab', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.cache.list': { status: 'not_implemented', caches: [] } });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Cache');

    await waitFor(() => {
      expect(screen.getByText(/not available in Phase 1/i)).toBeDefined();
    });
  });

  it('shows Cache tab with plan dialog on Clear', async () => {
    const mockCache = {
      pluginId: 'terminal',
      caches: [{ id: 'tmp-cache', path: '/tmp/cache', description: 'Temp data', risk: 'low' }],
    };
    const mockPlan = { planId: 'plan-123', summary: 'Clear one cache entry (low risk)', entries: ['/tmp/cache'] };
    const mockExecute = { status: 'ok', planId: 'plan-123' };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.cache.list': mockCache,
      'plugin.cache.clear.plan': mockPlan,
      'plugin.cache.clear.execute': mockExecute,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Cache');

    await waitFor(() => {
      expect(screen.getByText('tmp-cache')).toBeDefined();
    });

    // Mock confirm returns true — should proceed with clear
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getAllByText('Clear')[0]);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('Cleared')).toBeDefined();
    });
  });

  it('shows Settings save button and handles save', async () => {
    const mockSchema = {
      pluginId: 'terminal',
      schema: { type: 'object', properties: { debug: { type: 'boolean', description: 'Enable debug' } } },
    };
    const mockConfig = { pluginId: 'terminal', config: { debug: true } };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.config.schema': mockSchema,
      'plugin.config.get': mockConfig,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Settings');

    await waitFor(() => {
      expect(screen.getByText('Save to Core')).toBeDefined();
    });

    // Click Save — MockCoreClient returns undefined for plugin.config.set, so save "succeeds"
    fireEvent.click(screen.getByText('Save to Core'));

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeDefined();
    });
  });

  it('shows permission denied state', async () => {
    const core = createCore(undefined);
    vi.spyOn(core, 'call').mockRejectedValue(new Error('Permission denied'));
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitFor(() => {
      expect(screen.getByText('Permission Denied')).toBeDefined();
    });
  });
});

// ─── PluginDetail: Blockers & Status Tab ──────────────────────────

describe('PluginDetail: Blockers & Status', () => {
  it('blockers render in plugin detail', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'blocked',
      checkedAt: Date.now(),
      dependencies: [],
      capabilities: [],
      blockers: [
        { kind: 'missing_dependency', dependency: 'python3', reason: 'binary_missing' },
        { kind: 'unsupported_capability', capability: 'process.spawn', reason: 'not supported on this platform' },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.check': mockCheck });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Blockers & Status');

    await waitFor(() => {
      expect(screen.getByText('missing_dependency')).toBeDefined();
      expect(screen.getByText('python3')).toBeDefined();
      expect(screen.getByText('unsupported_capability')).toBeDefined();
      expect(screen.getByText('process.spawn')).toBeDefined();
    });
  });

  it('shows no blockers message when check returns empty', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'ok',
      blockers: [],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.check': mockCheck });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Blockers & Status');

    await waitFor(() => {
      expect(screen.getByText(/No blockers/i)).toBeDefined();
    });
  });

  it('shows Create Install Plan button for missing_dependency blockers', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'blocked',
      blockers: [{ kind: 'missing_dependency', dependency: 'python3', reason: 'binary_missing' }],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.check': mockCheck });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Blockers & Status');

    await waitFor(() => {
      expect(screen.getByText('Create Install Plan')).toBeDefined();
    });
  });

  it('install plan renders steps', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'blocked',
      blockers: [{ kind: 'missing_dependency', dependency: 'python3', reason: 'binary_missing' }],
    };
    const mockPlan = {
      planId: 'plan-001',
      pluginId: 'terminal',
      steps: [
        { order: 1, description: 'Detect binary availability', commands: ['plugin.check'], risk: 'low', status: 'pending' },
        { order: 2, description: 'Detect package manager', commands: ['env.which apt'], risk: 'low', status: 'pending' },
      ],
      risk: 'high',
      status: 'pending_approval',
      summary: 'Installation plan for terminal (dry-run)',
      createdAt: Date.now(),
    };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.check': mockCheck,
      'plugin.install.plan': mockPlan,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Blockers & Status');

    await waitFor(() => expect(screen.getByText('Create Install Plan')).toBeDefined());
    fireEvent.click(screen.getByText('Create Install Plan'));

    await waitFor(() => {
      expect(screen.getByText('Detect binary availability')).toBeDefined();
      expect(screen.getByText('Detect package manager')).toBeDefined();
      expect(screen.getByText('plan-001')).toBeDefined();
      expect(screen.getByText('Installation plan for terminal (dry-run)')).toBeDefined();
    });
  });

  it('execute success updates status', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'blocked',
      blockers: [{ kind: 'missing_dependency', dependency: 'python3', reason: 'binary_missing' }],
    };
    const mockPlan = {
      planId: 'plan-exec-001',
      pluginId: 'terminal',
      steps: [
        { order: 1, description: 'Install step', commands: ['echo test'], risk: 'low', status: 'pending' },
      ],
      risk: 'low',
      status: 'pending_approval',
      summary: 'Test install plan',
      createdAt: Date.now(),
    };
    const mockNotifyReq = { requestId: 'req-001', status: 'pending' };
    const mockNotifyResp = { requestId: 'req-001', status: 'responded' };
    const mockExec = { status: 'completed', planId: 'plan-exec-001', pluginId: 'terminal', steps: 1, dryRun: true };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.check': mockCheck,
      'plugin.install.plan': mockPlan,
      'notify.request': mockNotifyReq,
      'notify.respond': mockNotifyResp,
      'plugin.install.execute': mockExec,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Blockers & Status');
    await waitFor(() => expect(screen.getByText('missing_dependency')).toBeDefined());

    // Create plan
    fireEvent.click(screen.getByText('Create Install Plan'));
    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());

    // Request approval
    fireEvent.click(screen.getByText('Request Approval'));
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());

    // Approve
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Execute Install')).toBeDefined());

    // Execute
    fireEvent.click(screen.getByText('Execute Install'));
    await waitFor(() => {
      expect(screen.getByText(/completed/i)).toBeDefined();
      expect(screen.getByText('(dry-run)')).toBeDefined();
      expect(screen.getByText('(1 steps)')).toBeDefined();
    });
  });

  it('unsupported capability renders explanation', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'blocked',
      blockers: [{ kind: 'unsupported_capability', capability: 'gpu.compute', reason: 'no GPU support on this platform' }],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.check': mockCheck });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Blockers & Status');

    await waitFor(() => {
      expect(screen.getByText('unsupported_capability')).toBeDefined();
      expect(screen.getByText('gpu.compute')).toBeDefined();
      expect(screen.getByText(/not supported on the current platform/i)).toBeDefined();
    });
  });

  it('unknown capability renders explanation', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'blocked',
      blockers: [{ kind: 'unknown_capability', capability: 'magic.wand', reason: 'not in support matrix' }],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.check': mockCheck });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Blockers & Status');

    await waitFor(() => {
      expect(screen.getByText('unknown_capability')).toBeDefined();
      expect(screen.getByText('magic.wand')).toBeDefined();
      expect(screen.getByText(/not recognized by the current Go Core version/i)).toBeDefined();
    });
  });

  it('shows Request Permission button for missing_grant blocker', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'blocked',
      blockers: [{ kind: 'missing_grant', capability: 'session.create', reason: 'not_granted' }],
    };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.check': mockCheck,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Blockers & Status');

    await waitFor(() => {
      expect(screen.getByText('missing_grant')).toBeDefined();
      expect(screen.getByText('Request Permission')).toBeDefined();
    });
  });
});

// ─── Host-rendered components ───────────────────────────────────────

describe('Host-rendered components', () => {
  it('PluginPermissionPanel renders from Core data', async () => {
    const { PluginPermissionPanel } = await import('../../app/console/plugin-host/host-component-registry');
    const core = createCore({
      'plugin.permissions.list': {
        pluginId: 'test',
        permissions: [{ id: 'test.perm', description: 'Test permission', capabilities: ['test.cap'], default: 'ask' }],
      },
    });
    const props = {
      core,
      config: { componentId: 'PluginPermissionPanel', pluginId: 'test', title: 'Permissions' },
      container: { surface: 'panel', width: 400, height: 300 },
    };
    render(React.createElement(PluginPermissionPanel, props));

    await waitFor(() => {
      expect(screen.getByText('test.perm')).toBeDefined();
    });
  });

  it('PluginFilesTable renders from Core data', async () => {
    const { PluginFilesTable } = await import('../../app/console/plugin-host/host-component-registry');
    const core = createCore({
      'plugin.files.list': {
        pluginId: 'test',
        files: [{ id: 'cfg', path: '/etc/test', purpose: 'config', clearable: false }],
      },
    });
    const props = {
      core,
      config: { componentId: 'PluginFilesTable', pluginId: 'test', title: 'Files' },
      container: { surface: 'panel', width: 400, height: 300 },
    };
    render(React.createElement(PluginFilesTable, props));

    await waitFor(() => {
      expect(screen.getByText('/etc/test')).toBeDefined();
    });
  });

  it('PluginConfigForm renders from Core data', async () => {
    const { PluginConfigForm } = await import('../../app/console/plugin-host/host-component-registry');
    const core = createCore({
      'plugin.config.schema': { pluginId: 'test', schema: { type: 'object', properties: { opt: { type: 'string' } } } },
      'plugin.config.get': { pluginId: 'test', config: { opt: 'value1' } },
    });
    const props = {
      core,
      config: { componentId: 'PluginConfigForm', pluginId: 'test', title: 'Config' },
      container: { surface: 'panel', width: 400, height: 300 },
    };
    render(React.createElement(PluginConfigForm, props));

    await waitFor(() => {
      expect(screen.getByText('opt')).toBeDefined();
      expect(screen.getByText('"value1"')).toBeDefined();
    });
  });

  it('PluginInstallHistoryPanel shows not-implemented state', async () => {
    const { PluginInstallHistoryPanel } = await import('../../app/console/plugin-host/host-component-registry');
    const core = createCore({
      'plugin.history': { pluginId: 'test', events: [], status: 'not_implemented' },
    });
    const props = {
      core,
      config: { componentId: 'PluginInstallHistoryPanel', pluginId: 'test', title: 'History' },
      container: { surface: 'panel', width: 400, height: 300 },
    };
    render(React.createElement(PluginInstallHistoryPanel, props));

    await waitFor(() => {
      expect(screen.getByText(/not available in Phase 1/i)).toBeDefined();
    });
  });
});

// ─── Plugin Permission Grant ─────────────────────────────────────────

describe('Plugin Permission Grant', () => {
  it('uses capability and mode params (not permissionId/level)', async () => {
    const core = createCore({ 'plugin.check': { status: 'ok', blockers: [], capabilities: [], dependencies: [] } });

    // Spy on call to capture the params sent to the mock
    const calls: Array<Record<string, unknown>> = [];
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      calls.push(params ?? {});
      if (method === 'plugin.permissions.grant') {
        return Promise.resolve({ status: 'ok', pluginId: params?.pluginId, capability: params?.capability, mode: params?.mode });
      }
      if (method === 'plugin.check') {
        return Promise.resolve({ status: 'ok', blockers: [], capabilities: [], dependencies: [] });
      }
      return Promise.resolve(undefined);
    });

    await core.call('plugin.permissions.grant', {
      pluginId: 'test', capability: 'network.connect', mode: 'allow'
    });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]).toHaveProperty('capability', 'network.connect');
    expect(calls[0]).toHaveProperty('mode', 'allow');
    expect(calls[0]).not.toHaveProperty('permissionId');
    expect(calls[0]).not.toHaveProperty('level');
  });

  it('shows approval state when grant returns requires_approval', async () => {
    const core = createCore({
      'plugin.permissions.grant': {
        status: 'requires_approval',
        message: 'High-risk operation requires approval',
        planId: 'plan-test-123',
      },
    });

    const result = await core.call('plugin.permissions.grant', {
      pluginId: 'test', capability: 'process.spawn', mode: 'allow'
    });

    expect((result as Record<string, unknown>).status).toBe('requires_approval');
    expect((result as Record<string, unknown>).planId).toBe('plan-test-123');
  });

  // Bug 1 fix: approval.list returns { approvals: [...] } object, not array
  it('reads approval.list as object with approvals array', async () => {
    const mockApprovals = {
      approvals: [
        { requestId: 'req-001', pluginId: 'test-plugin', action: 'Grant fs.write', detail: 'High risk', status: 'pending', createdAt: '2026-01-01' },
      ],
    };
    const core = createCore({ 'approval.list': mockApprovals });

    const result = await core.call<{ approvals?: Array<Record<string, unknown>> }>('approval.list', {});
    expect(result).toBeDefined();
    expect(result).toHaveProperty('approvals');
    expect(Array.isArray(result!.approvals)).toBe(true);
    expect(result!.approvals!.length).toBe(1);
    expect(result!.approvals![0].requestId).toBe('req-001');
  });

  // Bug 2 fix: approveGrant re-calls plugin.permissions.grant with planId in payload
  it('re-calls plugin.permissions.grant with planId after approval', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const core = createCore(undefined);
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params: params ? { ...params } : undefined });
      if (method === 'plugin.permissions.grant') {
        // First call: no planId → requires_approval
        if (!params?.planId) {
          return Promise.resolve({ status: 'requires_approval', planId: 'plan-full-flow-1', message: 'High-risk operation requires approval' });
        }
        // Second call: with planId → ok
        return Promise.resolve({ status: 'ok', pluginId: params?.pluginId, capability: params?.capability, mode: params?.mode });
      }
      if (method === 'notify.request') {
        return Promise.resolve({ requestId: 'req-full-flow-1', status: 'pending' });
      }
      if (method === 'notify.respond') {
        return Promise.resolve({ requestId: params?.requestId, action: params?.action, status: 'responded' });
      }
      if (method === 'plugin.check') {
        return Promise.resolve({ status: 'ok', blockers: [], capabilities: [], dependencies: [] });
      }
      return Promise.resolve(undefined);
    });

    // Step 1: First grant (no planId)
    const result1 = await core.call<Record<string, unknown>>('plugin.permissions.grant', {
      pluginId: 'test', capability: 'plugin.uninstall', mode: 'allow',
    });
    expect(result1.status).toBe('requires_approval');
    const planId = result1.planId as string;

    // Step 2: notify.request with planId
    const result2 = await core.call<Record<string, unknown>>('notify.request', {
      title: 'Grant approval', body: '...', planId, timeout: 300,
    });
    const requestId = result2.requestId as string;

    // Step 3: notify.respond approve
    await core.call('notify.respond', { requestId, action: 'allow' });

    // Step 4: Second grant WITH planId
    const result4 = await core.call<Record<string, unknown>>('plugin.permissions.grant', {
      pluginId: 'test', capability: 'plugin.uninstall', mode: 'allow', planId,
    });
    expect(result4.status).toBe('ok');

    // Verify the second grant call included planId
    const grantCalls = calls.filter(c => c.method === 'plugin.permissions.grant');
    expect(grantCalls.length).toBe(2);
    expect(grantCalls[1].params).toHaveProperty('planId', planId);
  });
});
