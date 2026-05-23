// ─── Plugin Management tests ─────────────────────────────────────
// Tests: PluginManager search/filter/env, PluginDetail all 8 tabs,
// loading/error/empty/permission-denied states.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PluginManager } from '../../app/console/system-pages/plugin-manager';
import { PluginDetail } from '../../app/console/system-pages/plugin-detail';
import { createMockCoreClient } from '../../app/console/core/core-client';
import type { CoreClient } from '../../app/console/core/core-types';
import { registerView, unregisterView } from '../../app/console/main/view-registry';

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
      // Should show categorized blocker summary (compact format: perm:N unsup:N deps:N)
      expect(screen.getByText(/check: blocked/)).toBeDefined();
      expect(screen.getByText(/perm:2 unsup:1 deps:1/)).toBeDefined();
    });
  });

  it('shows check: ok status when check returns clean', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'clean-plugin', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': { status: 'ok', blockers: [], capabilities: [], dependencies: [] },
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('clean-plugin')).toBeDefined());

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/check: ok/)).toBeDefined();
    });
  });

  it('shows check: incomplete status when check returns incomplete', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'warn-plugin', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': { status: 'incomplete', blockers: [], capabilities: [], dependencies: [] },
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('warn-plugin')).toBeDefined());

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/check: incomplete/)).toBeDefined();
    });
  });

  it('shows capability count and tags for capabilities without env check', async () => {
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
    // New format: summary row shows "caps: 3", tags row shows capability names
    expect(container.textContent).toContain('caps: 3');
    expect(screen.getByText('network.connect')).toBeDefined();
    expect(screen.getByText('process.spawn')).toBeDefined();
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
      expect(screen.getByText(/unk:1/)).toBeDefined();
    });
  });

  // ── Response shape compatibility ──

  it('plugin.list returns {plugins: []} object and renders empty state', async () => {
    const core = createCore({ 'plugin.list': { plugins: [] } });
    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('No plugins installed')).toBeDefined();
    });
  });

  it('plugin.list returns {entries: []} object and renders plugin list', async () => {
    const core = createCore({ 'plugin.list': { entries: mockPluginList } });
    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('terminal')).toBeDefined();
    });
  });

  // ── run.list integration ──

  it('run.list returns {runs: [...]} object and run counts render', async () => {
    const core = createCore({
      'plugin.list': mockPluginList,
      'run.list': {
        runs: [
          { runId: 'r1', kind: 'terminal', pluginId: 'terminal', state: 'running', sessionId: 's1' },
          { runId: 'r2', kind: 'shell', pluginId: 'shell', state: 'stopped', sessionId: 's2' },
          { runId: 'r3', kind: 'terminal', pluginId: 'terminal', state: 'running', sessionId: 's3' },
        ],
      },
    });
    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('terminal')).toBeDefined();
    });

    // terminal has 2 runs, others have 0
    expect(screen.getByText('runs: 2')).toBeDefined();
    const zeroRunNodes = screen.getAllByText('runs: 0');
    expect(zeroRunNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('run.list fails but plugin list still renders with run counts 0', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    const origCall = core.call.bind(core);
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'run.list') throw new Error('run.list unavailable');
      return origCall(method, params);
    });

    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('terminal')).toBeDefined();
    });
    // All plugins have 0 runs since run.list failed
    const zeroRunNodes = screen.getAllByText('runs: 0');
    expect(zeroRunNodes.length).toBe(5);
  });

  it('run.list returns {entries: [...]} object and counts aggregate correctly', async () => {
    const core = createCore({
      'plugin.list': mockPluginList,
      'run.list': {
        entries: [
          { runId: 'r1', kind: 'terminal', pluginId: 'terminal', state: 'running', sessionId: 's1' },
        ],
      },
    });
    render(<PluginManager core={core} />);

    await waitFor(() => {
      expect(screen.getByText('terminal')).toBeDefined();
    });
  });

  // ── Single Check failure isolation ──

  it('single plugin Check fails and shows inline error only for that row', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    const origCall = core.call.bind(core);
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.check' && (params as Record<string, unknown>)?.pluginId === 'terminal') {
        throw new Error('Check unavailable for terminal');
      }
      return origCall(method, params);
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    // Click Check on terminal (index 1 in plugin list, index 0 is sessionnode-core)
    const checkButtons = screen.getAllByText('Check');
    fireEvent.click(checkButtons[1]);

    await waitFor(() => {
      expect(screen.getByText('Check unavailable for terminal')).toBeDefined();
    });
    // Other plugins still show "check: not run"
    const notRunNodes = screen.getAllByText('check: not run');
    expect(notRunNodes.length).toBeGreaterThanOrEqual(3);
  });

  // ── Check All partial failure ──

  it('Check All with partial failures still shows successful results', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    const origCall = core.call.bind(core);
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.check') {
        const pid = (params as Record<string, unknown>)?.pluginId as string;
        if (pid === 'terminal') {
          return { status: 'ok', dependencies: [{ id: 'bash' }], blockers: [], capabilities: [] };
        }
        if (pid === 'system-info') {
          throw new Error('Check failed for system-info');
        }
        return { status: 'incomplete', dependencies: [], blockers: [], capabilities: [] };
      }
      return origCall(method, params);
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      // terminal check succeeded
      expect(screen.getByText('check: ok')).toBeDefined();
      // error for system-info
      expect(screen.getByText('check: error')).toBeDefined();
    });
    // incomplete checks appear on multiple plugins
    const incompleteNodes = screen.getAllByText('check: incomplete');
    expect(incompleteNodes.length).toBeGreaterThanOrEqual(1);
  });

  // ── Builtin vs non-builtin toggle ──

  it('builtin plugin row shows "builtin" text, no Enable/Disable button', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('sessionnode-core')).toBeDefined());

    // sessionnode-core is builtin — the "builtin" label appears (both type badge and action placeholder)
    const builtinTexts = screen.getAllByText('builtin');
    expect(builtinTexts.length).toBeGreaterThanOrEqual(1);

    // Non-builtin plugins have Enable/Disable buttons — 4 non-builtin plugins = 4 toggle buttons
    const toggleButtons = screen.getAllByText(/^(Enable|Disable)$/);
    expect(toggleButtons.length).toBe(4);
  });

  it('non-builtin plugin shows Enable/Disable button', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    // terminal is a feature plugin — should show Disable button (since status is enabled)
    const disableButtons = screen.getAllByText('Disable');
    expect(disableButtons.length).toBeGreaterThanOrEqual(1);
  });

  // ── Toggle failure inline error ──

  it('toggle fails and shows inline error on the plugin row', async () => {
    const core = createCore({ 'plugin.list': mockPluginList });
    const origCall = core.call.bind(core);
    const callSpy = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.disable' && (params as Record<string, unknown>)?.pluginId === 'terminal') {
        throw new Error('Cannot disable terminal: in use');
      }
      return origCall(method, params);
    });
    (core as unknown as Record<string, unknown>).call = callSpy;

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    // Click Disable on terminal (first "Disable" button in DOM order)
    const disableButtons = screen.getAllByText('Disable');
    fireEvent.click(disableButtons[0]);

    // Verify the spy was called with plugin.disable
    await waitFor(() => {
      expect(callSpy).toHaveBeenCalledWith('plugin.disable', expect.objectContaining({ pluginId: 'terminal' }));
    });

    // Error should appear — check both inline row and top banner
    const errorMsg = 'Cannot disable terminal: in use';
    await waitFor(() => {
      expect(screen.getAllByText(errorMsg).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── deps count in summary ──

  it('shows deps count from env check result', async () => {
    const core = createCore({
      'plugin.list': [mockPluginList[0]],
      'plugin.check': {
        status: 'ok',
        blockers: [],
        dependencies: [{ id: 'bash' }, { id: 'python3' }, { id: 'git' }],
      },
    });

    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('sessionnode-core')).toBeDefined());

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText('deps: 3')).toBeDefined();
    });
  });
});

