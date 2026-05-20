# SessionNode v2 — Plugin Adapters

> 一个插件一个 manifest，多个 adapter 的声明方式和约定
> Adapter 只定义"如何适配"，不定义"插件能做什么"

---

## 核心原则

```
一个插件 = 一个 Manifest
Manifest 的 core section 定义插件的能力和权限
Adapters 只声明"如何将 core 能力暴露给不同客户端"

Adapter 不能:
  - 声明 core.capabilities 之外的额外能力
  - 绕过 Core 权限校验
  - 伪造 pluginId
  - 定义插件生命周期
```

---

## systemUi Adapter

System UI adapter 声明插件在 Web UI 中的表现。

### 声明格式

```yaml
adapters:
  systemUi:
    views:                          # 主视图（如聊天、编辑器）
      - id: claude-code.chat
        type: custom-react          # custom-react | host-rendered | iframe
        title: "Claude Chat"
        entry: ClaudeChatView       # React 组件入口（仅 custom-react）
        componentId: PluginCacheTable  # 内置组件 ID（仅 host-rendered）
        sandbox: same-origin        # same-origin | iframe
        preferredSlot: main.editor
        allowedSlots:
          - main.editor
          - panel.bottom

    panels:                         # 面板（侧边栏、底部）
      - id: claude-code.panel
        type: custom-react
        title: "Claude"
        slot: sidebar
        entry: ClaudePanel

    configuration:                  # 配置项（JSON Schema）
      title: "Claude Code"
      properties:
        claude-code.model:
          type: string
          default: sonnet-4-7
          enum: [sonnet-4-7, haiku-4-5]

    commands:                       # 命令
      - id: claude-code.start
        title: "Start Claude Code"
        shortcut: "Ctrl+Shift+C"

    menus:                          # 菜单
      claude-code.context:
        label: "Claude Code"
        items:
          - command: claude-code.start
            group: ai

    status:                         # 状态栏
      - id: claude-code.status
        label: "Claude Code"
        icon: bot
        onClick:
          command: claude-code.start
```

### 渲染方式

| 类型 | 渲染者 | 信任等级 | 适用场景 |
|------|--------|---------|---------|
| custom-react (same-origin) | 插件自身 React | 高 | 复杂业务 UI：聊天、终端、文件管理器 |
| custom-react (iframe) | 插件 iframe | 低 | 第三方插件 UI |
| host-rendered | System UI 内置组件 | 最高 | 管理类 UI：配置表单、权限面板、缓存表格 |

**重要**：systemUi adapter 不定义插件核心协议。详见 System UI 文档：
- [PLUGIN_UI_CONTRACT.md](../system-ui/PLUGIN_UI_CONTRACT.md) — UI 契约
- [PLUGIN_UI_BOUNDARIES.md](../system-ui/PLUGIN_UI_BOUNDARIES.md) — 渲染方式决策树
- [PLUGIN_HOST.md](../system-ui/PLUGIN_HOST.md) — Plugin Host 加载流程

---

## cli Adapter

CLI adapter 声明终端命令。**CLI 是 adapter，不是插件本体**。详细规则已迁移到独立文档区。

### 快速概览

```yaml
adapters:
  cli:
    commands:
      - name: start
        description: "Start Claude Code session"
        usage: "claude start [dir] [--target <node>]"
        args:
          - name: dir
            type: string
            description: "Working directory"
            optional: true
            position: 0
        options:
          - name: target
            type: string
            description: "Target node ID"
            short: t
        capability: claude-code.start
        output:
          format: stream
```

### 详细规则 → [docs/core-v2/cli/](../cli/)

| 主题 | 文档 |
|------|------|
| 声明格式、命令注册、冲突检测 | [CLI_ADAPTER_CONTRACT.md](../cli/CLI_ADAPTER_CONTRACT.md) |
| 命令路由、actor 身份、target node | [COMMAND_ROUTING.md](../cli/COMMAND_ROUTING.md) |
| 参数/选项 schema | [ARGUMENT_SCHEMA.md](../cli/ARGUMENT_SCHEMA.md) |
| 输出格式规范、exit code | [OUTPUT_FORMATS.md](../cli/OUTPUT_FORMATS.md) |
| 危险能力审批、audit | [APPROVAL_AND_AUDIT.md](../cli/APPROVAL_AND_AUDIT.md) |
| 完整使用示例 | [EXAMPLES.md](../cli/EXAMPLES.md) |

### CLI 适配原则

- **CLI 是 adapter，不是 Core** — CLI 命令最终通过 Core capability 执行
- **CLI 不维护独立状态** — 所有状态读写通过 Core API
- **命令名与已有插件冲突 → 注册失败**
- CLI 命令只能使用 `core.permissions` 中声明的能力

---

## daemon Adapter

Daemon adapter 声明后台守护任务。

### 声明格式

```yaml
adapters:
  daemon:
    tasks:
      - id: env-check
        description: "Periodic environment check"
        interval: "1h"                    # 执行间隔
        capability: claude-code.check-environment
        timeout: "30s"
        onFailure: notify                 # notify | retry | disable
        healthCheck:                       # 健康检查
          type: process
          name: claude
```

### Daemon 原则

- daemon 任务由 Core 调度，不独立运行
- 任务声明在 manifest 中，Core 负责执行和监控
- daemon adapter 不能执行未在 core.capabilities 中声明的能力

---

## webhook Adapter

Webhook adapter 声明外部 HTTP 入口。

### 声明格式

```yaml
adapters:
  webhook:
    endpoints:
      - path: "/webhooks/claude-code/event"
        method: POST
        description: "Receive external events"
        capability: claude-code.handle-event
        auth:
          type: token                     # token | signature | none
        request:
          contentType: application/json
          schema:
            type: object
            properties:
              event:
                type: string
```

### Webhook 原则

- webhook 入口由 Core 注册和管理
- 外部请求经过 Core 认证后转发到对应能力
- webhook adapter 仍然受 Core 权限控制

---

## 组合示例：Claude Code

Claude Code 同时拥有三种 adapter：

```
claude-code 插件 manifest:
  core:
    capabilities: session.create, process.spawn, stream.write, stream.replay,
                  fs.read, env.read, plugin.cache.*, plugin.history

  adapters:
    systemUi:
      views:
        - claude-code.chat (custom-react, ClaudeChatView)
      panels:
        - claude-code.panel (custom-react, ClaudeCodePanel)
      configuration: model, temperature, maxTokens, systemPrompt
      commands: start, history, status, resume
      menus: claude-code.context
      status: claude-code.status

    cli:
      commands:
        - claude start [dir] [--target]
        - claude history [--limit]
        - claude check

    daemon:
      tasks:
        - env-check (every 1h, check claude binary and node)
```

所有 adapter 共享同一份 core capabilities 声明。UI、CLI、后台都只能调用 `core.capabilities` 中列出的能力。
