# 09 — UI Contract Tests

Verify that the UI layer's assumptions about API/WebSocket behavior hold true.
Some inspect source files; others simulate real browser flows against a bridge.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| page.tsx | `app/page.tsx` | main UI state management |
| shell-terminal.tsx | `app/console/stage/shell-terminal.tsx` | terminal component |
| workbench-state.ts | `app/console/stage/workbench-state.ts` | tab state |
| UI_OPERATION_MAP.md | `docs/UI_OPERATION_MAP.md` | documented contract |

## Tests

### 1. `real-ui-simulation-full-pipeline.test.mjs`
Simulates EXACT browser behavior: HTTP createInstance → surface.publish → surface.subscribe → runtime.output. Unlike other tests that skip the HTTP step.

### 2. `ui-operation-map-contract.test.mjs`
Every API endpoint and WebSocket message type referenced in `app/**` source files is documented in `docs/UI_OPERATION_MAP.md`. Reads source files statically.