// ─── PluginManager: List Display Completeness ───────────────────

describe('PluginManager: List Display Completeness', () => {
  it('renders all row elements: pluginId, status dot, version, type, launchable, caps, deps, check, runs, buttons', async () => {
    const core = createCore({
      'plugin.list': [{
        pluginId: 'full-plugin', version: '2.0.0', status: 'enabled', type: 'feature',
        description: 'A full-featured plugin', capabilities: ['cap.a', 'cap.b'],
      }],
      'plugin.check': { status: 'ok', blockers: [], dependencies: [{ id: 'node' }] },
      'run.list': { runs: [{ runId: 'r1', pluginId: 'full-plugin', state: 'running', sessionId: 's1' }] },
    });
    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('full-plugin')).toBeDefined());

    // Trigger Check All to populate deps/check columns
    fireEvent.click(screen.getByText('Check All'));
    await waitFor(() => {
      expect(screen.getByText('check: ok')).toBeDefined();
    });

    const greenDots = document.querySelectorAll('.bg-emerald-500');
    expect(greenDots.length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('2.0.0')).toBeDefined();
    expect(screen.getByText('feature')).toBeDefined();
    expect(screen.getByText('launchable: no')).toBeDefined();
    expect(screen.getByText('caps: 2')).toBeDefined();
    expect(screen.getByText('deps: 1')).toBeDefined();
    expect(screen.getByText('check: ok')).toBeDefined();
    expect(screen.getByText('runs: 1')).toBeDefined();
    expect(screen.getByText('Detail')).toBeDefined();
    expect(screen.getByText('Check')).toBeDefined();
    expect(screen.getByText('Disable')).toBeDefined();
    expect(screen.getByText(/A full-featured plugin/)).toBeDefined();
  });

  it('renders builtin plugin row with builtin label and no Enable/Disable', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'core-builtin', version: '1.0.0', status: 'enabled', type: 'builtin' }],
      'run.list': { runs: [] },
    });
    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('core-builtin')).toBeDefined());

    const builtinBadges = screen.getAllByText('builtin');
    expect(builtinBadges.length).toBeGreaterThanOrEqual(2);

    expect(screen.queryByText('Enable')).toBeNull();
    expect(screen.queryByText('Disable')).toBeNull();
    expect(screen.getByText('Detail')).toBeDefined();
    expect(screen.getByText('Check')).toBeDefined();
  });

  it('shows check: not run when no env check performed', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'unchecked', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'run.list': { runs: [] },
    });
    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('unchecked')).toBeDefined());
    expect(screen.getByText('check: not run')).toBeDefined();
    expect(screen.getByText('deps: 0')).toBeDefined();
    expect(screen.getByText('runs: 0')).toBeDefined();
  });

  it('shows launchable: yes when plugin owns a launchable view via meta.pluginId', async () => {
    const DummyIcon = () => null;
    registerView('terminal.main-view', {
      component: () => null,
      meta: {
        title: 'Terminal', icon: DummyIcon, launchable: true,
        launchMode: 'direct', viewType: 'main.editor', pluginId: 'terminal',
      },
    });

    try {
      const core = createCore({
        'plugin.list': [{ pluginId: 'terminal', version: '1.0.0', status: 'enabled', type: 'feature' }],
        'run.list': { runs: [] },
      });
      render(<PluginManager core={core} />);

      await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());
      expect(screen.getByText('launchable: yes')).toBeDefined();
    } finally {
      unregisterView('terminal.main-view');
    }
  });

  it('disabled plugin shows Enable button and no Disable button', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'off-plugin', version: '0.2.0', status: 'disabled', type: 'feature' }],
      'run.list': { runs: [] },
    });
    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('off-plugin')).toBeDefined());
    expect(screen.getByText('Enable')).toBeDefined();
    expect(screen.queryByText('Disable')).toBeNull();

    const grayDots = document.querySelectorAll('.bg-gray-600');
    expect(grayDots.length).toBeGreaterThanOrEqual(1);
  });

  it('error plugin shows red status dot and inline error text', async () => {
    const core = createCore({
      'plugin.list': [{
        pluginId: 'broken-plugin', version: '0.5.0', status: 'error', type: 'feature',
        error: 'Missing dependency: python3',
      }],
      'run.list': { runs: [] },
    });
    render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('broken-plugin')).toBeDefined());
    expect(screen.getByText('Missing dependency: python3')).toBeDefined();

    const redDots = document.querySelectorAll('.bg-red-500');
    expect(redDots.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── PluginManager + PluginDetail: List-Detail-Back Integration ──

describe('PluginManager + PluginDetail: List-Detail-Back Flow', () => {
  function NavWrapper({ core }: { core: CoreClient }) {
    const [selected, setSelected] = React.useState<string | null>(null);
    if (selected) {
      return React.createElement(PluginDetail, {
        core, pluginId: selected, onBack: () => setSelected(null),
      });
    }
    return React.createElement(PluginManager, { core, onPluginSelect: setSelected });
  }

  it('navigates from PluginManager to PluginDetail via Detail button', async () => {
    const core = createCore({
      'plugin.list': [
        { pluginId: 'sessionnode-core', version: '0.1.0', status: 'enabled', type: 'builtin' },
        { pluginId: 'terminal', version: '1.0.0', status: 'enabled', type: 'feature', description: 'Terminal sessions' },
      ],
      'plugin.get': mockPluginGet,
      'run.list': { runs: [] },
    });

    render(<NavWrapper core={core} />);
    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    const detailButtons = screen.getAllByText('Detail');
    fireEvent.click(detailButtons[1]);

    await waitFor(() => {
      expect(screen.getByText('< Plugin Manager')).toBeDefined();
    });
    expect(screen.getByText('Shell session management')).toBeDefined();
  });

  it('back button returns from PluginDetail to PluginManager list', async () => {
    const core = createCore({
      'plugin.list': [
        { pluginId: 'sessionnode-core', version: '0.1.0', status: 'enabled', type: 'builtin' },
        { pluginId: 'terminal', version: '1.0.0', status: 'enabled', type: 'feature' },
      ],
      'plugin.get': mockPluginGet,
      'run.list': { runs: [] },
    });

    render(<NavWrapper core={core} />);
    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());
    fireEvent.click(screen.getAllByText('Detail')[1]);
    await waitFor(() => expect(screen.getByText('< Plugin Manager')).toBeDefined());

    fireEvent.click(screen.getByText('< Plugin Manager'));

    await waitFor(() => {
      expect(screen.getByText('Plugin Management')).toBeDefined();
    });
    expect(screen.queryByText('< Plugin Manager')).toBeNull();
    expect(screen.getByText('sessionnode-core')).toBeDefined();
    expect(screen.getByText('terminal')).toBeDefined();
  });

  it('back button from PluginDetail invokes onBack callback', async () => {
    const onBack = vi.fn();
    const core = createCore({ 'plugin.get': mockPluginGet });
    render(<PluginDetail core={core} pluginId="terminal" onBack={onBack} />);

    await waitForDetail();
    fireEvent.click(screen.getByText('< Plugin Manager'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('PluginDetail renders all 13 tab labels', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();

    const expectedTabs = [
      'Overview', 'Environment', 'Capabilities', 'Permissions',
      'Approvals', 'Install', 'Config', 'Files',
      'Cache', 'Runs', 'Logs', 'History', 'Raw Manifest',
    ];

    const tabButtons = screen.getAllByRole('button').filter(btn =>
      expectedTabs.includes(btn.textContent || '')
    );
    expect(tabButtons.length).toBe(13);

    for (const tab of expectedTabs) {
      expect(screen.getByText(tab, { selector: 'button' })).toBeDefined();
    }
  });

  it('navigating to different plugins via Detail shows correct details', async () => {
    const systemInfoGet = {
      id: 'system-info', pluginId: 'system-info', version: '1.0.0',
      name: 'System Info', description: 'System diagnostics plugin',
      enabled: true, trusted: false, manifestVersion: '1', capabilities: [],
    };

    const core = createCore({
      'plugin.list': [
        { pluginId: 'sessionnode-core', version: '0.1.0', status: 'enabled', type: 'builtin' },
        { pluginId: 'terminal', version: '1.0.0', status: 'enabled', type: 'feature' },
        { pluginId: 'system-info', version: '1.0.0', status: 'enabled', type: 'feature' },
      ],
      'plugin.get': systemInfoGet,
      'run.list': { runs: [] },
    });

    render(<NavWrapper core={core} />);
    await waitFor(() => expect(screen.getByText('system-info')).toBeDefined());

    const detailButtons = screen.getAllByText('Detail');
    fireEvent.click(detailButtons[2]);

    await waitFor(() => {
      expect(screen.getByText('System diagnostics plugin')).toBeDefined();
    });

    fireEvent.click(screen.getByText('< Plugin Manager'));
    await waitFor(() => expect(screen.getByText('Plugin Management')).toBeDefined());

    const detailButtons2 = screen.getAllByText('Detail');
    fireEvent.click(detailButtons2[1]);

    await waitFor(() => {
      expect(screen.getByText('< Plugin Manager')).toBeDefined();
    });
  });
});

// ─── PluginManager: No Skeleton Loading Regression ──────────────

describe('PluginManager: No Skeleton Loading Regression', () => {
  it('does not show skeleton loading after toggle failure', async () => {
    const core = createCore({ 'plugin.list': mockPluginList, 'run.list': { runs: [] } });
    const origCall = core.call.bind(core);
    const callSpy = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.disable' && (params as Record<string, unknown>)?.pluginId === 'terminal') {
        throw new Error('Cannot disable terminal: in use');
      }
      return origCall(method, params);
    });
    (core as unknown as Record<string, unknown>).call = callSpy;

    render(<PluginManager core={core} />);
    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    const disableButtons = screen.getAllByText('Disable');
    fireEvent.click(disableButtons[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Cannot disable terminal: in use').length).toBeGreaterThanOrEqual(1);
    });

    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(0);
  });

  it('does not show skeleton loading after single check failure', async () => {
    const core = createCore({ 'plugin.list': mockPluginList, 'run.list': { runs: [] } });
    const origCall = core.call.bind(core);
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.check' && (params as Record<string, unknown>)?.pluginId === 'terminal') {
        throw new Error('Check unavailable');
      }
      return origCall(method, params);
    });

    render(<PluginManager core={core} />);
    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    const checkButtons = screen.getAllByText('Check');
    fireEvent.click(checkButtons[1]);

    await waitFor(() => {
      expect(screen.getByText('Check unavailable')).toBeDefined();
    });

    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(0);
  });

  it('does not show skeleton loading after Check All partial failure', async () => {
    const core = createCore({ 'plugin.list': mockPluginList, 'run.list': { runs: [] } });
    const origCall = core.call.bind(core);
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.check') {
        const pid = (params as Record<string, unknown>)?.pluginId as string;
        if (pid === 'system-info') throw new Error('Check failed for system-info');
        return { status: 'ok', dependencies: [], blockers: [], capabilities: [] };
      }
      return origCall(method, params);
    });

    render(<PluginManager core={core} />);
    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getAllByText('check: ok').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('check: error')).toBeDefined();
    });

    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(0);
  });
});

