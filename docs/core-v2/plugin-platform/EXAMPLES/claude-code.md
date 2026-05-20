# Example: Claude Code 插件

> Claude Code 集成插件 — 展示 systemUi + cli + daemon 三 adapter 组合的完整插件示例

---

## 概述

Claude Code 插件是 SessionNode 平台上一个展示"一个插件、多个 adapter"的参考实现。它同时提供：

- **System UI** — 历史记录面板、会话管理视图、设置页面
- **CLI** — `claude` 命令封装，通过 Core capability 调用
- **Daemon** — 后台环境检测、自动更新检查

## Manifest

```yaml
manifestVersion: "1"
id: claude-code
name: Claude Code
version: 2.0.0
type: plugin
trusted: true
description: Claude Code integration with session management and history

core:
  permissions:
    - id: claude-code.session
      description: Create and manage Claude Code sessions
      capabilities:
        - session.create
        - session.list
        - session.get
        - session.stop
      default: ask
      constraints:
        targetNodes:
          - self
          - node_vps

    - id: claude-code.fs-read
      description: Read workspace files for context
      capabilities:
        - fs.read
        - fs.list
        - fs.stat
      default: ask
      constraints:
        paths:
          allow:
            - "${workspace}/**"

    - id: claude-code.process
      description: Spawn claude CLI process
      capabilities:
        - process.spawn
        - process.kill
      default: ask
      constraints:
        paths:
          allow:
            - "${workspace}/**"

  environment:
    checks:
      - id: claude-cli
        type: binary
        command: claude
        required: false
        installHint: "npm install -g @anthropic-ai/claude-code"
      - id: node-version
        type: binary
        command: node
        required: true
        versionCommand: node --version
        requiredVersion: ">=18"

  files:
    config: "${plugin.configDir}"
    data: "${plugin.dataDir}"
    cache: "${plugin.cacheDir}"
    logs: "${plugin.logsDir}"
    declarations:
      - id: global-history
        path: "~/.claude/history.jsonl"
        description: "Global Claude Code session history"
        clearable: false
      - id: plugin-cache
        path: "${plugin.cacheDir}/metadata"
        description: "Plugin metadata cache"
        clearable: true
        risk: low
      - id: session-artifacts
        path: "${plugin.dataDir}/sessions"
        description: "Session output artifacts"
        clearable: true
        risk: medium

  caches:
    - id: plugin-cache
      paths:
        - "${plugin.cacheDir}/metadata"
      clearable: true
      clearMode: delete-path
      risk: low
      owner: plugin

  tasks:
    - id: claude-code.env-check
      capability: plugin.check
      planRequired: false
      risk: low
    - id: claude-code.install
      capability: plugin.install.execute
      planRequired: true
      risk: high

  history:
    defaultPolicy: disk

adapters:
  systemUi:
    views:
      - id: claude-code.history
        surface: main.editor
        type: custom-react
        entry: ./web/HistoryView.tsx
        title: "History"
      - id: claude-code.session
        surface: main.editor
        type: custom-react
        entry: ./web/SessionView.tsx
        title: "Session"

    panels:
      - id: claude-code.sessions
        surface: main.editor.bottom
        type: custom-react
        entry: ./web/SessionPanel.tsx
        title: "Sessions"

    configuration:
      - id: claude-code.cli-path
        title: "CLI Path"
        description: "Path to claude executable"
        type: string
        default: "claude"
      - id: claude-code.auto-session
        title: "Auto-create session"
        description: "Automatically create session on project open"
        type: boolean
        default: true

    commands:
      - id: claude-code.open-history
        title: "Open History"
        command: claude-code.view.history
      - id: claude-code.new-session
        title: "New Session"
        command: claude-code.session.create
      - id: claude-code.toggle-panel
        title: "Toggle Sessions Panel"
        command: claude-code.panel.sessions

    menus:
      - id: claude-code.editor-context
        title: "Claude Code"
        items:
          - command: claude-code.new-session
            label: "New Session"
            when: "editor.hasFocus"

    status:
      - id: claude-code.status
        label: "Claude Code"
        icon: terminal

  cli:
    commands:
      - id: claude-code.cli.run
        name: run
        description: "Run Claude Code in current workspace"
        entry: ./cli/index.ts
        handler: runHandler
        args: "[options] [prompt]"
        options:
          - flag: --model
            description: "Model to use"
          - flag: --resume
            description: "Resume from session ID"
        examples:
          - "claude run 'explain this code'"
          - "claude run --model claude-sonnet-4-6"
        capability: claude-code.session

      - id: claude-code.cli.history
        name: history
        description: "View session history"
        entry: ./cli/index.ts
        handler: historyHandler
        args: "[--limit N]"
        capability: claude-code.session

  daemon:
    tasks:
      - id: claude-code.env-check
        interval: "1h"
        capability: plugin.check
        payload:
          pluginId: claude-code
        timeout: "30s"
        onFailure: notify

      - id: claude-code.update-check
        interval: "24h"
        capability: claude-code.check-update
        timeout: "10s"
        onFailure: notify
```

## 核心设计

### 权限分级

| Permission | Default | 原因 |
|-----------|---------|------|
| `claude-code.session` | ask | 创建 session 涉及资源占用 |
| `claude-code.fs-read` | ask | 读取工作区文件需要用户知情 |
| `claude-code.process` | ask | spawn 子进程是危险能力 |

### 存储规划

| 路径 | 类型 | 可清理 | 说明 |
|------|------|--------|------|
| `~/.claude/history.jsonl` | history | 否 | 用户历史记录，不可丢失 |
| `${plugin.cacheDir}/metadata` | cache | 是 | 元数据缓存，可重建 |
| `${plugin.dataDir}/sessions` | state | 有条件 | session 输出，用户确认后可清理 |

### 双节点支持

插件声明 `targetNodes: [self, node_vps]`，意味着：
- local 节点：直接创建 session、读取文件
- VPS 节点：通过 Core 路由能力，在 VPS 上执行 `plugin.check`、`session.create`
- 权限在目标节点独立校验

---

## 验证要点

- [ ] Manifest 校验通过（无 NAMESPACE/DANGEROUS_DEFAULT_ALLOW 错误）
- [ ] 权限 Grant 流程：安装后弹出 fs-read / process / session 授权
- [ ] 环境检测：local 和 VPS 分别检测 claude CLI 是否存在
- [ ] 文件登记：history.jsonl 和 cache 目录正确注册到 Core
- [ ] System UI 视图渲染：history view / session panel 正常显示
- [ ] CLI 命令注册：`claude run` / `claude history` 可用
- [ ] Daemon 任务：env-check 每小时执行
- [ ] 缓存清理：plugin-cache 可安全清理
