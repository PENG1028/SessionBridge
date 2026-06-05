// ─── Slot Registry Types ─────────────────────────────────
// Pure data types for the slot/filling system.
// No React, no DOM — runs in any JS environment.

/**
 * A slot declaration defines an extension point that other plugins
 * can fill with content (panels, settings sections, toolbar items, etc.).
 */
export interface SlotDeclaration {
  /** Globally unique slot identifier, e.g. "settings.section.plugin-config" */
  slotId: string;
  /** Human-readable title for the slot */
  title: string;
  /** Optional description of what this slot expects */
  description?: string;
  /** Plugin or system component that declares this slot, e.g. "settings-panel" */
  declaredBy: string;
  /** Optional hint for filling validation (e.g. "panel-component", "settings-form") */
  expectedType?: string;
}

/**
 * A slot filling is a piece of content provided by a plugin
 * to be rendered inside a declared slot.
 */
export interface SlotFilling {
  /** The slot this filling targets */
  slotId: string;
  /** Unique identifier within the slot, e.g. "terminal.config" */
  fillingId: string;
  /** Plugin that provides this filling */
  pluginId: string;
  /** The data being slotted in — opaque to the registry */
  content: unknown;
  /** Display order within the slot (ascending, lower = first) */
  order?: number;
}
