# Local + VPS Real-World Test Scenarios

> **Date**: 2026-05-20
> **Core Version**: Phase 1 (in-memory sessions, memory/disk history, basic topology)
> **Node Environment**: Windows local (`node-local`) + Tencent Cloud VPS (`node-vps`)

## Conventions

| Term | Meaning |
|------|---------|
| local | Windows machine, go-core instance `node-local` |
| VPS | Remote server 43.160.241.180, go-core instance `node-vps` |
| system-ui | First-party UI client (web/desktop) |
| shell plugin | Plugin that provides terminal/shell capability |
| external client | Script/CLI with service token, no plugin context |
| Actor Type | `web` (browser UI), `cli` (terminal tool), `node` (node-to-node), `external` (service token) |

---

## Scenario 1: Local Terminal, VPS Joins Late to View History

### Topology

```
[Local node-local:9091]  ←peer→  [VPS node-vps:9090]
      │                              │
  [system-ui A]                  [system-ui B (late join)]
```

### Actor: system-ui (via shell plugin)

### Target Node: local (session lives on local)

### Core API Call Chain

```
1. A → App UI built-in system pages:  session.create { pluginId:"shell", command:"bash" }
2. A → local dispatcher:  stream.write { stream:"stdin", data:"ls\n" }
3. local → process:       stdout/stderr chunks pushed via connection registry
4. (time passes, A closes tab)
5. B → VPS system-ui:     session.list
6. VPS topology:          forward to local (TargetNodeID=node-local)
7. local dispatcher:      execute session.list → return sessions
8. B → VPS system-ui:     session.info { sessionId: "sess_1" }
9. VPS → local (route):   execute → return metadata
10. B → VPS system-ui:    stream.replay { sessionId:"sess_1", streamType:"stdout", fromSeq:0 }
11. VPS → local (route):  execute → return events
12. B → VPS system-ui:    stream.tail { sessionId:"sess_1", streamType:"stdout", lines:10 }
13. VPS → local (route):  execute → return last events
```

### Permission Path

- `session.create` → AllowAll policy (dev mode)
- `session.list` → AllowAll
- `session.info` → AllowAll
- `stream.replay` → AllowAll
- `stream.tail` → AllowAll

### Plan Before Apply: No

### Session / History / Log / Audit

- `local` creates session → `sess_1`
- `local` records stdout/stderr into history store of LOCAL
- `local` history policy: memory mode, 100MB max, includes stdout+stderr
- `local` audit records all API calls
- `VPS` audit records route metadata (forwarding did not execute)
- Target node (`local`) writes final audit

### Failure Scenarios

| Failure | Expected |
|---------|----------|
| sess_1 not found | `session.info` returns error |
| history policy disabled | `stream.replay` returns `HISTORY_DISABLED` |
| `fromSeq` before earliest event | `stream.replay` returns `HISTORY_RANGE_TRUNCATED` + available range |
| `fromSeq` after last event | Empty event list, no error |
| stdin requested | `stream.replay {streamType:"stdin"}` returns empty (not recorded by default) |

### Corresponding Tests

- `TestTwoCore_Scenario1_LocalTerminal_VPSViewsHistory`
- `TestTwoCore_Scenario1_ReplayAfterTruncation`
- `TestTwoCore_Scenario1_StdinReplayDenied`

---

## Scenario 2: VPS Starts ClaudeCode, Local Takes Over Viewing

### Topology

```
[Local node-local:9091]  ←peer→  [VPS node-vps:9090]
      │                              │
  [system-ui B]                  [system-ui A / claude-code plugin]
```

### Actor: system-ui (via claude-code plugin on VPS)

### Target Node: VPS

### Core API Call Chain

```
1. A → VPS:              session.create { pluginId:"claude-code", command:"claude" }
2. VPS process:          spawn claude, push stdout/stderr to connection registry
3. (later) B → local:    session.list
4. local dispatcher:      TargetNodeID=node-vps → forward to VPS
5. VPS dispatcher:        execute session.list, return sessions (including claude-code session)
6. B → local:            session.get { sessionId, includeMetadata:true }
7. → VPS:                returns { nodeId:node-vps, pluginId:claude-code, cwd:/home/ubuntu, command:"claude" }
8. B → local:            stream.replay { sessionId }
9. → VPS:                returns stdout/stderr history
10. B → local:           stream.tail { sessionId, lines:20 }
11. → VPS:               returns last 20 lines
```

