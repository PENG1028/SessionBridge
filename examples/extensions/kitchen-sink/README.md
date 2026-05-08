# Kitchen Sink — SessionBridge Example Extension

A comprehensive example extension demonstrating the SessionBridge extension contract.

## What It Demonstrates

- **Contributions-only extension**: No `AgentAdapter` returned — pure manifest declarations.
- **All `contributes` sections**: views, commands, menus, notifications, configuration, languages.
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
| `contributes.menus` | 2 menu items with group/when |
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

- No agent adapter — no `start()`, no `detect()`, no `parseLine()`.
- No custom web views — panel placeholders only.
- No process spawning.
- No network access.
