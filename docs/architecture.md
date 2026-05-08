# SessionBridge — 架构文档

> 最后更新: 2026-05-08
> 版本: v0.6.0

---

## 一、项目定位

SessionBridge 是一个 **多端远程控制台 (Remote Agent Console)** — 一套让任何设备控制任何其他设备的开源系统。

不是"Claude Code 的 Web 前端"，不是终端桥接工具，不是 SSH 客户端。虽然当前支持的 adapter 之一是 Claude Code，但架构本身是通用、多 peer 的：每个安装实例运行同一份 `NodeRuntime` 二进制，自动探测自己的角色，既可以控制别人也可以被别人控制。

**关键理念**：所有节点都是对等的。无论是浏览器、手机 APK、Windows EXE、还是服务器无头进程，都跑同样的核心代码，只有 form factor 不同。

### 设计原则

- **双端口职责清晰**：Relay 默认使用 `8080` 提供 HTTP/API/WebSocket 中继，Dashboard 默认使用 `9843` 提供本地管理面板。
- **节点即平台**：PC、手机、服务器都围绕同一套 `NodeRuntime` 组织，只通过角色和外壳形态区分。
- **实例即执行上下文**：每个 Instance 绑定独立工作目录、进程状态和输出缓冲；UI 只是在不同 View 中呈现这些上下文。
- **Adapter 插件体系**：Core 不绑定特定 AI 或终端后端，通过 Adapter 暴露能力、View 和 Panel。

---

## 二、节点拓扑

### 角色自动探测

每个节点启动时自行决定角色：

```
NodeRuntime.resolveRole()
    │
    ├─ 配置强制 relay → 启动 WebSocket 服务器，接受外来连接
    │
    ├─ 配置强制 leaf  → 作为 agent 连接上游 relay
    │
    └─ auto（默认）→ 调用 system-info adapter 检测网络能力
         │
         ├─ 有公网 IP / 可端口监听 → relay 角色
         └─ 无公网 IP / NAT 环境 → leaf 角色（主动连出）
```

### 典型拓扑

```
┌─────────────────┐    HTTP/WS + Crypto     ┌──────────────────────────┐
│  Flutter APK      │ ◀══════════════════▶  │  VPS 节点                │
│  (手机)           │    AES-256-GCM      │  role: relay              │
│  ├─ 内置 WebView  │    wss:// (可选 TLS)  │  NodeRuntime              │
│  │  加载本地面板   │                      │  ├─ Relay HTTP/WS :8080   │
│  └─ 后台通知服务  │                      │  ├─ Dashboard :9843       │
└─────────────────┘                      │  ├─ 本地面板               │
                                          │  ├─ Identity Manager     │
┌─────────────────┐    HTTP/WS + Crypto     │  ├─ Crypto Layer         │
│  PC 节点          │ ◀══════════════════▶  │  ├─ Adapter Layer         │
│  role: leaf       │    AES-256-GCM      │  │  ├─ Claude Code       │
│  NodeRuntime      │    wss:// (可选 TLS)  │  │  ├─ Shell              │
│  (家里电脑)       │                      │  │  └─ System Info        │
│  ├─ 本地面板      │                      └──────────────────────────┘
│  └─ RelayConnect  │                                  ▲
└─────────────────┘                          HTTP/WS + Crypto
                                              AES-256-GCM
                                                      ▼
                                          ┌──────────────────────────┐
                                          │  PC 节点                  │
                                          │  role: leaf               │
                                          │  ├─ 本地面板             │
                                          │  └─ RelayConnect         │
                                          └──────────────────────────┘
```

**Dashboard（本地面板）访问方式**：

| 设备 | 怎么用 | 可对外暴露？ |
|------|--------|------------|
| PC | EXE/浏览器打开本地面板 (127.0.0.1:9843) | 本机 API 已实现，前端体验仍在收口 |
| 手机 | APK 内置 WebView 加载自己的面板 | 开发中 |
| 服务器 | 无 GUI，默认不查看 | 远程协议已存在，端到端体验仍在收口 |

Dashboard 默认绑定 `127.0.0.1`（仅本机访问）。当前实现提供 `/api/node/external` 本机接口，可执行网络环境检测并切换 `dashboardBind` 后重启 Dashboard。远程节点通过 `node.external.*` 协议转发的后端通道已存在，但前端入口与端到端体验仍在收口中。

```
本机操作: Dashboard → /api/node/external → 检测环境 → 切换 dashboardBind
远程操作: node.external.inspect / node.external.set → relay 转发 → 目标节点处理
              (前端入口与状态展示仍在收口中)
```