### Permission Path

- `session.create` → AllowAll (dev mode) — executes on VPS
- `session.list` → AllowAll — executes on VPS
- `session.get` → AllowAll — executes on VPS
- `stream.replay` → if permission denied → metadata only, no stream content
- `stream.tail` → same as replay

### Plan Before Apply: No

### Session / History / Log / Audit

- `VPS` creates session → `sess_2`, binds to claude-code process
- `VPS` records stdout/stderr into VPS history store
- `VPS` audit records `session.create`, `session.list`, `session.get`, `stream.replay`
- `Local` audit records route metadata only (log "routed to node-vps")
- `Local` does NOT store VPS stream history in local history store

### Failure Scenarios

| Failure | Expected |
|---------|----------|
| No stream.read permission | `session.get` returns metadata, `stream.replay` returns `PERMISSION_DENIED` |
| VPS node offline | Forward error `NODE_UNREACHABLE` |
| Session not found | `session.get` returns error |

### Corresponding Tests

- `TestTwoCore_Scenario2_VPSClaudeCode_LocalViews`
- `TestTwoCore_Scenario2_PermissionStreamReadDenied`
- `TestTwoCore_Scenario2_VPSOffline`

---

## Scenario 3: External Script Calls Local Core to Run Command on VPS

### Topology

```
[External Script] → HTTP/WS → [Local node-local:9091]  ←peer→  [VPS node-vps:9090]
```

### Actor: external client (no pluginId, service token)

### Target Node: VPS

### Core API Call Chain

```
1. Script → local:          action.request { capability:"process.spawn", targetNodeId:"node-vps",
                               payload:{command:"go", args:["test","./..."], cwd:"/home/ubuntu/project"},
                               actor:{type:"external", token:"<service-token>"} }
2. local authenticator:      validate token → resolve actor
3. local permission:         check pluginId (empty → skip plugin check or use system scope)
4. local dispatcher:         TargetNodeID=node-vps → forward to VPS
5. VPS authenticator:        actor.Type="node", skip token check
6. VPS permission:           check process.spawn grant
7. VPS executor:             spawn "go test ./..." process
8. VPS audit:                log process.spawn { command:"go test ./...", actor:"external", ... }
9. Response:                 route back to local → back to script
```

### Permission Path

- `local`: external actor type allowed (dev mode), empty pluginId → skip plugin check, still check capability registration
- `VPS`: process.spawn must be granted on VPS

### Plan Before Apply: **Yes** — `process.spawn` is not in DefaultHighRiskCaps currently, but should be flagged for external actors.

### Session / History / Log / Audit

- `VPS` audit records `process.spawn` with command metadata but NOT stdout content
- `VPS` audit redacts arguments? (Phase 0: full args visible; Phase 1+: redact)
- `Local` audit records route metadata: "routed to node-vps"
- `Local` history store does NOT persist VPS process stdout
- If token has scope `targetNodes:["node-vps"]`, local MUST reject if target is local

### Failure Scenarios

| Failure | Expected |
|---------|----------|
| No token | `UNAUTHENTICATED` |
| Token scope excludes local | Local reject if TargetNodeID empty or local |
| process.spawn not granted on VPS | `PERMISSION_DENIED` from VPS |
| VPS unreachable | `NODE_UNREACHABLE` |
| No pluginId with high-risk cap | Should require explicit scope or plan |

### Corresponding Tests

- `TestTwoCore_Scenario3_ExternalCall_VPSExec`
- `TestTwoCore_Scenario3_TokenScopeDeniesLocal`
- `TestTwoCore_Scenario3_VPSAuditCommandMetadata`

---

## Scenario 4: Local and VPS View Same Session Simultaneously

### Topology

```
[Local node-local:9091]  ←peer→  [VPS node-vps:9090]
      │                              │
  [system-ui A]                  [system-ui B]
      │ (subscribed)                │ (subscribed to same session)
      └──────── sess_1 ─────────────┘
```

### Core API Call Chain

