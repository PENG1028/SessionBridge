// ─── Types ──────────────────────────────────────────

export interface ProviderPreset {
  id: string;
  label: string;
  provider: 'anthropic' | 'openai';
  baseUrl: string;
  model: string;
  category?: string;
  icon?: string;
  iconColor?: string;
}

// ─── Built-in presets (static JSON data) ────────────
// Imported from JSON so user-defined presets (stored elsewhere)
// can be merged at runtime using the same shape.

import builtinPresets from './provider-presets.json';

export const PROVIDER_PRESETS: ProviderPreset[] = builtinPresets as ProviderPreset[];

// ─── Categories (derived from presets) ──────────────

export const PRESET_CATEGORIES = [
  { id: 'official', label: 'Official' },
  { id: 'cn_official', label: 'CN Official' },
  { id: 'aggregator', label: 'Aggregator' },
  { id: 'third_party', label: 'Third Party' },
] as const;

// ─── Lookup helpers ─────────────────────────────────

export function getPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === id);
}

export function getPresetsByCategory(category: string): ProviderPreset[] {
  return PROVIDER_PRESETS.filter(p => p.category === category);
}

/**
 * Merge user-defined presets with built-in ones.
 * User presets with the same id override built-in ones.
 * To be used once a storage layer is available.
 */
export function mergePresets(userPresets: ProviderPreset[]): ProviderPreset[] {
  const map = new Map<string, ProviderPreset>();
  for (const p of PROVIDER_PRESETS) map.set(p.id, p);
  for (const p of userPresets) map.set(p.id, p);
  return Array.from(map.values());
}
