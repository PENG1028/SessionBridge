# SessionBridge Test Specifications

38 integration + 5 E2E browser tests (43 total) organized by functional layer.

## Index

| # | Spec | Tests | Scope |
|---|------|-------|-------|
| 01 | [surface-sync](01-surface-sync.md) | 12 | Surface publish/subscribe/replay/cross-node sync |
| 02 | [terminal-execution](02-terminal-execution.md) | 4 | Terminal spawn, cwd, shared local/remote sessions |
| 03 | [tab-workbench](03-tab-workbench.md) | 4 | Tab lifecycle, cross-relay sync, instanceId remap |
| 04 | [cross-machine](04-cross-machine.md) | 4 | VPS relay, SSH tunnel, full 47-scenario matrix |
| 05 | [agent-operation](05-agent-operation.md) | 4 | Operation protocol, remote routing, runtime boundaries |
| 06 | [browser-session](06-browser-session.md) | 3 | Browser identity, persistence/reconnect, panel consistency |
| 07 | [cli-config](07-cli-config.md) | 3 | CLI commands, config→auth chain, API parity |
| 08 | [extension-audit](08-extension-audit.md) | 1 | Manifest correctness, dist completeness |
| 09 | [ui-contracts](09-ui-contracts.md) | 2 | UI pipeline simulation, operation-map doc contract |
| 10 | [infrastructure](10-infrastructure.md) | 2 | StateBus diagnostics, debug endpoints |
| 11 | [e2e-browser](../e2e/TEST_PLAN.md) | 5 | Playwright: cross-machine UI, tab sync, plugins |

## Self-Contained vs External-Deps

| Type | Count | Description |
|------|-------|-------------|
| Self-contained | 31 | Spawns its own bridge process, no external setup |
| Needs VPS relay | 4 | Requires SSH tunnel localhost:18080 → VPS:8080 |
| Needs local+VPS relay | 2 | Requires both local relay (14400) + VPS relay (18080) |

## Adding a New Test

1. Read the spec file for the target layer to avoid duplication
2. Create `tests/integration/<name>.test.mjs` following the existing pattern (see any self-contained test for the bridge-lifecycle template)
3. Add a row to the relevant spec file
4. If the category doesn't exist, create a new `NN-category.md` and update this README

## Gap Tracking

See [99-test-gaps](99-test-gaps.md) for known uncovered areas.
