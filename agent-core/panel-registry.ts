// ─── Panel Registry ──────────────────────────────────────────
// Aggregates side panel contributions from extension manifests
// and resolves visibility via when-condition evaluation.
//
// Usage (server-side):
//   panelRegistry.registerFromManifest('claude-code', manifest);
//   const panels = panelRegistry.getPanels('sidebar-right', ctx);
//
// Usage (client-side):
//   import { evaluateWhen } from './extension-points';
//   const visible = extensionPanels.filter(p => evaluateWhen(p.when, ctx));

import type { ExtensionManifest, SidePanelContribution, WhenContext } from '../extensions/types';
import { evaluateWhen } from './extension-points';

interface PanelEntry {
  side: 'sidebar-left' | 'sidebar-right';
  contribution: SidePanelContribution;
  extensionId: string;
}

export class PanelRegistry {
  private entries: PanelEntry[] = [];

  /** Register side panel contributions from an extension manifest. */
  registerFromManifest(extensionId: string, manifest: ExtensionManifest): void {
    const views = manifest.contributes?.views;
    if (!views) return;
    for (const side of ['sidebar-left', 'sidebar-right'] as const) {
      const panels = views[side];
      if (!panels) continue;
      for (const p of panels) {
        this.entries.push({ side, contribution: p, extensionId });
      }
    }
  }

  /** Unregister all panels for a given extension. */
  unregister(extensionId: string): void {
    this.entries = this.entries.filter(e => e.extensionId !== extensionId);
  }

  /** Get panels for a sidebar side, filtered by when condition and sorted by order. */
  getPanels(
    side: 'sidebar-left' | 'sidebar-right',
    ctx?: WhenContext,
  ): SidePanelContribution[] {
    return this.entries
      .filter(e => e.side === side)
      .map(e => e.contribution)
      .filter(p => ctx === undefined || evaluateWhen(p.when, ctx))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /** Clear all entries. */
  clear(): void {
    this.entries = [];
  }
}

/** Global singleton. */
export const panelRegistry = new PanelRegistry();
