# SessionNode v2 — Capability Status Matrix

> Plugin platform capability inventory: implementation status, handler binding, test coverage, and UI behavior.
> Reference: PLUGIN_CORE_API_CONTRACT.md, PLUGIN_MANIFEST_SPEC.md, PLUGIN_SECURITY_MODEL.md

---

## 1. Capability Status Matrix — sessionnode-core

The core plugin (`sessionnode-core`) declares 40 capabilities in `AllPluginsCaps`. The following matrix covers the 28 capabilities most directly relevant to the plugin platform management surface.

### Plugin Management (18 capabilities)

| Capability | Status | Handler | Notes |
|---|---|---|---|
| `system.info` | ✅ implemented | `systemInfo` | Returns OS, arch, Go version, CPU count, hostname, goroutine count |
| `plugin.list` | ✅ implemented | `pluginList` | Returns all discovered plugins (built-in + manifest) with status |
| `plugin.get` | ✅ implemented | `pluginGet` | Returns full manifest detail including core and adapters sections |
| `plugin.info` | ✅ implemented | `pluginInfo` | Returns plugin summary enriched with manifest data |
| `plugin.status` | ✅ implemented | `pluginStatus` | Returns enabled/disabled/error with manifest error detail |
| `plugin.check` | ✅ implemented | `pluginCheck` | Real dependency detection: binary (LookPath), env (os.Getenv), command (run), path/file/directory (os.Stat) |
| `plugin.enable` | ✅ implemented | `pluginEnable` | Real: writes to `config.DisabledPlugins` |
| `plugin.disable` | ✅ implemented | `pluginDisable` | Real: writes to `config.DisabledPlugins` |
| `plugin.install.plan` | ✅ implemented | `pluginInstallPlan` | Generates real install plan with steps, risk assessment, planId; stores in PlanStore in-memory |
| `plugin.install.execute` | ✅ implemented | `pluginInstallExecute` | Validates plan is approved, dry-run executes steps, records history. DRY-RUN: no real system commands are run |
| `plugin.uninstall` | ✅ implemented | `pluginUninstall` | Removes registered files from PlanStore, cleans up install plans, records plugin.uninstalled history event. DRY-RUN: no real files are deleted |
| `plugin.cache.list` | ✅ implemented | `pluginCacheList` | Returns manifest-declared clearable cache declarations |
| `plugin.cache.info` | ✅ implemented | `pluginCacheInfo` | Returns detailed cache info per cache entry |
| `plugin.cache.clear` | ⏳ stub | `pluginCacheClear` | Returns `not_implemented` (bulk clear without plan) |
| `plugin.cache.clear.plan` | ✅ implemented | `pluginCacheClearPlan` | Lists cache paths, returns planId for approval |
| `plugin.cache.clear.execute` | ✅ implemented | `pluginCacheClearExecute` | Requires planId, deletes specified paths, records history |
| `plugin.files.list` | ✅ implemented | `pluginFilesList` | Returns manifest-declared file locations (config, data, cache, logs, custom) |
| `plugin.files.register` | ✅ implemented | `pluginFilesRegister` | Stores file paths per plugin in PlanStore; tracks artifacts for uninstall lifecycle |

### Permission Management (3 capabilities)

| Capability | Status | Handler | Notes |
|---|---|---|---|
| `plugin.permissions.list` | ✅ implemented | `pluginPermissionsList` | Returns permission declarations with current grant state |
| `plugin.permissions.grant` | ✅ implemented | `pluginPermissionsGrant` | High-risk operations require approval; writes grant to config |
| `plugin.permissions.revoke` | ✅ implemented | `pluginPermissionsRevoke` | Removes stored grant; falls back to manifest default |

### Configuration Management (3 capabilities)

| Capability | Status | Handler | Notes |
|---|---|---|---|
| `plugin.config.get` | ✅ implemented | `pluginConfigGet` | Returns current config values + revision number |
| `plugin.config.set` | ✅ implemented | `pluginConfigSet` | With optimistic locking (revision-based conflict detection) |
| `plugin.config.schema` | ✅ implemented | `pluginConfigSchema` | Returns JSON Schema from manifest `configuration` section |

### Node Management (3 capabilities)

