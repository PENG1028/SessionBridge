# SessionNode — 设计文档

> Go 重写版，取代旧的 TypeScript sessionBridge。

---

## 术语

| 术语 | 含义 |
|------|------|
| **Node** | 运行本软件的一台机器。每个 node 有唯一 ID、名称、地址 |
| **Relay** | Node 的一种角色。提供跨网络层转发，让内网/不可达的节点可以被访问 |
| **Leaf** | 通过 Relay 访问的节点。通常位于 NAT 后或内网中，不能直接建立入站连接 |
| **Instance** | 一个运行中的会话（终端、命令执行等）。每个 instance 有唯一 ID |
| **Stream** | Instance 的 stdin/stdout 数据流 |

---

## 核心使用场景

### 场景 A：单机终端

```
Browser ── Node(:8080)
               │
            shell(pty)
```

用户在本机启动 node，浏览器打开开终端。最简单的路径。

### 场景 B：跨网络拓扑

```
Browser ── Node A (:8080) ──── Node B (:8080)
          [relay]                  [leaf: NAT 后]
               │                         │
            本机 shell              远程 shell
```

- Node A 可作为 relay（跨层转发）
- Node B 是 leaf（NAT 后，不能直接连）
- 浏览器连 A，可以在 B 上开终端
- 消息路径：Browser ↔ A ↔ B

### 场景 C：多跳拓扑

```
Browser ── Node A ── Node B ── Node C
          [relay]    [relay]    [leaf: NAT 后]
```

Node A 连 B，B 连 C。浏览器连 A 可以在 C 上开终端。

### 场景 D：多浏览器 + 多 leaf

```
Tab1 ─┐
      ├─ Node A ── Node B (leaf)
Tab2 ─┘           ── Node C (leaf)
```

两个浏览器 Tab 都连到 Node A（relay）。A 同时连接 B 和 C 两个 leaf。Tab1 和 Tab2 可以分别在 B 和 C 上开终端，各自的输出互不干扰。

### 场景 E：文件浏览

```
Browser ── Node A ── Node B
              │           │
          ls /tmp     ls /home
```

在任何节点上查看目录结构，REST 请求，不需要 WebSocket。

### 场景 F：CLI 优先

```
node                          # 前台启动（默认 :8080）
node --port 9090              # 指定端口
node --name myserver          # 指定节点名称

node daemon start             # 后台启动
node daemon stop              # 停止
node daemon status            # 查看 daemon 状态
node daemon install           # 注册开机自启

node connect ws://...         # 连接上游 relay
node disconnect               # 断开上游

node status                   # 本机状态
node ls                       # 列出所有节点

node exec <node> <cmd>        # 在指定节点执行命令，stdout 输出

node config get <key>         # 读取配置
node config set <key> <val>   # 修改配置

node --help
node version
```

---

## 架构设计

### 节点类型与拓扑

```
       ┌──────────────────┐
       │   Node A (relay) │  ← 公开可达，运行 relay 转发
       │   :8080          │
       └────┬─────────────┘
            │                   
    ┌───────┴────────┐
    │                │
    ▼                ▼
┌─────────┐   ┌─────────┐
│ Node B  │   │ Node C  │  ← Leaf: NAT 后或内网
│ (leaf)  │   │ (leaf)  │    只能主动出站连接
└─────────┘   └─────────┘
```

- **Relay**: 节点启动时带 `--relay` 或配置中 `role: relay`。接受来自 leaf 的连接，替它们转发流量
- **Leaf**: 默认角色。主动连接到 relay，由 relay 代为接收入站请求
- 一个节点可以同时是 relay（接受其他 leaf 连接）且是另一个 relay 的 leaf

### 路由模型

每个节点维护一张路由表：

```
inst_abc → local (PID 12345)
inst_def → leaf "Node B"
inst_ghi → leaf "Node C"
inst_jkl → upstream relay "Node A"
```

