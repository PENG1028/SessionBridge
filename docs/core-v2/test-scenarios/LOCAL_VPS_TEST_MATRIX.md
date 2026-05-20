# Local + VPS Test Matrix

> **Date**: 2026-05-20
> **Core Version**: Phase 1 (in-memory sessions, memory/disk history, basic topology)

## Matrix Legend

| Layer | Scope | Run |
|-------|-------|-----|
| **UT** | Unit test (`*_test.go` in same package) | `go test` |
| **INT** | In-process two-node integration (`topology/e2e_test.go` helpers) | `go test` |
| **E2E** | Real VPS environment (`cmd/e2e_dual_node/`) | Manual, `SESSIONNODE_E2E_REAL=true` |

---

## Scenario Coverage

| # | Scenario | Existing Tests | Missing Tests | Priority |
|---|----------|---------------|---------------|----------|
| 1 | Local terminal, VPS views history | `TestPeerTopology_SessionCreateOnPeer` (INT), `TestPeerTopology_FullE2EWithPeerSessionInfo` (INT) | `TestTwoCore_Scenario1_ReplayAfterTruncation` (INT), `TestTwoCore_Scenario1_StdinReplayDenied` (INT), `TestTwoCore_Scenario1_LocalTerminal_VPSViewsHistory` (INT) | P0 |
| 2 | VPS ClaudeCode, Local views | `TestPeerTopology_SessionCreateOnPeer` (INT), `TestPeerTopology_FullE2EWithPeerSessionInfo` (INT) | `TestTwoCore_Scenario2_VPSClaudeCode_LocalViews` (INT), `TestTwoCore_Scenario2_PermissionStreamReadDenied` (INT), `TestTwoCore_Scenario2_VPSOffline` (INT) | P0 |
| 3 | External script cross-node exec | `TestPeerTopology_ProcessSpawnOnPeer` (INT) | `TestTwoCore_Scenario3_ExternalCall_VPSExec` (INT), `TestTwoCore_Scenario3_TokenScopeDeniesLocal` (INT), `TestTwoCore_Scenario3_VPSAuditCommandMetadata` (INT), E2E real VPS (`cmd/e2e_dual_node`) | P0 |
| 4 | Two subscribers same session | `TestPeerTopology_ConcurrentForwarding` (INT) | `TestTwoCore_Scenario4_TwoSubscribersSameSession` (INT), `TestTwoCore_Scenario4_PauseOneSubscriber` (INT), `TestTwoCore_Scenario4_CloseTabDoesNotStopSession` (INT), `TestTwoCore_Scenario4_ExplicitStop` (INT) | P1 |
| 5 | Config conflict | `TestConfig_LoadSave` (UT), `TestConfig_SetGet` (UT) | `TestConfig_RevisionConflict` (UT), `TestConfig_SetWithRevisionOK` (UT) | P1 |
| 6 | Plugin check cross-node | `TestExecutor_Registry` (UT) | `TestExecutor_PluginCheck` (UT), `TestExecutor_PluginInstallPlan` (UT) | P2 |
| 7 | Plugin cache isolation | None | `TestExecutor_PluginCacheList` (UT), `TestExecutor_PluginCacheClear` (UT) | P2 |
| 8 | Cross-node approval | `TestNotify_CreateAndRespond` (UT), `TestNotify_Timeout` (UT) | `TestTwoCore_Scenario8_NotifyRequest_CrossNode` (INT), dispatcher approval wiring | P1 |
| 9 | Disconnect/reconnect | `TestPeerTopology_AutoReconnect` (INT), `TestPeerTopology_RetryBackoffReset` (INT) | `TestTwoCore_Scenario9_DisconnectSessionStillRunning` (INT), `TestTwoCore_Scenario9_ReconnectSync` (INT) | P1 |
| 10 | Daemon restart | `TestHistory_ReplayFromDisk` (UT) | restart wiring tests (needs lifecycle hooks) | P2 |

---

## Detailed Test Inventory

### Existing Tests That Cover Scenario Aspects