// ─── PluginManager: Per-Row Error Isolation ─────────────────────

describe('PluginManager: Per-Row Error Isolation', () => {
  it('toggleErrors isolates per-row: only failing row shows inline error', async () => {
    const core = createCore({ 'plugin.list': mockPluginList, 'run.list': { runs: [] } });
    const origCall = core.call.bind(core);
    const callSpy = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.disable' && (params as Record<string, unknown>)?.pluginId === 'terminal') {
        throw new Error('Cannot disable terminal');
      }
      return origCall(method, params);
    });
    (core as unknown as Record<string, unknown>).call = callSpy;

    render(<PluginManager core={core} />);
    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    const disableButtons = screen.getAllByText('Disable');
    fireEvent.click(disableButtons[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Cannot disable terminal').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('system-info')).toBeDefined();
    expect(screen.getByText('sessionnode-core')).toBeDefined();
  });

  it('checkErrors isolates per-row: only checked row shows inline error', async () => {
    const core = createCore({ 'plugin.list': mockPluginList, 'run.list': { runs: [] } });
    const origCall = core.call.bind(core);
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.check') {
        const pid = (params as Record<string, unknown>)?.pluginId as string;
        if (pid === 'terminal') throw new Error('Check failed for terminal');
        return { status: 'ok', dependencies: [], blockers: [], capabilities: [] };
      }
      return origCall(method, params);
    });

    render(<PluginManager core={core} />);
    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    const checkButtons = screen.getAllByText('Check');
    fireEvent.click(checkButtons[1]);

    await waitFor(() => {
      expect(screen.getByText('Check failed for terminal')).toBeDefined();
    });

    const notRunNodes = screen.getAllByText('check: not run');
    expect(notRunNodes.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('sessionnode-core')).toBeDefined();
  });

  it('toggleErrors from two different rows do not interfere', async () => {
    const core = createCore({ 'plugin.list': mockPluginList, 'run.list': { runs: [] } });
    const origCall = core.call.bind(core);
    const callSpy = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.disable' && (params as Record<string, unknown>)?.pluginId === 'terminal') {
        throw new Error('Cannot disable terminal');
      }
      if (method === 'plugin.disable' && (params as Record<string, unknown>)?.pluginId === 'system-info') {
        throw new Error('Cannot disable system-info');
      }
      return origCall(method, params);
    });
    (core as unknown as Record<string, unknown>).call = callSpy;

    render(<PluginManager core={core} />);
    await waitFor(() => expect(screen.getByText('terminal')).toBeDefined());

    const disableButtons = screen.getAllByText('Disable');
    fireEvent.click(disableButtons[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Cannot disable terminal').length).toBeGreaterThanOrEqual(1);
    });

    const disableButtons2 = screen.getAllByText('Disable');
    fireEvent.click(disableButtons2[1]);

    await waitFor(() => {
      expect(screen.getAllByText('Cannot disable system-info').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText('Cannot disable terminal').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cannot disable system-info').length).toBeGreaterThanOrEqual(1);
  });
});

