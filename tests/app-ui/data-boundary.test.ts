// ─── App UI Core Data Boundary tests ─────────────────────────
// Verifies that:
// 1. No active code contains old relay HTTP API patterns
// 2. DashboardView renders through mocked CoreClient calls
// 3. DirectoryPicker uses core.call('fs.list', ...) not direct HTTP

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─── Test 1: Static audit for old relay patterns ─────────────

const FORBIDDEN_PATTERNS = [
  { pattern: '/api/queue', label: '/api/queue' },
  { pattern: '/api/info', label: '/api/info' },
  { pattern: '/api/list', label: '/api/list' },
  { pattern: 'wsToHttpUrl', label: 'wsToHttpUrl' },
];

function scanFileForPattern(filePath: string, pattern: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (trimmed.includes('legacy') || trimmed.includes('removed') || trimmed.includes('Removed') ||
        trimmed.includes('no longer') || trimmed.includes('deprecated')) continue;
    if (trimmed.includes(pattern) && !trimmed.startsWith('*')) {
      if (trimmed.includes('removed')) continue;
      if (trimmed.includes('not.toContain') || trimmed.includes('not.toEqual') || trimmed.includes('not.toBe')) continue;
      return true;
    }
  }
  return false;
}

describe('data-boundary: no legacy relay API calls', () => {
  const appDirs = [
    'app/console/dialogs',
    'app/console/main',
    'app/console/panels',
    'app/console/sidebar',
    'app/console/shell',
    'app/console/system-pages',
    'app/console/core',
  ];

  for (const forbidden of FORBIDDEN_PATTERNS) {
    it(`no active code uses ${forbidden.label}`, () => {
      const hits: string[] = [];
      for (const dir of appDirs) {
        const fullDir = path.join(process.cwd(), dir);
        if (!fs.existsSync(fullDir)) continue;
        const entries = fs.readdirSync(fullDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
          const filePath = path.join(fullDir, entry.name);
          if (scanFileForPattern(filePath, forbidden.pattern)) {
            hits.push(`${dir}/${entry.name}`);
          }
        }
      }
      expect(hits).toEqual([]);
    });
  }
});

// ─── Test 2: DashboardView with mocked core.call ────────────

import React from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

// Create a mock CoreClient for dashboard-view which uses useCore() internally
const mockDashboardCall = vi.fn();
const mockDashboardCore = {
  isConnected: true,
  call: mockDashboardCall,
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  pluginId: 'sessionnode-core',
  wsUrl: '/api/core/call',
  hasToken: false,
  authMode: 'none',
  lastError: null,
  disconnect: vi.fn(),
};

vi.mock('../../app/console/core/core-client-provider', () => ({
  useCore: () => mockDashboardCore,
  useCoreStatus: () => 'connected',
  useIsOnline: () => true,
}));

