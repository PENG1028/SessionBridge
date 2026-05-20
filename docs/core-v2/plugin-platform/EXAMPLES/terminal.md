# Example: Terminal 插件

> 全功能终端仿真插件 — 展示 systemUi + cli 双 adapter 组合，以 `trusted: true` 运行

---

## 概述

Terminal 插件提供一个完整的终端仿真器，包含 systemUi 视图/面板和 CLI 命令支持。作为 `trusted: true` 插件，它可以声明危险能力（`process.spawn`）并以 `default: ask` 运行。

## Manifest

```yaml
manifestVersion: "1"
id: shell
name: Terminal
version: 1.0.0
type: plugin
trusted: true
description: Full-featured terminal emulator with session management

core:
  permissions:
    - id: shell.session
      description: Create and manage terminal sessions
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
        - process.stdin
      default: deny

    - id: shell.stream
      description: Subscribe to terminal output streams
      capabilities:
        - stream.subscribe
        - stream.replay
        - stream.tail
      default: ask

  environment:
    checks:
      - id: bash
        type: binary
        required: false
        command: bash
        installHint: "Install bash via your package manager"
      - id: zsh
        type: binary
        required: false
        command: zsh
      - id: powershell
        type: binary
        required: false
        command: pwsh
      - id: node
        type: binary
        required: true
        command: node

  files:
    logs: "${plugin.logsDir}"
    declarations:
      - id: terminal-logs
        path: "${plugin.logsDir}/sessions"
        description: "Terminal session logs"
        clearable: true
        risk: low
      - id: terminal-state
        path: "${plugin.dataDir}/sessions.json"
        description: "Saved terminal session state"
        clearable: false

  caches:
    - id: shell-history-cache
      paths:
        - "${plugin.cacheDir}/history"
      clearable: true
      clearMode: delete-path
      risk: low
      owner: plugin

  history:
    defaultPolicy: memory

adapters:
  systemUi:
    views:
      - id: shell.terminal
        surface: main.editor
        type: custom-react
        entry: ./web/TerminalView.tsx
        title: "Terminal"
      - id: shell.split
        surface: main.editor
        type: custom-react
        entry: ./web/SplitTerminal.tsx
        title: "Split Terminal"

    panels:
      - id: shell.sessions
        surface: main.editor.bottom
        type: custom-react
        entry: ./web/SessionPanel.tsx
        title: "Sessions"

    configuration:
      - id: shell.default-shell
        title: "Default Shell"
        description: "Shell to use for new terminals"
        type: string
        default: "bash"
      - id: shell.font-size
        title: "Font Size"
        type: number
        default: 14
      - id: shell.scrollback
        title: "Scrollback Lines"
        type: number
        default: 5000

    commands:
      - id: shell.new-terminal
        title: "New Terminal"
        command: shell.terminal.create
        keys: "ctrl+shift+`"
      - id: shell.split-down
        title: "Split Terminal Down"
        command: shell.terminal.split
        keys: "ctrl+shift+5"

    menus:
      - id: shell.editor-context
        title: "Terminal"
        items:
          - command: shell.new-terminal
            label: "Open Terminal Here"
            when: "editor.hasFocus"

  cli:
    commands:
      - id: shell.cli.exec
        name: exec
        description: "Execute a command in a new shell session"
        entry: ./cli/index.ts
        handler: execHandler
        args: "<command> [args...]"
        examples:
          - "shell exec ls -la"
          - "shell exec node server.js"
        capability: shell.process

      - id: shell.cli.sessions
        name: sessions
        description: "List active shell sessions"
        entry: ./cli/index.ts
        handler: listSessions
        args: ""
        capability: shell.session
```

## 核心设计

### 为什么 `trusted: true`

Terminal 插件的核心能力是 `process.spawn`，属于危险能力。由于：
- Terminal 是 Shell 操作的基础工具
- 它需要 `process.spawn` 执行任意用户命令
- 但 **不** 允许 `default: allow`（即使 `trusted: true`）

所以配置为 `trusted: true` + `default: deny` + 用户按需授权。

### 权限策略

| 权限 | Default | 用户典型选择 | 理由 |
|------|---------|-------------|------|
| `shell.session` | ask | allow | 创建终端是预期行为 |
| `shell.process` | deny | allow | 用户确认后才 spawn |
| `shell.stream` | ask | allow | 查看输出流安全 |

### 环境检测与降级

插件声明多个 shell（bash/zsh/powershell）为 optional：
- 如果 bash 不存在但 zsh 存在 → 使用 zsh
- 所有 shell 都不存在 → Core 提示安装
- `node` 为 required → 安装前必检

### 会话回放

通过 `stream.replay`，用户可以回放已关闭 session 的全部输出。terminal-logs 作为可清理的日志存储，用户可以选择清理旧日志释放空间。

---

## 验证要点

- [ ] Manifest 校验：`trusted: true` + `process.spawn` + `default: deny` 通过
- [ ] 环境检测：正确发现可用 shell，缺失时提示安装
- [ ] 权限 Grant：安装后弹出 process/spawn 授权请求
- [ ] System UI 渲染：TerminalView 正确显示，支持 split
- [ ] CLI 命令：`shell exec` 执行命令并返回结果
- [ ] 会话管理：session create / stop / list 工作正常
- [ ] 流订阅：`stream.subscribe` 实时输出
- [ ] 回放：关闭的 session 可 replay
- [ ] 日志清理：terminal-logs 安全删除
