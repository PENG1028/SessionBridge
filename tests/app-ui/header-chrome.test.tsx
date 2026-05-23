// ─── Header & Chrome rendering tests ──────────────────────────
// Tests header-right context controls, legacy chrome items,
// minimal header policy, command dispatch, and status bar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ─── Mock modules used by ConsoleHeader BEFORE importing it ──────

// Focus context
vi.mock('../../app/console/workbench/focus-context', () => ({
  useFocus: vi.fn(() => ({
    viewId: 'test-view',
    adapterId: 'test-adapter',
    paneViewType: 'terminal',
    isRunning: false,
    instanceId: 'inst-1',
    whenContext: { view: 'terminal', instanceStatus: 'idle' },
  })),
}));

// Runtime policy context
vi.mock('../../app/console/workbench/runtime-policy-context', () => ({
  useRuntimePolicy: vi.fn(() => ({
    activePolicy: { permissionMode: 'default', effortLevel: 'medium' },
  })),
}));

// View registry
vi.mock('../../app/console/main/view-registry', () => ({
  getAdapterMeta: vi.fn(() => ({ label: 'Test' })),
  getViewEntry: vi.fn(() => ({ meta: { title: 'Terminal' } })),
  getAdapterCapabilities: vi.fn(() => ({ modes: false })),
}));

// Workbench command dispatch — inline mock to avoid hoisting issues
vi.mock('../../app/console/actions/workbench-command-dispatch', () => ({
  runWorkbenchCommand: vi.fn(),
}));

// Action registry
vi.mock('../../app/console/actions/action-registry', () => ({
  getActions: vi.fn(() => []),
}));

// CoreClient status — ConsoleHeader uses useCoreStatus
vi.mock('../../app/console/core/core-client-provider', () => ({
  useCoreStatus: vi.fn(() => 'connected'),
}));

// ─── Now import after mocks are set up ──────────────────────────
import { ConsoleHeader } from '../../app/console/shell/console-header';
import type { ConsoleHeaderProps } from '../../app/console/shell/console-header';
import { StatusBar } from '../../app/console/shell/core-status-bar';
import { runWorkbenchCommand } from '../../app/console/actions/workbench-command-dispatch';
import {
  syncChromeContributions,
  clearChromeContributions,
  getHeaderChromeItems,
  getContextControls,
  getStatusBarChromeItems,
} from '../../app/console/chrome/chrome-registry';

const mockRunWorkbenchCommand = runWorkbenchCommand as ReturnType<typeof vi.fn>;

// ─── Helpers ────────────────────────────────────────────────────

function defaultProps(overrides?: Partial<ConsoleHeaderProps>): ConsoleHeaderProps {
  return {
    onMobileOpen: vi.fn(),
    statusColor: 'bg-green-500',
    statusText: 'Connected',
    connStatus: { status: 'connected' },
    phaseColor: 'text-purple-400 border-purple-700',
    phaseLabel: 'IDLE',
    phase: 'idle',
    currentActivity: null,
    openSearchPanel: vi.fn(),
    showDirSwitcher: false,
    onToggleDirSwitcher: vi.fn(),
    projectInfo: null,
    switchDirLocal: '',
    onSwitchDirLocalChange: vi.fn(),
    switching: false,
    onSwitchDir: vi.fn(),
    savedSessions: [],
    onSelectSavedSession: vi.fn(),
    ...overrides,
  };
}

// ─── StatusBar tests ────────────────────────────────────────────
describe('StatusBar', () => {
  beforeEach(() => {
    clearChromeContributions();
  });

  afterEach(cleanup);

  it('renders connection status label for each state', () => {
    const states = [
      { status: 'connected' as const, label: 'Core Connected' },
      { status: 'connecting' as const, label: 'Connecting...' },
      { status: 'disconnected' as const, label: 'Disconnected' },
      { status: 'error' as const, label: 'Connection Error' },
    ];

    for (const { status, label } of states) {
      const { unmount } = render(<StatusBar connectionStatus={status} />);
      expect(screen.getByText(new RegExp(label.replace(/\./g, '\\.')))).toBeTruthy();
      unmount();
    }
  });

  it('renders plugin-contributed status bar items via chrome registry', () => {
    syncChromeContributions({
      statusBar: [
        { id: 'sb-1', text: 'CPU 12%', side: 'left', group: 'system' },
        { id: 'sb-2', text: 'v1.0.0', side: 'right', group: 'info' },
      ],
    });

    render(<StatusBar connectionStatus="connected" />);

    expect(screen.getByText('CPU 12%')).toBeTruthy();
    expect(screen.getByText('v1.0.0')).toBeTruthy();
  });

  it('renders context controls with status-left / status-right placement', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'ctx-left', kind: 'button', label: 'Left CC', placement: 'status-left' },
        { id: 'ctx-right', kind: 'jump', label: 'Right CC', placement: 'status-right' },
      ],
    });

    render(<StatusBar connectionStatus="connected" />);

    expect(screen.getByText('Left CC')).toBeTruthy();
    expect(screen.getByText('Right CC')).toBeTruthy();
  });

  it('does NOT render context controls with non-status placements', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'ctx-hr', kind: 'button', label: 'Header Item', placement: 'header-right' },
        { id: 'ctx-br', kind: 'hint', label: 'Hint', placement: 'bottom-right' },
      ],
    });

    render(<StatusBar connectionStatus="connected" />);

    expect(screen.queryByText('Header Item')).toBeNull();
    expect(screen.queryByText('Hint')).toBeNull();
  });

  it('renders legacy string items alongside chrome items', () => {
    syncChromeContributions({
      statusBar: [
        { id: 'sb-chrome', text: 'Chrome Item', side: 'left' },
      ],
    });

    render(
      <StatusBar
        connectionStatus="connected"
        leftItems={['Legacy Left']}
        rightItems={['Legacy Right']}
      />
    );

    expect(screen.getByText('Chrome Item')).toBeTruthy();
    expect(screen.getByText('Legacy Left')).toBeTruthy();
    expect(screen.getByText('Legacy Right')).toBeTruthy();
  });
});

