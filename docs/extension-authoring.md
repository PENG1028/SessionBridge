# Extension Authoring Guide

SessionBridge supports a VS Code-style extension system. Extensions can contribute
commands, menus, views, notifications, configuration schemas, language definitions,
and optionally provide an `AgentAdapter` for runtime capabilities.

## Quick Start

A minimal extension is a directory with `sb-extension.json` and a main module:

```
my-extension/
├── sb-extension.json
└── index.ts              # or .js
```

### Minimal `sb-extension.json`

```json
{
  "id": "my-extension",
  "displayName": "My Extension",
  "version": "0.1.0",
  "main": "./index.js"
}
```

### Minimal `activate()`

```typescript
import type { ExtensionContext } from 'sessionbridge';

export async function activate(context: ExtensionContext): Promise<void> {
  context.log.info('My extension activated');
}
```

## Loading the Extension

```bash
# Via --extensions flag
bridge --extensions /path/to/my-extension

# Via environment variable
BRIDGE_EXTENSIONS_PATH=/path/to/my-extension bridge

# Multiple paths (separated by ; on Windows)
BRIDGE_EXTENSIONS_PATH="/path/to/ext1;/path/to/ext2" bridge
```

The loader also scans these locations automatically:

| Path | Type |
|---|---|
| `adapters/` | Built-in adapters (project directory) |
| `~/.sessionbridge/extensions/` | User-installed extensions |
| `BRIDGE_EXTENSIONS_PATH` | Environment variable override |

## Manifest Reference

### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier. Must match `/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/` |
| `displayName` | `string` | Human-readable name shown in UI |
| `version` | `string` | SemVer version (`x.y.z`) |
| `main` | `string` | Entry module path relative to extension root |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `icon` | `string` | Icon identifier for UI |
| `viewId` | `string` | View component ID for client-side routing |
| `engines.sessionbridge` | `string` | Required engine version range (syntax warning only, not enforced) |
| `capabilities` | `object` | See [Capabilities](#capabilities) |
| `contributes` | `object` | See [Contributions](#contributions) |
| `runtime` | `object` | Runtime detection hints |

### Capabilities

Map of `AdapterCapabilities` fields to boolean. Extensions that do not provide
an `AgentAdapter` should set all capabilities to `false`.

```json
{
  "capabilities": {
    "terminal": false,
    "fileContext": false,
    "structuredEvents": false,
    "approvals": false,
    "modes": false,
    "timeline": false,
    "compact": false,
    "tasks": false
  }
}
```

Known capability keys: `terminal`, `fileContext`, `structuredEvents`, `approvals`,
`modes`, `timeline`, `compact`, `tasks`.

### Contributions

#### `contributes.views`

Register side panels in the left or right sidebar.

```json
{
  "contributes": {
    "views": {
      "sidebar-left": [
        { "id": "my.panel", "title": "My Panel", "icon": "folder", "defaultVisible": true }
      ],
      "sidebar-right": [
        { "id": "my.info", "title": "Info", "icon": "info", "defaultVisible": false, "when": "isRunning" }
      ]
    }
  }
}
```

Each panel:
- `id` (required) — unique panel identifier
- `title` (required) — display name
- `icon` — icon identifier
- `defaultVisible` — shown by default
- `when` — visibility [when condition](#when-conditions)
- `order` — sort order (lower = higher priority, default 100)

#### `contributes.commands`

```json
{
  "contributes": {
    "commands": [
      { "id": "my.hello", "title": "Say Hello", "category": "My Extension", "icon": "wave" }
    ]
  }
}
```

Each command:
- `id` (required) — unique command ID
- `title` (required) — display name
- `category` — grouping category
- `icon` — icon identifier
- `when` — visibility condition

#### `contributes.menus`

```json
{
  "contributes": {
    "menus": [
      {
        "id": "my.menu.hello",
        "menu": "workbench/context",
        "title": "Say Hello",
        "command": "my.hello",
        "group": "navigation",
        "order": 10,
        "when": "activeAdapterId == my-ext"
      }
    ]
  }
}
```

Each menu:
- `id` (required) — unique menu item identifier
- `menu` — target menu context (`"workbench/context"` default, `"tab/context"`, `"instance/context"`, `"editor/context"`, `"terminal/context"`)
- `title` — display label
- `command` (required) — command ID to execute
- `group` — grouping (`"navigation"`, `"edit"`, `"debug"`, `"view"`)
- `order` — sort order within group (lower = higher priority, default 100)
- `when` — visibility condition

Command dispatch: action registry first (`getAction(command)?.run(ctx)`), fallback `sendCommand(command)` for adapter/runtime commands.

##### Three-Layer Model (Phase 4K)

The context menu uses a three-layer system:

| Layer | When to use | How |
|---|---|---|
| **Manifest menus** | Stable surfaces: workbench, view, terminal, chat, tab, file, panel | Declared in `contributes.menus` as above |
| **Action registry items** | Host-owned actions that also appear on contextMenu surface | `registerAction()` with `surfaces: ['contextMenu']` |
| **Component localItems** | Dynamic runtime data: row right-click, tree node, chart point, message block | Call `openContextMenu()` with `localItems` in the request |

**Important:** Manifest menus are only suitable for stable surfaces. If your menu item depends on runtime data (which row was clicked, which file node, which message), use `localItems` instead. The host's `openContextMenu()` API is currently internal (Phase 4K host-internal first; plugin API later).

Sources are merged in priority order (localItems > manifest > action registry), deduplicated by `id`, filtered by `when`, and sorted by `group` → `order`.

##### Submenu Support

Menu items with `children` render as nested submenus. The host renderer handles submenu positioning and viewport clamping:

```json
{
  "contributes": {
    "menus": [
      {
        "id": "my.menu.parent",
        "menu": "workbench/context",
        "title": "Parent Menu",
        "children": [
          { "id": "my.menu.child1", "title": "Child 1", "command": "my.child1" },
          { "id": "my.menu.child2", "title": "Child 2", "command": "my.child2" }
        ]
      }
    ]
  }
}
```

Note: `children` on manifest menus is currently experimental. For complex submenus with runtime data, prefer `localItems`.

##### Menu Targets

| Target | Purpose | Chain |
|---|---|---|
| `workbench/context` | Main workbench area (default) | `['workbench/context']` |
| `view/context` | Any view surface | `['view/context', 'workbench/context']` |
| `terminal/context` | Terminal area | `['terminal/context', 'view/context', 'workbench/context']` |
| `chat/context` | Chat/Claude area | `['chat/context', 'view/context', 'workbench/context']` |
| `tab/context` | Pane/workbench tabs | `['tab/context', 'view/context', 'workbench/context']` |
| `instance/context` | Instance list items | `['instance/context', 'workbench/context']` |
| `file/context` | File tree entries | `['file/context', 'view/context', 'workbench/context']` |
| `panel/context` | Panel headers | `['panel/context', 'workbench/context']` |

Omit `menu` to default to `workbench/context` (backward compatible).

#### `contributes.notifications`

```json
{
  "contributes": {
    "notifications": [
      { "id": "my.event", "label": "My Event", "description": "Triggered when something happens" }
    ]
  }
}
```

Each notification:
- `id` (required) — unique notification scenario ID
- `label` (required) — display name
- `description` — detailed description

#### `contributes.chrome`

Workbench chrome contributions let extensions declare lightweight host-rendered items in the header, status bar, and as adaptive context controls.

> Status: **Implemented in Phase 4J (header, statusBar) + Phase 4J-b (contextControls)**. Chrome items are host-rendered — extensions cannot inject React components into chrome areas. Header items render in `ConsoleHeader` right area, status bar items render in `StatusBar` left/right, and context controls (including legacy key hints) render in `KeyHintOverlay` (bottom-right, max 6, hidden on mobile).

**Primary model (Phase 4J-b):** `contextControls` — a unified contribution type supporting multiple interaction kinds. Legacy `keyHints` are converted to `contextControls` with `kind: "hint"` and `placement: "bottom-right"`.

```json
{
  "contributes": {
    "chrome": {
      "header": [
        {
          "id": "terminal.clear",
          "title": "Clear",
          "icon": "eraser",
          "side": "right",
          "order": 20,
          "when": "view == \"terminal\"",
          "command": "terminal.clear"
        }
      ],
      "statusBar": [
        {
          "id": "terminal.connection",
          "text": "Terminal",
          "side": "left",
          "order": 10,
          "when": "view == \"terminal\""
        }
      ],
      "contextControls": [
        {
          "id": "terminal.stop",
          "kind": "hint",
          "label": "Stop",
          "keys": "Esc",
          "placement": "bottom-right",
          "priority": 90,
          "when": "view == \"terminal\" && isRunning",
          "command": "terminal.kill"
        },
        {
          "id": "terminal.clear",
          "kind": "hint",
          "label": "Clear",
          "keys": "⌘L",
          "placement": "bottom-right",
          "priority": 50,
          "when": "view == \"terminal\"",
          "command": "terminal.clear"
        }
      ]
    }
  }
}
```

Header item fields:
- `id` (required) - unique item ID
- `title` or `text` - display label or tooltip
- `icon` - host-mapped icon identifier
- `side` - `"left"` or `"right"`
- `group` - optional grouping key
- `order` - sort order (lower = earlier, default 100)
- `when` - visibility [when condition](#when-conditions)
- `command` - command ID to execute when clicked
- `priority` - `"low"`, `"normal"`, or `"high"`
- `mobile` - `"show"`, `"collapse"`, or `"hide"`

Status bar item fields:
- `id` (required)
- `text` (required)
- `title`, `icon`, `side`, `group`, `order`, `when`, `command`, `priority`, `mobile`

##### Context Controls (`chrome.contextControls`)

Context controls are the primary model for adaptive context UI. Each item has a `kind` that controls host rendering:

| Kind | Purpose | Host rendering |
|------|---------|---------------|
| `hint` | Keyboard shortcut hint | kbd + label |
| `button` | Single action trigger | Capsule/button with label |
| `toggle` | On/off state toggle | Capsule with state indicator |
| `menu` | Dropdown/popover menu trigger | Capsule with chevron |
| `progress` | Progress / activity indicator | Capsule with spinner or bar |
| `approval` | Approval / confirmation entry | Capsule with highlight variant |
| `jump` | Navigation / quick jump | Capsule with arrow indicator |

Context control fields:
- `id` (required) — unique item ID
- `kind` (required) — one of `hint`, `button`, `toggle`, `menu`, `progress`, `approval`, `jump`
- `label` (required) — display text
- `icon` — host-mapped icon identifier
- `keys` — shortcut keys display (relevant for `hint` kind)
- `placement` — `"bottom-left"`, `"bottom-right"`, `"header-right"`, `"status-left"`, `"status-right"`, or `"auto"` (default)
- `command` — command ID to execute when clicked. Resolved via action registry first (host actions like `host.commandPalette.open`), falling back to `sendCommand` (adapter/runtime commands like `shell.clear`, `shell.kill`)
- `when` — visibility [when condition](#when-conditions)
- `order` — sort order within same priority (lower = earlier, default 100)
- `priority` — higher priority items are shown first; default 50
- `ttlMs` — auto-hide duration in milliseconds; 0/undefined = persistent
- `collapsible` / `defaultCollapsed` — whether the item can be collapsed
- `variant` — `"default"`, `"primary"`, `"danger"`, `"warning"`, `"success"` (host-mapped, no arbitrary colors)
- `reason` — debug/diagnostic explanation for why this control is shown
- `mobile` — `"show"`, `"collapse"`, or `"hide"`

Rules:
- Chrome items are host-rendered. Extensions cannot inject arbitrary React into header, status bar, or context controls.
- `contextControls` is the primary model. `keyHints` is legacy — automatically converted to `contextControls` with `kind: "hint"`, `placement: "bottom-right"`.
- Missing `when` means globally visible; extensions should prefer explicit `when` to avoid global UI noise.
- Host/core item IDs take precedence over extension IDs.
- Unknown icons use a host fallback.
- Unknown commands should be diagnosed by the host and may render disabled.
- Context controls are sorted by `placement` → `priority` (desc) → `order`, then by original registration order for stability.
- Mobile presentation is host-controlled; context controls may be hidden or collapsed.

#### `contributes.configuration`

JSON Schema for extension settings. Use `"type": "object"` with `properties`.

```json
{
  "contributes": {
    "configuration": {
      "type": "object",
      "properties": {
        "my.greeting": {
          "type": "string",
          "default": "Hello",
          "description": "Greeting text"
        },
        "my.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable feature"
        },
        "my.logLevel": {
          "type": "string",
          "default": "info",
          "enum": ["debug", "info", "warn", "error"],
          "description": "Log level"
        },
        "my.interval": {
          "type": "integer",
          "default": 30,
          "description": "Poll interval (seconds)"
        }
      }
    }
  }
}
```

#### `contributes.languages`

```json
{
  "contributes": {
    "languages": [
      { "id": "my-lang", "extensions": [".my", ".my-lang"], "icon": "code" }
    ]
  }
}
```

Each language:
- `id` (required) — language identifier
- `extensions` — file extension associations
- `icon` — icon identifier

### When Conditions

When conditions are simple boolean expressions used in `when` fields:

| Expression | Meaning |
|---|---|
| `isRunning` | Instance is running |
| `activeAdapterId == foo` | Active adapter is "foo" |
| `activeAdapterId != foo` | Active adapter is not "foo" |
| `view == claude-chat` | Current view is "claude-chat" |
| `editorHasSelection` | User has selected text |
| `isRunning && activeAdapterId == shell` | Composite condition |
| `isRunning \|\| view == terminal` | OR condition |
| `!isRunning` | NOT condition |
| `(isRunning && view == terminal)` | Grouped expression |

## Activation Patterns

### Contributions-only (no adapter)

```typescript
import type { ExtensionContext } from 'sessionbridge';

export async function activate(context: ExtensionContext): Promise<void> {
  context.log.info('Contributions-only extension');
}
```

The extension loads its manifest contributions without registering an
`AgentAdapter`. No runtime capabilities — commands, menus, views, etc.
are registered from the manifest.

### With AgentAdapter

```typescript
import type { ExtensionContext, AgentAdapter } from 'sessionbridge';

class MyAdapter implements AgentAdapter {
  id = 'my-extension';
  // ... implement AgentAdapter interface
}

export async function activate(context: ExtensionContext): Promise<AgentAdapter> {
  context.log.info('Adapter extension activated');
  return new MyAdapter();
}
```

When `activate()` returns an `AgentAdapter`, it is registered in the
adapter registry alongside the manifest contributions.

## Extension Context API

The `ExtensionContext` provided to `activate()`:

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Extension ID from manifest |
| `displayName` | `string` | Display name from manifest |
| `extensionPath` | `string` | Absolute path to extension directory |
| `subscriptions` | `Disposable[]` | Push disposables for cleanup on deactivation |
| `globalState` | `StateStore` | Global persistent KV store |
| `workspaceState` | `StateStore` | Workspace-scoped persistent KV store |
| `log` | `ExtensionLogger` | Structured logger with extension ID prefix |
| `extensionMode` | `'production' \| 'development'` | Runtime mode |

## Status and Diagnostics

After loading, extension status is available:

- **Dashboard**: `/api/extensions` returns `diagnostics[]` with status per extension
- **CLI startup**: loader prints ✅/❌ per extension with timing

Status values:
| Status | Meaning |
|---|---|
| `discovered` | Manifest found and valid |
| `activating` | Module loading and activate() in progress |
| `activated` | Successfully activated |
| `invalid` | Manifest validation failed |
| `failed` | Activation threw an error |
| `skipped` | Filtered out by loader options |
| `disabled` | Explicitly disabled |

## Current Limitations

- **Custom web views**: Dynamic loading of external React web-view components
  is not yet supported. Custom view components must be registered in
  `adapters/client-index.ts` at build time.
- **Main stage views**: To add a main-stage view (vs. sidebar panel), it must
  be registered via the built-in `web-views.ts` pattern in `adapters/`.
- **Workbench chrome contributions**: `contributes.chrome` header, statusBar, and contextControls are fully implemented. Legacy `keyHints` are supported through automatic conversion to `contextControls`. Chrome items are host-rendered and cannot provide arbitrary React components.
- **Session/History provider**: The session and history APIs in the relay
  server are still hardcoded for the claude-code JSONL format. A
  `SessionProvider` interface will be extracted in a future phase.
- **Install/Uninstall CLI**: No `bridge install` or `bridge uninstall`
  command yet — extensions must be placed manually or loaded via
  `--extensions` / `BRIDGE_EXTENSIONS_PATH`.
- **Marketplace**: No remote marketplace or discovery mechanism.
