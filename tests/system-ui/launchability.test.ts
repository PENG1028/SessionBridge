'use client';

import { describe, it, expect } from 'vitest';
import { isViewLaunchable, filterLaunchableViews, firstLaunchableViewId } from '../../app/console/plugin-host/launchability';

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