| Test | File | What It Covers | Scenarios |
|------|------|----------------|-----------|
| `TestPeerTopology_ConnectAndList` | `topology/e2e_test.go` | Peer WS connect + `ListNodes` | 9 (basic) |
| `TestPeerTopology_ForwardSystemInfo` | `topology/e2e_test.go` | Forward `system.info` to peer | 1, 2, 3 (routing) |
| `TestPeerTopology_SessionCreateOnPeer` | `topology/e2e_test.go` | Create session on remote peer | 1, 2 |
| `TestPeerTopology_ProcessSpawnOnPeer` | `topology/e2e_test.go` | Spawn process on remote peer | 3 |
| `TestPeerTopology_BidirectionalForward` | `topology/e2e_test.go` | A→B + B→A forwarding | 1, 2 |
| `TestPeerTopology_DisconnectedPeer` | `topology/e2e_test.go` | Forward error to disconnected peer | 2, 9 |
| `TestPeerTopology_UnknownNodeError` | `topology/e2e_test.go` | Error for unknown `TargetNodeID` | 3 |
| `TestPeerTopology_AutoReconnect` | `topology/e2e_test.go` | Reconnect after WS close | 9 |
| `TestPeerTopology_DeferredPeerStart` | `topology/e2e_test.go` | Retry loop liveness | 9 |
| `TestPeerTopology_RetryBackoffReset` | `topology/e2e_test.go` | Backoff reset after reconnect | 9 |
| `TestPeerTopology_ConcurrentForwarding` | `topology/e2e_test.go` | 10 concurrent forwarded requests | 4 |
| `TestPeerTopology_WSClientCreateOnPeer` | `topology/e2e_test.go` | Full WS client → main → peer path | 1, 2 |
| `TestPeerTopology_ListNodesViaWS` | `topology/e2e_test.go` | `node.list` via WS sees peer | 1, 2 |
| `TestPeerTopology_ActorTypeNodeBypass` | `topology/e2e_test.go` | `actorType=node` bypasses token check | 3 |
| `TestPeerTopology_ManyPeers` | `topology/e2e_test.go` | 3-node setup (main + 2 peers) | 1, 2 |
| `TestPeerTopology_ForwardTimeout` | `topology/e2e_test.go` | Forward timeout handling | 2, 9 |
| `TestPeerTopology_RapidReconnect` | `topology/e2e_test.go` | 10 disconnect/reconnect cycles | 9 |
| `TestPeerTopology_UnsolicitedResponse` | `topology/e2e_test.go` | Unknown RequestID silently dropped | — |
| `TestPeerTopology_SelfConnectPrevention` | `topology/e2e_test.go` | Self-ID peer config is skipped | — |
| `TestPeerTopology_LargePayloadForward` | `topology/e2e_test.go` | ~100KB payload forwarded | 3 |
| `TestPeerTopology_GracefulShutdown` | `topology/e2e_test.go` | Clean shutdown disconnects peers | 10 |
| `TestPeerTopology_FullE2EWithPeerSessionInfo` | `topology/e2e_test.go` | Create session on peer + query info | 1, 2 |
| `TestConfig_LoadSave` | `config/config_test.go` | Config file read/write | 5 |
| `TestConfig_SetGet` | `config/config_test.go` | Config key-value operations | 5 |
| `TestHistory_ReplayFromDisk` | `history/store_test.go` | Disk-mode replay recovery | 10 |
| `TestNotify_CreateAndRespond` | `notify/notify_test.go` | Approval create/respond cycle | 8 |
| `TestNotify_Timeout` | `notify/notify_test.go` | Approval response timeout | 8 |
| `TestDispatcher_SuccessPath` | `dispatcher/dispatcher_test.go` | Full 8-step dispatch chain | 1, 2, 3 |
| `TestDispatcher_AuthFailure` | `dispatcher/dispatcher_test.go` | Auth failure returns error | 3 |
| `TestDispatcher_RemoteForward` | `dispatcher/dispatcher_test.go` | Dispatcher routes to remote | 1, 2, 3 |
| `TestChecker_Success` | `permission/checker_test.go` | Permission grant OK | 1, 2, 3, 4 |
| `TestChecker_ModeDeny` | `permission/checker_test.go` | Permission mode=deny blocks | 2, 3, 8 |
| `TestChecker_ModeAsk` | `permission/checker_test.go` | Permission mode=ask returns NEED_APPROVAL | 8 |
| `TestPlan_CheckHighRisk` | `plan/manager_test.go` | High-risk cap requires plan | 3, 8 |
| `TestExecutor_SessionCreate` | `executor/executor_test.go` | Session creation handler | 1, 2 |
| `TestExecutor_ProcessSpawn` | `executor/executor_test.go` | Process spawn handler | 3 |
| `TestServer_SessionCreateWS` | `server/server_test.go` | WS client session.create | 1, 2 |
| `TestServer_SystemInfoWS` | `server/server_test.go` | WS client system.info | 1, 2 |
| `TestStore_CreateAndGet` | `session/store_test.go` | Session store operations | 1, 2, 4 |
| `TestRegistry_PushAndReadChunk` | `wsconn/registry_test.go` | Stream chunk push/read | 1, 2, 4 |
| `TestManager_SpawnAndPTY` | `process/manager_test.go` | Process spawn with PTY | 1, 2, 3 |