收到消息 → 按 instanceId 查路由表 → 投递到目标。

```
消息源        →  本机 Router  →  目标
───────────────────────────────────────
本地 shell    →  stdout       →  订阅者的 WebSocket
本地 WebSocket → stdin        →  instance（查表路由）
上游 relay    →  消息          →  本地 instance 或下游 leaf
Leaf          →  消息          →  本地 instance 或上游 relay
```

### 消息协议（~15 种）

```
===== 控制 =====
hello / welcome     — 连接握手
ping / pong         — 心跳

===== 节点发现 =====
node.announce       — 新节点上线（广播给所有连接）
node.leave          — 节点下线
node.list           — 节点列表

===== 实例管理 =====
instance.create     — 创建实例 { kind, dir?, node? }
instance.created    — 创建成功 { instanceId }
instance.destroy    — 销毁
instance.destroyed  — 销毁确认
instance.list       — 实例列表

===== 流数据 =====
instance.stdout     — 实例输出 → subscriber
instance.stdin      — 用户输入 → 实例
instance.resize     — 终端 resize
instance.exit       — 退出 { code }

===== 错误 =====
error               — 统一错误
```

### HTTP API

```
GET  /api/health            — 健康检查
GET  /api/nodes             — 节点列表
GET  /api/instances         — 实例列表
POST /api/instances         — 创建 { kind, dir?, node? }
DELETE /api/instances/:id   — 销毁

GET  /api/nodes/:id/fs?path= — 文件树浏览
```

WebSocket 端点：`GET /ws`

---

## 实现计划

### Phase 0：骨架
- `go mod init sessionnode`
- `cmd/node/main.go`
- `pkg/types/types.go`
- 空 `internal/` 结构子目录

### Phase 1：单机 relay + 终端
- WebSocket server（gorilla/websocket）
- PTY shell（creack/pty 或本地 os/exec）
- Instance 管理（创建/销毁/列表）
- 消息路由（路由表 + 转发）
- HTTP API（health/nodes/instances）
- 静态文件服务（embed 前端 SPA）
- **验证**: 浏览器开终端输命令

### Phase 2：跨节点拓扑
- WebSocket client（连接上游 relay）
- Leaf 注册到 relay
- 跨节点消息路由
- 节点发现/心跳
- **验证**: 两台机器远程终端

### Phase 3：CLI 完整
- daemon 模式（后台进程）
- `node exec`（通过 WebSocket 连本地 node 发命令）
- `node connect/disconnect`
- `node status` / `node ls`

### Phase 4：文件浏览
- 文件树 API（ReadDir）
- 前端文件树组件

### Phase 5：认证 + 打包
- 密码认证
- CI 交叉编译
- Docker 镜像
- 安装脚本

---

## 包结构

```
sessionnode/
├── cmd/node/main.go
├── internal/
│   ├── node/
│   │   ├── node.go            — 节点主循环
│   │   ├── instance.go        — 实例管理
│   │   └── router.go          — 消息路由
│   ├── shell/
│   │   └── shell.go           — PTY 进程
│   ├── ws/
│   │   ├── server.go          — WebSocket 服务器
│   │   ├── client.go          — WebSocket 客户端（连接上游）
│   │   └── protocol.go        — 消息编解码
│   ├── api/
│   │   └── handler.go         — REST API
│   ├── config/
│   │   └── config.go          — 配置
│   └── daemon/
│       └── daemon.go          — 后台进程
├── pkg/types/types.go         — 公共类型
├── web/                       — 前端 SPA
├── go.mod
└── go.sum
```

---

## 设计原则

1. **一个 ID** — instanceId 管所有。不该有第二个 ID 体系
2. **无状态同步** — 节点不主动同步状态，只转发消息。谁订阅谁维护
3. **浏览器不做 peer** — 只用 REST + WebSocket 订阅，不对等
4. **CLI 优先** — 所有功能先有 CLI 命令，后有前端
5. **插件接口在第一天设计，v2 实现** — core 从第一天定义 plugin interface，但内置插件（terminal、fs）直接编译进 binary 实现这些接口。动态加载是 v2 的事
6. **跨层第一天设计** — 路由表从第一天分 local / leaf / upstream

