'use client';

/**
 * Plugin SDK — stable hooks for plugin implementations.
 *
 * Plugins MUST only import from ../../sdk, never directly from app/console/.
 * This allows the core UI to be refactored without breaking plugins,
 * and enables future dynamic loading with sandboxed API access.
 */

// Core connection
export { useCore, useCoreStatus, useActiveNodeId, useReachableNodeIds, useTargetReachability } from '../app/console/core/core-client-provider';
export type { CoreClient, CoreConnectionStatus } from '../app/console/core/core-types';

// Workbench context
export { useWorkbench } from '../app/console/workbench/workbench-context';
export { useFocus } from '../app/console/workbench/focus-context';
export type { FocusState } from '../app/console/workbench/focus-context';

// Session / Input / Tool activity contexts
export { useSessionContext } from '../app/console/workbench/session-context';
export { useInputContext } from '../app/console/workbench/input-context';
export { useToolActivityContext } from '../app/console/workbench/tool-activity-context';

// Dependency checking for plugins
export { useDependencyCheck } from '../app/lib/use-dependency-check';

// A newly exported standalone error hook
export { useCoreErrors } from '../app/console/core/use-core-call';
export { classifyCoreError } from '../app/console/core/core-error';
export type { CoreErrorCategory } from '../app/console/core/core-error';