### Tests to Write (New Integration Tests)

| Test | File | What It Covers | Scenarios | Layer |
|------|------|----------------|-----------|-------|
| `TestTwoCore_Scenario1_LocalTerminal_VPSViewsHistory` | `topology/e2e_test.go` | Local creates session, remote queries `session.list` + `session.info` + `stream.replay` | 1 | INT |
| `TestTwoCore_Scenario1_ReplayAfterTruncation` | `topology/e2e_test.go` | `fromSeq` before earliest → `HISTORY_RANGE_TRUNCATED`, `fromSeq` after last → empty | 1 | INT |
| `TestTwoCore_Scenario1_StdinReplayDenied` | `topology/e2e_test.go` | `stream.replay {streamType:"stdin"}` → empty (not recorded) | 1 | INT |
| `TestTwoCore_Scenario2_VPSClaudeCode_LocalViews` | `topology/e2e_test.go` | Remote creates session, local queries via forward | 2 | INT |
| `TestTwoCore_Scenario2_PermissionStreamReadDenied` | `topology/e2e_test.go` | `session.get` OK, `stream.replay` → `PERMISSION_DENIED` | 2 | INT |
| `TestTwoCore_Scenario2_VPSOffline` | `topology/e2e_test.go` | VPS node unreachable → `NODE_UNREACHABLE` | 2 | INT |
| `TestTwoCore_Scenario3_ExternalCall_VPSExec` | `topology/e2e_test.go` | `process.spawn` via forwarding, verify audit on target | 3 | INT |
| `TestTwoCore_Scenario3_TokenScopeDeniesLocal` | `topology/e2e_test.go` | Token scope restricts target → local rejects | 3 | INT |
| `TestTwoCore_Scenario3_VPSAuditCommandMetadata` | `topology/e2e_test.go` | Audit records command metadata, NOT stdout | 3 | INT |
| `TestTwoCore_Scenario4_TwoSubscribersSameSession` | `topology/e2e_test.go` | Two subscribers receive same chunks | 4 | INT |
| `TestTwoCore_Scenario4_PauseOneSubscriber` | `topology/e2e_test.go` | Unregister one subscriber, other still gets chunks | 4 | INT |
| `TestTwoCore_Scenario4_CloseTabDoesNotStopSession` | `topology/e2e_test.go` | Close subscriber ≠ stop process | 4 | INT |
| `TestTwoCore_Scenario4_ExplicitStop` | `topology/e2e_test.go` | `session.stop` kills process, stops broadcast | 4 | INT |
| `TestTwoCore_Scenario8_NotifyRequest_CrossNode` | `topology/e2e_test.go` | Permission `ask` mode → notification broadcast cross-node | 8 | INT |
| `TestTwoCore_Scenario9_DisconnectSessionStillRunning` | `topology/e2e_test.go` | Disconnect peer → session still runs on peer | 9 | INT |
| `TestTwoCore_Scenario9_ReconnectSync` | `topology/e2e_test.go` | After reconnect, query `session.list` to catch up | 9 | INT |

### Tests to Write (New Unit Tests)

| Test | File | What It Covers | Scenarios | Layer |
|------|------|----------------|-----------|-------|
| `TestConfig_RevisionConflict` | `config/config_test.go` | `expectedRevision != current` → `CONFIG_CONFLICT` | 5 | UT |
| `TestConfig_SetWithRevisionOK` | `config/config_test.go` | `SetWithRevision` with matching revision succeeds | 5 | UT |
| `TestExecutor_PluginCheck` | `executor/executor_test.go` | `plugin.check` capability handler | 6 | UT |
| `TestExecutor_PluginInstallPlan` | `executor/executor_test.go` | `plugin.install` plan generation | 6 | UT |
| `TestExecutor_PluginCacheList` | `executor/executor_test.go` | `plugin.cache.list` handler | 7 | UT |
| `TestExecutor_PluginCacheClear` | `executor/executor_test.go` | `plugin.cache.clear` handler | 7 | UT |