---

## 插件系统设计（v2 实现，v1 预留）

### 设计目标

- 插件 = 一个独立的可执行文件，通过 stdin/stdout JSON 或 Unix socket 与核心通信
- 核心不信任插件——插件通过声明权限来获取能力
- 插件可以声明：新的 instance kind、UI 组件、CLI 子命令、事件处理
- 前端组件是声明式组合——插件不写 HTML，而是声明"我要在这里放一个按钮，点了我收到事件"
- 同一套 UI 声明在桌面和移动端自适应

### 核心接口（v1 定义在 `pkg/plugin/`）

```go
package plugin

// Plugin 是所有插件必须实现的接口
type Plugin interface {
    Name() string
    Version() string
    Manifest() Manifest
}

// Manifest 声明插件的能力
type Manifest struct {
    Name        string          `json:"name"`
    Version     string          `json:"version"`
    Description string          `json:"description,omitempty"`
    Permissions []Permission    `json:"permissions"`     // 所需权限
    Instances   []InstanceKind  `json:"instances,omitempty"`    // 提供哪些 instance kind
    UI          *UIManifest     `json:"ui,omitempty"`    // UI 贡献
    CLI         *CLIManifest    `json:"cli,omitempty"`   // CLI 子命令
}

type Permission string
const (
    PermissionFilesystemRead  Permission = "filesystem:read"
    PermissionFilesystemWrite Permission = "filesystem:write"
    PermissionNetwork         Permission = "network"
    PermissionProcess         Permission = "process:spawn"
    PermissionUIEvent         Permission = "ui:event"      // 触发弹窗/通知
    PermissionClipboard       Permission = "clipboard"
)

// InstanceKind 声明插件提供的实例类型
type InstanceKind struct {
    Kind  string `json:"kind"`  // 例如 "terminal", "claude-code"
    Label string `json:"label"` // 显示名称
    Icon  string `json:"icon"`  // 图标名（前端内置图标集中选）
    Args  bool   `json:"args"`  // 创建时是否需要用户输入参数
}
```

### 插件生命周期

```
核心启动
  → 扫描插件目录（~/.node/plugins/）
  → 执行每个插件的可执行文件，建立 IPC 连接
  → 调用 plugin.Hello() 获取 Manifest
  → 检查权限声明，加入能力注册表
  → 广播 plugin.registered 给前端（前端更新 UI）

运行时
  → 用户创建 "claude-code" 实例
  → 核心查注册表 → 路由到对应插件
  → 插件返回 instanceId，核心建立 stream 通道
  → stdin/stdout 在核心和插件之间流转

核心关闭
  → 逐个调用 plugin.Shutdown()
  → 关闭 IPC 连接
```

### 插件与核心的关系

```
┌──────────────────────────────────────────┐
│                 核心 (node)                │
│                                            │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  │
│  │ Terminal │  │  Router   │  │ API     │  │
│  │  (pty)   │  │          │  │ Server  │  │
│  └─────────┘  └──┬───────┘  └─────────┘  │
│                  │                        │
│         ┌────────┴────────┐              │
│         │  Plugin Host    │              │
│         │  (进程管理)      │              │
│         └────────┬────────┘              │
└──────────────────┼───────────────────────┘
                   │ IPC (stdin/stdout JSON)
            ┌──────┴──────┐
            │ claude-code  │
            │ (独立进程)    │
            └─────────────┘
```

### Instance 路由扩展（插件感知）

核心的路由表从：

```
inst_abc → local shell
```

扩展为：

```
inst_abc → local shell                 (PID 12345)
inst_def → plugin:claude-code          (插件进程)
inst_ghi → leaf "Node B"               (远程)
inst_jkl → plugin:claude-code@Node B   (远程节点上的插件)
```