网络检测覆盖：本机 IP 地址（127.0.0.1 / LAN / 公网）、HTTPS 证书状态、认证 Token 配置，以及基于网卡信息的端口可达性启发式判断。检测通过后可修改 `dashboardBind` 并重启绑定。防火墙/安全组外部探测目前还不是强校验。

跨节点控制不依赖访问别人的面板。**本地面板会显示全网所有实例**，从自己面板直接操控远程进程。

**关键特性**：
- 所有通信经过应用层 AES-256-GCM 加密，不依赖 TLS
- 每个节点持有 Ed25519 身份密钥对（首次启动自动生成）
- 通过 ECDH + HKDF 派生每连接会话密钥，具备前向安全
- TLS 可选：配置证书后自动升级到 HTTPS/WSS，加密层双重叠加
- 每个节点都可以控制其他节点（通过 relay 路由）
- 每个节点都可以被其他节点控制（注册为 agent）
- 一个 relay 可以挂载任意多个 leaf 节点
- relay 本身也可以连接另一个 upstream relay（链式拓扑）
- Dashboard 对外暴露能力处于部分实现状态：本机 API 已可用，远程协议已接入 relay，完整前端入口和端到端状态仍需收口

---

## 三、Core 架构

### NodeRuntime — 统一编排器

`NodeRuntime`（`adapters/agent-core/node-runtime.ts`）是整个系统的核心编排器，取代了旧版 relay/agent 分离架构。无论是 relay 服务器还是 leaf agent，都通过同一个 `NodeRuntime` 启动。

```
NodeRuntime
│
├─ resolveConfig()          ← NodeConfig（CLI/环境变量/配置文件三源合并）
├─ resolveRole()            ← 角色自动探测
│
├─ [relay 角色]
│   └─ NodeRelayServer      ← HTTP + WebSocket 服务器
│       ├─ REST API (8 端点)
│       ├─ WebSocket (v1 信封)
│       ├─ InstanceManager
│       ├─ AuditLogger
│       └─ SessionPersistence
│
├─ [所有角色]
│   ├─ Dashboard            ← 本地管理页面 (127.0.0.1:9843)
│   │                          仅当前设备用户使用。PC 用 EXE 打开，
│   │                          手机 APK 用 WebView 加载，服务器无 GUI 默认不看
│   ├─ RelayConnection      ← 连接上游 relay
│   ├─ AdapterRegistry      ← 插件注册中心
│   │   ├─ shellAdapter
│   │   ├─ claudeCodeAdapter
│   │   └─ systemInfoAdapter
│   ├─ RelayEventBus        ← 跨组件事件总线
│   ├─ PermissionModel      ← 权限管控
│   └─ NotificationModel    ← 通知管理
│
└─ [leaf 角色]
    └─ Shell 进程管理        ← spawn/kill, PID 文件, 孤儿进程清理
         ├─ 256KB 背压高水位
         ├─ 64KB 背压低水位
         └─ 每 200ms 轮询恢复
```

### 启动流程

```
bridge（CLI 入口：src/index.ts）
    │
    ├─ 解析 CLI 参数 → Partial<NodeConfig>
    ├─ 创建 NodeRuntime(config)
    │
    └─ node.start()
         │
         ├─ 1. 解析配置文件 (agent.json / BRIDGE_CONFIG)
         ├─ 2. 合并 CLI 覆盖 → resolveConfig()
         ├─ 3. 自动生成/恢复持久化 nodeId
         ├─ 4. resolveRole() → relay 或 leaf
         ├─ 5. 如果角色=relay → 启动 NodeRelayServer
         │      ├─ HTTP 服务器
         │      ├─ WebSocket 服务器
         │      ├─ 注册 REST API 路由
         │      └─ 恢复持久化会话
         ├─ 6. 启动 Dashboard（本地管理页面 :9843）
         ├─ 7. 注册适配器 (shell / claude-code / system-info)
         ├─ 8. 检测可用适配器
         ├─ 9. 连接 Relay（上游或回环）
         └─ 10. [leaf 角色] 注册成功后 spawn shell
```

### NodeConfig — 统一配置

`NodeConfig`（`adapters/agent-core/config.ts`）是整个节点的统一配置对象，从三个来源合并（优先级递减）：
1. CLI 参数（`bridge --upstream ws://host:8080 --role leaf`）
2. `BRIDGE_CONFIG` 环境变量指向的 JSON 文件
3. 默认值