### E2E Tests (Real VPS Environment)

| Test | Location | What It Covers | Scenarios |
|------|----------|----------------|-----------|
| `main.go` (all test cases) | `cmd/e2e_dual_node/` | Local execution, remote routing, unknown node failure | 1, 2, 3 |
| Scenario 3 extend | `cmd/e2e_dual_node/main.go` | `process.spawn` with `TargetNodeID=node-vps`, verify audit | 3 |
| Scenario 5+ | `cmd/e2e_dual_node/main.go` | Config conflict detection (when revision tracking implemented) | 5 |

---

## Implementation Status Per Scenario

| # | Scenario | Tests | Primitives | VPS Testable |
|---|----------|-------|------------|--------------|
| 1 | Local terminal, VPS views history | Partial (existing INT covers routing + session.create on peer + session.info) | ✅ All primitives exist | Yes (ssh tunnel) |
| 2 | VPS ClaudeCode, Local views | Partial (existing INT covers routing + session create on peer + session.info) | ✅ All primitives exist | Yes (ssh tunnel) |
| 3 | External script cross-node exec | Partial (existing INT covers process.spawn on peer) | ✅ All primitives exist | Yes (direct) |
| 4 | Two subscribers same session | None specific (concurrent forwarding exists) | ✅ All primitives exist | Yes (ssh tunnel) |
| 5 | Config conflict | None (basic store tests exist) | ⚠️ Missing: revision tracking | No (unit) |
| 6 | Plugin check cross-node | None | ⚠️ Missing: executor `plugin.check`, `plugin.install` handlers | No (unit) |
| 7 | Plugin cache isolation | None | ⚠️ Missing: executor `plugin.cache.*` handlers | No (unit) |
| 8 | Cross-node approval | Partial (notify unit tests exist) | ⚠️ Missing: dispatcher approval wiring | Yes (ssh tunnel) |
| 9 | Disconnect/reconnect | Good (multiple reconnect INT tests exist) | ⚠️ Missing: re-sync after reconnect | Yes (ssh tunnel) |
| 10 | Daemon restart | Partial (ReplayFromDisk unit test exists) | ⚠️ Missing: main.go restart wiring, session persistence | No (unit) |

---

## Test Execution Plan

### Phase A: In-Process Two-Core Integration Tests (go test)

```bash
# Run all existing topology E2E tests
go test ./internal/topology/ -run TestPeerTopology -v -timeout 120s

# Run all scenario-specific tests (once written)
go test ./internal/topology/ -run TestTwoCore_Scenario -v -timeout 120s
```

### Phase B: Unit Tests for New Primitives

```bash
go test ./internal/config/ -run TestConfigRevision -v
go test ./internal/executor/ -run TestExecutor_Plugin -v
```

### Phase C: Real VPS E2E

```bash
# Requires: go-core running on VPS (:9090) + SSH tunnel from local (:9090→VPS:9090)
cd cmd/e2e_dual_node && go run .
```

### Phase D: Full Verification

```bash
go test ./... -count=1 -timeout 180s 2>&1 | tail -20
go vet ./...
go build ./cmd/node/
```

---

## Remaining Work by Package

| Package | Work Needed | Depends On |
|---------|-------------|------------|
| `internal/config` | Add `Revision` counter + `SetWithRevision()` method | — |
| `internal/topology` | Add 17 new `TestTwoCore_Scenario*` integration tests | — |
| `internal/executor` | Add `plugin.check`, `plugin.install`, `plugin.cache.*` handlers | — |
| `internal/dispatcher` | Wire approval flow (`CreateApproval` + `WaitForResponse` for `ask` mode) | — |
| `internal/permission` | Add node-scope check (`TargetNodeID` vs grant scope) | — |
| `internal/history` | Enforce stdin exclusion in `Replay()` (not just `Record()`) | — |
| `cmd/e2e_dual_node` | Extend test cases for scenario 3+ | — |
| `cmd/node/main.go` | Wire `ReplayFromDisk` on restart, session persistence | — |
