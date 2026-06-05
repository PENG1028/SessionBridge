# SessionNode v2 — Plugin Manifest 规范

> 完整 manifest 格式、字段定义、校验规则
> 对应 Go Core 实现：`go-core/internal/pluginmanifest/`
>
> 配套文档：[PLUGIN_DEFINITION.md](./PLUGIN_DEFINITION.md) | [PLUGIN_CORE_API_CONTRACT.md](./PLUGIN_CORE_API_CONTRACT.md) | [PLUGIN_ADAPTERS.md](./PLUGIN_ADAPTERS.md)

---

## 概述

每个 SessionNode 插件通过 `plugin.yaml` manifest 声明自身身份、能力和集成点。Core 的 `pluginmanifest` 包解析和验证 manifest。

**核心规则：**
- `core` section **必选** — 每个插件必须声明 core contract
- `adapters` section **可选** — systemUi / cli / daemon / webhook
- 所有 ID 必须用 pluginId 命名空间化（`<pluginId>.<name>`）
- 危险能力不能 `default: allow`（除非 `trusted: true`）

## 目录布局

```
plugins/<plugin-id>/
├── plugin.yaml              # Manifest (YAML or JSON)
├── web/                     # System UI views/panels (可选)
│   ├── TerminalView.tsx
│   └── SessionPanel.tsx
├── cli/                     # CLI adapter 实现 (可选)
│   └── index.ts
└── daemon/                  # Daemon adapter 实现 (可选)
    └── env-check.ts
```

## Root Fields

```yaml
manifestVersion: "1"         # Required. Currently only "1" is supported
id: my-plugin                # Required. kebab-case, not reserved
name: My Plugin              # Required. Human-readable
version: 1.0.0               # Required. semver-like (major.minor.patch)
type: plugin                 # Required. "plugin" or "system"
trusted: false               # Required. If true, dangerous defaults are allowed
description: "..."           # Optional
author: SessionNode          # Optional
homepage: https://...        # Optional
license: MIT                 # Optional
```

**Reserved plugin IDs** (cannot be used as a plugin `id`):
- `system-ui`
- `sessionnode-core`

## Core Section (Mandatory)

```yaml
core:
  permissions:
    - id: my-plugin.read
      description: Read files
      capabilities:
        - fs.read
      default: ask
      constraints:
        paths:
          allow:
            - "${workspace}/**"
          deny:
            - "**/.env"
        targetNodes:
          - self

  environment:
    checks:
      - id: check-bash
        type: binary
        required: false
        command: bash
        installHint: "Install bash via your package manager"

  files:
    config: "${plugin.configDir}"
    data: "${plugin.dataDir}"
    cache: "${plugin.cacheDir}"
    logs: "${plugin.logsDir}"
    artifacts: "${plugin.artifactsDir}"
    declarations:
      - id: my-cache
        path: "${plugin.cacheDir}/data"
        description: Plugin cache data
        clearable: true
        risk: low

  tasks:
    - id: my-task
      capability: plugin.install.execute
      planRequired: true
      risk: high

  history:
    defaultPolicy: memory    # "memory" | "disk" | "none"
```

### Permissions

Each permission links a human-readable description to one or more capabilities:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Must be namespaced: `<pluginId>.<name>` |
| `description` | Yes | What this permission allows |
| `capabilities` | Yes | List of capability strings (see below) |
| `default` | No | `"ask"`, `"deny"`, or `"allow"`. Default: `"ask"` |
| `constraints` | No | Path, target, env, network, or resource limits |

#### Constraints

```yaml
constraints:
  paths:
    allow:
      - "${workspace}/**"
    deny:
      - "**/.env"
  targetNodes:
    - self
  env:
    - SESSIONNODE_HOME
  network:
    - "*.example.com:443"
  resources:
    maxMemory: 512MB
    maxCPU: 1
    maxDisk: 10GB
    maxProcess: 5
```

#### Dangerous capabilities

These capabilities **must not** have `default: allow` unless `trusted: true`:

| Capability | Risk |
|------------|------|
| `process.spawn` | Arbitrary process execution |
| `stream.write` | Write to any stream |
| `fs.write` | File system modification |
| `fs.delete` | File system deletion |
| `plugin.install.execute` | Plugin installation/update |
| `plugin.cache.clear.execute` | Cache clearing (data loss) |
| `config.set` | Configuration modification |
| `permission.grant` | Permission escalation |
| `plugin.permissions.grant` | Plugin permission escalation |
| `node.disconnect` | Network disruption |

