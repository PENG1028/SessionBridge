# 01 — Surface Sync Layer

Surface = a shared view (terminal tab, chat panel, etc.) that browsers subscribe to.
Covers creation, publish/subscribe, output replay, cross-relay forwarding, stale cleanup.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| SurfaceManager | `src/state-bridge/relay-integration.ts` | create, get, listAll, subscribe, publish, delete |
| StateBus | `src/state-bridge/storage.ts` | persistence under `global/surfaces/*` |
| WorkbenchStore | `src/state-bridge/relay-integration.ts` | tab projection from surfaces |
| API Routes | `src/api-routes.ts` | POST /api/instances → atomic surface creation |
| Relay Server | `src/relay-server.ts` | surface.subscribe / surface.publish handlers |

## Tests

### 1. `shared-surface-terminal-replay.test.mjs`
**MVP protocol test.** surface.publish → surfaceId, runtime.output streaming to subscriber.

### 2. `shared-surface-replay-cap.test.mjs`
ReplayPolicy `tail` mode: 6000 lines of output, lines=5000 → earliest 1000 dropped.

### 3. `shared-surface-cross-relay.test.mjs`
surface.publish on leaf relay → forwarded to upstream → appears under remapped nodeId.

### 4. `shared-surface-ui-contract.test.mjs`
Protocol-level contracts: surface.subscribeNode format → WorkbenchState compatible.

### 5. `surface-persistence-restore.test.mjs`
**6-phase unified persistence (A-H).** Atomic creation, SurfacePersistence, keep migration, subscribeNode rebuild, atomic API, independent instanceId.

### 6. `surface-nodeid-ownership.test.mjs`
3 invariants: API returns surface in response, surface.nodeId = device owner (not instanceId), agent inventory synthesizes under agentNodeId.

### 7. `shell-surface-bridge.test.mjs`
**Critical bridge:** agent.stdout → broadcastShellOutput → surface subscribers as runtime.output.

### 8. `stale-surface-tab-cleanup.test.mjs`
surface.subscribe with fake instanceId → SURFACE_STALE error + surface.closed.

### 9. `cross-node-surface-discovery.test.mjs`
Two agents on same relay each create surfaces; browser discovers per-node with correct metadata.

### 10. `cross-node-surface-sync.test.mjs`
**F1-F4 checklist.** Downstream→upstream sync, cross-node output routing, close/update propagation. Spawns 2 bridge processes.

### 11. `ui-terminal-existing-instance-publishes-surface.test.mjs`
UI path: terminal tab has instanceId but no _surfaceId → ensureSurfacePublished auto-publishes.

### 12. `ui-surface-real-path-contract.test.mjs`
Code-level invariant check: UI surface sync pipeline matches documented contract. Reads source files.
