// ─── Workbench State tests ────────────────────────────────────
// Tests the recursive layout tree reducer and helper functions.
// Pure function tests — no React, no DOM.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialState,
  createEmptyPane,
  workbenchReducer,
  findPane,
  collectAllTabs,
  findPaneByInstance,
  ensureInstanceTab,
  genTabId,
  genPaneId,
} from '../../app/console/stage/workbench-state';
import type { PaneTab, WorkbenchState } from '../../app/console/stage/workbench-state';

// ─── Helper: create a test tab ─────────────────────────────────

function makeTab(overrides?: Partial<PaneTab>): PaneTab {
  const id = genTabId();
  return { id, title: 'Test', viewType: 'terminal', ...overrides };
}

function makeEmptyTab(): PaneTab {
  const id = genTabId();
  return { id, title: 'New', viewType: 'empty' };
}

// ─── Helpers ──────────────────────────────────────────────────

describe('createInitialState', () => {
  it('creates a single-pane state with an empty tab', () => {
    const state = createInitialState();
    expect(state.root.kind).toBe('pane');
    if (state.root.kind === 'pane') {
      expect(state.root.tabs).toHaveLength(1);
      expect(state.root.tabs[0].viewType).toBe('empty');
    }
    expect(state.bottom).toBeNull();
  });

  it('creates state with instanceId pre-bound', () => {
    const state = createInitialState('inst-abc');
    if (state.root.kind === 'pane') {
      expect(state.root.tabs[0].instanceId).toBe('inst-abc');
    }
  });
});

describe('createEmptyPane', () => {
  it('creates a main-zone pane', () => {
    const pane = createEmptyPane('main');
    expect(pane.kind).toBe('pane');
    expect(pane.zone).toBe('main');
    expect(pane.tabs).toHaveLength(1);
    expect(pane.tabs[0].viewType).toBe('empty');
  });

  it('creates a bottom-zone pane', () => {
    const pane = createEmptyPane('bottom');
    expect(pane.zone).toBe('bottom');
  });
});

// ─── Tree helpers ─────────────────────────────────────────────

