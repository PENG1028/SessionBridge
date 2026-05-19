# SessionBridge — API Contracts

This directory documents the current API contracts between major subsystems. Each doc describes interfaces, types, message shapes, and expected behavior — **not** implementation details.

## Documents

| File | Scope |
|------|-------|
| [`client-device-api.md`](client-device-api.md) | WebSocket protocol (v1 envelope, hello/welcome, data transfer, instance/session management), HTTP REST endpoints for instance lifecycle |
| [`workbench-state-api.md`](workbench-state-api.md) | `WorkbenchState` layout tree (PaneState / SplitNode), reducer actions (FOCUS_PANE, CLOSE_TAB, SPLIT_PANE, ADD_TAB, etc.), helper functions |
| [`action-api.md`](action-api.md) | Panel action event bus (`emitPanelAction` / `onPanelAction`), View Registry (`registerView`, `ViewMeta`), Adapter-to-View mapping, context menu contract |
| [`shared-ui-api.md`](shared-ui-api.md) | Shared UI components: `DockPanelFrame`, `ContextMenu`, `NotificationProvider` / `ToastContainer`, `PanelRegistration` interface |

## Conventions

- All WebSocket messages use the v1 envelope `{ v: 1, ts, type, body }` unless noted.
- REST endpoints are relative to the relay server's HTTP base (inferred from WebSocket URL).
- TypeScript interfaces are canonical; markdown docs are a reference and may lag behind in edge cases.