#### Capabilities requiring descriptions

`process.spawn`, `fs.write`, and `fs.delete` **require** a non-empty `description`.

#### fs.delete special rules

`fs.delete` requires:
1. Path constraints (cannot be unbounded)
2. `default` must be `"ask"` or `"deny"` (not `"allow"`)

#### `plugin.install.execute` requires a planRequired task

If a permission includes `plugin.install.execute`, the core must have at least one task with `planRequired: true`.

### Environment Checks

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique check identifier |
| `type` | No | `"binary"`, `"env"`, `"path"`, `"file"`, `"directory"`, `"command"` |
| `required` | No | `true` or `false` |
| `command` | Conditional | Required for `binary` type |
| `args` | No | CLI arguments |
| `versionCommand` | No | Command to check version |
| `requiredVersion` | No | Required version string |
| `installHint` | No | User-facing install instructions |

- `binary` type requires `command`
- `command` type requires `command` or `args`
- `requiredVersion` without `versionCommand` triggers a `RECOMMENDED` warning
- Duplicate check IDs trigger a `DUPLICATE` error

### File Declarations

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Declaration identifier |
| `path` | Yes | File path (supports `${var}` substitution) |
| `description` | No | Human-readable description |
| `clearable` | No | `true` if this can be safely deleted |
| `external` | No | `true` if shared with other plugins |
| `risk` | No | `"low"`, `"medium"`, or `"high"` |

**Clearable paths must not** point to dangerous system directories:
- Root `/`
- Home directory (`~`, `${home}`)
- Windows: `C:\`, `System32`, `Program Files`

### Path Variable Substitution

| Variable | Resolves To |
|----------|-------------|
| `${home}` | User home directory |
| `${workspace}` | Current workspace |
| `${plugin.dir}` | Plugin installation directory |
| `${plugin.configDir}` | Plugin config directory |
| `${plugin.dataDir}` | Plugin data directory |
| `${plugin.cacheDir}` | Plugin cache directory |
| `${plugin.logsDir}` | Plugin logs directory |
| `${plugin.artifactsDir}` | Plugin artifacts directory |
| `${node.dataDir}` | Node data directory |
| `${temp}` | System temp directory |

## Adapters Section (Optional)

```yaml
adapters:
  systemUi:
    views:
      - id: my-plugin.view
        surface: main.editor
        type: custom-react
        entry: ./web/View.tsx
        title: My View
    panels:
      - id: my-plugin.panel
        surface: main.editor.bottom
        type: custom-react
        entry: ./web/Panel.tsx
        title: My Panel
    commands:
      - id: my-plugin.cmd
        title: My Command
        command: my-plugin.action
    status:
      - id: my-plugin.status
        label: Ready
        icon: check
    configuration:
      title: "Plugin Name"
      properties:
        settingKey:
          type: string | number | integer | boolean
          default: ...
          description: "Description of the setting"
          enum: [...]         # for string type
          minimum: ...        # for number/integer type
          maximum: ...        # for number/integer type

  cli:
    commands:
      - id: my-plugin.cli.run
        name: run
        description: Run my-plugin
        entry: ./cli/index.ts
        handler: runHandler
        args: "[options]"
        examples:
          - "node my-plugin run"

  daemon:
    tasks:
      - id: my-plugin.env-check
        interval: "1h"
        capability: my-plugin.check-env
        timeout: "30s"
        onFailure: notify

  webhook:
    endpoints:
      - path: "/webhooks/my-plugin/event"
        method: POST
        capability: my-plugin.handle-event
        auth:
          type: token
```

### systemUi Adapter

Views, panels, commands, status, and configuration contributed to the `system-ui` host.

**Entry paths** must be relative (no `/` or `C:\` prefix) and must not contain `..`.

Valid view types: `"custom-react"`, `"host-rendered"`.

#### `configuration` — 插件设置声明 ✅ 已实现

通过 `adapters.systemUi.configuration` 声明插件配置项，这些配置会自动出现在 App UI 的 **SettingsPanel** 中，由 `PluginSettingsGroup` 组件渲染。

```yaml
configuration:
  title: "Plugin Name"           # SettingsPanel 中的分组标题
  properties:
    key:
      type: string | number | integer | boolean | object
      default: ...               # 默认值
      description: "..."         # 配置项说明
      enum: [...]                # 枚举值（仅 string 类型）
      minimum: ...               # 最小值（仅 number/integer 类型）
      maximum: ...               # 最大值（仅 number/integer 类型）