```typescript
interface NodeConfig {
  // 身份
  label: string;               // 节点显示名
  role: 'auto' | 'relay' | 'leaf';
  nodeId?: string;              // 持久化节点标识（首次启动自动生成）
  nodeRole?: string;            // 角色标签（mesh/权限用）
  workingDirectory: string;

  // Relay 服务器（relay 角色启用）
  relayPort: number;            // 默认 8080
  relayBind: string;            // 默认 0.0.0.0
  relayToken?: string;          // 认证令牌

  // 上游 relay（leaf 角色连接方向）
  upstreamRelay?: string;

  // Dashboard（始终启用）
  dashboardPort: number;        // 默认 9843
  dashboardBind: string;        // 默认 127.0.0.1

  // 能力
  adapters?: string[];
  permissions?: PermissionConfig;
  notificationSettings?: Record<string, boolean>;
  ntfyTopic?: string;

  // 加密
  identityPath?: string;        // Ed25519 身份密钥存储路径（默认 ~/.sessionbridge/identity.json）
  crypto?: CryptoConfig;        // 加密配置

  // 持久化
  logFile?: string;
  pidFile?: string;

  // 扩展配置（设备/平台专用，opaque）
  extensions?: Record<string, unknown>;
}
```

**nodeId 自动生成**: 首次启动时生成 32 字符 hex 标识，持久化到 `~/.sessionbridge/agent.json`，后续启动复用。用于事件路由、审计追踪和 mesh 网络。

**身份密钥自动生成**: 首次启动时在 `~/.sessionbridge/identity.json` 生成 Ed25519 密钥对。`publicKey` 作为节点身份标识参与 ECDH 握手，派生每连接 AES-256-GCM 会话密钥。

---

## 四、Adapter 插件体系

### AgentAdapter 接口

系统通过 Adapter 接口解耦具体 AI 后端。当前注册的三个 adapter 遵循同一接口：

```typescript
interface AgentAdapter {
  id: string;                    // "shell" | "claude-code" | "system-info"
  name: string;
  displayName: string;
  icon: string;
  viewId: string;                // UI 组件标识

  detect(runtime: RuntimeInfo): Promise<boolean>;         // 环境检测
  start(input: StartInstanceInput): Promise<InstanceHandle>;  // 启动实例
  getCapabilities(): AdapterCapabilities;                 // 能力声明
  getView(): ComponentType<AdapterViewProps>;             // UI 组件
  getSidePanels(): SidePanelDef[];                        // 侧边栏
  resolveSpawnCommand(config?): { cmd, args, cwd, env };  // 命令解析
  getNotificationScenarios?(): NotificationScenario[];    // 通知场景
}
```

### AdapterCapabilities — 能力声明驱动 UI

每个 adapter 声明自己支持的能力，Core 据此渲染不同的 UI：

```typescript
type AdapterCapabilities = {
  terminal: boolean;          // 显示终端面板
  fileContext: boolean;       // 显示文件树
  structuredEvents: boolean;  // 结构化事件（tool_use/thinking 等）
  approvals: boolean;         // 权限确认弹窗
  modes: boolean;             // 模式切换 (plan/dontAsk/acceptEdits)
  timeline: boolean;          // 工具调用时间线
  compact: boolean;           // 上下文压缩
  tasks: boolean;             // 后台任务面板
};
```

### 已注册 Adapter

| Adapter | ID | 核心能力 | 说明 |
|---------|-----|---------|------|
| Shell | `shell` | terminal | 原始终端，无结构化事件 |
| Claude Code | `claude-code` | 全能力 | stream-json 解析，结构化输出块 |
| System Info | `system-info` | 无 | 系统信息采集，不启动实例 |

### OutputBlock — 统一输出格式

所有 adapter 的输出统一为 `OutputBlock`，Core 只负责渲染：

```typescript
interface OutputBlock {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text'
      | 'plan' | 'status' | 'error' | 'token_usage';
  name?: string;        // 工具名
  input?: string;       // 工具输入（JSON）
  output?: string;      // 工具结果
  text?: string;        // 普通文本
  status: 'running' | 'done' | 'error';
  meta?: Record<string, unknown>;  // adapter 特定元数据
}
```

### AgentCapabilityHost — 能力宿主

Adapter 通过 `AgentCapabilityHost` 访问系统资源，所有操作经过权限检查：

```
AgentCapabilityHost
├─ fs: FileSystemCapability    ← 文件读写（权限门控）
├─ process: ProcessCapability  ← 进程管理（权限门控）
├─ terminal: TerminalCapability ← 终端 spawn（权限门控）
├─ permissions: PermissionState ← 权限状态
└─ notifications: NotificationCapability ← 通知（支持 ntfy.sh 推送）
```

---

## 五、核心模块详情

### relay-server.ts

`src/relay-server.ts` — 节点的 HTTP + WebSocket 服务器，在 `NodeRuntime` 中当角色为 relay 时启动。提供：

