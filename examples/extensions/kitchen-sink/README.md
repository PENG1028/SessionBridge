# Kitchen Sink — SessionBridge Example Extension

A comprehensive example extension demonstrating the SessionBridge extension contract.

## What It Demonstrates

- **Contributions-only extension**: No `AgentAdapter` returned — pure manifest declarations.
- **All `contributes` sections**: views, commands, menus, notifications, configuration, languages, chrome (contextControls).
- **Explicit menu targets**: `menu` field set on all context menu items (`workbench/context`, `view/context`).
- **Chrome contextControls**: both `kind: "hint"` (keyboard shortcut hint) and `kind: "button"` (clickable action).
- **`activate()` lifecycle**: uses `context.log`, `globalState`/`workspaceState`, `subscriptions`.
- **Graceful non-adapter activation**: the loader treats this as a valid first-class extension.

## Manifest Highlights

| Field | Value |
|---|---|
| `id` | `kitchen-sink` |
| `displayName` | Kitchen Sink |
| `version` | `0.1.0` |
| `main` | `./index.js` |
| `capabilities` | All `false` — no adapter runtime |
| `contributes.views` | 1 sidebar-left + 2 sidebar-right panels |
| `contributes.commands` | 3 commands with category/icon/when |
| `contributes.menus` | 2 menu items with explicit `menu` target, group/when |
| `contributes.chrome.contextControls` | 2 items: hint (⌘G) + button (Reset) |
| `contributes.notifications` | 2 scenarios |
| `contributes.configuration` | 4 properties (string/boolean/enum/integer) |
| `contributes.languages` | 1 test language (`.sbtest`, `.sb-test`) |

## Usage

```bash
bridge --extensions examples/extensions/kitchen-sink
```

Or set `BRIDGE_EXTENSIONS_PATH`:

```bash
BRIDGE_EXTENSIONS_PATH=./examples/extensions/kitchen-sink bridge
```

## What NOT to Expect

- **No agent adapter** — no `start()`, no `detect()`, no `parseLine()`.
- **No custom web views** — panel placeholders only.
- **No process spawning**.
- **No network access**.

### Panel Rendering Limitation

The `contributes.views` entries in this example declare sidebar panels (`ks.explorer`, `ks.info`, `ks.stats`). However, external plugins **cannot ship their own React components**. The host only renders panels that have a corresponding component registered via `registerPanelComponent()` in `app/console/panels/register-panel-components.ts`. Panels without a registered component are **silently skipped** with a development-mode console warning.

For built-in adapters (claude-code, shell, system-info), the host provides panel components. For external plugins like kitchen-sink, the panel IDs are registered but no component exists — the panels will not appear in the sidebar at runtime unless the host adds a component override.

This is a current limitation. Dynamic React panel loading for external plugins is future work.
