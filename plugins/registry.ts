'use client';

// ─── Plugin Component Registry ────────────────────────────────────
// Maps plugin IDs to lazy-loaded React components.
// Next.js analyzes these static import() paths at build time and
// generates independent chunks. Disabled plugins never download.
//
// To add a self-contained plugin:
// 1. Create app/plugins/<id>/index.tsx (export default Component)
// 2. Add entry: '<id>': () => import('@/plugins/<id>/index')
// 3. Set type: custom-react in the plugin's plugin.yaml view/panel
//
// The component MUST accept HostComponentProps.

import type { ComponentType } from 'react';
import type { HostComponentProps } from '../app/console/plugin-host/host-component-registry';

export const pluginComponents: Record<
  string,
  () => Promise<{ default: ComponentType<HostComponentProps> }>
> = {
  terminal: () => import('./terminal/index'),
  'system-info': () => import('./system-info/index'),
};
