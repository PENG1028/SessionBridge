// ─── Slot Registry Unit Tests ───────────────────────────
// Tests are pure data-layer — no React, no DOM.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SlotRegistry } from './slot-registry';
import type { SlotDeclaration, SlotFilling } from './slot-types';

function makeDecl(overrides: Partial<SlotDeclaration> = {}): SlotDeclaration {
  return {
    slotId: 'test.slot',
    title: 'Test Slot',
    declaredBy: 'test-plugin',
    ...overrides,
  };
}

function makeFilling(overrides: Partial<SlotFilling> = {}): SlotFilling {
  return {
    slotId: 'test.slot',
    fillingId: 'test.filling',
    pluginId: 'test-plugin',
    content: { value: 42 },
    ...overrides,
  };
}

describe('SlotRegistry', () => {
  let registry: SlotRegistry;

  beforeEach(() => {
    registry = new SlotRegistry();
  });

  // ── declare + getDeclarations ─────────────────────────

  it('registers a declaration and returns it via getDeclarations', () => {
    const decl = makeDecl();
    registry.declare(decl);

    const all = registry.getDeclarations();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      slotId: 'test.slot',
      title: 'Test Slot',
      declaredBy: 'test-plugin',
    });
  });

  it('returns a declaration by slotId', () => {
    const decl = makeDecl();
    registry.declare(decl);

    const got = registry.getDeclaration('test.slot');
    expect(got).toBeDefined();
    expect(got!.slotId).toBe('test.slot');
  });

  it('returns undefined for unknown slotId', () => {
    expect(registry.getDeclaration('nonexistent')).toBeUndefined();
  });

  it('warns and skips duplicate declaration', () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((msg) => warns.push(msg));

    registry.declare(makeDecl({ slotId: 'dup.slot', declaredBy: 'plugin-a' }));
    registry.declare(makeDecl({ slotId: 'dup.slot', declaredBy: 'plugin-b' }));

    expect(registry.getDeclarations()).toHaveLength(1);
    expect(registry.getDeclaration('dup.slot')!.declaredBy).toBe('plugin-a');
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain('already declared');

    spy.mockRestore();
  });

  // ── fill + getFillings ────────────────────────────────

  it('adds a filling to a declared slot', () => {
    registry.declare(makeDecl({ slotId: 'settings.section' }));
    registry.fill(makeFilling({ slotId: 'settings.section', fillingId: 'f1' }));

    const fillings = registry.getFillings('settings.section');
    expect(fillings).toHaveLength(1);
    expect(fillings[0].fillingId).toBe('f1');
  });

  it('returns fillings sorted by order ascending', () => {
    registry.declare(makeDecl({ slotId: 'toolbar' }));
    registry.fill(makeFilling({ slotId: 'toolbar', fillingId: 'c', order: 3 }));
    registry.fill(makeFilling({ slotId: 'toolbar', fillingId: 'a', order: 1 }));
    registry.fill(makeFilling({ slotId: 'toolbar', fillingId: 'b', order: 2 }));

    const fillings = registry.getFillings('toolbar');
    expect(fillings.map((f) => f.fillingId)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for fillings of unknown slot', () => {
    expect(registry.getFillings('no-such-slot')).toEqual([]);
  });

  // ── fill to unknown slot → orphaned ───────────────────

  it('orphans a filling whose slot is not declared and warns', () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((msg) => warns.push(msg));

    registry.fill(makeFilling({ slotId: 'missing.slot', pluginId: 'orphan-plugin' }));

    expect(registry.getOrphans()).toHaveLength(1);
    expect(registry.getOrphans()[0].slotId).toBe('missing.slot');
    expect(registry.getOrphans()[0].pluginId).toBe('orphan-plugin');
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain('filled unknown slot');

    spy.mockRestore();
  });

  it('moves orphan to normal fillings when slot is declared later', () => {
    registry.fill(makeFilling({ slotId: 'late.slot', fillingId: 'f1', pluginId: 'p1' }));
    expect(registry.getOrphans()).toHaveLength(1);

    registry.declare(makeDecl({ slotId: 'late.slot' }));
    registry.fill(makeFilling({ slotId: 'late.slot', fillingId: 'f1', pluginId: 'p1' }));

    expect(registry.getOrphans()).toHaveLength(0);
    expect(registry.getFillings('late.slot')).toHaveLength(1);
  });

  // ── getUnfilledSlots ──────────────────────────────────

  it('returns declarations with zero fillings', () => {
    registry.declare(makeDecl({ slotId: 'empty.1' }));
    registry.declare(makeDecl({ slotId: 'empty.2' }));
    registry.declare(makeDecl({ slotId: 'filled' }));
    registry.fill(makeFilling({ slotId: 'filled', fillingId: 'x' }));

    const unfilled = registry.getUnfilledSlots();
    expect(unfilled).toHaveLength(2);
    expect(unfilled.map((d) => d.slotId).sort()).toEqual(['empty.1', 'empty.2']);
  });

  // ── undeclare cleans up fillings ──────────────────────

  it('undeclare removes declaration and associated fillings', () => {
    registry.declare(makeDecl({ slotId: 'remove.me' }));
    registry.fill(makeFilling({ slotId: 'remove.me', fillingId: 'f1' }));
    registry.fill(makeFilling({ slotId: 'remove.me', fillingId: 'f2' }));

    expect(registry.getDeclaration('remove.me')).toBeDefined();
    expect(registry.getFillings('remove.me')).toHaveLength(2);

    registry.undeclare('remove.me');

    expect(registry.getDeclaration('remove.me')).toBeUndefined();
    expect(registry.getFillings('remove.me')).toHaveLength(0);
  });

  it('undeclare also cleans up orphans targeting that slot', () => {
    registry.fill(makeFilling({ slotId: 'soon.removed', fillingId: 'f1' }));
    expect(registry.getOrphans()).toHaveLength(1);

    registry.declare(makeDecl({ slotId: 'soon.removed' }));
    registry.fill(makeFilling({ slotId: 'soon.removed', fillingId: 'f1' }));

    // Orphan should be gone
    expect(registry.getOrphans()).toHaveLength(0);

    registry.undeclare('soon.removed');

    expect(registry.getOrphans()).toHaveLength(0);
  });

  // ── unfill removes all from a plugin ──────────────────

  it('unfill removes all fillings from a plugin across all slots', () => {
    registry.declare(makeDecl({ slotId: 'slot.a' }));
    registry.declare(makeDecl({ slotId: 'slot.b' }));

    registry.fill(makeFilling({ slotId: 'slot.a', fillingId: 'p1-f1', pluginId: 'plugin-1' }));
    registry.fill(makeFilling({ slotId: 'slot.a', fillingId: 'p2-f1', pluginId: 'plugin-2' }));
    registry.fill(makeFilling({ slotId: 'slot.b', fillingId: 'p1-f2', pluginId: 'plugin-1' }));

    registry.unfill('plugin-1');

    expect(registry.getFillings('slot.a')).toHaveLength(1);
    expect(registry.getFillings('slot.a')[0].pluginId).toBe('plugin-2');
    expect(registry.getFillings('slot.b')).toHaveLength(0);
  });

  it('unfill also removes plugin fillings from orphans', () => {
    registry.fill(makeFilling({ slotId: 'unknown', fillingId: 'o1', pluginId: 'plugin-1' }));
    registry.fill(makeFilling({ slotId: 'unknown2', fillingId: 'o2', pluginId: 'plugin-1' }));

    expect(registry.getOrphans()).toHaveLength(2);

    registry.unfill('plugin-1');

    expect(registry.getOrphans()).toHaveLength(0);
  });

  // ── replace existing fillingId ────────────────────────

  it('replaces a filling with the same fillingId (same slot)', () => {
    registry.declare(makeDecl({ slotId: 'replace.slot' }));

    registry.fill(makeFilling({
      slotId: 'replace.slot',
      fillingId: 'same-id',
      content: { value: 1 },
      order: 1,
    }));

    registry.fill(makeFilling({
      slotId: 'replace.slot',
      fillingId: 'same-id',
      content: { value: 42 },
      order: 2,
    }));

    const fillings = registry.getFillings('replace.slot');
    expect(fillings).toHaveLength(1);
    // The order was updated as part of the replacement
    expect(fillings[0].content).toEqual({ value: 42 });
  });

  it('replace also moves from orphans to normal if previously orphaned', () => {
    registry.fill(makeFilling({ slotId: 'maybe.later', fillingId: 'f1', content: 'old' }));
    expect(registry.getOrphans()).toHaveLength(1);

    registry.declare(makeDecl({ slotId: 'maybe.later' }));
    registry.fill(makeFilling({ slotId: 'maybe.later', fillingId: 'f1', content: 'new' }));

    expect(registry.getOrphans()).toHaveLength(0);
    expect(registry.getFillings('maybe.later')).toHaveLength(1);
    expect(registry.getFillings('maybe.later')[0].content).toBe('new');
  });

  // ── getAll snapshot ───────────────────────────────────

  it('getAll returns a complete snapshot of registry state', () => {
    registry.declare(makeDecl({ slotId: 'snap.a' }));
    registry.declare(makeDecl({ slotId: 'snap.b' }));
    registry.fill(makeFilling({ slotId: 'snap.a', fillingId: 'f1', order: 2 }));
    registry.fill(makeFilling({ slotId: 'snap.a', fillingId: 'f2', order: 1 }));
    registry.fill(makeFilling({ slotId: 'orphan.me', fillingId: 'o1' }));

    const snapshot = registry.getAll();

    expect(snapshot.declarations).toHaveLength(2);
    expect(snapshot.fillings.has('snap.a')).toBe(true);
    expect(snapshot.fillings.get('snap.a')!.map((f) => f.fillingId)).toEqual(['f2', 'f1']);
    expect(snapshot.orphans).toHaveLength(1);
  });

  it('getAll does not expose internal references (defensive copy)', () => {
    registry.declare(makeDecl({ slotId: 'safe' }));
    const snapshot = registry.getAll();
    snapshot.declarations[0].title = 'MUTATED';
    expect(registry.getDeclaration('safe')!.title).toBe('Test Slot');
  });
});
