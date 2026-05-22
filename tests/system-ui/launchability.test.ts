'use client';

import { describe, it, expect } from 'vitest';
import { isViewLaunchable, filterLaunchableViews, firstLaunchableViewId, hasLaunchableViewForPlugin } from '../../app/console/plugin-host/launchability';

// ─── isViewLaunchable unit tests ─────────────────────────────────

describe('isViewLaunchable', () => {
  // ── Direct-launchable views (should be launchable) ──────────

  it('returns true for launchable:true + launchMode:direct on main.editor', () => {
    expect(isViewLaunchable({ launchable: true, launchMode: 'direct', viewType: 'main.editor' })).toBe(true);
  });

  it('returns true for launchable:true on main.editor (no launchMode)', () => {
    expect(isViewLaunchable({ launchable: true, viewType: 'main.editor' })).toBe(true);
  });

  it('returns true for launchMode:direct on main.editor (no launchable flag)', () => {
    expect(isViewLaunchable({ launchMode: 'direct', viewType: 'main.editor' })).toBe(true);
  });

  it('returns true when viewType is undefined and launchable:true (backward compat)', () => {
    expect(isViewLaunchable({ launchable: true })).toBe(true);
  });

  it('returns true when viewType is undefined and launchMode:direct (backward compat)', () => {
    expect(isViewLaunchable({ launchMode: 'direct' })).toBe(true);
  });

  // ── Panel-only views (should NOT be launchable) ─────────────

  it('returns false for launchable:true + launchMode:direct on panel.bottom', () => {
    expect(isViewLaunchable({ launchable: true, launchMode: 'direct', viewType: 'panel.bottom' })).toBe(false);
  });

  it('returns false for panel.bottom even with explicit launchability', () => {
    expect(isViewLaunchable({ launchable: true, viewType: 'panel.bottom' })).toBe(false);
  });

  it('returns false for sidebar.left view type', () => {
    expect(isViewLaunchable({ launchable: true, launchMode: 'direct', viewType: 'sidebar.left' })).toBe(false);
  });

  it('returns false for statusBar.left view type', () => {
    expect(isViewLaunchable({ launchable: true, launchMode: 'direct', viewType: 'statusBar.left' })).toBe(false);
  });

  // ── Adapter-only mapping views (should NOT be launchable) ───

  it('returns false when no launchable flag and no launchMode (adapter-only)', () => {
    expect(isViewLaunchable({ viewType: 'main.editor' })).toBe(false);
  });

  it('returns false when launchable:false despite main.editor', () => {
    expect(isViewLaunchable({ launchable: false, viewType: 'main.editor' })).toBe(false);
  });

  // ── hidden launchMode (should never be launchable) ──────────

  it('returns false for launchMode:hidden even with launchable:true', () => {
    expect(isViewLaunchable({ launchable: true, launchMode: 'hidden', viewType: 'main.editor' })).toBe(false);
  });

  it('returns false for launchMode:hidden alone', () => {
    expect(isViewLaunchable({ launchMode: 'hidden', viewType: 'main.editor' })).toBe(false);
  });

  // ── runtime launchMode (should never be launchable) ─────────

  it('returns false for launchMode:runtime even with launchable:true', () => {
    expect(isViewLaunchable({ launchable: true, launchMode: 'runtime', viewType: 'main.editor' })).toBe(false);
  });

  it('returns false for launchMode:runtime alone', () => {
    expect(isViewLaunchable({ launchMode: 'runtime', viewType: 'main.editor' })).toBe(false);
  });

  // ── session launchMode (should never be launchable) ──────────

  it('returns false for launchMode:session even with launchable:true', () => {
    expect(isViewLaunchable({ launchable: true, launchMode: 'session', viewType: 'main.editor' })).toBe(false);
  });

  it('returns false for launchMode:session alone', () => {
    expect(isViewLaunchable({ launchMode: 'session', viewType: 'main.editor' })).toBe(false);
  });

  // ── Undefined/missing properties ────────────────────────────

  it('returns false when meta is completely empty', () => {
    expect(isViewLaunchable({})).toBe(false);
  });

  it('returns false when only viewType:main.editor is set', () => {
    expect(isViewLaunchable({ viewType: 'main.editor' })).toBe(false);
  });

  it('handles undefined launchable safely', () => {
    expect(isViewLaunchable({ launchable: undefined, viewType: 'main.editor' })).toBe(false);
  });

  it('handles undefined launchMode safely', () => {
    expect(isViewLaunchable({ launchable: true, launchMode: undefined, viewType: 'main.editor' })).toBe(true);
  });
});

// ─── filterLaunchableViews unit tests ────────────────────────────