| Capability | Status | Handler | Notes |
|---|---|---|---|
| `node.list` | ✅ implemented | `nodeList` | Returns known peers from topology; fallback to local-only |
| `node.info` | ✅ implemented | `nodeInfo` | Returns node details enriched with OS/arch/hostname |
| `node.health` | ✅ implemented | `nodeHealth` | Health check returning `status: "ok"` |

### Task Management (2 capabilities)

| Capability | Status | Handler | Notes |
|---|---|---|---|
| `task.list` | ✅ implemented | `taskList` | Returns all tasks tracked in the TaskStore (in-memory) |
| `task.info` | ✅ implemented | `taskInfo` | Returns a single task by taskId; supports install/uninstall/check/cache_clear task types with step tracking |

### Run Index (5 capabilities)

| Capability | Status | Handler | Notes |
|---|---|---|---|
| `run.create` | ✅ implemented | `runCreate` | Spawns process + creates run record with policy & metadata; reuses spawnManagedProcess helper |
| `run.list` | ✅ implemented | `runList` | Lists runs with kind/pluginId/state filters; auto-syncs run state from ProcessManager |
| `run.info` | ✅ implemented | `runInfo` | Returns run detail + process snapshot (pid/state/exitCode/command) |
| `run.stop` | ✅ implemented | `runStop` | Stops run by sending signal to process; updates run state to stopped |
| `run.updatePolicy` | ✅ implemented | `runUpdatePolicy` | Updates run policy (onDisconnect/onCoreShutdown/persistHistory); rejects restartRestore |

### Other (1 capability)

| Capability | Status | Handler | Notes |
|---|---|---|---|
| `plugin.history` | ✅ implemented | `pluginHistory` | Returns real plugin management events from the history store; Phase 1 is memory-only unless the store is configured for disk |

---

## 2. Status Legend

| Status | Meaning | Color Convention |
|---|---|---|
| ✅ implemented | Handler is registered and returns meaningful data | Green |
| ⏳ stub | Handler exists but returns `not_implemented` or placeholder | Yellow |
| 🔜 planned | Capability declared in `AllPluginsCaps` but no handler exists | Gray |

**Transition Criteria:**

- **stub → implemented**: Handler returns real data from Core state, manifest, or filesystem
- **not registered → stub**: Handler function written and registered in `executor/registry.go`
- **implemented → hardened**: Handler has unit tests, error paths, and edge case coverage

---

## 3. Capabilities Declared in AllPluginsCaps — Not in Main Matrix

The following capabilities are declared in `AllPluginsCaps` for `sessionnode-core` but are grouped under other plugin domains. They are included here for completeness.

| Plugin Domain | Capabilities | Status Summary |
|---|---|---|
| **session** | `session.list`, `session.info`, `session.get` | ✅ implemented — `sessionList`, `sessionInfo`, `sessionGet` |
| **session.history** | `session.history.getPolicy`, `session.history.setPolicy`, `session.history.stats`, `session.history.list`, `session.history.clear.plan`, `session.history.clear.execute` | ✅ all implemented |
| **notify** | `notify.send`, `notify.request`, `notify.respond` | ✅ all implemented |

### Capabilities for Other Plugin IDs (shell, file-explorer, session)

These capabilities are registered in `AllPluginsCaps` under non-core plugin IDs. They are **not** part of `sessionnode-core`'s capability set but are recognized by the permission system.

| Plugin ID | Capabilities | Status |
|---|---|---|
| **shell** | `process.spawn`, `process.signal`, `process.resize`, `process.list` | ✅ all implemented |
| **shell** | `session.create`, `session.destroy`, `session.list`, `session.info`, `session.get` | ✅ all implemented |
| **shell** | `stream.subscribe`, `stream.write`, `stream.list`, `stream.replay`, `stream.tail` | ✅ all implemented |
| **shell** | `env.get`, `env.set`, `env.list`, `env.unset`, `env.checkBinary`, `env.which`, `env.home`, `env.cwd` | ✅ all implemented |
| **file-explorer** | `fs.read`, `fs.write`, `fs.list`, `fs.mkdir`, `fs.remove`, `fs.rename`, `fs.stat` | ✅ all implemented |
| **session** | `session.create`, `session.destroy`, `session.list`, `session.info`, `session.get` | ✅ all implemented |
| **session** | `stream.subscribe`, `stream.write`, `stream.list`, `stream.replay`, `stream.tail` | ✅ all implemented |
| **session** | `session.history.getPolicy`, `session.history.setPolicy`, `session.history.stats`, `session.history.list`, `session.history.clear.plan`, `session.history.clear.execute` | ✅ all implemented |