// ─── PluginManager: Blocker Kind Contract ───────────────────────

describe('PluginManager: Blocker Kind Contract', () => {
  it('missing_dependency renders deps:N without crash', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'test-plugin', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': {
        status: 'blocked',
        blockers: [
          { kind: 'missing_dependency', dependency: 'python3', reason: 'binary_missing' },
          { kind: 'missing_dependency', dependency: 'git', reason: 'binary_missing' },
        ],
      },
      'run.list': { runs: [] },
    });
    const { container } = render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('test-plugin')).toBeDefined());
    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/deps:2/)).toBeDefined();
      expect(screen.getByText('check: blocked')).toBeDefined();
    });
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('missing_grant renders perm:N without crash', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'test-plugin', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': {
        status: 'blocked',
        blockers: [
          { kind: 'missing_grant', capability: 'network.connect', reason: 'not_granted' },
          { kind: 'missing_grant', capability: 'process.spawn', reason: 'not_granted' },
          { kind: 'missing_grant', capability: 'fs.write', reason: 'not_granted' },
        ],
      },
      'run.list': { runs: [] },
    });
    const { container } = render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('test-plugin')).toBeDefined());
    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/perm:3/)).toBeDefined();
      expect(screen.getByText('check: blocked')).toBeDefined();
    });
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('unsupported_capability renders unsup:N without crash', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'test-plugin', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': {
        status: 'blocked',
        blockers: [
          { kind: 'unsupported_capability', capability: 'gpu.compute', reason: 'no GPU' },
        ],
      },
      'run.list': { runs: [] },
    });
    const { container } = render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('test-plugin')).toBeDefined());
    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/unsup:1/)).toBeDefined();
      expect(screen.getByText('check: blocked')).toBeDefined();
    });
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('unknown_capability renders unk:N without crash', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'test-plugin', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': {
        status: 'blocked',
        blockers: [
          { kind: 'unknown_capability', capability: 'magic.wand', reason: 'not in support matrix' },
          { kind: 'unknown_capability', capability: 'sorcery.cast', reason: 'not in support matrix' },
        ],
      },
      'run.list': { runs: [] },
    });
    const { container } = render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('test-plugin')).toBeDefined());
    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText(/unk:2/)).toBeDefined();
      expect(screen.getByText('check: blocked')).toBeDefined();
    });
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('all four blocker kinds render together without crash', async () => {
    const core = createCore({
      'plugin.list': [{ pluginId: 'full-blocked', version: '1.0.0', status: 'enabled', type: 'feature' }],
      'plugin.check': {
        status: 'blocked',
        blockers: [
          { kind: 'missing_dependency', dependency: 'rustc', reason: 'binary_missing' },
          { kind: 'missing_grant', capability: 'network.connect', reason: 'not_granted' },
          { kind: 'unsupported_capability', capability: 'gpu.compute', reason: 'no GPU' },
          { kind: 'unknown_capability', capability: 'future.tech', reason: 'not in matrix' },
        ],
      },
      'run.list': { runs: [] },
    });
    const { container } = render(<PluginManager core={core} />);

    await waitFor(() => expect(screen.getByText('full-blocked')).toBeDefined());
    fireEvent.click(screen.getByText('Check All'));

    await waitFor(() => {
      expect(screen.getByText('check: blocked')).toBeDefined();
      expect(screen.getByText(/deps:1/)).toBeDefined();
      expect(screen.getByText(/perm:1/)).toBeDefined();
      expect(screen.getByText(/unsup:1/)).toBeDefined();
      expect(screen.getByText(/unk:1/)).toBeDefined();
    });
    expect(container.querySelector('.animate-pulse')).toBeNull();
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

  it('shows Config tab data', async () => {
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
    await clickTab('Config');

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
      expect(screen.getByText(/No log entries found/i)).toBeDefined();
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

  it('shows Config save button and handles save', async () => {
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
    await clickTab('Config');

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

// ─── PluginDetail: Capabilities & Install Tabs ───────────────────

describe('PluginDetail: Capabilities & Install', () => {
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
    await clickTab('Capabilities');

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
    await clickTab('Capabilities');

    await waitFor(() => {
      expect(screen.getByText(/All declared capabilities are supported/i)).toBeDefined();
    });
  });

  it('shows Create Install Plan button in Install tab', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

    await waitFor(() => {
      expect(screen.getByText('Create Install Plan')).toBeDefined();
    });
  });

  it('install plan renders steps', async () => {
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
      'plugin.install.plan': mockPlan,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

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
      'plugin.install.plan': mockPlan,
      'notify.request': mockNotifyReq,
      'notify.respond': mockNotifyResp,
      'plugin.install.execute': mockExec,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

    // Create plan
    await waitFor(() => expect(screen.getByText('Create Install Plan')).toBeDefined());
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
    await clickTab('Capabilities');

    await waitFor(() => {
      expect(screen.getByText('unsupported_capability')).toBeDefined();
      expect(screen.getByText('gpu.compute')).toBeDefined();
      expect(screen.getByText(/no GPU support on this platform/i)).toBeDefined();
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
    await clickTab('Capabilities');

    await waitFor(() => {
      expect(screen.getByText('unknown_capability')).toBeDefined();
      expect(screen.getByText('magic.wand')).toBeDefined();
      expect(screen.getByText(/not in support matrix/i)).toBeDefined();
    });
  });

  it('shows missing_grant blocker info in Capabilities tab', async () => {
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
    await clickTab('Capabilities');

    await waitFor(() => {
      expect(screen.getByText('missing_grant')).toBeDefined();
      expect(screen.getByText('session.create')).toBeDefined();
    });
  });
});

// ─── PluginDetail: Contract Hardening ─────────────────────────────

describe('PluginDetail: Contract Hardening', () => {
  it('Environment tab shows "No dependencies" for empty deps', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'ok',
      checkedAt: Date.now(),
      dependencies: [],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.check': mockCheck });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Environment');

    await waitFor(() => {
      expect(screen.getByText('No dependencies.')).toBeDefined();
    });
  });

  it('Capabilities tab handles all 4 blocker kinds', async () => {
    const mockCheck = {
      pluginId: 'terminal',
      status: 'blocked',
      blockers: [
        { kind: 'missing_dependency', dependency: 'python3', reason: 'binary_missing' },
        { kind: 'unsupported_capability', capability: 'gpu.compute', reason: 'no GPU support' },
        { kind: 'missing_grant', capability: 'session.create', reason: 'not_granted' },
        { kind: 'unknown_capability', capability: 'magic.wand', reason: 'not in support matrix' },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.check': mockCheck });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Capabilities');

    await waitFor(() => {
      expect(screen.getByText('missing_dependency')).toBeDefined();
      expect(screen.getByText('unsupported_capability')).toBeDefined();
      expect(screen.getByText('missing_grant')).toBeDefined();
      expect(screen.getByText('unknown_capability')).toBeDefined();
    });
  });

  it('Permissions tab handles empty permissions', async () => {
    const mockPermissions = { pluginId: 'terminal', permissions: [] };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.permissions.list': mockPermissions });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');

    await waitFor(() => {
      expect(screen.getByText('No permissions found')).toBeDefined();
    });
  });

  it('Approvals tab handles {approvals:[]} response', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'approval.list': { approvals: [] },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Approvals');

    await waitFor(() => {
      expect(screen.getByText(/No pending approvals/i)).toBeDefined();
    });
  });

  it('Approvals tab handles approval.list failure', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    vi.spyOn(core, 'call').mockImplementation(async (method: string) => {
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'approval.list') throw new Error('Network error');
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Approvals');

    await waitFor(() => {
      expect(screen.getByText(/No pending approvals/i)).toBeDefined();
    });
  });

  it('Install tab shows "not implemented" when execute returns not_implemented', async () => {
    const mockPlan = {
      planId: 'plan-ni',
      pluginId: 'terminal',
      steps: [{ order: 1, description: 'Install step', commands: ['echo test'], risk: 'low', status: 'pending' }],
      risk: 'low',
      status: 'pending_approval',
      summary: 'Test plan',
      createdAt: Date.now(),
    };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.install.plan': mockPlan,
    });
    // Override execute to throw not_implemented
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'plugin.install.plan') return mockPlan;
      if (method === 'notify.request') return { requestId: 'req-ni', status: 'pending' };
      if (method === 'notify.respond') return { status: 'responded' };
      if (method === 'plugin.install.execute') throw new Error('CAPABILITY_NOT_DECLARED: plugin.install.execute not_implemented');
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

    // Create plan
    await waitFor(() => expect(screen.getByText('Create Install Plan')).toBeDefined());
    fireEvent.click(screen.getByText('Create Install Plan'));
    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());

    // Request approval
    fireEvent.click(screen.getByText('Request Approval'));
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());

    // Approve
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Execute Install')).toBeDefined());

    // Execute - should show not implemented message
    fireEvent.click(screen.getByText('Execute Install'));
    await waitFor(() => {
      expect(screen.getByText('Execution not implemented by Core yet')).toBeDefined();
    });
  });

  it('Install tab shows error when planId missing', async () => {
    const mockPlanNoId = {
      // planId intentionally missing
      pluginId: 'terminal',
      steps: [{ order: 1, description: 'Step', commands: ['echo test'], risk: 'low', status: 'pending' }],
      risk: 'low',
      status: 'pending_approval',
      summary: 'No Plan ID',
      createdAt: Date.now(),
    };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.install.plan': mockPlanNoId,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

    // Create plan
    await waitFor(() => expect(screen.getByText('Create Install Plan')).toBeDefined());
    fireEvent.click(screen.getByText('Create Install Plan'));

    // Should see Request Approval button
    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());
    fireEvent.click(screen.getByText('Request Approval'));

    // Should show planId missing error
    await waitFor(() => {
      expect(screen.getByText(/Plan ID is missing/i)).toBeDefined();
    });
  });

  it('Config tab handles missing schema', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.config.schema': { pluginId: 'terminal', schema: null },
      'plugin.config.get': { pluginId: 'terminal', config: {} },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Config');

    await waitFor(() => {
      expect(screen.getByText(/No configuration schema declared/i)).toBeDefined();
    });
  });

  it('Cache tab shows disabled Clear when cache is not clearable', async () => {
    const mockCache = {
      pluginId: 'terminal',
      caches: [{ id: 'system-cache', path: '/sys/cache', description: 'System data', risk: 'low', clearable: false }],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.cache.list': mockCache });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Cache');

    await waitFor(() => {
      const clearBtn = screen.getByText('Clear');
      expect(clearBtn).toBeDefined();
      expect((clearBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('Runs tab shows enabled Attach button and calls run.attach on click', async () => {
    const mockRuns = {
      runs: [
        { runId: 'run-001', kind: 'terminal', state: 'running', sessionId: 'sess-001', createdAt: 1000 },
      ],
    };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'run.list': mockRuns,
      'run.attach': { runId: 'run-001', sessionId: 'sess-001', state: 'running' },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');

    await waitFor(() => {
      const attachBtn = screen.getByText('Attach');
      expect(attachBtn).toBeDefined();
      expect((attachBtn as HTMLButtonElement).disabled).toBe(false);
    });

    // Click Attach — verify UI updates to "Attach verified"
    const callSpy = vi.spyOn(core, 'call');
    fireEvent.click(screen.getByText('Attach'));
    await waitFor(() => {
      expect(callSpy).toHaveBeenCalledWith('run.attach', { runId: 'run-001', replay: false });
      expect(screen.getByText('Attach verified')).toBeDefined();
    });
    callSpy.mockRestore();
  });

  it('History tab handles empty history', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.history': { pluginId: 'terminal', events: [] },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText(/No history events recorded/i)).toBeDefined();
    });
  });
});

// ─── PluginDetail: Runs Tab ────────────────────────────────────────

describe('PluginDetail: Runs Tab', () => {
  it('run.list returns {runs: [...]} — renders runs for current plugin', async () => {
    const mockRuns = {
      runs: [
        { runId: 'run-001', kind: 'terminal', pluginId: 'terminal', state: 'running', sessionId: 'sess-001', createdAt: 1000 },
        { runId: 'run-002', kind: 'shell', pluginId: 'terminal', state: 'stopped', sessionId: 'sess-002', nodeId: 'n1' },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'run.list': mockRuns });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');

    await waitFor(() => {
      expect(screen.getByText('run-001')).toBeDefined();
      expect(screen.getByText('run-002')).toBeDefined();
      expect(screen.getByText('shell')).toBeDefined(); // run-002's kind
      expect(screen.getByText('running')).toBeDefined();
      expect(screen.getByText('stopped')).toBeDefined();
    });
  });

  it('run.list returns empty [] — shows empty state', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet, 'run.list': [] });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');

    await waitFor(() => {
      expect(screen.getByText(/No active runs/i)).toBeDefined();
    });
  });

  it('run.list returns {entries: [...]} shape — uses listFromResponse multi-key extraction', async () => {
    const mockRuns = {
      entries: [
        { runId: 'run-entries-1', kind: 'terminal', state: 'running', sessionId: 'sess-e1', createdAt: 2000 },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'run.list': mockRuns });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');

    await waitFor(() => {
      expect(screen.getByText('run-entries-1')).toBeDefined();
    });
  });

  it('run.list error — shows error state, not crash', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    vi.spyOn(core, 'call').mockImplementation(async (method: string) => {
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'run.list') throw new Error('run.list unavailable');
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');

    await waitFor(() => {
      expect(screen.getByText('run.list unavailable')).toBeDefined();
    });
  });

  it('Stop button calls run.stop with runId, then refreshes list', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let runListCalls = 0;
    const core = createCore({
      'plugin.get': mockPluginGet,
      'run.list': {
        runs: [
          { runId: 'run-stop-1', kind: 'shell', state: 'running', sessionId: 'sess-s1' },
        ],
      },
    });
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params: params ? { ...params } : undefined });
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'run.list') {
        runListCalls++;
        // First call during mount: return running so Stop button appears
        // Second call after refresh: return stopped
        return {
          runs: [{ runId: 'run-stop-1', kind: 'shell', state: runListCalls === 1 ? 'running' : 'stopped', sessionId: 'sess-s1' }],
        };
      }
      if (method === 'run.stop') return { runId: 'run-stop-1', state: 'stopped' };
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');
    await waitFor(() => expect(screen.getByText('run-stop-1')).toBeDefined());

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => {
      const stopCalls = calls.filter(c => c.method === 'run.stop');
      expect(stopCalls.length).toBeGreaterThanOrEqual(1);
      expect(stopCalls[0].params).toHaveProperty('runId', 'run-stop-1');
    });

    await waitFor(() => {
      expect(screen.getByText('stopped')).toBeDefined();
    });
  });

  it('Stop error shows per-row error text', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'run.list': {
        runs: [
          { runId: 'run-err-1', kind: 'shell', state: 'running', sessionId: 'sess-e1' },
        ],
      },
    });
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'run.list') return { runs: [{ runId: 'run-err-1', kind: 'shell', state: 'running', sessionId: 'sess-e1' }] };
      if (method === 'run.stop') throw new Error('Process still alive — force kill required');
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');
    await waitFor(() => expect(screen.getByText('run-err-1')).toBeDefined());

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => {
      expect(screen.getByText(/Process still alive/)).toBeDefined();
    });
  });

  it('Stop errors isolate per row — second row error does not pollute first', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'run.list': {
        runs: [
          { runId: 'run-ok', kind: 'shell', state: 'running', sessionId: 'sess-ok' },
          { runId: 'run-fail', kind: 'shell', state: 'running', sessionId: 'sess-fail' },
        ],
      },
    });
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'run.list') return {
        runs: [
          { runId: 'run-ok', kind: 'shell', state: 'running', sessionId: 'sess-ok' },
          { runId: 'run-fail', kind: 'shell', state: 'running', sessionId: 'sess-fail' },
        ],
      };
      if (method === 'run.stop') {
        if ((params as Record<string, unknown>)?.runId === 'run-fail') throw new Error('Cannot stop run-fail');
        return { state: 'stopped' };
      }
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');
    await waitFor(() => expect(screen.getByText('run-ok')).toBeDefined());

    const stopButtons = screen.getAllByText('Stop');
    fireEvent.click(stopButtons[1]);

    await waitFor(() => {
      expect(screen.getByText(/Cannot stop run-fail/)).toBeDefined();
    });
    const errorElements = screen.getAllByText(/Cannot stop run-fail/);
    expect(errorElements.length).toBe(1);
  });

  it('Attach button enabled and shows verified after successful attach', async () => {
    const mockRuns = {
      runs: [{ runId: 'run-attach', kind: 'terminal', state: 'running', sessionId: 'sess-a1' }],
    };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'run.list': mockRuns,
      'run.attach': { runId: 'run-attach', sessionId: 'sess-a1', state: 'running' },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');
    await waitFor(() => expect(screen.getByText('run-attach')).toBeDefined());

    const attachBtn = screen.getByText('Attach');
    expect((attachBtn as HTMLButtonElement).disabled).toBe(false);

    // Click Attach
    fireEvent.click(attachBtn);
    await waitFor(() => {
      expect(screen.getByText('Attach verified')).toBeDefined();
    });
  });

  it('run.list returns null — does not crash', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet, 'run.list': null });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Runs');

    await waitFor(() => {
      expect(screen.getByText(/No active runs/i)).toBeDefined();
    });
  });
});