- **HTTP 服务**: 静态文件（Web UI）、REST API
- **WebSocket 服务**: 实时通信、agent 注册、shell 转发
- **实例管理**: 通过 `InstanceManager` 管理本地和远程实例
- **会话持久化**: 断线重连 + grace period
- **块传输**: 64KB 分片 + 消息重组
- **Shell 写锁**: instanceId → WebSocket 映射，防止多浏览器冲突
- **心跳**: 30 秒间隔，自动清理僵尸连接

### InstanceManager

`src/instance-manager.ts` — 多实例管理器 + 操作状态机。

```
InstanceData
├─ id, dir, label, status      ← 基本信息
├─ source: local | remote       ← 实例来源
├─ adapterId: string            ← 关联 adapter
├─ process / handle             ← 进程句柄或 adapter handle
├─ agentConnection              ← 远程 agent 的 WebSocket
├─ blockBuffer / outputBuffer   ← 断线重连缓存
├─ checkpointManager            ← 独立 checkpoint
├─ adapterState                 ← 通用状态包
├─ currentOperation             ← 当前操作
└─ operationHistory             ← 最近 20 条操作历史
```

**操作状态机**:
```
pending ──▶ running ──▶ succeeded
                  │          │
                  ├──▶ failed
                  │
                  └──▶ cancelled ──▶ pending (可重试)
```

### AuditLogger

`src/audit-log.ts` — 结构化 JSONL 审计日志。

- 按日轮转（`audit-YYYY-MM-DD.jsonl`）
- 单文件最大 1GB 警报
- 支持按日期/操作/实例 ID 查询
- 支持按日期清理旧日志

### SessionPersistence

`src/session-persistence.ts` — 会话持久化。

- 500ms 防抖写入
- 优雅关闭时 flush
- 断线重连 60 秒 grace period
- 持久化快照按 `stopped` 写入；当前 `NodeRelayServer.start()` 恢复时会把实例重新标为 `running`，这是实现与持久化语义之间的已知不一致，后续应以真实进程/agent 连接状态为准
- 存储路径：`.sessionbridge/sessions.json`

### RelayEventBus

`adapters/agent-core/event-bus.ts` — 跨组件类型化事件总线。

```typescript
// 支持的事件类型
'instance.created' | 'instance.destroyed' | 'instance.status'
'agent.connected'  | 'agent.disconnected'
'config.updated'   | 'task.progress'     | 'audit.log'
```

- 支持通配符 `*` 监听所有事件
- emit 时自动注入当前 `nodeId`
- 可实例化（非单例），每个 scope 创建独立实例

### RelayConnection

`adapters/agent-core/relay-connection.ts` — 从 leaf 节点到 relay 的 WebSocket 连接。

- **hello 握手**：携带 role、version、features、token
- **agent.register**：向 relay 注册自己
- **块传输**：64KB 分片，支持任意大小消息
- **指数退避重连**：1s → 2s → 4s → ... → 30s
- **shell 背压**：暴露 `bufferedAmount` 供上游做流控

### Config Sync

`adapters/agent-core/config-sync.ts` — relay 到 agent 的配置推送。

```
RelayConfigManager (relay 端)
│
├─ set(key, value)             ← 设置待推送配置
├─ getPending() → pushMessage  ← 构建推送消息
└─ ack(instanceId, keys)       ← 确认收到并删除待推送

AgentConfigReceiver (agent 端)
│
├─ apply(pushMessage)          ← 验证并应用配置
│   ├─ 未知 key → rejected
│   ├─ 需重启 key (role/port/bind) → rejected
│   └─ 可热加载 key → 立即应用 + emit 事件
└─ sendAck(connection, ...)    ← 发送确认回 relay
```

### Permissions

`adapters/agent-core/permissions.ts` — 权限管控。

```typescript
type PermissionCategory = 'fileRead' | 'fileWrite' | 'network'
                        | 'processManagement' | 'shellAccess';
```

- 默认所有权限开放（向后兼容）
- 支持运行时动态调整
- 支持序列化到配置文件

### Notifications

`adapters/agent-core/notifications.ts` — 结构化通知模型。

- 系统默认场景：`agent.connected`、`agent.disconnected`、`update.available`
- Adapter 可贡献自定义场景
- 每个场景支持用户开关
- 支持 ntfy.sh 推送（可选配置）

---

## 六、协议与通信

### WebSocket 协议 (v1 信封)

所有消息以 v1 信封封装：

```typescript
interface Envelope {
  v: 1;                    // 协议版本
  id?: string;             // 消息 ID
  ts: number;              // 时间戳
  type: string;            // 消息类型
  body: Record<string, unknown>;  // 消息体
}
```

