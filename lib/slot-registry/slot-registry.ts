// ─── Slot Registry ──────────────────────────────────────
// Pure TypeScript registry for slot declarations and fillings.
// No React, no DOM — works in Node.js/worker/browser.

import type { SlotDeclaration, SlotFilling } from './slot-types';

export class SlotRegistry {
  private _declarations = new Map<string, SlotDeclaration>();
  private _fillings = new Map<string, Map<string, SlotFilling>>();
  private _orphans: SlotFilling[] = [];

  // ── bookkeeping ───────────────────────────────────────

  /**
   * Register a slot declaration.
   * If the slotId is already declared, a warning is emitted and
   * the new declaration is ignored.
   */
  declare(decl: SlotDeclaration): void {
    if (this._declarations.has(decl.slotId)) {
      console.warn(
        `[slot-registry] Slot "${decl.slotId}" already declared by "${this._declarations.get(decl.slotId)!.declaredBy}". ` +
        `Skipping duplicate declaration from "${decl.declaredBy}".`
      );
      return;
    }
    this._declarations.set(decl.slotId, { ...decl });
  }

  /**
   * Remove a slot declaration and all its fillings.
   * Silently does nothing if the slot doesn't exist.
   */
  undeclare(slotId: string): void {
    this._declarations.delete(slotId);
    this._fillings.delete(slotId);
    // Also remove any orphans targeting this slot
    this._orphans = this._orphans.filter((o) => o.slotId !== slotId);
  }

  // ── filling ───────────────────────────────────────────

  /**
   * Submit a filling for a slot.
   *
   * - If the target slot IS declared: the filling is added to that
   *   slot's list, sorted by `order` ascending.
   * - If the target slot is NOT declared: the filling is pushed to an
   *   orphaned list and a warning is emitted.
   * - If a filling with the same `fillingId` already exists for the
   *   same `slotId`, it is replaced (updated).
   */
  fill(filling: SlotFilling): void {
    if (this._declarations.has(filling.slotId)) {
      let slotFillings = this._fillings.get(filling.slotId);
      if (!slotFillings) {
        slotFillings = new Map();
        this._fillings.set(filling.slotId, slotFillings);
      }
      slotFillings.set(filling.fillingId, { ...filling });

      // Remove from orphans if it was orphaned before
      this._orphans = this._orphans.filter(
        (o) => !(o.slotId === filling.slotId && o.fillingId === filling.fillingId)
      );
    } else {
      // Remove stale entry for this filling if re-orphaning
      this._orphans = this._orphans.filter(
        (o) => !(o.slotId === filling.slotId && o.fillingId === filling.fillingId)
      );
      this._orphans.push({ ...filling });
      console.warn(
        `[slot-registry] Plugin "${filling.pluginId}" filled unknown slot "${filling.slotId}" — ` +
        `target component may not be installed.`
      );
    }
  }

  /**
   * Remove all fillings by a given plugin from all slots (and orphans).
   * Silently does nothing if the plugin has no fillings.
   */
  unfill(pluginId: string): void {
    for (const [, slotFillings] of this._fillings) {
      for (const [fillingId, filling] of slotFillings) {
        if (filling.pluginId === pluginId) {
          slotFillings.delete(fillingId);
        }
      }
    }
    this._orphans = this._orphans.filter((o) => o.pluginId !== pluginId);
  }

  // ── queries ───────────────────────────────────────────

  /** Get a single slot declaration by ID, or undefined. */
  getDeclaration(slotId: string): SlotDeclaration | undefined {
    return this._declarations.get(slotId);
  }

  /** Get all registered slot declarations (shallow copy). */
  getDeclarations(): SlotDeclaration[] {
    return Array.from(this._declarations.values()).map((d) => ({ ...d }));
  }

  /**
   * Get all fillings for a given slot, sorted by `order` ascending.
   * Returns an empty array if the slot has no fillings or doesn't exist.
   */
  getFillings(slotId: string): SlotFilling[] {
    const slotFillings = this._fillings.get(slotId);
    if (!slotFillings) return [];
    return Array.from(slotFillings.values())
      .map((f) => ({ ...f }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /**
   * Return all declarations that currently have zero fillings.
   */
  getUnfilledSlots(): SlotDeclaration[] {
    const result: SlotDeclaration[] = [];
    for (const [slotId, decl] of this._declarations) {
      const fillings = this._fillings.get(slotId);
      if (!fillings || fillings.size === 0) {
        result.push({ ...decl });
      }
    }
    return result;
  }

  /** Return all fillings whose target slot hasn't been declared yet. */
  getOrphans(): SlotFilling[] {
    return this._orphans.map((o) => ({ ...o }));
  }

  // ── inspection ────────────────────────────────────────

  /**
   * Return a snapshot of the full registry state.
   */
  getAll(): {
    declarations: SlotDeclaration[];
    fillings: Map<string, SlotFilling[]>;
    orphans: SlotFilling[];
  } {
    const fillingsSnapshot = new Map<string, SlotFilling[]>();
    for (const [slotId, slotFillings] of this._fillings) {
      fillingsSnapshot.set(
        slotId,
        Array.from(slotFillings.values()).sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0)
        )
      );
    }
    return {
      declarations: this.getDeclarations(),
      fillings: fillingsSnapshot,
      orphans: this.getOrphans(),
    };
  }
}

/** Application-wide singleton slot registry. */
export const slotRegistry = new SlotRegistry();
