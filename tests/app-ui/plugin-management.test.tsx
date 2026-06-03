// ─── Plugin Management tests ───────────────────────────────────
// Tests for AppManager, DependencyPanel, and PermissionPanel
// in plugins/plugin-manager/.
//
// Uses module-level vi.mock for app-registry and core-client-provider,
// following patterns established in page-smoke.test.tsx,
// header-chrome.test.tsx, and data-boundary.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────

const mockCoreStatus = vi.fn(() => 'connected');
vi.mock('../../app/console/core/core-client-provider', () => ({
  useCoreStatus: () => mockCoreStatus(),
  useCore: () => mockCore,
}));

const mockCore = {
  call: vi.fn(),
  isConnected: true,
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  disconnect: vi.fn(),
  pluginId: 'test-core',
  wsUrl: 'ws://localhost:9090/ws',
  hasToken: false,
  authMode: 'none' as const,
  lastError: null,
};

const mockLoadApps = vi.fn();
const mockIsEnabled = vi.fn();
const mockSetEnabled = vi.fn();
const mockGetLoadError = vi.fn();
const mockGetGrant = vi.fn();
const mockSetGrant = vi.fn();
vi.mock('../../app/lib/app-registry/app-registry', () => ({
  loadApps: (...args: any[]) => mockLoadApps(...args),
  isEnabled: (...args: any[]) => mockIsEnabled(...args),
  setEnabled: (...args: any[]) => mockSetEnabled(...args),
  getLoadError: (...args: any[]) => mockGetLoadError(...args),
  getGrant: (...args: any[]) => mockGetGrant(...args),
  setGrant: (...args: any[]) => mockSetGrant(...args),
}));

const mockRunChecks = vi.fn();
vi.mock('../../app/lib/use-dependency-check', () => ({
  useDependencyCheck: () => ({
    results: mockResults,
    loading: mockDepLoading,
    error: mockDepError,
    runChecks: mockRunChecks,
  }),
}));

let mockResults: any[] = [];
let mockDepLoading = false;
let mockDepError: string | null = null;

// ─── SUT imports (must be after mocks) ─────────────────────────

import { AppManager } from '../../plugins/plugin-manager/index';
import { DependencyPanel } from '../../plugins/plugin-manager/dependency-panel';
import { PermissionPanel } from '../../plugins/plugin-manager/permission-panel';
import type { AppSummary, CheckResult, AppPermissionSpec } from '../../app/lib/app-registry/app-types';

// ─── Test data ─────────────────────────────────────────────────

function makeAppSummary(overrides: Partial<AppSummary> = {}): AppSummary {
  return {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    type: 'plugin',
    trusted: false,
    description: 'A test plugin',
    capabilities: ['fs.read', 'fs.write'],
    ...overrides,
  };
}

function makeCheckResult(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    id: 'node',
    type: 'env',
    command: 'node',
    found: true,
    required: true,
    installHint: undefined,
    ...overrides,
  };
}

function makePermissionSpec(overrides: Partial<AppPermissionSpec> = {}): AppPermissionSpec {
  return {
    id: 'test.perm',
    description: 'Test permission',
    capabilities: ['fs.read', 'fs.write'],
    default: 'ask',
    ...overrides,
  };
}

// ─── Tests: AppManager ─────────────────────────────────────────

describe('AppManager', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockCoreStatus.mockReturnValue('connected');
  });

  it('shows loading spinner on mount', () => {
    // Never resolve the promise
    mockLoadApps.mockReturnValue(new Promise(() => {}));
    render(<AppManager />);
    // Should show the spinner (RefreshCw with animate-spin class)
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });

  it('renders list of apps after loading', async () => {
    mockLoadApps.mockResolvedValue([
      makeAppSummary({ id: 'app1', name: 'App One' }),
      makeAppSummary({ id: 'app2', name: 'App Two', trusted: true }),
    ]);
    mockIsEnabled.mockReturnValue(true);

    render(<AppManager />);

    await waitFor(() => {
      expect(screen.getByText('App One')).toBeDefined();
    });
    expect(screen.getByText('App Two')).toBeDefined();
    expect(screen.getByText('trusted')).toBeDefined();

    // Verify app count in header
    expect(screen.getByText('(2)')).toBeDefined();
  });

  it('shows error state when loadApps fails', async () => {
    mockLoadApps.mockRejectedValue(new Error('Network error'));
    render(<AppManager />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load apps')).toBeDefined();
    });
  });

  it('shows empty state when no apps found', async () => {
    mockLoadApps.mockResolvedValue([]);
    mockGetLoadError.mockReturnValue(null);
    render(<AppManager />);

    await waitFor(() => {
      expect(screen.getByText(/No plugins found/)).toBeDefined();
    });
  });

  it('shows core-disconnected message when status is not connected', async () => {
    mockLoadApps.mockResolvedValue([]);
    mockCoreStatus.mockReturnValue('disconnected');
    render(<AppManager />);

    await waitFor(() => {
      expect(screen.getByText(/Core is not connected/)).toBeDefined();
    });
  });

  it('shows load error in empty state when getLoadError is set', async () => {
    mockLoadApps.mockResolvedValue([]);
    mockGetLoadError.mockReturnValue('Manifest parse error');
    render(<AppManager />);

    await waitFor(() => {
      expect(screen.getByText(/Manifest parse error/)).toBeDefined();
    });
  });

  it('toggles app enabled state on button click', async () => {
    mockLoadApps.mockResolvedValue([makeAppSummary()]);
    mockIsEnabled.mockReturnValue(false);
    mockSetEnabled.mockResolvedValue(undefined);
    // refresh() will be called again after toggle
    mockLoadApps.mockResolvedValue([makeAppSummary()]);

    render(<AppManager />);

    await waitFor(() => {
      expect(screen.getByText('Test App')).toBeDefined();
    });

    // Button should say "Disabled" when not enabled
    const toggleBtn = screen.getByText('Disabled');
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(mockSetEnabled).toHaveBeenCalledWith('test-app', true);
    });
  });

  it('displays capabilities with +N overflow', async () => {
    mockLoadApps.mockResolvedValue([
      makeAppSummary({
        capabilities: ['fs.read', 'fs.write', 'fs.list', 'fs.mkdir', 'fs.remove'],
      }),
    ]);
    mockIsEnabled.mockReturnValue(true);

    render(<AppManager />);

    await waitFor(() => {
      expect(screen.getByText('fs.read')).toBeDefined();
    });
    expect(screen.getByText('+2')).toBeDefined();
  });
});