```

配置字段说明：

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | 否 | string | SettingsPanel 中该插件配置分组的标题 |
| `properties` | 是 | object | 配置项集合，key 为配置项 ID（建议 namespace 化：`<pluginId>.<key>`） |
| `type` | 是 | string | 配置项类型：`string`, `number`, `integer`, `boolean`, `object` |
| `default` | 否 | 与 type 一致 | 默认值 |
| `description` | 否 | string | 配置项说明文字 |
| `enum` | 否 | string[] | 可选值列表（仅 string 类型） |
| `minimum` | 否 | number | 最小值（仅 number/integer 类型） |
| `maximum` | 否 | number | 最大值（仅 number/integer 类型） |

**数据流**：`plugin.yaml` → `plugin-sync` → `slotRegistry.fill()` → `SettingsPanel` 聚合渲染

**存储**：插件配置通过 `plugin.config.set` / `plugin.config.get` 经由 Go Core 持久化。

详细适配器规范参见 [PLUGIN_ADAPTERS.md](./PLUGIN_ADAPTERS.md)。

### cli Adapter

Commands contributed to the CLI adapter. Each command must have a namespaced `id`, a short `name`, and a `description`.

**Max commands per adapter:** 2000 (enforced by validator).

详细 CLI 适配器规范参见 [PLUGIN_ADAPTERS.md](./PLUGIN_ADAPTERS.md)。

### daemon Adapter

Background tasks that Core schedules and monitors. Each task must have:
- `id`: Namespaced task identifier
- `interval`: Cron expression or duration string (e.g., "1h", "30m")
- `capability`: Core capability to call
- `timeout`: Max execution time
- `onFailure`: `notify` | `retry` | `disable`

### webhook Adapter

External HTTP endpoints that Core registers. Each endpoint must have:
- `path`: URL path (relative to Core's webhook base path)
- `method`: HTTP method
- `capability`: Core capability to invoke on request
- `auth`: Authentication method (`token` | `signature` | `none`)

## ID Namespace Rules

All declared IDs must be prefixed with the plugin's own `id`:

| Declaration | Example Valid ID |
|-------------|-----------------|
| Permission | `my-plugin.read` |
| View | `my-plugin.view` |
| Panel | `my-plugin.panel` |
| CLI command | `my-plugin.cli.run` |
| System UI command | `my-plugin.cmd` |

## Validation Rules Summary

| Rule | Code | Condition |
|------|------|-----------|
| Unsupported version | `UNSUPPORTED` | `manifestVersion` is not `"1"` |
| Reserved ID | `RESERVED` | `id` is `system-ui` or `sessionnode-core` |
| Invalid ID format | `INVALID_FORMAT` | `id` is not kebab-case |
| Missing core | `REQUIRED` | `core` section is absent |
| Namespace violation | `NAMESPACE` | ID not prefixed with plugin ID |
| Duplicate ID | `DUPLICATE` | Permission ID used more than once |
| Unknown capability | `UNKNOWN_CAPABILITY` | Capability not in known list |
| Invalid default | `INVALID_DEFAULT` | Default not `ask`/`deny`/`allow` |
| Dangerous default allow | `DANGEROUS_DEFAULT_ALLOW` | Dangerous capability with `default: allow` on untrusted plugin |
| Empty capability | `EMPTY` | Capability string is empty |
| Path escape | `PATH_ESCAPE` | Entry path contains `..` |
| Absolute path | `ABSOLUTE_PATH` | Entry path starts with `/`, `\`, or `C:` |
| Too many commands | `TOO_MANY` | >2000 CLI commands |
| Clearable dangerous path | `CLEARABLE_DANGEROUS_PATH` | Clearable path points to system directory |

## Example: Core-Only Plugin (no UI, no CLI)

```yaml
manifestVersion: "1"
id: backup-runner
name: Backup Runner
version: 1.0.0
type: plugin
trusted: false
description: Scheduled file backup

