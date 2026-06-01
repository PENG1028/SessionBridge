// ─── Protocol Type Consistency Tests ──────────────────────────────
// Smoke tests that verify frontend TypeScript types and normalizers
// are compatible with the data shapes returned by Go Core.
//
// When Go Core changes a capability's return shape, one of these tests
// should break, alerting the developer to update the frontend types.
//
// Normalizer tests use mock raw data that mirrors real Go Core output.
// If Go Core adds/changes a field, update the mock here AND the types
// in app/console/core/core-types.ts (and normalizer if applicable).

import { describe, it, expect } from 'vitest';

// ─── normalizer imports ──────────────────────────────────────────
import { normalizeNodeInfo, normalizeSessionInfo, listFromResponse } from '../../app/console/core/core-response-utils';
import type { NodeInfo, SessionInfo } from '../../app/console/core/core-types';

// ─── mapper imports ──────────────────────────────────────────────
import { mapPanelsToSidebarViews, mapStatusToChrome, mapViewsToAdapterViews } from '../../app/console/core/manifest-mapper';

// ====================================================================
// 1. normalizeNodeInfo — matches Go Core's node.info response shape
// ====================================================================
describe('core-types-sync: normalizeNodeInfo', () => {
  it('handles Go Core style node.info shape', () => {
    // Go Core node.info returns fields like: nodeId, name, status, version, os, arch, cwd, projectName, homeDir
    const raw: Record<string, unknown> = {
      nodeId: 'node_abc123',
      name: 'test-node',
      status: 'online',
      version: '0.3.0',
      os: 'linux',
      arch: 'x64',
      cwd: '/home/user/project',
      projectName: 'sessionbridge',
    };
    const result: NodeInfo = normalizeNodeInfo(raw);
    expect(result.nodeId).toBe('node_abc123');
    expect(result.name).toBe('test-node');
    expect(result.status).toBe('online');
    expect(result.version).toBe('0.3.0');
    expect(result.os).toBe('linux');
    expect(result.arch).toBe('x64');
  });

  it('handles minimal node.info with only nodeId', () => {
    const raw: Record<string, unknown> = { nodeId: 'local' };
    const result: NodeInfo = normalizeNodeInfo(raw);
    expect(result.nodeId).toBe('local');
    expect(result.status).toBe('offline'); // default from normalizeNodeStatus
  });

  it('handles alternate status values from Go Core', () => {
    for (const status of ['online', 'connected', 'connecting', 'error', 'revoked', 'offline', 'disconnected']) {
      const raw = { nodeId: 'n', status };
      const result = normalizeNodeInfo(raw);
      expect(result.nodeId).toBe('n');
      // Should not throw for any status value
    }
  });
});

// ====================================================================
// 2. normalizeSessionInfo — matches Go Core's session.created shape
// ====================================================================
describe('core-types-sync: normalizeSessionInfo', () => {
  it('handles Go Core style session data', () => {
    // Go Core session.created event carries: sessionId, kind, pluginId, state
    const raw: Record<string, unknown> = {
      sessionId: 'sess_001',
      kind: 'terminal',
      pluginId: 'terminal',
      state: 'running',
      command: 'bash',
      cwd: '/home/user',
    };
    const result: SessionInfo = normalizeSessionInfo(raw);
    expect(result.sessionId).toBe('sess_001');
    expect(result.kind).toBe('terminal');
    expect(result.status).toBe('running');
  });

  it('handles minimal session data', () => {
    const raw: Record<string, unknown> = { sessionId: '', kind: '' };
    const result = normalizeSessionInfo(raw);
    expect(result.sessionId).toBe('');
    expect(result.status).toBe('stopped');
  });
});

// ====================================================================
// 3. Go Core plugin manifest adapters.system-ui → frontend mappers
// ====================================================================
describe('core-types-sync: manifest mapper from Go Core shape', () => {
  it('mapPanelsToSidebarViews handles Go Core plugin system-ui panels', () => {
    // Go Core plugin.get returns adapters.system-ui.panels as an array of
    // { id, surface, type, entry?, componentId?, title? }
    const goCorePanels = [
      { id: 'files-panel', surface: 'left', type: 'component', componentId: 'files-component', title: 'Files' },
      { id: 'bookmarks-panel', surface: 'right', type: 'component', componentId: 'bookmarks-component', title: 'Bookmarks' },
      { id: 'bottom-panel', surface: 'panel.bottom', type: 'hosted', entry: '/bottom' },
    ];
    const result = mapPanelsToSidebarViews(goCorePanels);
    expect(result['sidebar-left']).toHaveLength(1);
    expect(result['sidebar-left'][0].id).toBe('files-panel');
    expect(result['sidebar-right']).toHaveLength(1);
    expect(result['sidebar-right'][0].id).toBe('bookmarks-panel');
    // panel.bottom panels are excluded from sidebar maps
  });

  it('mapStatusToChrome handles Go Core system-ui status items', () => {
    // Go Core plugin.get returns adapters.system-ui.status as an array of
    // { id, label, icon?, command? }
    const goCoreStatus = [
      { id: 'cpu-meter', label: 'CPU: 23%', icon: 'cpu' },
      { id: 'mem-meter', label: 'MEM: 4.2G', command: 'mem.show' },
    ];
    const result = mapStatusToChrome(goCoreStatus);
    expect(result.statusBar).toHaveLength(2);
    expect(result.statusBar![0].id).toBe('cpu-meter');
    expect(result.statusBar![0].text).toBe('CPU: 23%');
    expect(result.statusBar![1].command).toBe('mem.show');
  });

  it('mapViewsToAdapterViews handles Go Core system-ui views', () => {
    // Go Core plugin.get returns adapters.system-ui.views as an array of
    // { id, surface, type, entry?, componentId?, title?, icon? }
    const goCoreViews = [
      { id: 'terminal-view', surface: 'terminal.surface', type: 'host-rendered' },
      { id: 'system-info-view', surface: 'system-info.surface', type: 'custom-react', componentId: 'sysinfo' },
    ];
    const result = mapViewsToAdapterViews(goCoreViews);
    expect(result['terminal-view']).toBe('terminal.surface');
    expect(result['system-info-view']).toBe('system-info.surface');
  });

  it('handles undefined/empty plugin sections gracefully', () => {
    expect(mapPanelsToSidebarViews(undefined)).toEqual({});
    expect(mapStatusToChrome(undefined)).toEqual({});
    expect(mapViewsToAdapterViews(undefined)).toEqual({});
    expect(mapPanelsToSidebarViews([])).toEqual({});
    expect(mapStatusToChrome([])).toEqual({});
  });
});

// ====================================================================
// 4. listFromResponse — handles Go Core's varying list response shapes
// ====================================================================
describe('core-types-sync: listFromResponse handles Go Core shapes', () => {
  it('handles direct array (plugin.list returns array of plugins)', () => {
    const result = listFromResponse([{ pluginId: 'core' }, { pluginId: 'terminal' }], 'plugins');
    expect(result).toHaveLength(2);
  });

  it('handles wrapped object (some responses use { plugins: [...] })', () => {
    const result = listFromResponse({ plugins: [{ pluginId: 'core' }] }, 'plugins');
    expect(result).toHaveLength(1);
  });

  it('returns empty array for unrecognised shapes', () => {
    expect(listFromResponse(null, 'items')).toEqual([]);
    expect(listFromResponse(undefined, 'items')).toEqual([]);
    expect(listFromResponse('not an array', 'items')).toEqual([]);
  });
});