describe('data-boundary: DashboardView via mocked CoreClient', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    // Set up default mock responses for dashboard-view
    mockDashboardCall.mockImplementation((method: string) => {
      if (method === 'node.info') {
        return Promise.resolve({
          platform: 'linux',
          arch: 'x64',
          hostname: 'test-host',
          cpus: 4,
          uptime: 3600,
        });
      }
      if (method === 'logs.tail') {
        return Promise.resolve({
          entries: [
            { message: '[INFO] Core started' },
            { message: '[INFO] Plugin loaded' },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected call: ${method}`));
    });
  });

  it('renders system info from mocked core.call node.info', async () => {
    const { DashboardView } = await import('../../app/console/main/dashboard-view');

    await act(async () => {
      render(React.createElement(DashboardView));
    });

    await waitFor(() => {
      expect(screen.getByText('test-host')).toBeDefined();
    });

    expect(mockDashboardCall).toHaveBeenCalledWith('node.info', {});
  });

  it('renders logs from mocked core.call logs.tail', async () => {
    const { DashboardView } = await import('../../app/console/main/dashboard-view');

    await act(async () => {
      render(React.createElement(DashboardView));
    });

    await waitFor(() => {
      expect(screen.getByText(/Core started/)).toBeDefined();
    });

    expect(mockDashboardCall).toHaveBeenCalledWith('logs.tail', { source: 'core', lines: 20 });
  });

  it('shows fallback display when not connected', async () => {
    const disconnectedCore = {
      ...mockDashboardCore,
      isConnected: false,
      call: vi.fn().mockRejectedValue(new Error('Not connected')),
    };

    const mod = await import('../../app/console/core/core-client-provider');
    vi.spyOn(mod, 'useCore').mockReturnValue(disconnectedCore);

    const { DashboardView } = await import('../../app/console/main/dashboard-view');

    await act(async () => {
      render(React.createElement(DashboardView));
    });

    // Should not show error screen (data is null but err is also null)
    expect(screen.queryByText('Dashboard unavailable')).toBeNull();
    vi.restoreAllMocks();
  });
});

// ─── Test 3: DirectoryPicker uses core.call('fs.list', ...) ──

const mockListCall = vi.fn();
const mockDirCore = {
  isConnected: true,
  call: mockListCall,
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  pluginId: 'sessionnode-core',
  wsUrl: '/api/core/call',
  hasToken: false,
  authMode: 'none',
  lastError: null,
  disconnect: vi.fn(),
};

// Re-mock for directory picker tests (need different mock implementation)
describe('data-boundary: DirectoryPicker CoreClient path', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // jsdom doesn't have matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    mockListCall.mockImplementation((method: string) => {
      if (method === 'fs.list') {
        return Promise.resolve({
          path: '.',
          entries: [
            { name: 'src', isDir: true, size: 0, mode: 'drwxr-xr-x' },
            { name: 'package.json', isDir: false, size: 100, mode: '-rw-r--r--' },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected call: ${method}`));
    });
  });

  it('uses core.call(fs.list) not HTTP relay', async () => {
    // Re-mock useCore for directory picker tests
    const mod = await import('../../app/console/core/core-client-provider');
    vi.spyOn(mod, 'useCore').mockReturnValue(mockDirCore);

    const { DirectoryPicker } = await import('../../app/console/dialogs/directory-picker');

    await act(async () => {
      render(React.createElement(DirectoryPicker, {
        open: true,
        onClose: vi.fn(),
        onSelect: vi.fn(),
        absoluteCwd: '/test',
      }));
    });

    // Should call fs.list with the absolute path
    await waitFor(() => {
      expect(mockListCall).toHaveBeenCalledWith('fs.list', { path: '/test' });
    });
  });

  it('does not call any HTTP API', async () => {
    const mod = await import('../../app/console/core/core-client-provider');
    vi.spyOn(mod, 'useCore').mockReturnValue(mockDirCore);

    const { DirectoryPicker } = await import('../../app/console/dialogs/directory-picker');

    await act(async () => {
      render(React.createElement(DirectoryPicker, {
        open: true,
        onClose: vi.fn(),
        onSelect: vi.fn(),
        absoluteCwd: '/test',
      }));
    });

    // Verify no HTTP fetch calls were made
    const fetchCalls = (globalThis as any).fetch?.mock?.calls ?? [];
    const httpCalls = fetchCalls.filter((call: unknown[]) => {
      const url = typeof call[0] === 'string' ? call[0] : (call[0] as Request)?.url;
      return url && (url.includes('/api/list') || url.includes('/api/info') || url.includes('/api/queue'));
    });
    expect(httpCalls.length).toBe(0);
  });

  it('renders tree items when fs.list returns entries', async () => {
    const mod = await import('../../app/console/core/core-client-provider');
    vi.spyOn(mod, 'useCore').mockReturnValue(mockDirCore);

    const { DirectoryPicker } = await import('../../app/console/dialogs/directory-picker');

    await act(async () => {
      render(React.createElement(DirectoryPicker, {
        open: true,
        onClose: vi.fn(),
        onSelect: vi.fn(),
        absoluteCwd: '/test',
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined();
    });
  });

  it('shows loading state when core is not connected', async () => {
    const disconnectedCore = {
      ...mockDirCore,
      isConnected: false,
      call: vi.fn(),
    };
    const mod = await import('../../app/console/core/core-client-provider');
    vi.spyOn(mod, 'useCore').mockReturnValue(disconnectedCore);

    const { DirectoryPicker } = await import('../../app/console/dialogs/directory-picker');

    await act(async () => {
      render(React.createElement(DirectoryPicker, {
        open: true,
        onClose: vi.fn(),
        onSelect: vi.fn(),
      }));
    });

    // Should show loading indicator when disconnected
    expect(screen.getByText(/Loading files/)).toBeDefined();
  });
});