core:
  permissions:
    - id: backup-runner.read
      description: Read files to back up
      capabilities:
        - fs.read
        - fs.list
      default: ask
      constraints:
        paths:
          allow:
            - "${workspace}/**"

    - id: backup-runner.write
      description: Write backup archives
      capabilities:
        - fs.write
      default: ask
      constraints:
        paths:
          allow:
            - "${workspace}/.backups/**"

  files:
    logs: "${plugin.logsDir}"
    declarations:
      - id: backup-logs
        path: "${plugin.logsDir}/backups"
        description: Backup operation logs
        clearable: true

  history:
    defaultPolicy: disk
```

## Example: Full Plugin (system-ui + cli)

```yaml
manifestVersion: "1"
id: shell
name: Shell
version: 1.0.0
type: plugin
trusted: true

core:
  permissions:
    - id: shell.session
      description: Create and manage shell sessions
      capabilities:
        - session.create
        - session.list
        - session.get
        - session.stop
      default: ask

    - id: shell.process
      description: Spawn and control shell processes
      capabilities:
        - process.spawn
        - process.kill
        - process.resize
      default: deny

  environment:
    checks:
      - id: bash
        type: binary
        required: false
        command: bash

  history:
    defaultPolicy: memory

adapters:
  system-ui:
    views:
      - id: shell.terminal
        surface: main.editor
        type: custom-react
        entry: ./web/TerminalView.tsx
        title: Terminal
    panels:
      - id: shell.sessions
        surface: main.editor.bottom
        type: custom-react
        entry: ./web/SessionPanel.tsx
        title: Sessions
    configuration:
      title: Terminal
      properties:
        defaultShell:
          type: string
          default: "bash"
          description: "Default shell path"
          enum: ["bash", "zsh", "pwsh", "cmd", "powershell"]
        fontSize:
          type: integer
          default: 12
          minimum: 8
          maximum: 24
          description: "Terminal font size"
        cursorBlink:
          type: boolean
          default: true
          description: "Enable cursor blinking"

  cli:
    commands:
      - id: shell.cli.start
        name: start
        description: Start a new shell session
        entry: ./cli/index.ts
        handler: startShell
```

## Go Implementation

Package: `go-core/internal/pluginmanifest/`

### Key Types

```go
type Manifest struct {
    ManifestVersion string      `json:"manifestVersion"`
    ID              string      `json:"id"`
    Name            string      `json:"name"`
    Version         string      `json:"version"`
    Type            string      `json:"type"`
    Trusted         bool        `json:"trusted"`
    Core            *CoreSpec   `json:"core"`
    Adapters        AdapterSpec `json:"adapters"`
}

type CoreSpec struct {
    Permissions []PermissionSpec `json:"permissions"`
    Environment EnvironmentSpec  `json:"environment"`
    Files       FilesSpec        `json:"files"`
    Tasks       []TaskSpec       `json:"tasks"`
    History     HistorySpec      `json:"history"`
}

type AdapterSpec struct {
    SystemUI *SystemUIAdapter `json:"system-ui"`
    CLI      *CLIAdapter      `json:"cli"`
    Daemon   *DaemonAdapter   `json:"daemon"`
    Webhook  *WebhookAdapter  `json:"webhook"`
}
```

### Key Functions

| Function | Description |
|----------|-------------|
| `ParseYAML(data) (*Manifest, error)` | Parse YAML manifest (uses internal YAML parser, no external deps) |
| `ParseJSON(data) (*Manifest, error)` | Parse JSON manifest |
| `LoadFile(path) (*Manifest, error)` | Auto-detect format from extension |
| `Validate(m *Manifest) []ValidationError` | Structural validation |
| `DetectConflicts(manifests) []Conflict` | Cross-plugin conflict detection |
| `ResolvePluginPath(pluginDir, expr, vars) (string, error)` | Path resolution with variable substitution |
| `ValidateClearablePath(path) error` | Safety check for clearable paths |
| `IsSupportedManifestVersion(v) bool` | Version support check |

### YAML Parser

The YAML parser (`yaml.go`) is a minimal implementation supporting:
- Maps (`key: value`)
- Lists (`- item`)
- Inline lists (`[a, b]`)
- Inline maps (`{k: v}`)
- Strings, booleans, integers, floats, null
- Nested structures

No external YAML library is required.