### 块传输 (Chunked Transfer)

大消息超过 64KB 时分片传输：

```json
{
  "v": 1, "ts": ..., "type": "agent.stdout",
  "body": {
    "instanceId": "inst_1_xxx",
    "line": "part_of_data",
    "chunk": { "msgId": "inst_1_xxx-1", "seq": 0, "total": 3 }
  }
}
```

接收端自动重组，30 秒超时清理不完整缓冲。

### Shell 写锁协议

防止多个浏览器同时写入 shell 导致混乱：

```
shell.lock     → 获取锁（返回 lock_status）
shell.unlock   → 释放锁
shell.input    → 写入（自动获取锁）
shell.lock_status → 锁状态广播（locked/unlocked + 持有者）
```

### 消息类型

| 方向 | 类型 | 说明 |
|------|------|------|
| B→S | `hello` | 握手，含 token/role/version |
| B→S | `instance.input` | 发送用户输入 |
| B→S | `instance.command` | 控制命令 (clear/restart/interrupt/等) |
| B→S | `shell.spawn` | 启动 shell |
| B→S | `shell.input` | Shell 输入 |
| B→S | `shell.lock` / `shell.unlock` | Shell 写锁 |
| A→S | `agent.register` | Agent 注册 |
| A→S | `agent.stdout` / `agent.stderr` | Agent 输出 |
| S→B | `welcome` | 握手响应，含实例列表 |
| S→B | `instance.block` | 结构化输出块 |
| S→B | `shell.output` | Shell 输出 |
| S→B | `system.notification` | 系统通知 |
| S→B | `system.shutdown` | 服务器关闭通知 |
| S→A | `config.push` | 配置推送 |
| S→A | `agent.stdin` | 代理输入转发 |
| ←→ | `ping` / `pong` | 心跳 |

---

## 七、REST API

`src/api-routes.ts` 注册 8 个结构化 REST API 端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 增强健康检查（实例数、内存、系统信息） |
| GET | `/api/instances` | 实例列表 |
| GET | `/api/instances/:id` | 单个实例详情 |
| GET | `/api/instances/:id/status` | 实例状态轻量查询 |
| POST | `/api/instances` | 创建实例 |
| DELETE | `/api/instances/:id` | 删除实例 |
| POST | `/api/instances/:id/command` | 发送控制命令 |
| GET | `/api/sessions` | 会话列表 |

此外，`relay-server.ts` 内联了更多 API 路由（向后兼容）：
`/api/list`、`/api/read-file`、`/api/write`、`/api/checkpoints`、`/api/rewind`、`/api/rewind-all`、`/api/sessions/search`、`/api/sessions/detail`、`/api/sessions/current`、`/api/interrupt`、`/api/queue`、`/api/mode`、`/api/session/switch`、`/api/info`。

---

## 八、Dashboard 本地管理页面

每个节点启动时在 `localhost:9843` 启动一个 Dashboard 服务器（`adapters/agent-core/dashboard-server.ts`），提供 HTTP API：

| 路径 | 说明 |
|------|------|
| `/` | HTML 管理页面 |
| `/api/status` | 节点状态（版本、标签、系统信息） |
| `/api/system` | 系统信息 |
| `/api/processes` | 进程列表（支持排序） |
| `/api/permissions` | 权限查看/修改 |
| `/api/notifications` | 通知设置查看/修改 |
| `/api/shell/run` | 执行 shell 命令（SSE 流式返回） |
| `/api/shell/stream` | SSE 实时输出流 |
| `/api/shell/input` | 向运行中的 shell 发送输入 |
| `/api/shell/kill` | 终止 shell 进程 |
| `/api/logs` | 最近 50 条日志 |

---

## 九、目录结构

