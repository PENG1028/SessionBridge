'use client';

/**
 * Plugin SDK — stable utility functions for plugin implementations.
 */

export { getLastActiveDir, setLastActiveDir, getRestoreLastPath } from '../app/lib/path-bookmarks';
export { TOOL_SEMANTICS } from '../app/console/shared/tool-constants';
export { evaluateWhen } from '../lib/evaluate-when';
export { normalizeNodeInfo, listFromResponse, normalizeSessionInfo } from '../app/console/core/core-response-utils';
export { loadApps, isEnabled, setEnabled, getLoadError, invalidateCache } from '../app/lib/app-registry/app-registry';
export { registerPanelComponent } from '../app/console/panels/panel-registry';
