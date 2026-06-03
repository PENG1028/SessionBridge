'use client';

import {
  Activity, Bookmark, Camera, Cpu, FileText, Folder, ListChecks,
  Play, ScrollText, Terminal, Upload, Zap,
  Search, Settings,
} from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * Unified icon registry — single source of truth for string → Lucide component.
 *
 * Plugin YAML manifests declare icon names (lowercase-kebab). This map
 * resolves them at runtime. Add new icons here when a plugin needs one
 * that isn't yet mapped.
 *
 * Icon names follow the convention: lowercase-kebab (e.g. "scroll-text").
 * PascalCase names from YAML (e.g. "Activity") MUST NOT be used — they
 * will not resolve. Convert to lowercase-kebab in the YAML instead.
 */
export const iconRegistry: Record<string, ComponentType<{ className?: string }>> = {
  // Panel icons
  activity: Activity,
  bookmark: Bookmark,
  camera: Camera,
  cpu: Cpu,
  'file-text': FileText,
  folder: Folder,
  'list-checks': ListChecks,
  play: Play,
  'scroll-text': ScrollText,
  terminal: Terminal,
  upload: Upload,
  zap: Zap,

  // Header/chrome icons
  search: Search,
  settings: Settings,
};

export function resolveIcon(name?: string): ComponentType<{ className?: string }> | undefined {
  return name ? iconRegistry[name] : undefined;
}