// ─── Tests: PermissionPanel ────────────────────────────────────

describe('PermissionPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockGetGrant.mockReturnValue('ask');
  });

  it('shows empty state when permissions array is empty', () => {
    render(<PermissionPanel appId="test" permissions={[]} />);
    expect(screen.getByText('No permissions declared.')).toBeDefined();
  });

  it('renders permission groups with capabilities', () => {
    const perms = [makePermissionSpec()];
    render(<PermissionPanel appId="test" permissions={perms} />);

    expect(screen.getByText('test.perm')).toBeDefined();
    expect(screen.getByText('Test permission')).toBeDefined();
    expect(screen.getByText('fs.read')).toBeDefined();
    expect(screen.getByText('fs.write')).toBeDefined();
  });

  it('displays default grant mode when no stored grant exists', () => {
    // Simulate no stored grant — getGrant returns empty string
    mockGetGrant.mockReturnValue('');
    const perms = [
      makePermissionSpec({ capabilities: ['fs.read'], default: 'deny' }),
    ];
    render(<PermissionPanel appId="test" permissions={perms} />);

    // Button should show the spec's default since no grant is stored
    expect(screen.getByText('deny')).toBeDefined();
  });

  it('cycles grant mode on toggle click', async () => {
    mockGetGrant.mockReturnValue('allow');
    mockSetGrant.mockResolvedValue(undefined);
    const perms = [makePermissionSpec({ capabilities: ['fs.read'] })];

    render(<PermissionPanel appId="test" permissions={perms} />);

    const btn = screen.getByText('allow');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockSetGrant).toHaveBeenCalledWith('test', 'fs.read', 'ask');
    });
  });

  it('disables toggle button while loading', async () => {
    mockGetGrant.mockReturnValue('allow');
    // Don't resolve setGrant to keep loading true
    mockSetGrant.mockReturnValue(new Promise(() => {}));
    const perms = [makePermissionSpec({ capabilities: ['fs.read'] })];

    render(<PermissionPanel appId="test" permissions={perms} />);

    const btn = screen.getByText('allow');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(btn.getAttribute('disabled')).toBe('');
    });
  });
});

// ─── Tests: DependencyPanel ────────────────────────────────────

describe('DependencyPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockResults = [];
    mockDepLoading = false;
    mockDepError = null;
    mockCore.call.mockReset();
    globalThis.fetch = vi.fn();
  });

  it('shows "Not checked" state initially', () => {
    render(<DependencyPanel appId="test" />);
    expect(screen.getByText('Not checked')).toBeDefined();
  });

  it('shows Check button in idle state', () => {
    render(<DependencyPanel appId="test" />);
    expect(screen.getByText('Check')).toBeDefined();
  });

  it('displays check results summary', () => {
    mockResults = [
      makeCheckResult({ id: 'node', command: 'node', found: true }),
      makeCheckResult({ id: 'npm', command: 'npm', found: false, required: true }),
    ];
    render(<DependencyPanel appId="test" />);
    expect(screen.getByText('1/2 passed')).toBeDefined();
  });

  it('shows check error message', () => {
    mockDepError = 'Failed to fetch environment checks';
    render(<DependencyPanel appId="test" />);
    expect(screen.getByText('Failed to fetch environment checks')).toBeDefined();
  });

  it('shows empty/no-dependencies message when no results and no error', () => {
    render(<DependencyPanel appId="test" />);
    expect(screen.getByText(/No dependencies declared/)).toBeDefined();
  });

  it('displays blockedBy message', () => {
    mockResults = [
      makeCheckResult({
        id: 'npx',
        command: 'npx',
        found: false,
        blockedBy: 'node',
      }),
    ];
    render(<DependencyPanel appId="test" />);
    expect(screen.getByText(/blocked by: node/)).toBeDefined();
  });

  it('shows Install button for missing deps with installHint', () => {
    mockResults = [
      makeCheckResult({
        id: 'node',
        command: 'node',
        found: false,
        installHint: 'brew install node',
        required: true,
      }),
    ];
    render(<DependencyPanel appId="test" />);
    expect(screen.getByText('Install')).toBeDefined();
  });

  it('calls runChecks on Check button click', async () => {
    mockRunChecks.mockResolvedValue([]);
    render(<DependencyPanel appId="test" />);

    const checkBtn = screen.getByText('Check');
    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(mockRunChecks).toHaveBeenCalledWith('test');
    });
  });
});