### Capabilities Not Declared in AllPluginsCaps (Known Gaps)

| Capability | GAP | Notes |
|---|---|---|
| `network.*` | ❌ Not declared | No network capability exists in the permission system. Needed for Claude Code API calls. |
| `approval.*` | 🔜 Planned | Declared in API contract docs but not in `AllPluginsCaps` |
| `config.*` (non-plugin) | ⏳ Partial | `config.get`/`config.set` mentioned in API contract but no handlers for global config |
| `logs.*` | 🔜 Planned | `logs.tail`/`logs.query`/`logs.export` in API contract but not implemented |
| `audit.*` | 🔜 Planned | `audit.list`/`audit.get`/`audit.export` in API contract but not implemented |
| `task.*` | ⏳ Partial | `task.list` and `task.info` implemented; TaskStore is in-memory with Task types for install/uninstall/check/cache_clear |
| `action.*` | 🔜 Planned | Operation execution in API contract |

---

## 4. UI Behavior by Status

Each capability status maps to a specific UI presentation in the Plugin Manager and Detail panels.

| Status | Plugin Manager Behavior | Plugin Detail Behavior |
|---|---|---|
| **✅ implemented** | Capability badge shown as green; tooltip shows "Implemented" | Full expandable detail section with response example |
| **⏳ stub** | Capability badge shown as yellow; tooltip shows "Coming in Phase 2" | Collapsed by default; shows "Not yet implemented" placeholder |
| **🔜 planned** | Not shown in default view; visible under "Show all capabilities" | Gray placeholder with planned phase label |
| **not registered** | Not shown | Not shown |

### Permission Requirement Display

| Permission Level | UI Indicator |
|---|---|
| `allow` | Green lock icon — no user action needed |
| `ask` | Yellow question icon — user will be prompted on each call |
| `deny` | Red lock icon — capability blocked |
| `high-risk` | Red shield icon + "Plan Required" badge — requires approval workflow |

### Plugin List View Columns

| Column | Source | Behavior |
|---|---|---|
| Plugin ID | Manifest / built-in | Always shown |
| Version | Manifest | Shown; "0.1.0" for built-in |
| Status | `plugin.status` | Color-coded: green=enabled, red=error, gray=disabled |
| Trust Level | Manifest `trusted` field | Shown as trust badge |
| Capabilities Count | `AllPluginsCaps` | Clickable to expand detail |
| Enable/Disable Toggle | `plugin.enable` / `plugin.disable` | Shows only if capability is implemented |

---

## 5. Test Coverage

### Unit Tests (executor/executor_test.go)

