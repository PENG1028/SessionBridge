'use client';

// ─── Module-level initialization ─────────────────────────────────
// Side-effect imports that register views, panels, and actions.
// Extracted from page.tsx to keep the entry point clean.

import { __coreViewsRegistered } from './main/register-core-views';
import { __extensionPanelComponentsRegistered } from './panels/register-panel-components';
import { __coreActionsRegistered } from './actions/register-core-actions';
import { registerBuiltinHostComponents } from './plugin-host/host-component-registry';

/** Trigger all module-level side effects. Call once at app startup. */
export function ensureBootstrapped() {
  void __coreViewsRegistered;
  void __extensionPanelComponentsRegistered;
  void __coreActionsRegistered;
  registerBuiltinHostComponents();
}