describe('filterLaunchableViews', () => {
  it('returns only direct-launchable views, excluding empty and panels', () => {
    const entries: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['empty', { meta: {} }],
      ['dashboard', { meta: { launchable: true, launchMode: 'direct', viewType: 'main.editor' } }],
      ['terminal', { meta: { launchable: true, launchMode: 'direct', viewType: 'main.editor' } }],
      ['claude-chat', { meta: { viewType: 'main.editor' } }],
      ['system-info', { meta: { launchable: true, viewType: 'panel.bottom' } }],
      ['hidden-task', { meta: { launchable: true, launchMode: 'hidden', viewType: 'main.editor' } }],
    ];

    const result = filterLaunchableViews(entries);
    expect(result.map(([id]) => id)).toEqual(['dashboard', 'terminal']);
  });

  it('returns empty array when no views are launchable', () => {
    const entries: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['adapter-only', { meta: { viewType: 'main.editor' } }],
      ['panel-view', { meta: { launchable: true, viewType: 'panel.bottom' } }],
    ];

    const result = filterLaunchableViews(entries);
    expect(result).toHaveLength(0);
  });
});

// ─── firstLaunchableViewId unit tests ────────────────────────────

describe('firstLaunchableViewId', () => {
  it('returns the first direct-launchable view id, not the first adapter view', () => {
    const entries: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['claude-chat', { meta: { viewType: 'main.editor' } }],
      ['dashboard', { meta: { launchable: true, launchMode: 'direct', viewType: 'main.editor' } }],
    ];

    expect(firstLaunchableViewId(entries)).toBe('dashboard');
  });

  it('returns null when no launchable views exist', () => {
    const entries: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['claude-chat', { meta: { viewType: 'main.editor' } }],
      ['hidden-task', { meta: { launchMode: 'hidden', viewType: 'main.editor' } }],
    ];

    expect(firstLaunchableViewId(entries)).toBeNull();
  });

  it('returns the id not the entry object', () => {
    const entries: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['logs', { meta: { launchable: true, launchMode: 'direct', viewType: 'main.editor' } }],
    ];

    const result = firstLaunchableViewId(entries);
    expect(typeof result).toBe('string');
    expect(result).toBe('logs');
  });

  it('skips empty id entries', () => {
    const entries: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['empty', { meta: { launchable: true, launchMode: 'direct', viewType: 'main.editor' } }],
      ['dashboard', { meta: { launchable: true, launchMode: 'direct', viewType: 'main.editor' } }],
    ];

    expect(firstLaunchableViewId(entries)).toBe('dashboard');
  });
});

// ─── hasLaunchableViewForPlugin unit tests ────────────────────────

describe('hasLaunchableViewForPlugin', () => {
  // Simulate getAdapterIdForView: maps viewId -> adapter pluginId, or undefined
  const adapterMap: Record<string, string> = {
    'terminal.view': 'terminal',
    'claude-chat': 'claude-code',
    'system-info.panel': 'system-info',
  };
  const ownerResolver = (viewId: string) => adapterMap[viewId];

  const entries: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
    ['empty', { meta: {} }],
    ['dashboard', { meta: { launchable: true, launchMode: 'direct', viewType: 'main.editor' } }],
    ['terminal.view', { meta: { launchable: true, launchMode: 'direct', viewType: 'main.editor' } }],
    ['claude-chat', { meta: { viewType: 'main.editor' } }],
    ['system-info.panel', { meta: { launchable: true, viewType: 'panel.bottom' } }],
    ['hidden-task', { meta: { launchable: true, launchMode: 'hidden', viewType: 'main.editor' } }],
    ['runtime-view', { meta: { launchMode: 'runtime', viewType: 'main.editor' } }],
    ['session-view', { meta: { launchable: true, launchMode: 'session', viewType: 'main.editor' } }],
  ];

  it('returns true for terminal plugin (has direct launchable main.editor view)', () => {
    expect(hasLaunchableViewForPlugin('terminal', entries, ownerResolver)).toBe(true);
  });

  it('returns false for claude-code plugin (adapter-only, no launchable flag)', () => {
    expect(hasLaunchableViewForPlugin('claude-code', entries, ownerResolver)).toBe(false);
  });

  it('returns false for system-info plugin (panel-only, not launchable)', () => {
    expect(hasLaunchableViewForPlugin('system-info', entries, ownerResolver)).toBe(false);
  });

  it('returns true for sessionnode-core (dashboard is launchable, no adapter mapping → defaults to core)', () => {
    expect(hasLaunchableViewForPlugin('sessionnode-core', entries, ownerResolver)).toBe(true);
  });

  it('returns false for unknown plugin with no views', () => {
    expect(hasLaunchableViewForPlugin('nonexistent', entries, ownerResolver)).toBe(false);
  });

  it('returns false for plugin whose only view is hidden', () => {
    const hiddenOnly: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['hidden-task', { meta: { launchable: true, launchMode: 'hidden', viewType: 'main.editor' } }],
    ];
    const map: Record<string, string> = { 'hidden-task': 'stealth-plugin' };
    expect(hasLaunchableViewForPlugin('stealth-plugin', hiddenOnly, (vid) => map[vid])).toBe(false);
  });

  it('returns false for plugin whose only view has runtime launchMode', () => {
    const runtimeOnly: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['runtime-view', { meta: { launchMode: 'runtime', viewType: 'main.editor' } }],
    ];
    const map: Record<string, string> = { 'runtime-view': 'bg-plugin' };
    expect(hasLaunchableViewForPlugin('bg-plugin', runtimeOnly, (vid) => map[vid])).toBe(false);
  });

  it('returns false for plugin whose only view has session launchMode', () => {
    const sessionOnly: Array<[string, { meta: { launchable?: boolean; launchMode?: string; viewType?: string } }]> = [
      ['session-view', { meta: { launchable: true, launchMode: 'session', viewType: 'main.editor' } }],
    ];
    const map: Record<string, string> = { 'session-view': 'session-plugin' };
    expect(hasLaunchableViewForPlugin('session-plugin', sessionOnly, (vid) => map[vid])).toBe(false);
  });
});