```
sessionBridge/
├── src/
│   ├── index.ts                   # CLI 入口 (bridge 命令)
│   ├── relay-server.ts            # HTTP + WS + 集成枢纽 (2000+ 行)
│   ├── api-routes.ts              # REST API 路由 (8 个端点)
│   ├── instance-manager.ts        # 多实例管理 + 操作状态机
│   ├── audit-log.ts               # JSONL 审计日志 (按日轮转)
│   ├── session-persistence.ts     # 会话快照保存/恢复 (防抖 500ms)
│   ├── stream-parser.ts           # 流式解析工具
│   ├── checkpoint-manager.ts      # 文件级 checkpoint
│   ├── rate-limiter.ts            # API 频率限制
│   ├── agent.ts                   # (旧) Agent 客户端 — 被 NodeRuntime 替代
│   ├── protocol.ts                # (旧) 协议定义 — 已迁移到 adapters/protocol.ts
│   ├── ansi.ts                    # ANSI 转义解析
│   ├── browser.ts                 # 跨平台浏览器打开
│   ├── i18n.ts                    # 多语言
│   └── run-command.ts             # bridge run 命令模式
│
├── adapters/
│   ├── types.ts                   # 核心类型定义 (Adapter/OutputBlock/SystemToast)
│   ├── ARCHITECTURE.md            # Adapter 架构蓝图
│   ├── registry.ts                # AdapterRegistry 单例
│   ├── protocol.ts                # v1 信封格式 (envelope/parseMsg)
│   ├── version.ts                 # 版本常量
│   ├── semver.ts                  # 语义版本比较
│   │
│   ├── agent-core/                # 核心编排层
│   │   ├── config.ts              # NodeConfig + 持久化 nodeId
│   │   ├── node-runtime.ts        # NodeRuntime 编排器
│   │   ├── event-bus.ts           # RelayEventBus (类型化事件)
│   │   ├── config-sync.ts         # Config push/pull 基础设施
│   │   ├── relay-connection.ts    # WebSocket 客户端 (指数退避重连)
│   │   ├── permissions.ts         # 权限模型
│   │   ├── notifications.ts       # 通知模型
│   │   ├── capability-host.ts     # AgentCapabilityHost 实现
│   │   ├── dashboard-server.ts    # 本地 Dashboard (:9843)
│   │   ├── dashboard-page.tsx     # Dashboard HTML 页面
│   │   └── introspection.ts       # 系统内省 (进程/状态)
│   │
│   ├── shell/                     # Shell Adapter
│   │   └── index.ts               # ShellAdapter 实现
│   │
│   ├── claude-code/               # Claude Code Adapter
│   │   ├── index.ts               # ClaudeCodeAdapter 实现
│   │   ├── agent.ts               # Agent 代理层
│   │   ├── runtime.ts             # Claude 运行时检测 (二进制路径/版本)
│   │   ├── parser.ts              # stream-json 解析器
│   │   └── parse-output.ts        # 输出解析工具
│   │
│   └── system-info/               # 系统信息 Adapter
│       └── index.ts               # SystemInfoAdapter (环境检测)
│
├── app/                           # Next.js Web UI
│   ├── page.tsx
│   ├── layout.tsx
│   └── globals.css
│
├── lib/                           # 客户端库
│   ├── ws-client.ts               # WebSocket 客户端封装
│   ├── use-ws.ts                  # React hook
│   ├── session-store.ts           # IndexedDB 持久化
│   ├── ansi.ts                    # ANSI 前端解析
│   ├── i18n.ts                    # 前端多语言
│   └── persistence-hooks.ts       # React 持久化 hooks
│
├── docs/
│   ├── architecture.md            # ← 本文档
│   ├── protocol.md                # 通信协议
│   ├── development.md             # 开发指南
│   └── ...
│
├── tests/
│   ├── unit/                      # 单元测试
│   ├── integration/               # 集成测试
│   ├── cross/                     # 跨模块测试
│   └── helpers/                   # 测试工具
│
├── out/                           # next build 产物 (gitignored)
├── content/                       # 会话数据目录
├── .sessionbridge/                # 运行时数据 (自动创建)
│   ├── audit/                     # 审计日志
│   ├── sessions.json              # 持久化会话快照
│   └── shell.pid                  # Shell PID 文件 (孤儿进程清理)
├── package.json
├── next.config.js
├── tsconfig.json
└── tsconfig.server.json
```

---

## 十、数据流

### Dashboard 节点通过 Relay 与实例交互

```
Dashboard 节点 (A)                       Relay 节点 (B)                      目标节点 (C)
     │                                      │                                   │
     │─ WebSocket + AES-256-GCM ───────────▶│                                   │
     │  加密握手 (ECDH + HKDF)               │                                   │
     │◀─ 加密通道已建立 ────────────────────│                                   │
     │                                      │                                   │
     │─ instance.input (加密) ─────────────▶│                                   │
     │                                      ├─ CryptoStream 解密 → parseMsg     │
     │                                      ├─ 鉴权 (relayToken)                │
     │                                      ├─ envelope({ type, data })         │
     │                                      │                                   │
     │                                      ├─ [本地实例]                        │
     │                                      │   └─ adapter.handle.send(data)    │
     │                                      │       → Claude / Shell 进程       │
     │                                      │                                   │
     │                                      ├─ [远程实例]                       │
     │                                      │   └─ agent.stdin (加密) ────────▶│
     │                                      │       → shellProc.stdin           │
     │                                      │                                   │
     │◀─ instance.output/block (加密) ─────│                                   │
     │                                      │◀─ agent.stdout (加密) ────────────│
     │                                      │                                   │
     └─ Dashboard 渲染                       │                                   │
         ├─ 终端输出 (ANSI 解析)              │                                   │
         ├─ 工具调用卡片                      │                                   │
         ├─ 文件树 / 实例面板                │                                   │
         └─ 消息日志                         │                                   │
```