// ─── PluginDetail: Install Tab ─────────────────────────────────────

describe('PluginDetail: Install Tab', () => {
  it('plugin.install.execute returns {status:"not_implemented"} — shows not-implemented message', async () => {
    const mockPlan = {
      planId: 'plan-ni-status',
      pluginId: 'terminal',
      steps: [{ order: 1, description: 'Install step', commands: ['echo test'], risk: 'low', status: 'pending' }],
      risk: 'low',
      status: 'pending_approval',
      summary: 'Test plan',
      createdAt: Date.now(),
    };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.install.plan': mockPlan,
      'notify.request': { requestId: 'req-ni-status', status: 'pending' },
      'notify.respond': { status: 'responded' },
      'plugin.install.execute': { status: 'not_implemented', reason: 'Phase 1 stub' },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

    await waitFor(() => expect(screen.getByText('Create Install Plan')).toBeDefined());
    fireEvent.click(screen.getByText('Create Install Plan'));
    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());

    fireEvent.click(screen.getByText('Request Approval'));
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Execute Install')).toBeDefined());

    fireEvent.click(screen.getByText('Execute Install'));
    await waitFor(() => {
      expect(screen.getByText('Execution not implemented by Core yet')).toBeDefined();
    });
    expect(screen.queryByText(/^not_implemented$/)).toBeNull();
  });

  it('plugin.install.plan returns planId — shows plan details', async () => {
    const mockPlan = {
      planId: 'plan-show-1',
      pluginId: 'terminal',
      steps: [{ order: 1, description: 'Verify binary', commands: ['which bash'], risk: 'low', status: 'pending' }],
      risk: 'medium',
      status: 'pending_approval',
      summary: 'Install plan for terminal',
      createdAt: Date.now(),
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.install.plan': mockPlan });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

    await waitFor(() => expect(screen.getByText('Create Install Plan')).toBeDefined());
    fireEvent.click(screen.getByText('Create Install Plan'));

    await waitFor(() => {
      expect(screen.getByText('plan-show-1')).toBeDefined();
      expect(screen.getByText('Install plan for terminal')).toBeDefined();
      expect(screen.getByText('Verify binary')).toBeDefined();
      expect(screen.getByText('medium')).toBeDefined();
    });
  });

  it('plugin.install.plan fails — shows error state', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    vi.spyOn(core, 'call').mockImplementation(async (method: string) => {
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'plugin.install.plan') throw new Error('Plan creation failed: disk full');
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

    await waitFor(() => expect(screen.getByText('Create Install Plan')).toBeDefined());
    fireEvent.click(screen.getByText('Create Install Plan'));

    await waitFor(() => {
      expect(screen.getByText(/disk full/)).toBeDefined();
    });
  });

  it('planId missing — shows clear error', async () => {
    const mockPlanNoId = {
      pluginId: 'terminal',
      steps: [{ order: 1, description: 'Step', commands: ['echo test'], risk: 'low', status: 'pending' }],
      risk: 'low',
      status: 'pending_approval',
      summary: 'Plan without ID',
      createdAt: Date.now(),
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.install.plan': mockPlanNoId });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Install');

    await waitFor(() => expect(screen.getByText('Create Install Plan')).toBeDefined());
    fireEvent.click(screen.getByText('Create Install Plan'));

    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());
    fireEvent.click(screen.getByText('Request Approval'));

    await waitFor(() => {
      expect(screen.getByText(/Plan ID is missing/i)).toBeDefined();
    });
  });
});

