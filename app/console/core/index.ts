export { CoreClientImpl, createCoreClient, createMockCoreClient } from './core-client';
export { CoreClientProvider, useCoreClient, useCore, useCoreStatus, useIsOnline } from './core-client-provider';
export { useCoreEvent, useCoreEvents, CoreEvents } from './core-events';
export { useAppSync } from './use-app-sync';
export type {
  CoreClient,
  CoreConnectionStatus,
  CoreEvent,

  // API param types
  NotifyListParams,
  ApprovalListParams,
  LogQueryParams,
  AuditListParams,
  SessionListParams,
  StreamWriteParams,
  PluginListParams,
  ConfigGetParams,
  ConfigSetParams,
  NodeGetParams,

  // Response types
  SessionInfo,
  SessionStatus,
  PluginInfo,
  PluginStatus,
  NodeInfo,
  NodeStatus,
  ConfigEntry,
  TaskEvent,
} from './core-types';