| Capability | Unit Test | Coverage |
|---|---|---|
| `session.create` | `TestSessionCreate`, `TestSessionCreate_EmptyPayload` | Create with/without payload, state assertion |
| `session.destroy` | `TestSessionDestroy`, `TestSessionDestroy_MissingID`, `TestSessionDestroy_NotFound` | Normal, missing ID, not found |
| `session.list` | `TestSessionList` | Multiple sessions |
| `session.info` | `TestSessionInfo`, `TestSessionInfo_MissingID`, `TestSessionInfo_NotFound` | Normal, missing ID, not found |
| `session.get` | `TestSessionGet` | Single session get |
| `stream.write` | `TestStreamWriteAndSubscribe`, `TestStreamWriteWithStreamType` | Write + subscribe, streamType field |
| `stream.subscribe` | `TestStreamWriteAndSubscribe`, `TestStreamSubscribe_MissingID`, `TestStreamSubscribe_UnknownStream` | Subscribe, missing ID, unknown stream |
| `stream.list` | `TestStreamList` | List streams |
| `process.spawn` | `TestProcessSpawn`, `TestProcessSpawn_EmptyCommand`, `TestProcessSpawn_BadCommand` | Normal, empty command, bad command |
| `process.signal` | `TestProcessSpawnAndSignal`, `TestProcessSignal_MissingID` | Signal + kill, missing ID |
| `process.list` | `TestProcessList` | List processes |
| `env.get` | `TestEnvGet`, `TestEnvGet_MissingName`, `TestEnvGet_NotFound` | Normal, missing name, not found |
| `env.set` | `TestEnvSetAndUnset` | Set + verify + unset |
| `env.unset` | `TestEnvSetAndUnset` | Unset |
| `env.list` | `TestEnvList` | List env |
| `env.checkBinary` | `TestEnvCheckBinary`, `TestEnvCheckBinary_NotFound` | Found and not found |
| `env.which` | `TestEnvWhich` | Path resolution |
| `env.home` | `TestEnvHome` | Home directory |
| `env.cwd` | `TestEnvCwd` | Working directory |
| `system.info` | `TestSystemInfo` | System info fields |
| `fs.read` | `TestFsWriteAndRead`, `TestFsRead_MissingPath`, `TestFsRead_NotFound` | Read, missing path, not found |
| `fs.write` | `TestFsWriteAndRead` | Write |
| `fs.list` | `TestFsList`, `TestFsList_DefaultPath` | List with path, default path |
| `node.list` | `TestNodeList` | Multiple nodes |
| `node.health` | `TestNodeHealth` | Health check |
| `plugin.check` | `TestPluginCheck_ReturnsOK` | Status check |
| `plugin.cache.list` | `TestPluginCacheList_ReturnsEmpty` | Cache list |
| `plugin.install.plan` | `TestPluginInstallPlan_ReturnsPendingApproval`, `TestInstallPlan_UnknownPlugin_ReturnsErrorSafe`, `TestInstallPlan_PlanIdUnique` | Plan generation, error safety, uniqueness |
| `plugin.install.execute` | `TestInstallExecute_WithoutApproval_Fails`, `TestInstallExecute_WithApprovedPlan_Succeeds`, `TestInstallExecute_DryRunOnly_NoRealCommands`, `TestInstallExecute_MissingPlanId_ReturnsError`, `TestInstallExecute_PlanNotFound_ReturnsError`, `TestInstallExecute_PlanIdFromRequestLevel` | Plan validation, approval gating, dry-run enforcement, error paths |
| `plugin.uninstall` | `TestUninstall_ReturnsResult`, `TestUninstall_RecordsHistory` | Returns registered files, history recording |
| `plugin.files.register` | `TestFilesRegister_RegistersFiles`, `TestFilesRegister_ReturnsRegisteredList`, `TestFilesRegister_MissingPluginId_FallsBackToRequest` | File registration, list accumulation, fallback |
| `plugin.cache.clear` | `TestPluginCacheClear_ReturnsNotImplemented` | Stub verification (bulk clear without plan) |
| `plugin.enable` / `plugin.disable` | `TestPluginEnable`, `TestPluginDisable`, plus edge-case tests | Writes disabled plugin state and rejects built-in plugin disable |
| `plugin.config.set` | `TestPluginConfigSet`, `TestPluginConfigSet_WithRevision`, `TestPluginConfigSet_Conflict` | Config writes and optimistic locking |
| `plugin.permissions.grant` / `plugin.permissions.revoke` | `TestPluginPermissionsGrant*`, `TestPluginPermissionsRevoke*` | Grant/revoke behavior, invalid modes, high-risk approval status |
| `plugin.cache.clear.plan` / `plugin.cache.clear.execute` | `TestPluginCacheClearPlan_NoCacheId`, `TestPluginCacheClearExecute_NoPlanId` | Plan and execute validation paths |
| `plugin.history` | `TestPluginHistory_RecordsEvents` | Real plugin event capture |
| `task.list` / `task.info` | `TestTaskCreate`, `TestTaskList`, `TestTaskInfo`, `TestTaskInfo_MissingTaskId`, `TestTaskInfo_NotFound`, `TestTaskProgress`, `TestTaskFailed` | Task lifecycle: create, list, info, progress, failure |
| `run.create` | `TestRunCreate`, `TestRunCreate_DefaultKind`, `TestRunCreate_EmptyCommand`, `TestRunCreate_InvalidPolicy`, `TestRunCreate_UnsupportedOnCoreShutdown`, `TestRunCreate_Metadata` | Create with policy validation, kind default, metadata |
| `run.list` | `TestRunList`, `TestRunList_FilterByKind` | List all + filter by kind |
| `run.info` | `TestRunInfo`, `TestRunInfo_NotFound` | Detail + process snapshot; not found |
| `run.stop` | `TestRunStop`, `TestRunStop_NotFound` | Stop + state verification; not found |
| `run.updatePolicy` | `TestRunUpdatePolicy`, `TestRunUpdatePolicy_RejectsRestartRestore` | Policy update + validation |
| `run integration` | `TestRunIntegration_ProcessSpawnStillWorks`, `TestRunIntegration_StreamWriteToRunProcess`, `TestRunIntegration_DisconnectDoesNotKillRunProcess` | process.spawn preserved, stream write works, disconnect protection |
| `run registry` | `TestRegisteredRunCapabilitiesInHandlers` | All 5 run caps registered |
| `notify.respond` (approval) | `TestNotifyRespond_Approve_UpdatesRequest`, `TestNotifyRespond_Approve_UpdatesLinkedPlan`, `TestNotifyRespond_Deny_UpdatesLinkedPlan` | Approval/deny updates linked plans and requests |
| `high-risk grant approval` | `TestHighRiskGrant_WithoutPlan_RequiresApproval`, `TestHighRiskGrant_WithApprovedPlan_Succeeds`, `TestHighRiskGrant_WithDeniedPlan_Fails` | High-risk grant plan/approval/deny lifecycle |
| `session.history.*` | `TestWSHistoryE2E` | Full history lifecycle E2E |

