'use client';

// ── Dock Profile ──────────────────────────────────────────────
// View-scoped persistence for dock panel state (order, collapse, size).
//
// Profile keys are formatted as `view:<viewType>`, e.g.:
//   view:claude-chat, view:terminal, view:dashboard
//
// Legacy fallback: if no profile data exists for a key, the old
// global keys (sessionbridge-sidebar-order, sessionbridge-collapsed-panels)
// are read as migration sources. Writes always go to the new key.
//
// Future scope: instance-scoped profiles (`instance:<instanceId>`),
// bottom/floating dock areas, resize handle integration.

export type DockArea = 'left' | 'right';

export interface DockProfileState {
  order?: Partial<Record<DockArea, string[]>>;
  collapsed?: string[];
  sizes?: Record<string, number>;
}

const PROFILES_KEY = 'sessionbridge-dock-profiles';
const LEGACY_ORDER_KEY = 'sessionbridge-sidebar-order';
const LEGACY_COLLAPSE_KEY = 'sessionbridge-collapsed-panels';

// ── Helpers ───────────────────────────────────────────────────

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

function loadAll(): Record<string, DockProfileState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(profiles: Record<string, DockProfileState>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {}
}

// ── Legacy fallback readers ───────────────────────────────────

function loadLegacyOrder(): Partial<Record<DockArea, string[]>> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LEGACY_ORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadLegacyCollapsed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LEGACY_COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Read a profile, falling back to legacy global keys if absent.
 * Once read, the legacy data is migrated into the new profile key
 * so subsequent reads hit the fresh path.
 */
function loadProfile(profileKey: string): DockProfileState {
  const profiles = loadAll();
  if (profiles[profileKey]) return profiles[profileKey];

  // Attempt one-time migration from legacy keys.
  const legacyOrder = loadLegacyOrder();
  const legacyCollapsed = loadLegacyCollapsed();
  if (legacyOrder || legacyCollapsed.length > 0) {
    const migrated: DockProfileState = {};
    if (legacyOrder) migrated.order = legacyOrder;
    if (legacyCollapsed.length > 0) migrated.collapsed = legacyCollapsed;
    profiles[profileKey] = migrated;
    saveAll(profiles);
    // Clear legacy keys after migration.
    try {
      localStorage.removeItem(LEGACY_ORDER_KEY);
      localStorage.removeItem(LEGACY_COLLAPSE_KEY);
    } catch {}
    return migrated;
  }

  return {};
}

// ── Public API ────────────────────────────────────────────────

export function loadPanelOrder(area: DockArea, profileKey: string): string[] | null {
  const profile = loadProfile(sanitizeKey(profileKey));
  return profile.order?.[area] ?? null;
}

export function savePanelOrder(area: DockArea, profileKey: string, order: string[]): void {
  const key = sanitizeKey(profileKey);
  const profiles = loadAll();
  if (!profiles[key]) profiles[key] = {};
  if (!profiles[key].order) profiles[key].order = {};
  profiles[key].order![area] = order;
  saveAll(profiles);
}

export function loadCollapsedPanels(profileKey: string): string[] {
  const profile = loadProfile(sanitizeKey(profileKey));
  return profile.collapsed ?? [];
}

export function isPanelCollapsed(profileKey: string, panelId: string): boolean {
  return loadCollapsedPanels(profileKey).includes(panelId);
}

export function setPanelCollapsed(profileKey: string, panelId: string, collapsed: boolean): void {
  const key = sanitizeKey(profileKey);
  const profiles = loadAll();
  if (!profiles[key]) profiles[key] = {};
  const ids = profiles[key].collapsed ? [...profiles[key].collapsed!] : [];
  if (collapsed) {
    if (!ids.includes(panelId)) ids.push(panelId);
  } else {
    const idx = ids.indexOf(panelId);
    if (idx >= 0) ids.splice(idx, 1);
  }
  profiles[key].collapsed = ids;
  saveAll(profiles);
}

export function loadPanelSize(profileKey: string, panelId: string): number | null {
  const profile = loadProfile(sanitizeKey(profileKey));
  return profile.sizes?.[panelId] ?? null;
}

export function savePanelSize(profileKey: string, panelId: string, size: number): void {
  const key = sanitizeKey(profileKey);
  const profiles = loadAll();
  if (!profiles[key]) profiles[key] = {};
  if (!profiles[key].sizes) profiles[key].sizes = {};
  profiles[key].sizes![panelId] = size;
  saveAll(profiles);
}

/**
 * Reorder panels according to a saved order array.
 * Panels present in savedOrder but not in the current panel list are
 * silently dropped; panels not mentioned in savedOrder are appended.
 */
export function applyPanelOrder<T extends { id: string }>(panels: T[], savedOrder: string[] | null): T[] {
  if (!savedOrder || savedOrder.length === 0) return panels;
  const panelMap = new Map(panels.map(p => [p.id, p]));
  const ordered: T[] = [];
  const remaining = new Set(panels.map(p => p.id));

  for (const id of savedOrder) {
    if (remaining.has(id)) {
      ordered.push(panelMap.get(id)!);
      remaining.delete(id);
    }
  }
  for (const p of panels) {
    if (remaining.has(p.id)) {
      ordered.push(p);
    }
  }
  return ordered;
}