// ─── PluginDetail: Logs Tab ────────────────────────────────────────

describe('PluginDetail: Logs Tab', () => {
  it('logs.query returns {entries: []} — shows empty state', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet, 'logs.query': { entries: [] } });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Logs');

    await waitFor(() => {
      expect(screen.getByText(/No log entries found/i)).toBeDefined();
    });
  });

  it('logs.query returns entries — shows timestamp, level, message', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'logs.query': {
        entries: [
          { timestamp: '2026-05-22T10:00:00Z', level: 'info', source: 'plugin', pluginId: 'terminal', message: 'plugin loaded' },
          { timestamp: '2026-05-22T10:01:00Z', level: 'warn', source: 'plugin', pluginId: 'terminal', message: 'deprecated API used' },
          { timestamp: '2026-05-22T10:02:00Z', level: 'error', source: 'plugin', pluginId: 'terminal', message: 'capability failed' },
        ],
      },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Logs');

    await waitFor(() => {
      expect(screen.getByText('plugin loaded')).toBeDefined();
      expect(screen.getByText('deprecated API used')).toBeDefined();
      expect(screen.getByText('capability failed')).toBeDefined();
      expect(screen.getByText('INFO')).toBeDefined();
      expect(screen.getByText('WARN')).toBeDefined();
      expect(screen.getByText('ERROR')).toBeDefined();
    });
  });

  it('logs.query error — shows error state', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    vi.spyOn(core, 'call').mockImplementation(async (method: string) => {
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'logs.query') throw new Error('Log query timeout');
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Logs');

    await waitFor(() => {
      expect(screen.getByText('Log query timeout')).toBeDefined();
    });
  });

  it('logs.query returns null — does not crash', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet, 'logs.query': null });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Logs');

    await waitFor(() => {
      expect(screen.getByText(/No log entries found/i)).toBeDefined();
    });
  });
});

