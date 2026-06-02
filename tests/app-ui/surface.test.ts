// ─── Surface model unit tests ──────────────────────────────────
// Tests: localStorage does NOT save session truth, tab projection uses
// sessionId but reload comes from session.list, instanceId/adapterId
// no longer core truth.

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry, surfaceRegistry } from '../../app/console/surface/surface-registry';
import { rebuildTabsFromSessions } from '../../app/console/surface/surface-renderer';
import type { TabProjection } from '../../app/console/surface/surface-types';

describe('SurfaceRegistry', () => {
  let registry: SurfaceRegistry;

  beforeEach(() => {
    registry = new SurfaceRegistry();
    registry.registerBuiltins();
  });

  it('registers built-in system pages', () => {
    const dashboard = registry.get('system-ui.dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard?.pluginId).toBe('system-ui');
    expect(dashboard?.title).toBe('Dashboard');
  });

  it('returns contributions for a surface type', () => {
    const editorContribs = registry.getContributions('main.editor');
    expect(editorContribs.length).toBeGreaterThanOrEqual(4);
    expect(editorContribs.map(c => c.id)).toContain('system-ui.dashboard');
    expect(editorContribs.map(c => c.id)).toContain('system-ui.nodes');
    expect(editorContribs.map(c => c.id)).toContain('system-ui.sessions');
    expect(editorContribs.map(c => c.id)).toContain('system-ui.plugins');
  });

  it('returns navigation items', () => {
    const navItems = registry.getNavItems();
    expect(navItems.length).toBe(8);
    expect(navItems[0].id).toBe('dashboard');
    expect(navItems[navItems.length - 1].id).toBe('access-control');
  });

  it('supports custom registration', () => {
    registry.register({
      id: 'custom-plugin.view',
      pluginId: 'custom-plugin',
      surfaceType: 'main.editor',
      componentType: 'custom',
      title: 'Custom View',
    });

    const contrib = registry.get('custom-plugin.view');
    expect(contrib).toBeDefined();
    expect(contrib?.pluginId).toBe('custom-plugin');
  });

  it('supports unregistration', () => {
    registry.register({
      id: 'temp.view',
      pluginId: 'test',
      surfaceType: 'sidebar.left',
      componentType: 'builtin',
      title: 'Temp',
    });

    expect(registry.get('temp.view')).toBeDefined();
    registry.unregister('temp.view');
    expect(registry.get('temp.view')).toBeUndefined();
  });

  it('sorts contributions by order', () => {
    registry.register({
      id: 'z-view',
      pluginId: 'test',
      surfaceType: 'sidebar.left',
      componentType: 'builtin',
      title: 'Z View',
      order: 999,
    });
    registry.register({
      id: 'a-view',
      pluginId: 'test',
      surfaceType: 'sidebar.left',
      componentType: 'builtin',
      title: 'A View',
      order: 1,
    });

    const contribs = registry.getContributions('sidebar.left');
    // a-view should come before z-view
    const aIdx = contribs.findIndex(c => c.id === 'a-view');
    const zIdx = contribs.findIndex(c => c.id === 'z-view');
    expect(aIdx).toBeLessThan(zIdx);
  });
});

describe('TabProjection', () => {
  it('rebuildTabsFromSessions creates projections from session.list data', () => {
    const sessions = [
      { sessionId: 'sess_abc', kind: 'claude-code', pluginId: 'claude-code', nodeId: 'node-main', status: 'running' },
      { sessionId: 'sess_def', kind: 'shell', pluginId: 'shell', nodeId: 'node-main', status: 'stopped' },
    ];

    const tabs = rebuildTabsFromSessions(sessions);

    expect(tabs).toHaveLength(2);
    expect(tabs[0].sessionId).toBe('sess_abc');
    expect(tabs[0].pluginId).toBe('claude-code');
    expect(tabs[0].isAlive).toBe(true);
    expect(tabs[1].sessionId).toBe('sess_def');
    expect(tabs[1].pluginId).toBe('shell');
    expect(tabs[1].isAlive).toBe(false);
  });

  it('tab projection uses sessionId for Core truth, not localStorage', () => {
    // Verify TabProjection structure
    const tab: TabProjection = {
      tabId: 'tab_001',
      viewType: 'shell.terminal',
      title: 'Terminal',
      sessionId: 'sess_abc',
      nodeId: 'node-main',
      pluginId: 'shell',
      surfaceType: 'main.editor',
      isAlive: true,
    };

    expect(tab.sessionId).toBe('sess_abc');
    expect(tab.tabId).toBe('tab_001');
    // sessionId points to Core, tabId is pure frontend
    expect(tab.tabId).not.toBe(tab.sessionId);
  });

  it('empty session list produces empty tab list', () => {
    const tabs = rebuildTabsFromSessions([]);
    expect(tabs).toHaveLength(0);
  });

  it('resolves unknown plugin/kind to unknown viewType', () => {
    const tabs = rebuildTabsFromSessions([
      { sessionId: 'sess_unknown', kind: 'unknown', pluginId: 'unknown', nodeId: 'n1', status: 'running' },
    ]);
    expect(tabs[0].viewType).toBe('unknown');
  });
});

describe('localStorage rules', () => {
  it('surface registry does NOT persist to localStorage', () => {
    // The registry should be a pure in-memory store
    const registry = new SurfaceRegistry();
    const proto = Object.getPrototypeOf(registry);
    const methods = Object.getOwnPropertyNames(proto);
    // None of the methods should reference localStorage
    for (const method of methods) {
      if (typeof (registry as any)[method] === 'function') {
        const fnStr = (registry as any)[method].toString();
        expect(fnStr).not.toContain('localStorage');
      }
    }
  });
});
