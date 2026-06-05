'use client';

/**
 * Plugin SDK — the ONLY entry point plugins should import from.
 *
 * Plugins must import from this module, NEVER directly from app/console/.
 * Example:
 *   import { useCore, useWorkbench } from '../../sdk';
 *
 * This decouples plugins from core UI internals, enabling future
 * dynamic loading, sandboxing, and independent plugin distribution.
 */

export { useCore, useCoreStatus, useActiveNodeId, useReachableNodeIds, useTargetReachability, useCoreErrors, classifyCoreError, useDependencyCheck, useWorkbench, useFocus, useSessionContext, useInputContext, useToolActivityContext } from './hooks';
export type { CoreClient, CoreConnectionStatus, FocusState, CoreErrorCategory } from './hooks';

export { ShellTerminal, TitleBar, DirectoryPicker, SystemContextBar, FileExplorer } from './components';

export { getLastActiveDir, setLastActiveDir, getRestoreLastPath, TOOL_SEMANTICS, evaluateWhen, normalizeNodeInfo, listFromResponse, normalizeSessionInfo, loadApps, isEnabled, setEnabled, getLoadError, invalidateCache, getGrant, setGrant, getManifest, registerPanelComponent, TerminalInputBuffer, createDebouncedResize } from './utils';

export type { HostComponentProps, CoreEvent, NodeInfo, PeerEntry, NodeInvite, SessionInfo, AppSummary, AppManifest, AppSystemUI, AppUIPanel, AppPermissionSpec, CheckResult, InstalledSoftwareEntry, WhenContext } from './types';