// ─── Chrome Registry tests ──────────────────────────────────────
describe('Chrome Registry', () => {
  beforeEach(() => {
    clearChromeContributions();
  });

  it('returns empty arrays before sync', () => {
    expect(getHeaderChromeItems()).toEqual([]);
    expect(getContextControls()).toEqual([]);
    expect(getStatusBarChromeItems()).toEqual([]);
  });

  it('syncChromeContributions populates all collections', () => {
    syncChromeContributions({
      header: [
        { id: 'hdr-1', title: 'Header 1', side: 'right' },
      ],
      statusBar: [
        { id: 'sb-1', text: 'SB 1' },
      ],
      contextControls: [
        { id: 'ctx-1', kind: 'button', label: 'Ctx 1', placement: 'header-right' },
      ],
      keyHints: [
        { id: 'kh-1', label: 'KH 1', keys: 'Ctrl+K' },
      ],
    });

    expect(getHeaderChromeItems()).toHaveLength(1);
    expect(getStatusBarChromeItems()).toHaveLength(1);
    expect(getContextControls()).toHaveLength(2); // 1 explicit + 1 converted from keyHint
  });

  it('keyHints are converted to context controls with kind hint and placement bottom-right', () => {
    syncChromeContributions({
      keyHints: [
        { id: 'kh-test', label: 'Test Hint', keys: 'Ctrl+T', command: 'test.cmd' },
      ],
    });

    const ccs = getContextControls();
    const hint = ccs.find(c => c.id === 'kh-test');
    expect(hint).toBeDefined();
    expect(hint?.kind).toBe('hint');
    expect(hint?.placement).toBe('bottom-right');
    expect(hint?.command).toBe('test.cmd');
  });

  it('context controls with placement header-right are filterable', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'hr-1', kind: 'button', label: 'HR 1', placement: 'header-right' },
        { id: 'br-1', kind: 'hint', label: 'BR 1', placement: 'bottom-right' },
        { id: 'sl-1', kind: 'button', label: 'SL 1', placement: 'status-left' },
      ],
    });

    const all = getContextControls();
    expect(all).toHaveLength(3);

    const headerRight = all.filter(c => c.placement === 'header-right');
    expect(headerRight).toHaveLength(1);
    expect(headerRight[0].id).toBe('hr-1');
  });

  it('clears all items on clearChromeContributions', () => {
    syncChromeContributions({
      header: [{ id: 'h1', title: 'H' }],
      statusBar: [{ id: 's1', text: 'S' }],
      contextControls: [{ id: 'c1', kind: 'button', label: 'C' }],
    });

    clearChromeContributions();
    expect(getHeaderChromeItems()).toEqual([]);
    expect(getStatusBarChromeItems()).toEqual([]);
    expect(getContextControls()).toEqual([]);
  });

  it('handles null input gracefully', () => {
    syncChromeContributions(null);
    expect(getContextControls()).toEqual([]);
  });

  it('deduplicates contextControls over legacy keyHints with same ID', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'dup', kind: 'button', label: 'From CC', placement: 'header-right' },
      ],
      keyHints: [
        { id: 'dup', label: 'From KH', keys: 'Ctrl+D', command: 'dup.cmd' },
      ],
    });

    const ccs = getContextControls();
    const dupItems = ccs.filter(c => c.id === 'dup');
    expect(dupItems).toHaveLength(1);
    // The contextControls entry takes priority (label should be 'From CC')
    expect(dupItems[0].label).toBe('From CC');
  });
});

