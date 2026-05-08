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
      { "id": "my.menu.hello", "title": "Say Hello", "command": "my.hello", "group": "navigation", "when": "activeAdapterId == my-ext" }
    ]
  }
}
```

Each menu:
- `id` (required) — unique menu item identifier
- `title` — display label
- `command` (required) — command ID to execute
- `group` — grouping (`"navigation"`, `"edit"`, `"debug"`, `"view"`)
- `when` — visibility condition

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
- **Session/History provider**: The session and history APIs in the relay
  server are still hardcoded for the claude-code JSONL format. A
  `SessionProvider` interface will be extracted in a future phase.
- **Install/Uninstall CLI**: No `bridge install` or `bridge uninstall`
  command yet — extensions must be placed manually or loaded via
  `--extensions` / `BRIDGE_EXTENSIONS_PATH`.
- **Marketplace**: No remote marketplace or discovery mechanism.