```
1. A → local:       session.create → sess_1 created on local
2. A → local:       stream.subscribe { sessionId:"sess_1", stream:"stdout" }
3. local conn reg:  register A's writeCh for sess_1
4. B → VPS:         stream.subscribe { sessionId:"sess_1", stream:"stdout" }
5. VPS topology:    forward → local
6. local:           register B's writeCh for sess_1 (two subscribers now)
7. Process stdout:  pushChunk → history store → A writeCh + B writeCh
8. B pauses:        close subscriber (unregister B's writeCh)
9. Process stdout:  pushChunk → history store → A writeCh only (B unaffected)
10. A closes tab:   unregister A's writeCh (process still runs)
11. A → local:      session.stop { sessionId:"sess_1" }
12. local:          kill process, set state stopped, broadcast event
13. Both A+B:       receive session.stopped event
14. Either:         stream.replay still works (history available)
```

### Permission Path

- `session.create` → AllowAll
- `stream.subscribe` → AllowAll
- `session.stop` → AllowAll

### Plan Before Apply: No

### Session / History / Log / Audit

- `local` is session owner, process runner, and history store
- Both clients receive real-time chunks via connection registry
- Pausing one does not affect the other (subscribers independent)
- Closing subscriber does not stop process (need explicit session.stop)
- After stop, replay still works per history policy

### Failure Scenarios

| Failure | Expected |
|---------|----------|
| Subscribeunknown session | Error |
| Process dies unexpectedly | session.exited event to all subscribers |
| Both close tabs without stop | Process orphaned (needs cleanup policy TBD) |

### Corresponding Tests

- `TestTwoCore_Scenario4_TwoSubscribersSameSession`
- `TestTwoCore_Scenario4_PauseOneSubscriber`
- `TestTwoCore_Scenario4_CloseTabDoesNotStopSession`
- `TestTwoCore_Scenario4_ExplicitStop`

---

## Scenario 5: Config Conflict — Local and VPS Edit Settings Simultaneously

> **Status**: `PARTIALLY IMPLEMENTED` — Config Manager exists, revision tracking is MISSING.

### Current Primitive Gap

Config Manager (`internal/config/config.go`) has no revision counter or conflict detection. The `Save()` method overwrites without checking for concurrent modifications.

### Required Core Primitive

Add to `Config` struct:
```go
Revision int64 `json:"revision"`
```

Add to `Manager`:
```go
func (m *Manager) SetWithRevision(key string, value interface{}, expectedRevision int64) error
// returns ConfigConflictError if expectedRevision != current revision
```

### Failure Scenarios

| Failure | Expected |
|---------|----------|
| ExpectedRevision=1, actual=2 | `CONFIG_CONFLICT` error |
| ExpectedRevision=0 always | Allowed (first-time save) |

### Corresponding Tests

- `TestConfig_RevisionConflict`
- `TestConfig_SetWithRevisionOK`

---

## Scenario 6: ClaudeCode Plugin Environment Check Across Nodes

> **Status**: `IMPLEMENTED — LOCAL` — `plugin.check` now performs real dependency detection on the local executor (binary via `exec.LookPath`, env via `os.Getenv`, command via `exec.CommandContext` with 5s timeout, path/file/directory via `os.Stat`). Cross-node plugin.check scenario is not verified (no test yet).

### Current Primitive Gap

- `plugin.check` is now implemented with real dependency detection on the local executor. Cross-node `plugin.check` (one node checking dependencies on another node) is not tested.
- `plugin.install` plan/execute and `plugin.uninstall` remain stubs (Phase 2).
- Version command execution and `RequiredVersion` comparison are not yet implemented (the manifest schema includes these fields but the check loop does not run version commands or compare versions).

### Corresponding Tests

- `TestPluginCheck_*` — 17 unit tests in `internal/executor/executor_test.go` covering all 6 check types (binary, env, command, path, file, directory) with edge cases (empty command, unknown type, required/optional, type_mismatch)
- TODO: cross-node plugin.check (scenario not verified)
- TODO: plugin.install plan (blocked by missing PlanManager integration)
- `TestTwoCore_Scenario6_PluginList_NodeIsolated` — test that each node returns its own list independently

---

## Scenario 7: Plugin Cache and Install History Cross-Node Isolation

> **Status**: `DOCUMENTED ONLY` — plugin cache/install types defined but no executor implementation.

### Current Primitive Gap

- `plugin.cache.list`, `plugin.cache.clear` are NOT registered
- `PluginInstallHistory` type exists but no storage
- No per-node plugin tracking

### Corresponding Tests

- TODO: plugin.cache.list per node (blocked by missing handler)

---

## Scenario 8: Local Approves VPS High-Risk Operation

> **Status**: `PARTIALLY IMPLEMENTED` — notify/approval system exists, but dispatcher does NOT call CreateApproval when permission mode is "ask".

