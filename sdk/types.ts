'use client';

/**
 * Plugin SDK — stable types for plugin implementations.
 */

export type { HostComponentProps } from '../app/console/plugin-host/host-component-registry';
export type { CoreEvent, NodeInfo, PeerEntry, NodeInvite, SessionInfo } from '../app/console/core/core-types';

export type { AppSummary, AppManifest, AppSystemUI, AppUIPanel } from '../app/lib/app-registry/app-types';
export type { WhenContext } from '../lib/evaluate-when';
