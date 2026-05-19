# 03 — Tab / Workbench Layer

Workbench tab = a browser's open view of a surface. Tabs sync across browsers on the same node
and across relays in an upstream/downstream topology.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| WorkbenchStore | `src/state-bridge/relay-integration.ts` | tab CRUD, broadcast |
| syncTabsByLabel | `src/relay-server.ts` | tab sync gateway |
| importFromUpstream | `src/relay-server.ts` | cross-relay tab import + remap |
| NodeRuntime | `extensions/agent-core/node-runtime.ts` | agent-side tab awareness |

## Tests

### 1. `tab-lifecycle-e2e.test.mjs`
**S1-S4 scenarios.** Local tab creation, cross-browser sync, cross-node sync, stale cleanup.

### 2. `cross-relay-two-browser-e2e.test.mjs`
Upstream/downstream topology. Two browsers (one per relay). Tab sync across relay boundary.

### 3. `cross-relay-instanceid-remap.test.mjs`
workbench.tabs cross relay boundary → tab.instanceId remapped from remote to local instanceId.

### 4. `vps-tab-sync.test.mjs`
workbench.tabs propagate between browser connections through VPS relay.