### E2E Tests (server/server_test.go)

| Test | Capabilities Tested | Description |
|---|---|---|
| `TestWSSessionCreate` | `session.create` | Full WS round-trip with request ID |
| `TestWSSessionCreateAndInfo` | `session.create`, `session.info` | Create then info |
| `TestWSSessionList` | `session.create`, `session.list` | Create two, list |
| `TestWSSystemInfo` | `system.info` | System info WS round-trip |
| `TestWSEnvGet` | `env.get` | Env get WS round-trip |
| `TestWSStreamWriteAndSubscribe` | `stream.write`, `stream.subscribe` | WS write + subscribe |
| `TestWSAccessControl_AllowedCap` | Permissions | Capability allow |
| `TestWSAccessControl_UndeclaredCap` | Permissions | Undeclared cap rejection |
| `TestWSAccessControl_NotGrantedCap` | Permissions | Not-granted cap rejection |
| `TestWSAccessControl_DenyMode` | Permissions | Deny mode |
| `TestWSHistoryE2E` | `session.history.*`, `stream.replay` | Full history lifecycle |
| `TestTerminalPluginE2E` | `process.spawn`, `stream.replay` | Process spawn + history |
| `TestWSProcessSpawnAndStream` | `process.spawn`, `stream.subscribe` | Spawn + stream output + exit event |

### Permission System Tests (permission/registry_test.go)

| Test | Description |
|---|---|
| `TestMapRegistry_HasCapability` | Capability lookup |
| `TestMapRegistry_UnknownPlugin` | Unknown plugin returns false |
| `TestMapRegistry_EmptyCaps` | Empty caps returns false |
| `TestAllPluginsCaps_Completeness` | All known plugins have at least one cap |

### Test Coverage Summary

| Layer | File | Test Count | Notes |
|---|---|---|---|
| Executor unit tests | `executor/executor_test.go` | ~130+ tests | Covers session, stream, process, env, fs, system, node, plugin management (all 40 sessionnode-core caps), 17 `plugin.check` real dependency tests, install lifecycle (plan/execute/uninstall), files register, task management, approval workflow, run index (18 tests) |
| Server E2E tests | `server/server_test.go` | ~18 tests | Full WebSocket round-trip, access control, history |
| Registry tests | `permission/registry_test.go` | 4 tests | Capability registry, completeness |
| Process manager tests | `process/manager_test.go` | Additional | Process lifecycle, signals, stdin, cleanup |
| History store tests | `internal/history/store_test.go` | ~55+ tests | Init, record, replay, tail, truncation, clear, disk mode, concurrent access, stdin redaction (6 tests), edge cases |
| **Total** | | **~170+ tests** | |

### Coverage Gaps