### Current Primitive Gap

- `PermissionGrant.Mode == "ask"` returns `ErrCodeNeedApproval` from permission checker
- But the dispatcher's `Dispatch()` method does NOT:
  1. Call `notify.CreateApproval()`
  2. Wait for response via `WaitForResponse()`
  3. Retry the execution after approval

The current flow is:
```
permission.Check() → returns NEED_APPROVAL → dispatcher returns error response
```

The correct flow should be:
```
permission.Check() → returns NEED_APPROVAL
→ dispatcher calls deps.Notifier.CreateApproval(…)
→ dispatcher waits for approval response
→ if approved, proceed to execute
→ if denied, return denied error
```

This requires the dispatcher to have access to a Notifier interface. Currently the dispatcher only has `permissions`, `executor`, `audit`, `topology`, etc. The approval flow needs to be wired in.

### Corresponding Tests

- TODO: permission "ask" → CreateApproval + WaitForResponse (blocked by dispatcher wiring)
- `TestTwoCore_Scenario8_NotifyRequest_CrossNode` — test that notification broadcast works across topology

---

## Scenario 9: Disconnect and Reconnect

> **Status**: `PARTIALLY IMPLEMENTED` — topology has reconnection loop, but no re-sync mechanism.

### Current State

- `connectLoop` in topology.go handles reconnection with exponential backoff
- After reconnect, `HandleMessage` processes incoming messages
- BUT there's NO session list re-sync, NO stream.replay to fill gaps
- The reconnected peer simply starts receiving new messages

### Required Core Primitives

- Add `node.health` event emission on status changes (connected/disconnected)
- After reconnect, VPS should trigger `session.list` from local to catch up
- If history policy is memory, gap replay is limited (no gap detection yet)

### Corresponding Tests

- `TestTwoCore_Scenario9_DisconnectSessionStillRunning`
- `TestTwoCore_Scenario9_ReconnectSync`

---

## Scenario 10: Daemon Restart Recovery

> **Status**: `PARTIALLY IMPLEMENTED` — history has ReplayFromDisk but no restart wiring.

### Current State

- `history.Store.ReplayFromDisk()` exists for disk-mode recovery
- BUT `main.go` does NOT call it on restart
- `session.Store` is purely in-memory (no persistence)
- `config.Manager.Load()` reads from disk (identity/config restored)
- `audit` log is file-based, restart-safe
- No install history persistence beyond type definition

### Required Core Primitives

- `main.go`: on restart, call `historyStore.ReplayFromDisk()` for known sessions
- Session store would need disk persistence or re-creation from history
- Node identity: restored from config (already works)
- Plugin registry: restored from config (already works)

### Corresponding Tests

- TODO: restart recovery (needs server lifecycle hooks)

---

## Implementation Status Summary

| Scenario | Status | In-Process Test | Real-VPS Test |
|----------|--------|-----------------|---------------|
| 1. Local terminal, VPS views history | ✅ Implemented | `TestTwoCore_Scenario1_*` | Manual |
| 2. VPS ClaudeCode, Local views | ✅ Implemented | `TestTwoCore_Scenario2_*` | Manual |
| 3. External script cross-node exec | ✅ Implemented | `TestTwoCore_Scenario3_*` | `cmd/e2e_dual_node` |
| 4. Two subscribers same session | ✅ Implemented | `TestTwoCore_Scenario4_*` | Manual |
| 5. Config conflict | ⚠️ Partial — needs revision tracking | `TestConfigRevision*` | N/A |
| 6. Plugin check cross-node | ✅ Local — real executor detection; cross-node not tested | `TestPluginCheck_*` (17 tests) | N/A |
| 7. Plugin cache isolation | ⚠️ Implemented — cache info/list/clear.plan/clear.execute work; cross-node not tested | `TestPluginCacheList_ReturnsEmpty`, `TestPluginCacheInfo`, `TestPluginCacheClearPlan_NoCacheId`, `TestPluginCacheClearExecute_NoPlanId` | N/A |
| 8. Cross-node approval | ⚠️ Partial — dispatcher needs approval wiring | `TestTwoCore_Scenario8_*` | Manual |
| 9. Disconnect/reconnect | ⚠️ Partial — needs re-sync | `TestTwoCore_Scenario9_*` | Manual |
| 10. Daemon restart | ⚠️ Partial — `ReplayFromDisk` exists but not wired | TODO | N/A |