### Leaf 节点注册与通信

```
Leaf 节点 (C)                              Relay 节点 (B)
    │                                           │
    ├─ 1. NodeRuntime.resolveRole() → 'leaf'     │
    ├─ 2. startDashboard() (:9843)              │
    ├─ 3. Register adapters + detect             │
    ├─ 4. new RelayConnection(config)            │
    └─ 5. relay.connect()                       │
         │
         ├─ WebSocket → relay: ws://upstream:8080
         ├─ hello { role: "agent", version, features }
         ├─ agent.register { dir, label }
         ├─ ← welcome + agent.registered { instanceId }
         │
         ├─ [注册后] spawnShell()
         │   ├─ spawn bash/powershell
         │   ├─ PID 文件记录（清理孤儿进程用）
         │   └─ stdout 背压控制
         │
         ├─ [转发用户输入]
         │   ← relay → agent.stdin { instanceId, data }
         │   → writeToShellByRelayId() / shellProc.stdin
         │
         ├─ [转发输出]
         │   stdout → relay.sendStdout(chunk)
         │   → chunked agent.stdout → relay → broadcast → browsers
         │
         ├─ [心跳]
         │   ← ping → pong (30 秒)
         │
         └─ [断线]
             ← close → scheduleReconnect (指数退避)
             relay 侧 60s grace period → 标记离线
```

---

## 十一、安全机制

### 传输层安全

SessionBridge 默认不使用 TLS/HTTPS 证书。所有 WebSocket 通信通过应用层加密保护：

- **每节点身份**: 首次启动自动生成 Ed25519 密钥对，持久化到 `~/.sessionbridge/identity.json`
- **会话密钥**: 连接建立时通过 ECDH + HKDF-SHA256 派生每会话唯一的 AES-256-GCM 密钥（前向安全）
- **消息加密**: 所有消息使用 AES-256-GCM 加密，附带随机 IV 和认证标签（防篡改）
- **双层加密**: 如配置了 TLS 证书（HTTPS/WSS），应用层加密仍然生效，两层互不干扰

握手过程（任意两节点之间）：

```
节点 A (发起方)                   节点 B (响应方)
  │                                      │
  │ 生成 ephemeral X25519 密钥对          │
  │ hello { staticKey, ephemeralKey }    │
  │─────────────────────────────────────▶│
  │                                      │ 验证 token
  │                                      │ 生成 ephemeral X25519 密钥对
  │ welcome { staticKey, ephemeralKey }  │
  │◀─────────────────────────────────────│
  │                                      │
  │ 双方独立计算:                         │
  │ sec = X25519(eph, peer_eph)          │ ← 前向安全
  │ auth = X25519(static, peer_static)   │ ← 身份绑定
  │ session_key = HKDF(sec || auth)      │
  │                                      │
  │ 所有后续消息 AES-256-GCM 加密         │
  │══════════════════════════════════════▶│
```

注意：因为加密在应用层，**无论 ws:// 还是 wss:// 都同样安全**。TLS 是可选的额外保护层。

### 访问认证

- **relayToken**: 节点间认证，通过配置文件或 CLI `--relay-token` 设置
- Token 在加密握手**之后**通过加密通道传输，不会被窃听
- 未认证连接立即关闭（4001 Unauthorized）

### Shell 写锁

- 每个实例的 shell 同一时间只允许一个浏览器写入
- 锁通过 `shellLockMap`（instanceId → WebSocket）管理
- 浏览器断开时自动释放锁

### 权限模型

- 五类权限：文件读/写、网络、进程管理、Shell 访问
- 默认全部开放（向后兼容）
- 可通过 Dashboard 运行时调整
- 仅 agent 端生效（adapter 操作通过 `AgentCapabilityHost` 门控）

### 孤儿进程清理

- 每次 spawn shell 前检查 `.sessionbridge/shell.pid`
- 如果 PID 文件存在且对应进程存活 → kill
- 确保重启后不会残留孤立 shell 进程

---

## 十二、已实现功能清单 (v0.6.0)

