# 10 — Infrastructure & Diagnostics

StateBus internals, debug endpoints, diagnostic tooling.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| StateBus | `src/state-bridge/storage.ts` | key-value store with glob listing |
| Debug endpoints | `src/relay-server.ts` | /api/debug/statebus, /api/debug/surfaces |
| SurfaceManager | `src/state-bridge/relay-integration.ts` | getDebugSnapshot |

## Tests

### 1. `statebus-diag-invariants.test.mjs`
/api/debug/statebus returns valid JSON with expected shape. After browser subscribes to __local__, tabs appear. After surface.publish, workbench tabs project under correct nodeId.

### 2. `t2-debug.test.mjs`
Focused T2.4 debug test — cross-node terminal output routing.