describe('findPane', () => {
  it('finds pane in flat state', () => {
    const state = createInitialState();
    const found = findPane(state.root, state.activePaneId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(state.activePaneId);
  });

  it('finds pane after split', () => {
    let state = createInitialState();
    state = workbenchReducer(state, { type: 'SPLIT_PANE', paneId: state.activePaneId, direction: 'horizontal' });
    // Both panes should be findable by their IDs
    if (state.root.kind === 'split') {
      for (const child of state.root.children) {
        if (child.kind === 'pane') {
          const found = findPane(state.root, child.id);
          expect(found).not.toBeNull();
          expect(found!.id).toBe(child.id);
        }
      }
    }
  });

  it('returns null for unknown paneId', () => {
    const state = createInitialState();
    const found = findPane(state.root, 'nonexistent');
    expect(found).toBeNull();
  });
});

describe('collectAllTabs', () => {
  it('returns non-empty tabs from flat state', () => {
    const state = createInitialState();
    const tabs = collectAllTabs(state);
    expect(tabs).toHaveLength(0); // empty tab is excluded
  });

  it('includes tabs from bottom pane', () => {
    let state = createInitialState();
    state = workbenchReducer(state, { type: 'ADD_BOTTOM_PANE' });
    const tabs = collectAllTabs(state);
    expect(tabs).toHaveLength(1); // terminal tab in bottom pane
    expect(tabs[0].viewType).toBe('terminal');
  });
});

// ─── Reducer ──────────────────────────────────────────────────

describe('workbenchReducer', () => {
  let state: WorkbenchState;

  beforeEach(() => {
    state = createInitialState();
  });

  describe('ADD_TAB', () => {
    it('adds a tab to the active pane', () => {
      const tab = makeTab();
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab });
      const pane = findPane(state.root, state.activePaneId);
      expect(pane).not.toBeNull();
      if (pane) {
        expect(pane.tabs).toHaveLength(2);
        expect(pane.tabs[1].title).toBe('Test');
      }
    });

    it('activates the new tab by default', () => {
      const tab = makeTab();
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab });
      const pane = findPane(state.root, state.activePaneId);
      expect(pane!.activeTabId).toBe(tab.id);
    });

    it('can add tab without activating', () => {
      const tab = makeTab();
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab, activate: false });
      const firstTabId = state.root.kind === 'pane' ? state.root.tabs[0].id : '';
      const pane = findPane(state.root, state.activePaneId);
      expect(pane!.activeTabId).toBe(firstTabId);
    });
  });

  describe('CLOSE_TAB', () => {
    it('replaces last real tab with empty placeholder', () => {
      const tab = makeTab();
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab });
      expect(collectAllTabs(state)).toHaveLength(1);
      state = workbenchReducer(state, { type: 'CLOSE_TAB', paneId: state.activePaneId, tabId: tab.id });
      const pane = findPane(state.root, state.activePaneId);
      expect(pane).not.toBeNull();
      if (pane) {
        expect(pane.tabs).toHaveLength(1);
        expect(pane.tabs[0].viewType).toBe('empty');
      }
    });

    it('cannot close the inital empty tab', () => {
      const pane = findPane(state.root, state.activePaneId)!;
      const prev = state;
      state = workbenchReducer(state, { type: 'CLOSE_TAB', paneId: state.activePaneId, tabId: pane.tabs[0].id });
      expect(state).toBe(prev); // unchanged reference
    });

    it('removes tab and activates previous when closing non-last', () => {
      const tab1 = makeTab({ title: 'Tab1' });
      const tab2 = makeTab({ title: 'Tab2' });
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab: tab1 });
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab: tab2 });
      state = workbenchReducer(state, { type: 'CLOSE_TAB', paneId: state.activePaneId, tabId: tab2.id });
      const pane = findPane(state.root, state.activePaneId)!;
      expect(pane.tabs).toHaveLength(2); // empty + tab1
      expect(pane.activeTabId).toBe(tab1.id);
    });

    it('closes tab in bottom pane', () => {
      state = workbenchReducer(state, { type: 'ADD_BOTTOM_PANE' });
      const bottomTab = state.bottom!.tabs[0];
      state = workbenchReducer(state, { type: 'CLOSE_TAB', paneId: state.bottom!.id, tabId: bottomTab.id });
      expect(state.bottom!.tabs[0].viewType).toBe('empty');
    });
  });

  describe('SET_ACTIVE_TAB', () => {
    it('switches active tab', () => {
      const tab1 = makeTab({ title: 'Tab1' });
      const tab2 = makeTab({ title: 'Tab2' });
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab: tab1, activate: false });
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab: tab2, activate: false });
      state = workbenchReducer(state, { type: 'SET_ACTIVE_TAB', paneId: state.activePaneId, tabId: tab2.id });
      const pane = findPane(state.root, state.activePaneId)!;
      expect(pane.activeTabId).toBe(tab2.id);
    });
  });

  describe('SET_TAB_VIEW', () => {
    it('updates tab viewType and title', () => {
      const tab = makeTab();
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab });
      state = workbenchReducer(state, {
        type: 'SET_TAB_VIEW', paneId: state.activePaneId, tabId: tab.id,
        viewType: 'dashboard', title: 'Dashboard',
      });
      const pane = findPane(state.root, state.activePaneId)!;
      const updated = pane.tabs.find(t => t.id === tab.id);
      expect(updated?.viewType).toBe('dashboard');
      expect(updated?.title).toBe('Dashboard');
    });

    it('binds instanceId when provided', () => {
      const tab = makeTab();
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab });
      state = workbenchReducer(state, {
        type: 'SET_TAB_VIEW', paneId: state.activePaneId, tabId: tab.id,
        viewType: 'terminal', title: 'Terminal', instanceId: 'run-001',
      });
      const pane = findPane(state.root, state.activePaneId)!;
      const updated = pane.tabs.find(t => t.id === tab.id);
      expect(updated?.instanceId).toBe('run-001');
    });
  });

  describe('SPLIT_PANE', () => {
    it('splits pane horizontally', () => {
      state = workbenchReducer(state, { type: 'SPLIT_PANE', paneId: state.activePaneId, direction: 'horizontal' });
      expect(state.root.kind).toBe('split');
      if (state.root.kind === 'split') {
        expect(state.root.direction).toBe('horizontal');
        expect(state.root.children).toHaveLength(2);
      }
    });

    it('splits pane vertically', () => {
      state = workbenchReducer(state, { type: 'SPLIT_PANE', paneId: state.activePaneId, direction: 'vertical' });
      expect(state.root.kind).toBe('split');
      if (state.root.kind === 'split') {
        expect(state.root.direction).toBe('vertical');
      }
    });

    it('focuses the new pane', () => {
      state = workbenchReducer(state, { type: 'SPLIT_PANE', paneId: state.activePaneId, direction: 'horizontal' });
      const newPaneId = state.activePaneId;
      const pane = findPane(state.root, newPaneId);
      expect(pane).not.toBeNull();
    });
  });

  describe('UNSPLIT_PANE', () => {
    it('collapses split back to single pane', () => {
      state = workbenchReducer(state, { type: 'SPLIT_PANE', paneId: state.activePaneId, direction: 'horizontal' });
      const paneId = state.activePaneId;
      state = workbenchReducer(state, { type: 'UNSPLIT_PANE', paneId });
      expect(state.root.kind).toBe('pane');
    });
  });

  describe('REORDER_TABS', () => {
    it('reorders tabs by swapping positions', () => {
      const tab1 = makeTab({ title: 'Alpha' });
      const tab2 = makeTab({ title: 'Beta' });
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab: tab1, activate: false });
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab: tab2, activate: false });
      const pane = findPane(state.root, state.activePaneId)!;
      expect(pane.tabs.map(t => t.title)).toEqual(['New', 'Alpha', 'Beta']);
      // Move Beta before Alpha
      state = workbenchReducer(state, { type: 'REORDER_TABS', paneId: state.activePaneId, tabId: tab2.id, targetId: tab1.id });
      const rePane = findPane(state.root, state.activePaneId)!;
      expect(rePane.tabs.map(t => t.title)).toEqual(['New', 'Beta', 'Alpha']);
    });
  });

  describe('FOCUS_PANE', () => {
    it('changes activePaneId', () => {
      state = workbenchReducer(state, { type: 'SPLIT_PANE', paneId: state.activePaneId, direction: 'horizontal' });
      const firstPaneId = state.activePaneId;
      state = workbenchReducer(state, { type: 'FOCUS_PANE', paneId: firstPaneId });
      expect(state.activePaneId).toBe(firstPaneId);
    });
  });

  describe('ADD_EMPTY_PANE', () => {
    it('adds a new pane via split', () => {
      state = workbenchReducer(state, { type: 'ADD_EMPTY_PANE' });
      expect(state.root.kind).toBe('split');
      if (state.root.kind === 'split') {
        expect(state.root.children).toHaveLength(2);
      }
    });
  });

  describe('REMOVE_PANE', () => {
    it('removes pane from split layout', () => {
      state = workbenchReducer(state, { type: 'ADD_EMPTY_PANE' });
      const panes = collectAllTabs(state); // triggers side effect, finds all
      const paneToRemove = state.activePaneId;
      state = workbenchReducer(state, { type: 'REMOVE_PANE', paneId: paneToRemove });
      expect(state.root.kind).not.toBeNull();
    });

    it('removes bottom pane', () => {
      state = workbenchReducer(state, { type: 'ADD_BOTTOM_PANE' });
      expect(state.bottom).not.toBeNull();
      state = workbenchReducer(state, { type: 'REMOVE_PANE', paneId: state.bottom!.id });
      expect(state.bottom).toBeNull();
    });
  });

  describe('ADD_BOTTOM_PANE / CLOSE_BOTTOM_PANE', () => {
    it('adds a bottom terminal pane', () => {
      state = workbenchReducer(state, { type: 'ADD_BOTTOM_PANE' });
      expect(state.bottom).not.toBeNull();
      expect(state.bottom!.zone).toBe('bottom');
      expect(state.bottom!.tabs[0].viewType).toBe('terminal');
    });

    it('is idempotent (second ADD_BOTTOM_PANE is no-op)', () => {
      state = workbenchReducer(state, { type: 'ADD_BOTTOM_PANE' });
      const second = workbenchReducer(state, { type: 'ADD_BOTTOM_PANE' });
      expect(second.bottom).toEqual(state.bottom);
    });

    it('closes bottom pane', () => {
      state = workbenchReducer(state, { type: 'ADD_BOTTOM_PANE' });
      state = workbenchReducer(state, { type: 'CLOSE_BOTTOM_PANE' });
      expect(state.bottom).toBeNull();
    });
  });

  describe('CLEAR_INSTANCE_TABS', () => {
    it('clears tabs bound to the given instanceId', () => {
      const tab = makeTab({ instanceId: 'run-001' });
      state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab });
      state = workbenchReducer(state, { type: 'CLEAR_INSTANCE_TABS', instanceId: 'run-001' });
      const pane = findPane(state.root, state.activePaneId)!;
      const cleared = pane.tabs.find(t => t.id === tab.id);
      expect(cleared?.instanceId).toBeUndefined();
      expect(cleared?.viewType).toBe('empty');
    });
  });
});