`instance.create` 的消息体：

```json
{
  "type": "instance.create",
  "kind": "claude-code",
  "dir": "/home/user/project",
  "node": "Node B",
  "args": {"command": "analyze"}
}
```

核心根据 kind 查插件注册表 → 如果是插件类型 → 路由给对应插件进程。

### UI 贡献系统

插件不直接提供 UI 组件。插件声明"UI 意图"，前端有内置渲染器。

#### 声明方式（Manifest）

```json
{
  "ui": {
    "commands": [
      {
        "id": "claude-code.run",
        "label": "Run Claude Code",
        "icon": "sparkles",
        "slot": "node-bar:actions",     // 放在节点栏的操作区
        "action": {
          "type": "createInstance",
          "kind": "claude-code"
        }
      }
    ],
    "panels": [
      {
        "id": "claude-output",
        "label": "Claude Output",
        "slot": "main:panel",           // 放在主区域的 tab
        "component": "log-viewer",       // 前端内置组件
        "responsive": {
          "desktop": {"width": 600},
          "mobile": {"fullscreen": true}
        }
      }
    ],
    "events": [
      {
        "type": "confirm-dialog",
        "label": "Claude wants to read file",
        "component": "confirm-dialog",   // 前端内置弹窗组件
        "timeout": 30000
      }
    ]
  }
}
```

#### 前端 Slot 系统

前端预定义 slot 位置，插件声明往哪里填：

```
┌─ Top Bar ───────────────────────────────────┐
│  [Node:A] [Node:B]  |  [🔍] [⚙️]  ← command slots │
├─── Left Sidebar ──┬─ Main Area ─────────────┤
│  panel slots      │  panel slots            │
│  (file tree)      │  (terminals, logs)      │
│                   │                         │
├─── Status Bar ───────────────────────────────┤
│  status slots                                │
└──────────────────────────────────────────────┘
```

#### 前端内置组件

插件可以声明的 component 类型（前端内置，不需要插件提供代码）：

| component | 用途 | 桌面 | 移动端 |
|-----------|------|------|--------|
| `terminal` | 终端 | 全高 | 全屏 |
| `log-viewer` | 日志输出 | 可调大小 | 可滚动 |
| `file-tree` | 文件树 | 侧边栏 | 底部 sheet |
| `confirm-dialog` | 确认弹窗 | 居中弹窗 | 底部弹窗 |
| `notifications` | 通知 | 右上角 | 顶部 |
| `button` | 按钮 | 正常 | 触控友好 |
| `markdown` | 富文本 | 正常 | 正常 |
| `form` | 表单 | 正常 | 全屏 |

#### 响应式处理

```
前端收到 plugin.registered
  → 读取 manifest.ui
  → 按当前设备类型（desktop/mobile）选择 responsive 配置
  → 渲染到对应 slot

前端收到 plugin.event（来自插件的弹窗请求）
  → 按 event.component 类型选择渲染器
  → 桌面：居中弹窗
  → 移动端：底部 sheet
  → 用户操作后，结果返回给插件
```

### 插件触发弹窗流程

```
插件需要用户确认删除文件
  → 插件发送: { type: "ui.event", event: "confirm-dialog",
                payload: { title: "Delete?", body: "Delete file X?" } }
  → 核心转发给前端
  → 前端渲染 confirm-dialog（桌面弹窗 / 移动端 bottom sheet）
  → 用户点确认
  → 前端发送: { type: "ui.response", eventId: "...", result: "confirmed" }
  → 核心转发给插件
  → 插件继续执行
```

这个流程和 instance stream 是**两条独立通道**——UI 事件是请求-响应模式，实例 stream 是持续的双向流。

### CLI 插件声明

插件可以在 manifest 的 cli 字段声明子命令：