| Capability | Missing Tests | Risk |
|---|---|---|
| `plugin.list` | No unit test (tested implicitly via WS) | Low |
| `plugin.info` / `plugin.get` | No unit test | Low |
| `plugin.permissions.list` | No unit test | Low |
| `plugin.config.schema` | No focused unit test | Low |
| `plugin.cache.clear.plan` / `plugin.cache.clear.execute` | No successful filesystem deletion test | Medium |
| `fs.stat` | No unit test | Low |
| `notify.send` | No unit test | Low |
| `task.list` / `task.info` | No tests when TaskStore is nil | Low |

---

## Appendix A: Handler Registration Map

All handlers are registered in `executor/registry.go` via `registerDefaults()`:

```
plugin.list              → pluginList
plugin.info              → pluginInfo
plugin.get               → pluginGet
plugin.status            → pluginStatus
plugin.check             → pluginCheck
plugin.enable            → pluginEnable
plugin.disable           → pluginDisable
plugin.install           → pluginInstallPlan
plugin.install.plan      → pluginInstallPlan
plugin.install.execute   → pluginInstallExecute
plugin.uninstall         → pluginUninstall
plugin.files.register    → pluginFilesRegister
plugin.files.list        → pluginFilesList
plugin.cache.list        → pluginCacheList
plugin.cache.info        → pluginCacheInfo
plugin.cache.clear       → pluginCacheClear
plugin.cache.clear.plan  → pluginCacheClearPlan
plugin.cache.clear.execute → pluginCacheClearExecute
plugin.permissions.list  → pluginPermissionsList
plugin.permissions.grant → pluginPermissionsGrant
plugin.permissions.revoke → pluginPermissionsRevoke
plugin.config.get        → pluginConfigGet
plugin.config.set        → pluginConfigSet
plugin.config.schema     → pluginConfigSchema
plugin.history           → pluginHistory
task.list                → taskList
task.info                → taskInfo
run.create               → runCreate
run.list                 → runList
run.info                 → runInfo
run.stop                 → runStop
run.updatePolicy         → runUpdatePolicy
system.info              → systemInfo
node.list                → nodeList
node.info                → nodeInfo
node.health              → nodeHealth
session.create           → sessionCreate
session.destroy          → sessionDestroy
session.list             → sessionList
session.info             → sessionInfo
session.get              → sessionGet
session.history.*        → history* handlers
stream.*                 → stream* handlers
process.*                → process* handlers
env.*                    → env* handlers
fs.*                     → fs* handlers
notify.*                 → notify* handlers
```

## Appendix B: AllPluginsCaps by Plugin ID

```go
// sessionnode-core — 42 capabilities
"system.info", "plugin.{list,get,info,status,check,enable,disable}",
"plugin.install.{plan,execute}", "plugin.uninstall",
"plugin.cache.{list,info,clear,clear.plan,clear.execute}",
"plugin.files.{list,register}",
"plugin.permissions.{list,grant,revoke}",
"plugin.config.{get,set,schema}", "plugin.history",
"node.{list,info,health}",
"task.{list,info}",
"session.{list,info,get}",
"session.history.{getPolicy,setPolicy,stats,list,clear.plan,clear.execute}",
"notify.{send,request,respond}"

// shell — 23 capabilities
"session.{create,destroy,list,info,get}",
"stream.{subscribe,write,list,replay,tail}",
"process.{spawn,signal,resize,list}",
"env.{get,set,list,unset,checkBinary,which,home,cwd}"

// file-explorer — 7 capabilities
"fs.{read,write,list,mkdir,remove,rename,stat}"

// session — 15 capabilities
"session.{create,destroy,list,info,get}",
"stream.{subscribe,write,list,replay,tail}",
"session.history.{getPolicy,setPolicy,stats,list,clear.plan,clear.execute}"
```

---

> **Last updated:** 2026-05-20 (Round 8: run.create/list/info/stop/updatePolicy added with internal/run package; background/detached process gap addressed via run index)
> **Related docs:** [PLUGIN_CORE_API_CONTRACT.md](./PLUGIN_CORE_API_CONTRACT.md) | [PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md) | [PLUGIN_SECURITY_MODEL.md](./PLUGIN_SECURITY_MODEL.md) | [PLUGIN_ADAPTERS.md](./PLUGIN_ADAPTERS.md)
