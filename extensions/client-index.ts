'use client';

// ── Client-Side Adapter View Registry Loader ───────────────
// This file is the single aggregation point for adapter view registrations
// on the client side. Each adapter directory exports a web-views module
// that registers its views via registerView() side effects.
//
// TODO: replace explicit imports with a generated/manifest-based approach.
// Each adapter's sb-extension.json should declare its web-view entry point,
// and a build step (or Next.js plugin) should produce this file automatically.
// For now, every new adapter that has a client-side view must be added here.
//
// Core code imports THIS file only — it never needs to know about
// individual adapter names or paths.

import './claude-code/web-views';
import './shell/web-views';

/** Trigger all adapter client-side registrations. Safe to call multiple times. */
export function ensureAdapterViewsLoaded(): void {
  // Module-level side effects fire at import time.
  // This function exists as an explicit call site so bundlers
  // understand the dependency and don't tree-shake it away.
}
