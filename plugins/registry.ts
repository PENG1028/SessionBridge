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
  () => Promise<{ default: ComponentType<any> }>
> = {
  terminal: () => import('./terminal/index'),
  dashboard: () => import('./dashboard/index').then(m => ({ default: m.DashboardView as ComponentType<HostComponentProps> })),
  approvals: () => import('./approvals/index').then(m => ({ default: m.ApprovalCenter as ComponentType<HostComponentProps> })),
  'claude-chat': () => import('./claude-chat/index').then(m => ({ default: m.ClaudeChatView as ComponentType<HostComponentProps> })),
  'plugin-manager': () => import('./plugin-manager/index').then(m => ({ default: m.AppManager as ComponentType<HostComponentProps> })),
  mesh: () => import('./mesh/index').then(m => ({ default: m.NodeNetworkView as ComponentType<HostComponentProps> })),
};
