# SessionNode v2 — Core Architecture

> Go Core + TS Plugin 分层架构设计文档
> 取代旧 sessionBridge 的混杂核心模型

---

> **配套文档：[CAPABILITY_API.md](../core-kernel/CAPABILITY_API.md)** — 能力边界、权限模型、API 协议细节

## 目录

1. [整体架构](#一整体架构)
2. [核心概念与 ID 体系](#二核心概念与-id-体系)
3. [目录结构](#三目录结构)
4. [插件模型](#四插件模型)
5. [Go Core 能力 API](#五go-core-能力-api)
6. [同步模型](#六同步模型)
7. [ClaudeCode 工作流示例](#七claudecode-工作流示例)
8. [远程能力模型](#八远程能力模型)
9. [日志设计](#九日志设计)
10. [安全和权限](#十安全和权限)
11. [协议草案](#十一协议草案)
12. [防回退规则](#十二防回退规则)

---

## 一、整体架构

### 三层结构

```
┌────────────────────────────────────────────────────────────┐
│                      Web Host (TS)                          │
│  React SPA · 加载插件 Web 贡献 · 渲染 views/panels/actions  │
│  订阅 Core sessions/events · 调用 Core API                  │
└────────────────────┬───────────────────────────────────────┘
                     │ HTTP / WebSocket
┌────────────────────┴───────────────────────────────────────┐
│                     Go Core                                  │
│  节点身份 · 路由 · Session/Stream 生命周期 · FS/Env/Config   │
│  日志 · 审计 · 通知/审批 · 权限校验 · 插件注册 · 命令分发    │
└────────────────────┬───────────────────────────────────────┘
                     │ IPC (stdin/stdout JSON)
┌────────────────────┴───────────────────────────────────────┐
│                   CLI Host (TS/Go)                           │
│  加载插件 CLI 贡献 · 分发 CLI 命令 · 调用 Core API           │
└────────────────────────────────────────────────────────────┘
```

### 职责边界

| 层 | 拥有 | 不拥有 |
|----|------|--------|
| **Go Core** | 机器身份、路由拓扑、session 生命周期、stream 数据流、文件系统、环境变量、配置、日志、审计、通知/审批、权限、插件注册表、能力分发 | 插件业务逻辑、UI 表达、产品体验、parser、panel 布局 |
| **TS Plugin** | 页面组件、action handler、parser、CLI handler、产品逻辑 | 路由、权限校验、session 持久化、跨节点同步 |
| **Web Host** | 页面渲染、插件 UI 加载、事件订阅 | 后端状态、同步真相 |
| **CLI Host** | 插件 CLI 命令注册与分发 | 远程连接、权限绕过 |

### 数据流总图

```
用户操作 (Web UI / CLI)
       │
       ▼
Plugin Handler (TS)  ─── calls ───▶  Go Core API
                                          │
                                    ┌─────┴──────┐
                                    │ Capability  │
                                    │ Permission  │ ← 校验权限
                                    │ Check       │
                                    └─────┬──────┘
                                          │
                              ┌───────────┴──────────┐
                              │       Router           │
                              │  local / upstream /    │
                              │  downstream / relay    │
                              └───────────┬──────────┘
                                          │
                              ┌───────────┴──────────┐
                              │   Target Node         │
                              │  (本机或远程)          │
                              └─────────────────────┘
```

---

## 二、核心概念与 ID 体系

### ID 总表

| 概念 | ID 类型 | 格式示例 | 生成者 | 生命周期 | 说明 |
|------|---------|---------|--------|---------|------|
| **Node** | `nodeId` | `node_abc123` | Go Core | 持久化（配置文件） | 机器身份，安装时生成 |
| **Plugin** | `pluginId` | `claude-code`, `shell` | Manifest | 声明式 | 插件唯一标识 |
| **Session** | `sessionId` | `sess_1Lg3...` | Go Core | session 持续期间 | 长期运行实体（shell、claude 进程） |
| **Stream** | `streamId` | `stream_stdout_1Lg3...` | Go Core | stream 生命周期 | session 的 stdin/stdout/stderr |
| **Action** | `actionId` | `act_8kF2...` | Go Core | 单次请求-响应 | 一次性能力调用（fs.list, env.check） |
| **Request** | `requestId` | `req_4mN7...` | 调用方 | 单次请求-响应 | 请求追踪 ID，action/approval 共用 |
| **Event** | `eventSeq` | `42` | Go Core | session 持续期间单调递增 | session 事件的顺序号，用于多端 replay |
| **View** | `viewId` | `claude-code.chat` | Manifest | 声明式 | 前端视图类型标识 |
| **Tab** | `tabId` | `tab_3bF9...` | 浏览器 | UI 会话期间 | 仅前端投影，不参与后端同步 |
| **Route** | `route` | `local`, `upstream`, `leaf:node_abc` | Go Core | 拓扑期间 | 消息路由目标 |

### 概念关系

```
Node
  ├── 运行 Plugin (多个)
  │     └── manifest 声明 viewId / CLI commands / actions
  ├── 创建 Session (多个)
  │     ├── id: sessionId
  │     ├── kind: "shell" | "claude-code" | ...
  │     ├── pluginId: 归属哪个插件
  │     ├── nodeId: 运行在哪个节点
  │     ├── status: running | stopped | failed
  │     ├── Stream (1~3 个)
  │     │     ├── id: streamId
  │     │     ├── type: stdin | stdout | stderr
  │     │     ├── eventSeq: 单调递增
  │     │     └── subscribers: Set<WebSocket>
  │     └── Events (event log)
  │           ├── eventSeq: 1, 2, 3...
  │           ├── eventSeq: 单调递增
  │           └── 用于新订阅者 replay
  ├── 执行 Action (request-response)
  │     ├── actionId
  │     ├── capability: "fs.list"
  │     └── 不持久化，不广播
  └── 拥有 Routes
        ├── local: 本机进程
        ├── upstream: 上游 relay
        └── leaf: 下游 node

Browser (Web Host)
  └── Tab (多个)
        ├── id: tabId (仅前端)
        ├── viewId: 引用 plugin 声明的视图类型
        ├── sessionId: 关联的后端 session (可选)
        └── UI 状态: 仅 localStorage, 不是同步真相
```

### 为什么不用统一 ID

旧版用 `instanceId` 代表所有东西，导致：
- 一个 terminal session 和一次 fs.list 调用是同一种 ID，但生命周期完全不同（分钟级 vs 毫秒级）
- tab 的 UI 状态和 session 的后端状态混在一起
- 无法区分"进程还在跑"和"UI 窗口还开着"

新版每个概念独立 ID：
- `sessionId` = 长期实体，持久化，有 event log
- `actionId` = 一次性调用，不持久化，不广播
- `streamId` = 数据通道，附着在 session 上
- `tabId` = 纯 UI，不参与后端同步
- `eventSeq` = 单调递增，所有 session event 共用

---

## 三、目录结构

```
sessionnode/
├── go-core/
│   ├── cmd/node/main.go
│   ├── internal/
│   │   ├── node/
│   │   │   ├── identity.go       — nodeId 生成与管理
│   │   │   └── lifecycle.go      — 节点启动/关闭
│   │   ├── router/
│   │   │   ├── router.go         — 消息路由表
│   │   │   ├── local.go          — 本机投递
│   │   │   └── remote.go         — 远程转发 (upstream/downstream)
│   │   ├── session/
│   │   │   ├── session.go        — Session 实体
│   │   │   ├── manager.go        — 创建/销毁/列表
│   │   │   ├── event.go          — event log
│   │   │   └── persistence.go    — 磁盘持久化
│   │   ├── stream/
│   │   │   ├── stream.go         — Stream 实体
│   │   │   ├── manager.go        — 订阅/取消/广播
│   │   │   ├── replay.go         — eventSeq replay
│   │   │   └── buffer.go         — 环形缓冲
│   │   ├── process/
│   │   │   └── process.go        — 本地进程管理 (pty)
│   │   ├── fs/
│   │   │   ├── list.go           — 文件列表
│   │   │   ├── read.go           — 文件读取
│   │   │   ├── write.go          — 文件写入
│   │   │   ├── stat.go           — 文件信息
│   │   │   └── watch.go          — 文件监控
│   │   ├── env/
│   │   │   └── env.go            — 环境变量/系统信息
│   │   ├── config/
│   │   │   └── config.go         — 配置读写
│   │   ├── logs/
│   │   │   ├── log.go            — 核心日志
│   │   │   ├── audit.go          — 审计日志
│   │   │   └── rotate.go         — 日志轮转
│   │   ├── notify/
│   │   │   ├── notify.go         — 通知发送
│   │   │   ├── approval.go       — 审批请求
│   │   │   └── approval_queue.go — 审批队列
│   │   ├── plugin/
│   │   │   ├── registry.go       — 插件注册表
│   │   │   ├── manifest.go       — Manifest 解析
│   │   │   ├── host.go           — 插件进程管理 (v2)
│   │   │   └── ipc.go            — IPC 协议 (v2)
│   │   ├── permission/
│   │   │   ├── checker.go        — 权限校验
│   │   │   ├── policy.go         — 策略声明
│   │   │   └── grant.go          — 授权管理
│   │   ├── api/
│   │   │   ├── handler.go        — REST handler
│   │   │   └── middleware.go     — 认证/权限中间件
│   │   ├── ws/
│   │   │   ├── server.go         — WebSocket 服务器
│   │   │   ├── client.go         — 上游连接
│   │   │   └── protocol.go       — 消息编解码
│   │   └── daemon/
│   │       └── daemon.go         — 后台进程
│   ├── pkg/
│   │   ├── types/
│   │   │   ├── id.go             — ID 类型定义
│   │   │   ├── session.go        — Session 类型
│   │   │   ├── stream.go         — Stream 类型
│   │   │   ├── action.go         — Action 类型
│   │   │   ├── event.go          — Event 类型
│   │   │   └── route.go          — Route 类型
│   │   └── protocol/
│   │       ├── message.go        — 消息定义
│   │       ├── encode.go         — JSON 编解码
│   │       └── errors.go         — 错误码
│   ├── go.mod
│   └── go.sum
│
├── web/
│   ├── app/
│   │   ├── layout.tsx           — 主布局
│   │   ├── page.tsx             — 入口页
│   │   └── console/
│   │       ├── stage/           — 主工作区
│   │       ├── panel/           — 面板系统
│   │       └── shell/           — 终端组件
│   ├── plugin-host/
│   │   ├── loader.ts            — 插件 UI 加载器
│   │   ├── slot-renderer.tsx    — Slot 渲染引擎
│   │   └── component-registry.ts— 内置组件注册表
│   └── plugins/                 — 各插件 Web 贡献
│       ├── claude-code/
│       │   ├── plugin.yaml
│       │   ├── web/
│       │   │   ├── ClaudeChatView.tsx
│       │   │   ├── panels/
│       │   │   ├── actions.ts
│       │   │   ├── parser.ts
│       │   │   ├── history.tsx
│       │   │   └── index.ts
│       │   └── cli/
│       │       ├── start.ts
│       │       ├── history.ts
│       │       └── status.ts
│       ├── shell/
│       │   ├── plugin.yaml
│       │   ├── web/
│       │   │   ├── TerminalView.tsx
│       │   │   └── index.ts
│       │   └── cli/
│       │       └── exec.ts
│       ├── file-explorer/
│       │   ├── plugin.yaml
│       │   └── web/
│       │       ├── FileTree.tsx
│       │       └── index.ts
│       └── system-status/
│           ├── plugin.yaml
│           └── web/
│               ├── StatusPanel.tsx
│               └── index.ts
│
├── docs/
│   ├── core-v2/
│   │   └── ARCHITECTURE.md      ← 本文档
│   └── archive/                  ← 旧版归档
│
├── scripts/                      — 构建/部署脚本
└── README.md
```

---

## 四、插件模型

### 插件类型

| 类型 | Web UI | CLI | 说明 |
|------|--------|-----|------|
| **web-only** | 有 | 无 | 纯页面插件，如 file-explorer |
| **cli-only** | 无 | 有 | 纯命令行插件 |
| **web+cli** | 有 | 有 | 既有页面又有命令，如 claude-code、shell |
| **headless** | 无 | 无 | 后台服务插件，如 system-monitor |

### Manifest 声明

```yaml
# plugins/claude-code/plugin.yaml
id: claude-code
title: Claude Code
version: "1.0.0"
author: sessionnode

description: |
  Claude Code integration — AI-assisted development in terminal.

# 依赖的外部二进制
requires:
  binaries:
    - claude
    - git

# 需要的 Go Core 能力
capabilities:
  process:
    - process.spawn
    - process.kill
    - process.stdin
    - process.stdout
    - process.resize
    - process.status
  fs:
    - fs.list
    - fs.read
    - fs.write
    - fs.stat
  env:
    - env.info
    - env.checkBinary
    - env.path
    - env.home
    - env.cwd
  config:
    - config.get
    - config.set
  logs:
    - logs.tail
    - logs.query
  notify:
    - notify.send
    - notify.requestApproval

# 权限声明（给用户/管理员授权参考）
permissions:
  - id: claude.binary
    label: "允许启动 claude 二进制"
    description: "需要执行 claude 命令行工具"
  - id: claude.config.read
    label: "读取 ~/.claude 配置"
    description: "读取 Claude Code 的历史记录和配置"
  - id: workspace.readwrite
    label: "读写工作目录文件"
    description: "允许读取和修改工作区文件"

# Web 贡献
web:
  views:
    - id: claude-code.chat
      label: "Claude Chat"
      icon: sparkles
      component: custom          # 自定义 React 组件，非内置
      entry: ClaudeChatView
    - id: claude-code.history
      label: "History"
      icon: history
      component: custom
      entry: HistoryView
  panels:
    - id: claude-code.panel
      label: "Claude"
      slot: sidebar
      component: custom
      entry: ClaudePanel
  commands:
    - id: claude-code.run
      label: "Run Claude Code"
      slot: toolbar:actions
      action: claude-code.start
  menus:
    - id: claude-code.context
      label: "Claude Code"
      items:
        - label: "Explain code"
          action: claude-code.explain
        - label: "Review"
          action: claude-code.review
        - label: "Fix"
          action: claude-code.fix

# CLI 贡献
cli:
  commands:
    - name: start
      description: "Start Claude Code session"
      args: "[dir] [--target <node>]"
      action: claude-code.start
    - name: history
      description: "View Claude Code session history"
      args: "[--limit 10] [--target <node>]"
      action: claude-code.history
    - name: status
      description: "Check Claude Code session status"
      args: "[--target <node>]"
      action: claude-code.status
    - name: resume
      description: "Resume a previous Claude Code session"
      args: "<sessionId> [--target <node>]"
      action: claude-code.resume

# 运行时检查（Go Core 在加载时执行）
runtime:
  check:
    - type: binary
      name: claude
      version: ">= 0.20.0"
    - type: binary
      name: git
      optional: true
```

### 插件加载流程

```
节点启动
  → 扫描 plugins/ 目录下的所有 plugin.yaml
  → 解析 manifest，校验格式
  → 检查 requires.binaries 是否存在
  → 检查 capabilities 是否全部被 Go Core 支持
  → 检查 permissions 是否有用户授权记录
  → 注册到 Plugin Registry
  → 广播 plugin.registered 给所有连接的 browser/CLI
  → 前端收到后，加载对应 web entry 并注册到 slot 渲染器
```

### 插件调用 Core API 的方式

```
TS Plugin ── HTTP/WS ──▶ Go Core API
                           │
                     ┌─────┴──────┐
                     │ Permission  │ ← 校验插件是否有权限
                     │ Check       │
                     └─────┬──────┘
                           │
                     ┌─────┴──────┐
                     │  Router     │ ← 根据 targetNodeId 路由
                     │  local|leaf │
                     └─────┬──────┘
                           ▼
                     执行能力
```

插件调用 Core API 统一通过 HTTP/WebSocket，带上 `pluginId` 和 `requestId`：

```json
{
  "type": "action.request",
  "requestId": "req_4mN7...",
  "pluginId": "claude-code",
  "capability": "fs.read",
  "targetNodeId": "node_abc123",
  "payload": {
    "path": "/home/user/project/main.go"
  }
}
```

Go Core 收到后：
1. 校验 pluginId 是否注册
2. 校验 plugin 是否有 `fs.read` 权限
3. 校验 path 是否在 allowlist 内
4. 根据 targetNodeId 路由到本机或远程
5. 执行 fs.read
6. 返回 action.response

---

## 五、Go Core 能力 API

### 统一设计

所有能力调用走同一套 request-response 模式：

```go
// pkg/types/action.go
type ActionRequest struct {
    RequestId    string      `json:"requestId"`
    PluginId     string      `json:"pluginId"`
    Capability   string      `json:"capability"`
    TargetNodeId string      `json:"targetNodeId,omitempty"` // 空 = 本机
    Payload      interface{} `json:"payload"`
    Timestamp    int64       `json:"timestamp"`
}

type ActionResponse struct {
    RequestId   string      `json:"requestId"`
    Capability  string      `json:"capability"`
    Success     bool        `json:"success"`
    Error       *ErrorInfo  `json:"error,omitempty"`
    Payload     interface{} `json:"payload,omitempty"`
    Timestamp   int64       `json:"timestamp"`
}
```

### Process

```go
// process.spawn
Request:  { kind: "shell"|"claude-code", dir: "/home/user", env: {"KEY":"VAL"}, args: []string{} }
Response: { sessionId: "sess_1Lg3...", streamIds: { stdout: "...", stderr: "..." } }

// process.kill
Request:  { sessionId: "sess_1Lg3..." }
Response: { success: true }

// process.stdin
Request:  { sessionId: "sess_1Lg3...", data: "ls -la\n" }
Response: { success: true }

// process.resize
Request:  { sessionId: "sess_1Lg3...", rows: 24, cols: 80 }
Response: { success: true }

// process.status
Request:  { sessionId: "sess_1Lg3..." }
Response: { sessionId: "...", status: "running", pid: 12345, cpu: 2.1, mem: 50.5 }
```

### Stream

```go
// stream.subscribe (WebSocket)
// 通过 WebSocket 订阅 stream，不需要 REST API
WS Message: { type: "stream.subscribe", sessionId: "sess_1Lg3...", streamType: "stdout" }

// stream.replay
Request:  { sessionId: "sess_1Lg3...", streamType: "stdout", fromSeq: 0, toSeq: 100 }
Response: { chunks: [{ seq: 1, data: "...", ts: ... }, ...] }

// stream.write → process.stdin
Request:  { sessionId: "sess_1Lg3...", streamType: "stdin", data: "ls -la\n" }
Response: { success: true }
```

### FS

```go
// fs.list
Request:  { path: "/home/user/project" }
Response: { entries: [{ name: "main.go", type: "file", size: 1024, modTime: "..." }, ...] }

// fs.read
Request:  { path: "/home/user/project/main.go", offset: 0, limit: 4096 }
Response: { data: "base64...", size: 1024, truncated: false }

// fs.write
Request:  { path: "/home/user/project/main.go", data: "base64...", append: false }
Response: { success: true, size: 1024 }

// fs.stat
Request:  { path: "/home/user/project/main.go" }
Response: { name: "main.go", type: "file", size: 1024, modTime: "...", mode: "0644" }

// fs.watch (WebSocket)
WS Message: { type: "fs.watch", path: "/home/user/project" }
// Core 推送:
WS Message: { type: "fs.event", path: "/home/user/project/main.go", type: "changed" }
```

### Env

```go
// env.info
Request:  {}  // 不需要参数
Response: { hostname: "my-pc", os: "linux", arch: "amd64", platform: "ubuntu", version: "22.04" }

// env.checkBinary
Request:  { name: "claude", version: ">= 0.20.0" }
Response: { found: true, path: "/usr/local/bin/claude", version: "0.21.0" }

// env.path
Request:  {}
Response: { paths: ["/usr/local/bin", "/usr/bin", "/bin"] }

// env.home
Request:  {}
Response: { home: "/home/user" }

// env.cwd
Request:  { sessionId: "sess_1Lg3..." }
Response: { cwd: "/home/user/project" }
```

### Config

```go
// config.get
Request:  { key: "plugin.claude-code.theme" }
Response: { key: "plugin.claude-code.theme", value: "dark" }

// config.set
Request:  { key: "plugin.claude-code.theme", value: "light" }
Response: { success: true }

// config.watch (WebSocket)
WS Message: { type: "config.watch", key: "plugin.claude-code.theme" }
```

### Logs

```go
// logs.tail
Request:  { source: "core"|"session"|"plugin", sessionId?: "...", lines: 50 }
Response: { lines: [{ ts: "...", level: "info", msg: "..." }, ...] }

// logs.query
Request:  { source: "core", level: "error", from: "...", to: "...", limit: 100 }
Response: { lines: [...] }

// logs.session
Request:  { sessionId: "sess_1Lg3...", fromSeq: 0, toSeq: 100 }
Response: { events: [{ seq: 1, type: "started", ts: "..." }, ...] }
```

### Notify

```go
// notify.send
Request:  { type: "info"|"warn"|"error", title: "...", body: "...", timeout: 5000 }
Response: { notificationId: "ntf_..." }

// notify.requestApproval
Request:  {
            title: "Claude wants to read file",
            body: "/etc/shadow",
            detail: "Tool use: read",
            timeout: 30000,
            actions: [{ id: "allow", label: "Allow" }, { id: "deny", label: "Deny" }]
          }
Response: { requestId: "req_4mN7..." }
// 用户操作后 Core 推送:
WS Message: { type: "notify.approval.response", requestId: "req_4mN7...", action: "allow" }

// notify.respond (用户操作)
Request:  { requestId: "req_4mN7...", action: "allow" }
Response: { success: true }
```

### Plugin

```go
// plugin.list
Request:  {}
Response: { plugins: [{ id: "shell", version: "1.0.0", status: "loaded" }, ...] }

// plugin.enable
Request:  { pluginId: "claude-code" }
Response: { success: true }

// plugin.disable
Request:  { pluginId: "claude-code" }
Response: { success: true }

// plugin.status
Request:  { pluginId: "claude-code" }
Response: { id: "claude-code", status: "loaded", capabilities: [...], permissions: [...] }
```

---

## 六、同步模型

### 核心原则

```
Go Core 是同步事实来源
  └── session 存在 = 所有浏览器都能投影出 tab/view
  └── session 不存在 = 没有任何浏览器能看到它
  └── Tab/View 不拥有后端状态
  └── localStorage 只存 UI 偏好（主题、面板位置、上次路径）
```

### 浏览器刷新恢复流程

```
1. 浏览器连上 WebSocket
2. 发送 hello { nodeId: "...", lastKnownSeq?: 42 }
3. Go Core 回复 welcome
   {
     nodeId: "...",
     sessions: [
       { sessionId: "...", kind: "shell", status: "running", pluginId: "shell" },
       { sessionId: "...", kind: "claude-code", status: "running", pluginId: "claude-code" }
     ]
   }
4. 前端根据 session list 重建 tab（纯 UI 投影）
5. 如有 lastKnownSeq，Core 推送未同步的 session events
6. 前端恢复到断开前的状态
```

### Event Replay

```
session.shell.1 (eventSeq: 1) → created
session.shell.2 (eventSeq: 2) → stream.stdout: "$\r\n"
session.shell.3 (eventSeq: 3) → stream.stdout: "ls\r\n"
session.shell.4 (eventSeq: 4) → stream.stdin: "ls -la\n"
session.shell.5 (eventSeq: 5) → stream.stdout: "total 24\n..."
```

新订阅者连上来时：
```json
{
  "type": "stream.subscribe",
  "sessionId": "sess_1Lg3...",
  "requestId": "req_4mN7...",
  "fromSeq": 0  // 从最开始 replay
}
```

Core 回复：
```json
[
  {"type": "session.event", "sessionId": "sess_1Lg3...", "eventSeq": 1, ...},
  {"type": "session.event", "sessionId": "sess_1Lg3...", "eventSeq": 2, ...},
  ...
  {"type": "stream.subscribed", "sessionId": "sess_1Lg3...", "requestId": "req_4mN7..."}
  // 后续实时推送
]
```

### 多浏览器同步

```
Browser A 订阅 session X stdout
Browser B 订阅 session X stdout

Browser A 发送 stdin → Core → session X
session X 产生 stdout
  → eventSeq: 42
  → 写入 event log
  → 广播给 A 和 B
  → A 和 B 都渲染输出
```

没有"tab sync"——同步的是 session event，不是 UI tab。Tab 只是 session 的投影。

### 跨机器同步

```
Node A (relay)                      Node B (leaf)
  │                                      │
  │  session.create { kind: "shell" }     │
  │  ─────────────────────────────────▶   │
  │                                      │  spawn shell
  │  session.created { sessionId, ... }   │
  │  ◀─────────────────────────────────   │
  │                                      │
  │  session.event (stdout)               │
  │  ◀─────────────────────────────────   │
  │                                      │
  │  user stdin → session.stdin            │
  │  ─────────────────────────────────▶   │  → shell stdin
```

Core 把 session event 视为第一公民，跨机器时原样转发，不加 surface/operation 包装。

---

## 七、ClaudeCode 工作流示例

### Web 工作流

```
1. 用户打开 ClaudeCode View
   ClaudeChatView.tsx 调用 Core API:
     action.request { capability: "env.checkBinary", payload: { name: "claude" } }
     action.request { capability: "fs.list", payload: { path: "~/.claude/" } }

2. 创建 Claude Session
     action.request { capability: "process.spawn",
       payload: { kind: "claude-code", dir: "/repo", args: ["--resume"] } }
   → Core 返回 sessionId + streamIds

3. 订阅输出
   WebSocket:
     stream.subscribe { sessionId: "...", streamType: "stdout" }
     stream.subscribe { sessionId: "...", streamType: "stderr" }

4. TS Parser 解析 Stream
   stdout stream 收到 claude code 的 json 行
   parser.ts:
     - 解析 {"type": "text", "content": "..."}
     - 解析 {"type": "tool_use", "name": "Read", "input": {"path": "..."}}
     - 解析 {"type": "thinking", "content": "..."}
   parser 输出结构化数据 → React 组件渲染

5. Approval Request
   claude 需要读文件 /etc/hosts
   claude-code 插件调:
     action.request { capability: "notify.requestApproval",
       payload: { title: "Read file", body: "/etc/hosts" } }
   Core 推送到前端:
     notify.approval.request { requestId: "...", title: "Read file", body: "/etc/hosts" }
   前端渲染 approval dialog
   用户点 Allow → Core → claude-code 插件 → claude 继续

6. 用户输入
   用户输入文本 → ClaudeChatView → Core stream.write → claude stdin

7. 关闭
   用户关闭 tab → 前端不发送任何"同步"消息
   Core 的 session 还在运行（除非用户主动 kill）
   再次打开 tab → 通过 session list + replay 恢复
```

### CLI 工作流

```
终端输入:
  $ node claude start --target vps --cwd /repo

CLI Host 收到:
  1. 解析 cli command → claude-code 插件的 start handler
  2. handler 构造 action.request:
       capability: "process.spawn"
       targetNodeId: "vps"
       payload: { kind: "claude-code", dir: "/repo", args: [] }
  3. Go Core 收到:
     - 校验 claude-code 插件权限
     - 根据 targetNodeId 路由到 vps
     - vps 上执行 process.spawn
     - 创建 session，启动 claude
     - 返回 sessionId
  4. CLI Host 订阅 stdout/stderr stream
  5. stream 输出直接写到终端 stdout
  6. CLI 用户输入 → stream.write → claude stdin
  7. Ctrl+C → process.kill
  8. Go Core 保存 session event logs
```

---

## 八、远程能力模型

### 核心机制

所有能力调用天然支持 `targetNodeId` 参数。插件不需要自己实现远程连接。

```
┌───────────┐     action.request      ┌──────────┐
│ Plugin     │──┬──────────────────▶   │ Go Core  │
│ (任何节点)  │  │ {                   │          │
│            │  │   capability: "..", │  ┌───────┴──────┐
│            │  │   targetNodeId:     │  │ Route Table  │
│            │  │     "node_vps",     │  │ local|up|down│
│            │  │   payload: {...}    │  └───────┬──────┘
│            │  │ }                   │          │
└───────────┘  │                     │          │
               │                     │          ▼
               │                     │    ┌──────────┐
               │                     │    │ Target   │
               │                     │    │ Node     │
               │                     │    │ (远程)    │
               │                     │    └──────────┘
               │                     │
               │  action.response ◀──┘
               │  { success: true, payload: {...} }
```

### CLI --target

```bash
# shell 插件
node --target local shell open
node --target vps shell open

# claude-code 插件
node --target vps claude start
node --target workpc claude status
node --target local claude history

# 文件操作（通过 core fs）
node --target vps fs ls /etc
node --target workpc fs read /repo/main.go

# 系统信息
node --target all env info     # 如果支持多目标
```

### 跨节点 session 路由

```
session.create { kind: "shell", targetNodeId: "node_vps" }
  → Core 查路由表 → node_vps 在 leaf 列表
  → 转发请求给 node_vps
  → node_vps 创建 session + spawn shell
  → 返回 sessionId + streamIds
  → 发起方 Core 记录: sessionId → leaf "node_vps"

后续 stream.write { sessionId: "sess_...", data: "ls\n" }
  → Core 查 session → leaf "node_vps"
  → 转发给 node_vps
```

### 禁止

- 插件不能自己 dial 远程机器
- 插件不能绕过 Core 的权限校验
- 插件不能私自维护"session 列表"——以 Core 为准

---

## 九、日志设计

### 日志分类

| 类型 | 文件名 | 内容 | 保留策略 |
|------|--------|------|---------|
| **Core 日志** | `core-YYYY-MM-DD.log` | 节点运行、路由、session 生命周期、错误 | 按大小轮转，保留 10 个文件 |
| **审计日志** | `audit-YYYY-MM-DD.log` | 权限校验、能力调用、配置修改、节点连接/断开 | 长期保留，按天轮转 |
| **Session Events** | `sessions/sess_xxx/events.jsonl` | session 的 eventSeq 记录 | 随 session 删除 |
| **Stream 日志** | `sessions/sess_xxx/stdout.log` | stdout 原始数据 | 按大小截断 |
| **插件日志** | `plugin-{id}-YYYY-MM-DD.log` | 插件自己的日志（通过 Core 写入） | 按大小轮转 |

### 存储目录

```
~/.sessionnode/
├── config.yaml                — 用户配置
├── node.db                    — SQLite 或 JSON 持久化
├── logs/
│   ├── core-2026-05-19.log
│   ├── core-2026-05-20.log
│   ├── audit-2026-05-19.log
│   ├── audit-2026-05-20.log
│   ├── plugin-claude-code-2026-05-19.log
│   └── plugin-shell-2026-05-19.log
├── sessions/
│   ├── sess_1Lg3.../
│   │   ├── meta.json          — session 元信息
│   │   ├── events.jsonl       — eventSeq log
│   │   ├── stdout.log         — stdout 原始数据
│   │   └── stderr.log         — stderr 原始数据
│   └── sess_8kF2.../
│       └── ...
└── plugins/
    └── claude-code/
        └── data/              — 插件私有数据
```

### 日志格式

```json
// core.log (JSON Lines)
{"ts":"2026-05-19T10:00:00.000Z","level":"info","msg":"session created","sessionId":"sess_1Lg3...","kind":"shell","nodeId":"node_abc"}

// audit.log
{"ts":"2026-05-19T10:00:00.000Z","action":"capability.call","pluginId":"claude-code","capability":"fs.read","targetNodeId":"node_vps","allowed":true,"requestId":"req_4mN7..."}

// events.jsonl (per session)
{"eventSeq":1,"type":"session.created","ts":"2026-05-19T10:00:00.000Z","pluginId":"shell"}
{"eventSeq":2,"type":"stream.stdout","ts":"2026-05-19T10:00:00.001Z","data":"$\r\n"}
```

### 插件日志

插件通过 Go Core 的 `logs` capability 写入日志，不直接写文件：

```
插件 IPC 消息 → Core → 写入 plugin-{id}.log
```

```json
// 插件 → Core IPC
{"type":"log","level":"info","msg":"processing request","pluginId":"claude-code","requestId":"req_4mN7..."}
```

---

## 十、安全和权限

### 权限模型

```
Manifest 声明需要什么 ──▶ 用户/管理员授权 ──▶ Go Core 每次调用校验
```

### 权限声明

插件在 manifest 中声明需要的权限：

```yaml
permissions:
  - id: claude.binary
    label: "启动 claude 二进制"
    capabilities:
      - process.spawn
  - id: workspace.read
    label: "读取工作目录文件"
    capabilities:
      - fs.list
      - fs.read
    constraints:
      path:
        allow: ["/home/user/project/**", "/repo/**"]
        deny:  ["**/.env", "**/node_modules/**"]
  - id: claude.config.read
    label: "读取 ~/.claude 配置"
    capabilities:
      - fs.read
      - env.home
    constraints:
      path:
        allow: ["~/.claude/**"]
```

### 授权方式

```
1. 首次加载插件 → Core 检测到未授权的权限
2. 推送 notify.requestApproval 给用户
3. 用户审核权限声明
4. 用户选择 Allow / Deny / Allow with constraints
5. 授权记录写入 ~/.sessionnode/config.yaml
```

```yaml
# ~/.sessionnode/config.yaml
plugin.permissions:
  claude-code:
    claude.binary: allow
    workspace.read: allow
    claude.config.read: allow
    fs.write: deny
  file-explorer:
    fs.list: allow
    fs.read: allow
```

### 运行时校验

```go
// internal/permission/checker.go
func (c *Checker) Check(req *ActionRequest) error {
    // 1. 插件是否注册
    plugin, ok := c.registry.Get(req.PluginId)
    if !ok {
        return ErrPluginNotRegistered
    }

    // 2. 插件是否有此 capability
    if !plugin.HasCapability(req.Capability) {
        return ErrCapabilityNotDeclared
    }

    // 3. 用户是否授权
    grant := c.policy.GetGrant(req.PluginId, req.Capability)
    if grant == nil {
        return ErrNotAuthorized
    }

    // 4. 约束检查
    if grant.Constraints != nil {
        if err := c.checkConstraints(grant.Constraints, req.Payload); err != nil {
            return err
        }
    }

    return nil
}
```

### 安全规则

- **Relay 不能绕过权限** — relay 节点只转发消息，不执行业务逻辑。权限校验在目标节点的 Core 上执行
- **FS path 必须有 allow/deny** — 插件不能读取未被授权的路径
- **Process spawn 必须有 command allowlist** — 只允许 manifest 中声明的二进制
- **Notify approval 必须有 requestId 和 response tracking** — 每个 approval 有超时和唯一 ID
- **所有 capability 调用记录到 audit.log**

---

## 十一、协议草案

### WebSocket 消息

#### 连接

```json
// Browser → Core
{"type":"hello","nodeId":"browser_xxx","version":"2.0.0"}

// Core → Browser
{"type":"welcome","nodeId":"node_abc","sessions":[...],"nodes":[...],"plugins":[...]}
```

#### Session

```json
// 创建 session
{"type":"session.create","requestId":"req_1","pluginId":"shell","targetNodeId":"node_abc","payload":{"kind":"shell","dir":"/home/user"}}

// Core 回复
{"type":"session.created","requestId":"req_1","sessionId":"sess_1Lg3...","streamIds":{"stdout":"stream_...","stderr":"stream_..."}}

// Session event (Core → subscriber)
{"type":"session.event","sessionId":"sess_1Lg3...","eventSeq":42,"eventType":"stream.stdout","data":"base64...","timestamp":1712345678000}
```

#### Stream

```json
// 订阅 stream
{"type":"stream.subscribe","requestId":"req_2","sessionId":"sess_1Lg3...","streamType":"stdout","fromSeq":0}

// 订阅确认
{"type":"stream.subscribed","requestId":"req_2","sessionId":"sess_1Lg3...","streamType":"stdout"}

// Stream chunk (实时推送)
{"type":"stream.chunk","sessionId":"sess_1Lg3...","streamType":"stdout","eventSeq":43,"data":"base64...","timestamp":1712345679000}

// 写入 stream
{"type":"stream.write","sessionId":"sess_1Lg3...","streamType":"stdin","data":"bHMgLWxhCg=="} // base64("ls -la\n")

// Replay 请求
{"type":"stream.replay","requestId":"req_3","sessionId":"sess_1Lg3...","streamType":"stdout","fromSeq":0,"toSeq":100}
```

#### Action（一次性能力调用）

```json
// 请求
{"type":"action.request","requestId":"req_4","pluginId":"claude-code","capability":"fs.list","targetNodeId":"node_abc","payload":{"path":"/home/user/project"},"timestamp":1712345678000}

// 成功响应
{"type":"action.response","requestId":"req_4","capability":"fs.list","success":true,"payload":{"entries":[...]},"timestamp":1712345678001}

// 错误响应
{"type":"action.response","requestId":"req_4","capability":"fs.list","success":false,"error":{"code":"PERMISSION_DENIED","message":"path not allowed"},"timestamp":1712345678001}
```

#### Notify / Approval

```json
// 通知
{"type":"notify.send","requestId":"req_5","pluginId":"claude-code","payload":{"type":"info","title":"Done","body":"Task completed"}}

// 审批请求
{"type":"notify.approval.request","requestId":"req_6","pluginId":"claude-code","payload":{"title":"Read file","body":"/etc/hosts","actions":[{"id":"allow","label":"Allow"},{"id":"deny","label":"Deny"}],"timeout":30000},"timestamp":1712345678000}

// 用户响应
{"type":"notify.approval.response","requestId":"req_6","action":"allow"}

// 审批结果回调给请求方
{"type":"notify.approval.result","requestId":"req_6","action":"allow","respondedBy":"user","timestamp":1712345679000}
```

#### Error

```json
{"type":"error","requestId":"req_4","code":"PERMISSION_DENIED","message":"capability fs.read not authorized for plugin claude-code"}
```

### HTTP API

```http
# 节点信息
GET /api/v2/node
→ { nodeId: "node_abc", version: "2.0.0", uptime: 3600 }

# 节点列表
GET /api/v2/nodes
→ { nodes: [{ nodeId: "...", label: "VPS", status: "connected", role: "leaf" }] }

# Session 列表
GET /api/v2/sessions
→ { sessions: [{ sessionId: "...", kind: "shell", status: "running", pluginId: "shell" }] }

# Session 详情
GET /api/v2/sessions/:sessionId
→ { sessionId: "...", kind: "shell", pluginId: "shell", status: "running", streams: {...}, events: [...] }

# Action (HTTP 版)
POST /api/v2/action
Body: { requestId: "...", capability: "fs.list", targetNodeId: "...", payload: {...} }
→ { requestId: "...", success: true, payload: {...} }

# WebSocket
GET /ws/v2
```

---

## 十二、防回退规则

### 禁止事项

| # | 规则 | 例子 | 后果 |
|---|------|------|------|
| 1 | **禁止用 tabId 当 sessionId** | 前端 tab_xxx 被用作后端 session 标识 | 刷新后 tab 消失，session 状态丢失 |
| 2 | **禁止用统一 ID 代表所有概念** | 旧版的 instanceId 既代表 terminal 又代表 fs.list | 生命周期不同的实体无法区分 |
| 3 | **禁止 Web 插件直接维护同步事实** | 插件在 localStorage 保存 session 列表 | 刷新后状态不一致 |
| 4 | **禁止 CLI 插件绕过 Go Core 直接读写远程** | 插件自己 dial 远程机器的 WebSocket | 绕过权限校验、绕过审计 |
| 5 | **禁止 Go Core 出现插件专有逻辑** | Core 里写 claude-code 的 parser | 违反分层，Core 变得不可维护 |
| 6 | **禁止 localStorage 保存 session 真相** | 前端用 localStorage 恢复 session 列表 | 多浏览器之间不一致，刷新后过期 |
| 7 | **禁止 relay 私自修改业务状态** | Relay 收到 session.event 后在本地创建 session | 状态爆炸，无法追踪来源 |
| 8 | **禁止没有 eventSeq 的 session event** | 事件没有顺序号 | replay 时无法确定顺序 |
| 9 | **禁止没有 permission check 的 fs/process/env 调用** | 插件直接调 Core API 但不校验权限 | 安全漏洞 |
| 10 | **禁止 Core 返回的 session list 依赖前端过滤** | Core 返回所有 session 让前端自己筛选 | 泄露其他节点的 session 信息 |

### 设计检查清单

每个新功能上线前对照检查：

```
[ ] 使用了正确的 ID 类型？（sessionId vs tabId vs actionId）
[ ] 同步事实在 Go Core 还是在浏览器？
[ ] 插件调 Core API 时有权限校验吗？
[ ] 跨节点调用时 targetNodeId 传了吗？
[ ] Session event 有 eventSeq 吗？
[ ] 这条路径有 audit log 吗？
[ ] 浏览器刷新后能恢复吗？
[ ] relay 会不会私自修改状态？
[ ] Go Core 有没有插件专有逻辑？
[ ] CLI 命令有没有绕过 Core 直接连远程？
```

---

## 附录：旧版 vs 新版概念映射

| 旧版 | 新版 | 说明 |
|------|------|------|
| `instanceId` | → 拆分为 `sessionId` + `actionId` + `streamId` | 生命周期不同，ID 必须分开 |
| `surfaceId` | ❌ 删除 | 不需要 surface 抽象 |
| `operationId` | ❌ 删除 | 用 actionId(requestId) + eventSeq 替代 |
| `nodeId` / `peerId` | → `nodeId` | 统一为节点身份 |
| `SharedSurface` | ❌ 删除 | Session event 替代 surface publish/subscribe |
| `workbench.tabs` | ❌ 删除 | Tab 是纯 UI 投影，不参与后端协议 |
| `StateBridge` | ❌ 删除 | 不需要状态同步引擎，只转发 session event |
| `surface.publish/subscribe` | → `stream.subscribe` + `session.event` | 简化到 stream 级别 |
| `operation.input` | → `stream.write` | 统一数据通道 |
| `agent.stdout/stderr` | → `stream.chunk` | 统一消息格式 |
| `sidecar / adapter` | → `plugin` | 统一插件概念 |
| `__local__` | ❌ 删除 | 显式 nodeId 传递，不需要魔法 label |

---

## 十三、Actor 模型与认证

### Actor 类型总表

```go
type ActorType string

const (
    ActorSystemUI    ActorType = "system-ui"     // 内置控制面 UI
    ActorCLIUser     ActorType = "cli-user"      // 终端用户
    ActorService     ActorType = "service"       // Service Token（自动化）
    ActorPlugin      ActorType = "plugin"        // 插件进程
    ActorNodePeer    ActorType = "node-peer"     // 对等节点
    ActorExternalApp ActorType = "external-app"  // 外部应用
)
```

### 各 Actor 权限来源

| Actor 类型 | 权限来源 | Token 来源 | 典型场景 |
|-----------|---------|-----------|---------|
| `system-ui` | Core 启动时自动授予全部管理权限 | 内置 | Dashboard、Settings |
| `cli-user` | 本地用户身份（OS 用户匹配） | 本地 IPC 无 token | CLI 操作 |
| `service` | config.yaml 中按 token 配置的权限范围 | 管理员预生成 | CI/CD 部署 |
| `plugin` | Manifest 声明 + 用户 Grant | Plugin IPC 通道 | Claude Code |
| `node-peer` | 对等节点信任关系 | 节点间预共享 token | 跨节点转发 |
| `external-app` | 按 app 注册时的授权范围 | OAuth / 预共享 token | 自定义脚本 |

### 认证规则

```
1. Actor 类型不可由客户端伪造
   - Core 认证后根据 token 和通道类型填充 actor.type
   - 客户端声明的 actor.type 被 Core 忽略或覆盖

2. Service Token 没有默认管理员权限
   - 每个 token 必须显式声明允许的能力和约束
   - 未声明的能力调用被拒绝

3. PluginId 验证
   - PluginId 必须来自已注册的 Manifest
   - External Client 不使用 pluginId
   - 未注册的 pluginId → PLUGIN_NOT_REGISTERED
```

---

## 十四、Desired/Actual 状态与 Reconcile

### 核心模型

受 Kubernetes 启发，Plugin 管理使用 Desired State / Actual State 模型：

```
Desired State = 用户期望的插件状态（config.yaml 中声明）
Actual State  = Core 检测到的插件实际状态
Reconcile     = 对比差异并执行任务以趋近 Desired State
```

### Desired State 声明

```yaml
# ~/.sessionnode/config.yaml
plugins:
  desired:
    claude-code:
      state: enabled
      version: "1.0.0"
      permissions:
        fs.read: allow
        process.spawn: allow
    shell:
      state: enabled
```

### Reconcile 流程

```
1. Core 读取 Desired State（用户配置）
2. Core 检测 Actual State（运行 plugin.check）
3. 对比差异
4. 如有差异，生成 Task
5. 执行 Task（经过 Plan + Permission）
6. 重新检测 Actual State
7. Desired == Actual → 完成
```

### 禁止

```
Desired State 变更不直接触发安装/卸载操作。
实际变更必须经过 Plan Before Apply + Permission Check。
Desired State 只是声明用户期望，执行路径与其他操作一致。
```

---

## 十五、Task 生命周期

### Task 定义

Task 是 Core 中执行异步操作的实体。用于 reconcile、安装、清理等场景。

```
Task 状态机:
  pending → running → success
                   → failed
                   → cancelled

Task 类型:
  - reconcile: 插件状态趋同
  - install: 安装依赖
  - cache-clear: 清理缓存
  - plugin-check: 环境检测
```

### Task 消息

```json
// 创建 Task
{
  "type": "task.create",
  "requestId": "req_abc",
  "pluginId": "system-ui",
  "payload": {
    "taskType": "reconcile",
    "target": "claude-code",
    "priority": "normal"
  }
}

// Task 状态推送
{
  "type": "task.event",
  "taskId": "task_001",
  "status": "running",
  "progress": "Installing claude-cli...",
  "timestamp": 1712345678000
}

// Task 完成
{
  "type": "task.completed",
  "taskId": "task_001",
  "status": "success",
  "result": { "pluginId": "claude-code", "state": "enabled" }
}
```

### Task 的审计

```
所有 Task 操作写入 audit log：
  task.create: type=reconcile, target=claude-code
  task.completed: taskId, status=success
  task.failed: taskId, error=...
```

---

## 十六、健康检查与指标

### 健康检查端点

```http
GET /api/health
→ {
    "status": "ok",
    "version": "2.0.0",
    "uptime": 3600,
    "nodeId": "node_abc",
    "nodes": {
      "total": 3,
      "connected": 2,
      "disconnected": 1
    },
    "sessions": {
      "total": 5,
      "running": 3,
      "stopped": 2
    },
    "plugins": {
      "total": 4,
      "enabled": 3,
      "disabled": 1
    }
  }

// 详细健康检查
GET /api/health/detail
→ {
    "memory": { "used": "128MB", "total": "512MB" },
    "goroutines": 42,
    "eventLoopLag": "5ms",
    "disk": {
      "dataDir": "/home/user/.sessionnode",
      "free": "50GB",
      "total": "256GB"
    },
    "uptime": 3600
  }
```

### 自动上报

```
Core 定期（默认 30s）广播健康状态：
  WebSocket: node.health { nodeId, status, sessions, uptime }

system-ui 收到后更新 Dashboard。
CLI 可通过 node.health 能力查询。
```

### 指标数据

```
Core 维护以下计数器（内存中，可暴露给 Prometheus 等）：
  - capability.calls.total
  - capability.calls.allowed
  - capability.calls.denied
  - sessions.created
  - sessions.stopped
  - nodes.connected
  - nodes.disconnected
  - plugins.installed
  - plugins.enabled
  - plugins.disabled
  - approval.requests
  - approval.responses
  - approval.timeouts
```

---

## 十七、防回退规则补充

除了第十二节的规则外，新增以下规则：

| # | 规则 | 后果 |
|---|------|------|
| 11 | **禁止 Actor 类型由客户端指定** | Core 认证后填充，客户端不可伪造 |
| 12 | **禁止 Service Token 默认管理员权限** | 权限必须显式声明 |
| 13 | **禁止 Desired State 绕过 Plan/权限** | 仅声明期望，不走捷径 |
| 14 | **禁止 Core 不作为健康检查** | 必须有 `/api/health` 端点 |
| 15 | **禁止 Core 重启后丢失节点拓扑** | 拓扑必须持久化 |
| 16 | **禁止 Task 不写 audit** | 所有 Task 操作必须审计 |