| 功能 | 模块 | 状态 |
|------|------|------|
| 节点角色自动探测 | NodeRuntime | 已完成 |
| 统一配置 (CLI/文件/环境变量) | NodeConfig | 已完成 |
| 持久化 nodeId 自动生成 | config.ts | 已完成 |
| HTTP + WebSocket 服务器 | relay-server.ts | 已完成 |
| REST API (8 端点) | api-routes.ts | 已完成 |
| WebSocket v1 信封协议 | protocol.ts | 已完成 |
| 块传输及重组 (64KB) | relay-connection.ts + relay-server.ts | 已完成 |
| Shell 写锁 (lock/unlock) | relay-server.ts | 已完成 |
| Agent 注册/注销 | relay-server.ts | 已完成 |
| 多实例管理 | InstanceManager | 已完成 |
| 操作状态机 (pending→running→succeeded/failed/cancelled) | InstanceManager | 已完成 |
| 背压控制 (256KB/64KB) | node-runtime.ts | 已完成 |
| Adapter 插件体系 | AdapterRegistry + types.ts | 已完成 |
| Shell Adapter | adapters/shell/ | 已完成 |
| Claude Code Adapter | adapters/claude-code/ | 已完成 |
| System Info Adapter | adapters/system-info/ | 已完成 |
| AgentCapabilityHost + 权限门控 | capability-host.ts | 已完成 |
| 跨组件 EventBus (带 nodeId 注入) | event-bus.ts | 已完成 |
| 审计日志 (JSONL 按日轮转) | AuditLogger | 已完成 |
| 会话持久化 (防抖 500ms) | SessionPersistence | 已完成 |
| 断线重连 grace period (60s) | relay-server.ts | 已完成 |
| 孤儿进程清理 (PID 文件) | node-runtime.ts | 已完成 |
| 通知模型 (系统 + adapter 场景) | NotificationModel | 已完成 |
| 配置推送 (relay → agent) | ConfigSync | 已完成 |
| SystemToast 结构化通知 | types.ts | 已完成 |
| 心跳检测 (30s) | relay-server.ts | 已完成 |
| Dashboard 本地管理 | dashboard-server.ts | 已完成 |
| NodeConfig.extensions 扩展配置包 | config.ts | 已完成 |
| 版本兼容性检查 (semver) | semver.ts | 已完成 |
| Session 恢复/重建 | relay-server.ts | 部分完成：快照恢复已实现，恢复后运行态仍需修正 |
| `bridge run` 单命令模式 | run-command.ts | 已完成 |
| `bridge setup` 配置管理 | index.ts | 已完成 |
| Ed25519 身份密钥自动生成 | identity-manager.ts | 已完成 |
| ECDH 密钥交换 + 会话派生 | crypto-layer.ts | 已完成 |
| AES-256-GCM 消息加密 | crypto-layer.ts | 已完成 |
| CryptoStream 透明加解密封装 | crypto-stream.ts | 已完成 |
| 浏览器端 Web Crypto 加密 | crypto-client.ts | 已完成 |
| Relay 加密握手集成 | relay-server.ts | 已完成 |
| Agent 加密连接集成 | relay-connection.ts | 已完成 |
| 前端 WS 加密集成 | ws-client.ts | 已完成 |
| 加密/非加密客户端共存 | relay-server.ts | 已完成 |

### v0.7 (规划中)

| 功能 | 模块 | 状态 |
|------|------|------|
| Flutter APK (WebView + 通知 Service) | flutter_app/ | 开发中 |
| 对外访问完整体验 | dashboard-server.ts + node.external.* | 开发中：本机 API 与远程协议已存在，前端/端到端仍需收口 |

---

## 十三、与旧架构的关系

本项目的 v0.1-v0.4 使用 Bridge/PTYSession/node-pty 架构，v0.5 重写为 relay + InstanceManager 架构，v0.6 进一步统一为 NodeRuntime + Adapter 体系。

| 旧架构 (v0.1–0.4) | 中架构 (v0.5) | 新架构 (v0.6) | 说明 |
|--------------------|--------------|--------------|------|
| PTYSession (node-pty) | spawn Claude 子进程 | Adapter 统一 start() | 减少依赖，插件化 |
| Bridge 管理器 | relay-server 直接处理 | NodeRuntime 编排 | 统一入口 |
| LocalServer + RelayClient | 统一 relay 服务器 | NodeRelayServer | 对等节点模型 |
| `/remote` 命令模式 | 实例选择 + agent 连接 | 自动角色探测 | 无需手动配置 |
| `web/` 子目录 | `app/` + `lib/` 根目录 | 同左 | Next.js App Router |
| — | relay/agent 两套入口 | 单入口 `bridge` CLI | 统一用户体验 |
| — | 硬编码 Claude 逻辑 | Adapter `detect()` + `start()` | 插件化 |
| — | 无权限模型 | PermissionModel | 安全管控 |
| — | 无审计 | AuditLogger | 可审计性 |