// ─── ConsoleHeader tests ────────────────────────────────────────
describe('ConsoleHeader', () => {
  beforeEach(() => {
    clearChromeContributions();
    mockRunWorkbenchCommand.mockClear();
  });

  afterEach(cleanup);

  it('renders connection label', () => {
    render(<ConsoleHeader {...defaultProps()} />);
    // "Remote Console" appears in both mobile and desktop layouts
    const labels = screen.getAllByText('Remote Console');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders custom connection label when provided', () => {
    render(<ConsoleHeader {...defaultProps({ connectionLabel: 'My Server' })} />);
    const labels = screen.getAllByText('My Server');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders header-right context controls', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'cc-btn', kind: 'button', label: 'My Button', placement: 'header-right', command: 'test.cmd' },
        { id: 'cc-capsule', kind: 'jump', label: 'My Pill', placement: 'header-right', command: 'jump.cmd' },
      ],
    });

    render(<ConsoleHeader {...defaultProps()} />);

    expect(screen.getByText('My Button')).toBeTruthy();
    expect(screen.getByText('My Pill')).toBeTruthy();
  });

  it('renders legacy header chrome items', () => {
    syncChromeContributions({
      header: [
        { id: 'legacy-hdr', title: 'Legacy Header', text: 'LH', side: 'right', command: 'legacy.cmd' },
      ],
    });

    render(<ConsoleHeader {...defaultProps()} />);

    expect(screen.getByText('LH')).toBeTruthy();
  });

  it('fires runWorkbenchCommand when context control button is clicked', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'cc-cmd', kind: 'button', label: 'Click Me', placement: 'header-right', command: 'my.command' },
      ],
    });

    render(<ConsoleHeader {...defaultProps()} />);

    fireEvent.click(screen.getByText('Click Me'));
    expect(mockRunWorkbenchCommand).toHaveBeenCalledWith(
      { command: 'my.command' },
      expect.any(Object),
    );
  });

  it('fires runWorkbenchCommand when pill-kind context control is clicked', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'cc-toggle', kind: 'toggle', label: 'Toggle Me', placement: 'header-right', command: 'toggle.cmd' },
      ],
    });

    render(<ConsoleHeader {...defaultProps()} />);

    fireEvent.click(screen.getByText('Toggle Me'));
    expect(mockRunWorkbenchCommand).toHaveBeenCalledWith(
      { command: 'toggle.cmd' },
      expect.any(Object),
    );
  });

  it('does NOT crash when context control has no command', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'cc-nocmd', kind: 'button', label: 'No Command', placement: 'header-right' },
      ],
    });

    // Should render without error
    const { container } = render(<ConsoleHeader {...defaultProps()} />);
    expect(screen.getByText('No Command')).toBeTruthy();

    // Clicking should not throw
    expect(() => fireEvent.click(screen.getByText('No Command'))).not.toThrow();
    // runWorkbenchCommand should NOT have been called for this item
    expect(mockRunWorkbenchCommand).not.toHaveBeenCalled();
  });

  it('renders no-context-control items as disabled/non-interactive', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'cc-nocmd-pill', kind: 'jump', label: 'No Cmd Pill', placement: 'header-right' },
      ],
    });

    render(<ConsoleHeader {...defaultProps()} />);

    const el = screen.getByText('No Cmd Pill');
    // Non-command items with non-button kind don't get a button role
    expect(el.closest('[role="button"]')).toBeNull();
  });

  it('minimal header hides non-essential contributions', () => {
    syncChromeContributions({
      contextControls: [
        { id: 'cc-visible', kind: 'button', label: 'Visible', placement: 'header-right' },
      ],
      header: [
        { id: 'legacy-hdr', title: 'Legacy', side: 'right' },
      ],
    });

    render(<ConsoleHeader {...defaultProps({ chromePolicy: { header: 'minimal', statusBar: 'auto', commandPalette: true, globalShortcuts: true } })} />);

    // Context controls should NOT render in minimal mode
    expect(screen.queryByText('Visible')).toBeNull();
    // Legacy header chrome items should NOT render in minimal mode
    expect(screen.queryByText('Legacy')).toBeNull();
    // But connection label should still be there
    const labels = screen.getAllByText('Remote Console');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it('hidden header policy returns null', () => {
    const { container } = render(
      <ConsoleHeader {...defaultProps({ chromePolicy: { header: 'hidden', statusBar: 'auto', commandPalette: true, globalShortcuts: true } })} />
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders multiple categories of header-right content simultaneously', () => {
    // Populate all three slot mechanisms
    syncChromeContributions({
      header: [
        { id: 'legacy-1', title: 'Legacy Item', text: 'LI', side: 'right' },
      ],
      contextControls: [
        { id: 'ctx-1', kind: 'button', label: 'Ctx Item', placement: 'header-right' },
      ],
    });

    render(<ConsoleHeader {...defaultProps()} />);

    expect(screen.getByText('LI')).toBeTruthy();   // legacy chrome
    expect(screen.getByText('Ctx Item')).toBeTruthy(); // context control
  });
});