// ─── Cross-consistency: ViewSelector + PluginManager + PluginDetail ──
// All three use the same isViewLaunchable helper. These tests verify
// that the rules produce consistent results for representative scenarios.

describe('Launchability cross-consistency (ViewSelector / PluginManager / PluginDetail)', () => {
  // Meta shapes mirror the three consumers' entry patterns
  const terminalMeta    = { launchable: true, launchMode: 'direct' as const, viewType: 'main.editor' as const };
  const panelMeta       = { launchable: true, viewType: 'panel.bottom' as const };
  const adapterOnlyMeta = { viewType: 'main.editor' as const };
  const hiddenMeta      = { launchable: true, launchMode: 'hidden' as const, viewType: 'main.editor' as const };
  const runtimeMeta     = { launchMode: 'runtime' as const, viewType: 'main.editor' as const };
  const sessionMeta     = { launchable: true, launchMode: 'session' as const, viewType: 'main.editor' as const };

  describe('terminal direct main.editor view', () => {
    it('isViewLaunchable → true (ViewSelector shows it)', () => {
      expect(isViewLaunchable(terminalMeta)).toBe(true);
    });
    it('hasLaunchableViewForPlugin → true (PluginManager shows launchable: yes)', () => {
      const entries: Array<[string, { meta: typeof terminalMeta }]> = [['terminal.view', { meta: terminalMeta }]];
      const map: Record<string, string> = { 'terminal.view': 'terminal' };
      expect(hasLaunchableViewForPlugin('terminal', entries, (vid) => map[vid])).toBe(true);
    });
    it('isViewLaunchable → true (PluginDetail Overview shows "Can open as tab: Yes")', () => {
      expect(isViewLaunchable(terminalMeta)).toBe(true);
    });
  });

  describe('system-info panel-only view', () => {
    it('isViewLaunchable → false (ViewSelector does NOT show it)', () => {
      expect(isViewLaunchable(panelMeta)).toBe(false);
    });
    it('hasLaunchableViewForPlugin → false (PluginManager shows launchable: no)', () => {
      const entries: Array<[string, { meta: typeof panelMeta }]> = [['system-info.panel', { meta: panelMeta }]];
      const map: Record<string, string> = { 'system-info.panel': 'system-info' };
      expect(hasLaunchableViewForPlugin('system-info', entries, (vid) => map[vid])).toBe(false);
    });
    it('isViewLaunchable → false (PluginDetail Overview shows "Can open as tab: No")', () => {
      expect(isViewLaunchable(panelMeta)).toBe(false);
    });
  });

  describe('adapter mapping only / no launchable flag', () => {
    it('isViewLaunchable → false (ViewSelector does NOT show it)', () => {
      expect(isViewLaunchable(adapterOnlyMeta)).toBe(false);
    });
    it('hasLaunchableViewForPlugin → false (PluginManager shows launchable: no)', () => {
      const entries: Array<[string, { meta: typeof adapterOnlyMeta }]> = [['claude-chat', { meta: adapterOnlyMeta }]];
      const map: Record<string, string> = { 'claude-chat': 'claude-code' };
      expect(hasLaunchableViewForPlugin('claude-code', entries, (vid) => map[vid])).toBe(false);
    });
    it('isViewLaunchable → false (PluginDetail Overview shows "Can open as tab: No")', () => {
      expect(isViewLaunchable(adapterOnlyMeta)).toBe(false);
    });
  });

  describe('hidden / runtime / session launchMode', () => {
    it('hidden → isViewLaunchable false', () => {
      expect(isViewLaunchable(hiddenMeta)).toBe(false);
    });
    it('runtime → isViewLaunchable false', () => {
      expect(isViewLaunchable(runtimeMeta)).toBe(false);
    });
    it('session → isViewLaunchable false', () => {
      expect(isViewLaunchable(sessionMeta)).toBe(false);
    });
  });
});