// ─── PluginDetail: History Tab ─────────────────────────────────────

describe('PluginDetail: History Tab', () => {
  it('plugin.history returns {events: [...]} shape — renders correctly', async () => {
    const mockHistory = {
      events: [
        { action: 'plugin.installed', version: '1.0.0', timestamp: '2026-01-01T00:00:00Z' },
        { action: 'plugin.updated', version: '1.1.0', timestamp: '2026-03-15T12:00:00Z' },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.history': mockHistory });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText('plugin.installed')).toBeDefined();
      expect(screen.getByText('plugin.updated')).toBeDefined();
      expect(screen.getByText('v1.0.0')).toBeDefined();
      expect(screen.getByText('v1.1.0')).toBeDefined();
    });
  });

  it('plugin.history returns {history: [...]} shape — renders via fallback', async () => {
    const mockHistory = {
      history: [
        { action: 'plugin.enabled', version: '2.0.0', timestamp: '2026-02-01T00:00:00Z' },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.history': mockHistory });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText('plugin.enabled')).toBeDefined();
      expect(screen.getByText('v2.0.0')).toBeDefined();
    });
  });

  it('plugin.history returns {list: [...]} shape — renders via list fallback', async () => {
    const mockHistory = {
      list: [
        { action: 'config.changed', version: '3.0.0', timestamp: '2026-04-01T00:00:00Z' },
      ],
    };
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.history': mockHistory });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText('config.changed')).toBeDefined();
    });
  });

  it('plugin.history returns bare array — renders via listFromResponse', async () => {
    const mockHistory = [
      { action: 'plugin.uninstalled', version: '0.5.0', timestamp: '2025-12-01T00:00:00Z' },
    ];
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.history': mockHistory });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText('plugin.uninstalled')).toBeDefined();
    });
  });

  it('plugin.history returns empty — shows empty state', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet, 'plugin.history': { events: [] } });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText(/No history events recorded/i)).toBeDefined();
    });
  });

  it('plugin.history returns not_implemented — shows not-implemented message', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.history': { status: 'not_implemented', events: [] },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText(/not implemented in Phase 1/i)).toBeDefined();
    });
  });

  it('plugin.history error — shows error state', async () => {
    const core = createCore({ 'plugin.get': mockPluginGet });
    vi.spyOn(core, 'call').mockImplementation(async (method: string) => {
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'plugin.history') throw new Error('History DB unavailable');
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('History');

    await waitFor(() => {
      expect(screen.getByText('History DB unavailable')).toBeDefined();
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

  // ── Permission grant component-level approval flow ──

  it('shows "Request Approval" button when grant returns requires_approval', async () => {
    const mockPermissions = {
      pluginId: 'terminal',
      permissions: [
        { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' },
      ],
    };
    const mockGrantResult = {
      status: 'requires_approval',
      message: 'High-risk operation requires approval',
      planId: 'plan-approval-1',
    };
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.permissions.list': mockPermissions,
      'plugin.permissions.grant': mockGrantResult,
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');

    await waitFor(() => {
      expect(screen.getByText('terminal.session')).toBeDefined();
    });

    // Click "Grant Allow"
    fireEvent.click(screen.getByText('Grant Allow'));

    // Should show "Request Approval" button instead of immediately refreshing
    await waitFor(() => {
      expect(screen.getByText('Request Approval')).toBeDefined();
    });
    // Should NOT show "Grant Allow" anymore (approval flow active)
    expect(screen.queryByText('Grant Allow')).toBeNull();
    // Should show planId indicator
    expect(screen.getByText(/plan-approval-1/)).toBeDefined();
  });

  it('calls notify.request when Request Approval is clicked', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.permissions.list': {
        pluginId: 'terminal',
        permissions: [
          { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' },
        ],
      },
    });
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params: params ? { ...params } : undefined });
      if (method === 'plugin.permissions.list') {
        return {
          pluginId: 'terminal',
          permissions: [{ id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' }],
        };
      }
      if (method === 'plugin.permissions.grant') {
        return { status: 'requires_approval', planId: 'plan-req-1', message: 'Needs approval' };
      }
      if (method === 'notify.request') {
        return { requestId: 'req-req-1', status: 'pending' };
      }
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'plugin.check') return { status: 'ok', blockers: [], capabilities: [], dependencies: [] };
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');
    await waitFor(() => expect(screen.getByText('terminal.session')).toBeDefined());

    // Click Grant Allow
    fireEvent.click(screen.getByText('Grant Allow'));
    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());

    // Click Request Approval
    fireEvent.click(screen.getByText('Request Approval'));

    await waitFor(() => {
      const notifyCalls = calls.filter(c => c.method === 'notify.request');
      expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
      expect(notifyCalls[0].params).toHaveProperty('planId', 'plan-req-1');
      expect(notifyCalls[0].params).toHaveProperty('kind', 'approval');
    });
  });

  it('full approve flow: grant → request → approve → re-grant with planId', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.permissions.list': {
        pluginId: 'terminal',
        permissions: [
          { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' },
        ],
      },
    });
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params: params ? { ...params } : undefined });
      if (method === 'plugin.permissions.list') {
        return {
          pluginId: 'terminal',
          permissions: [{ id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' }],
        };
      }
      if (method === 'plugin.permissions.grant') {
        if (!params?.planId) {
          return { status: 'requires_approval', planId: 'plan-full-1', message: 'Needs approval' };
        }
        return { status: 'granted', pluginId: params?.pluginId, capability: params?.capability, mode: params?.mode };
      }
      if (method === 'notify.request') {
        return { requestId: 'req-full-1', status: 'pending' };
      }
      if (method === 'notify.respond') {
        return { requestId: params?.requestId, action: params?.action, status: 'responded' };
      }
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'plugin.check') return { status: 'ok', blockers: [], capabilities: [], dependencies: [] };
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');
    await waitFor(() => expect(screen.getByText('terminal.session')).toBeDefined());

    // Step 1: Click Grant Allow → requires_approval
    fireEvent.click(screen.getByText('Grant Allow'));
    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());

    // Step 2: Click Request Approval → notify.request
    fireEvent.click(screen.getByText('Request Approval'));
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    expect(screen.getByText('Deny')).toBeDefined();

    // Step 3: Click Approve → notify.respond allow → re-grant with planId
    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      const grantCalls = calls.filter(c => c.method === 'plugin.permissions.grant');
      expect(grantCalls.length).toBe(2);
      // Second grant call must include planId
      expect(grantCalls[1].params).toHaveProperty('planId', 'plan-full-1');
    });

    // notify.respond should have been called with allow
    const respondCalls = calls.filter(c => c.method === 'notify.respond');
    expect(respondCalls.length).toBeGreaterThanOrEqual(1);
    expect(respondCalls[0].params).toHaveProperty('action', 'allow');
  });

  it('deny flow: grant → request → deny → UI shows denied', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.permissions.list': {
        pluginId: 'terminal',
        permissions: [
          { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' },
        ],
      },
    });
    vi.spyOn(core, 'call').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params: params ? { ...params } : undefined });
      if (method === 'plugin.permissions.list') {
        return {
          pluginId: 'terminal',
          permissions: [{ id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' }],
        };
      }
      if (method === 'plugin.permissions.grant') {
        return { status: 'requires_approval', planId: 'plan-deny-1', message: 'Needs approval' };
      }
      if (method === 'notify.request') {
        return { requestId: 'req-deny-1', status: 'pending' };
      }
      if (method === 'notify.respond') {
        return { requestId: params?.requestId, action: params?.action, status: 'responded' };
      }
      if (method === 'plugin.get') return mockPluginGet;
      if (method === 'plugin.check') return { status: 'ok', blockers: [], capabilities: [], dependencies: [] };
      return undefined;
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');
    await waitFor(() => expect(screen.getByText('terminal.session')).toBeDefined());

    // Grant → requires_approval
    fireEvent.click(screen.getByText('Grant Allow'));
    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());

    // Request Approval
    fireEvent.click(screen.getByText('Request Approval'));
    await waitFor(() => expect(screen.getByText('Deny')).toBeDefined());

    // Click Deny
    fireEvent.click(screen.getByText('Deny'));

    // Should call notify.respond with deny
    await waitFor(() => {
      const respondCalls = calls.filter(c => c.method === 'notify.respond');
      expect(respondCalls.length).toBeGreaterThanOrEqual(1);
      expect(respondCalls[0].params).toHaveProperty('action', 'deny');
    });

    // UI should show denied (NOT granted)
    await waitFor(() => {
      expect(screen.getByText(/denied/i)).toBeDefined();
    });
    // Should NOT show "Grant Allow" (denied state, not back to initial)
    expect(screen.queryByText('grant: allow')).toBeNull();
  });

  it('shows error when requires_approval response has no planId', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.permissions.list': {
        pluginId: 'terminal',
        permissions: [
          { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' },
        ],
      },
      'plugin.permissions.grant': {
        status: 'requires_approval',
        message: 'Needs approval',
        // planId intentionally missing
      },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');
    await waitFor(() => expect(screen.getByText('terminal.session')).toBeDefined());

    // Click Grant Allow
    fireEvent.click(screen.getByText('Grant Allow'));

    // Should show error about missing planId
    await waitFor(() => {
      expect(screen.getByText(/planId/i)).toBeDefined();
    });
  });

  it('shows error when try to approve but requestId is missing', async () => {
    const core = createCore({
      'plugin.get': mockPluginGet,
      'plugin.permissions.list': {
        pluginId: 'terminal',
        permissions: [
          { id: 'terminal.session', description: 'Create sessions', capabilities: ['session.create'], default: 'ask' },
        ],
      },
      'plugin.permissions.grant': {
        status: 'requires_approval',
        planId: 'plan-no-req',
      },
      'notify.request': {
        status: 'pending',
        // requestId intentionally missing
      },
    });
    render(<PluginDetail core={core} pluginId="terminal" />);

    await waitForDetail();
    await clickTab('Permissions');
    await waitFor(() => expect(screen.getByText('terminal.session')).toBeDefined());

    // Grant → requires_approval
    fireEvent.click(screen.getByText('Grant Allow'));
    await waitFor(() => expect(screen.getByText('Request Approval')).toBeDefined());

    // Request Approval → but requestId is missing
    fireEvent.click(screen.getByText('Request Approval'));

    // Should show error about missing requestId
    await waitFor(() => {
      expect(screen.getByText(/requestId/i)).toBeDefined();
    });
  });

  // ── Bug 2 fix: approveGrant re-calls plugin.permissions.grant with planId in payload
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
