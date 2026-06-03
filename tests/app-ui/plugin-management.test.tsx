// ─── Plugin Management tests ─────────────────────────────────────
// DISABLED: PluginManager and PluginDetail were part of the old
// system-pages/ directory which was removed during the App Shell
// refactoring. Plugin management functionality now lives in
// plugins/plugin-manager/ and needs a new test suite written
// against the current component architecture.
//
// Tests: PluginManager search/filter/env, PluginDetail all 8 tabs,
// loading/error/empty/permission-denied states.
//
// See: plugins/plugin-manager/ for the current implementation.
//
// To re-enable: rewrite tests against plugins/plugin-manager/index.tsx

import { describe, it, expect } from 'vitest';

describe('PluginManager (placeholder)', () => {
  it.skip('needs rewrite against current plugin-manager component', () => {
    // Placeholder: original tests were tied to old system-pages/
    expect(true).toBe(true);
  });
});