// ─── Utilities ────────────────────────────────────────────────

describe('ensureInstanceTab', () => {
  let state: WorkbenchState;
  beforeEach(() => { state = createInitialState(); });

  it('adds tab for unknown instanceId', () => {
    const result = ensureInstanceTab(state, 'new-instance', 'My Instance');
    const pane = findPane(result.root, result.activePaneId)!;
    const bound = pane.tabs.find(t => t.instanceId === 'new-instance');
    expect(bound).toBeDefined();
    expect(bound!.title).toBe('My Instance');
  });

  it('does not add duplicate tab for existing instanceId', () => {
    const tab = makeTab({ instanceId: 'existing' });
    state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab });
    const result = ensureInstanceTab(state, 'existing');
    const pane = findPane(result.root, result.activePaneId)!;
    const matching = pane.tabs.filter(t => t.instanceId === 'existing');
    expect(matching).toHaveLength(1);
  });
});

describe('findPaneByInstance', () => {
  let state: WorkbenchState;
  beforeEach(() => { state = createInitialState(); });

  it('finds pane containing an instanceId', () => {
    const tab = makeTab({ instanceId: 'find-me' });
    state = workbenchReducer(state, { type: 'ADD_TAB', paneId: state.activePaneId, tab });
    const found = findPaneByInstance(state, 'find-me');
    expect(found).not.toBeNull();
    expect(found!.tabs.some(t => t.instanceId === 'find-me')).toBe(true);
  });

  it('returns null for unknown instance', () => {
    const found = findPaneByInstance(state, 'unknown');
    expect(found).toBeNull();
  });
});
