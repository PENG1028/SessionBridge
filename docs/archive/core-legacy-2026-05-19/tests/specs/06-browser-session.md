# 06 — Browser Session & Peer Topology

Browser = a WebSocket client with role='browser'. Receives peer.list, subscribes to surfaces.
Tests clientToken identity, reconnect recovery, panel/peer consistency.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| sendPeers / broadcastPeers | `src/relay-server.ts` | peer.list push to browsers |
| collectPeers | `src/relay-server.ts` | aggregate peers by IP, exclude runtime instances |
| hello handler | `src/relay-server.ts` | browser registration, clientToken binding |
| SurfaceManager | `src/state-bridge/relay-integration.ts` | surface persist + subscribe |

## Tests

### 1. `multi-browser-identity.test.mjs`
**C1-C6 checklist.** clientToken uniqueness, reconnect with same token → session recovery, browser connect/disconnect lifecycle, peer.list format validation, __local__ node invariants.

### 2. `persistence-reconnect.test.mjs`
**B1-B7 checklist.** Close/reopen surface persistence, multi-terminal independence, relay restart recovery, agent reconnect clears orphaned, stale surface detection, keep flag survival.

### 3. `panel-consistency.test.mjs`
**D1-D7 checklist.** Peer list correctness, node labels match instances, surface↔tab matching, projectCwd per node, runtime instance exclusion from peer list, peer link topology.