```json
{
  "cli": {
    "subcommands": [
      {
        "name": "claude",
        "description": "Run Claude Code operations",
        "args": "<command> [args...]",
        "permission": "process:spawn"
      }
    ]
  }
}
```

核心在启动时收集所有插件的 CLI 子命令，合并到 `node` 命令树：

```
node exec <node> <cmd>         ← 内置
node claude <args...>          ← 来自 claude-code 插件
node fs read <path>            ← 来自文件系统插件（如果有）
```

实现方式：

```go
// 核心启动时
for _, p := range plugins {
    for _, sub := range p.Manifest().CLI.Subcommands {
        cliRoot.AddCommand(sub.Name, func(cmd *cobra.Command) {
            // 把 CLI 参数 → JSON → 发送给插件进程
            // 插件进程执行后通过 stdout 输出结果
        })
    }
}
```

### 日志系统

#### 核心日志

```
存储位置:
  Linux:   ~/.node/logs/
  macOS:   ~/.node/logs/
  Windows: %USERPROFILE%\.node\logs\

文件:
  node.log              — 当前日志
  node.2026-05-19.log   — 轮转后的历史日志

格式 (JSON):
  {"time":"2026-05-19T10:00:00Z","level":"info","msg":"instance created","instance":"inst_abc","kind":"terminal"}

配置:
  log.level: debug|info|warn|error
  log.maxSize: 100MB    (轮转阈值)
  log.maxFiles: 10      (保留个数)
  log.json: true|false  (JSON 格式或文本格式)
```

#### 插件日志

每个插件有独立日志流：

```
~/.node/logs/plugin-claude-code.log
```

插件通过 IPC 发送日志事件给核心，核心统一写入日志文件：

```json
// 插件 → 核心 IPC 消息
{"type": "log", "level": "info", "msg": "processing request", "request_id": "req_123"}
```

#### 前端日志查看

- 插件 `log-viewer` 组件可以实时显示日志流
- 前端通过 WebSocket 订阅 `log.stream` 消息
- 桌面端：可拖拽大小的面板
- 移动端：全屏可滚动视图

### 插件与内置实现的关系（v1）

v1 虽然不实现插件动态加载，但**内置功能（terminal、file system）也通过同样的接口实现**：

```go
// internal/shell/shell.go
type ShellPlugin struct{}  // 实现 plugin.Plugin 接口

func (s *ShellPlugin) Manifest() plugin.Manifest {
    return plugin.Manifest{
        Name: "terminal",
        Instances: []plugin.InstanceKind{
            {Kind: "terminal", Label: "Terminal", Icon: "terminal", Args: false},
        },
    }
}
```

好处：
- 插件的代码路径和内置功能的代码路径是同一套
- 从 v1 到 v2 的迁移：把内置的实现拆成独立进程即可
- 接口在第一天就经过实战验证

### 包结构调整

```
sessionnode/
├── cmd/node/main.go
├── internal/
│   ├── plugin/
│   │   ├── host.go          — 插件进程管理 (v2)
│   │   ├── registry.go      — 插件注册表
│   │   └── ipc.go           — IPC 协议 (v2)
│   ├── node/
│   │   ├── node.go          — 节点主循环
│   │   ├── instance.go      — 实例管理
│   │   └── router.go        — 消息路由（含插件感知）
│   ├── shell/
│   │   └── shell.go         — 终端（实现 plugin.Plugin）
│   ├── ws/
│   │   ├── server.go        — WebSocket 服务器
│   │   ├── client.go        — 上游连接
│   │   └── protocol.go      — 消息编解码
│   ├── api/
│   │   └── handler.go       — REST API
│   ├── config/
│   │   └── config.go        — 配置
│   └── log/
│       └── log.go           — 结构化日志（JSON + 轮转）
├── pkg/
│   ├── types/types.go       — 公共类型
│   └── plugin/plugin.go     — Plugin 接口定义
├── web/                     — 前端 SPA
├── go.mod / go.sum
```
