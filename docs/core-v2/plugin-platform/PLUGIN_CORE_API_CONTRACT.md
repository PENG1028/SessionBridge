# SessionNode v2 — Plugin Core API Contract

> 插件如何调用 Core 能力、capability 命名规则、节点路由、危险能力
> 配套文档：[PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md) | [PLUGIN_SECURITY_MODEL.md](./PLUGIN_SECURITY_MODEL.md)

---

## Capability 命名总则

```
命名空间.动词
如: fs.read, session.create, process.spawn

命名空间:
  session.*         Session 元数据（CRUD）
  stream.*          标准流（stdout/stderr/stdin、回放）
  process.*         子进程管理（spawn/kill/resize）
  fs.*              文件系统（read/write/list/delete/stat）
  env.*             环境（info/checkBinary/path）
  config.*          配置（get/set/reset/schema）
  logs.*            运行时日志（tail/query/event）
  audit.*           审计日志（list/get/export/event）
  plugin.*          插件管理（list/check/install/files/cache/permissions/config/history）
  notify.*          通知（list/markRead/respond/event）
  approval.*        审批（list/approve/deny/request）
  node.*            节点管理（list/get/health/update/connect/disconnect）
  task.*            异步任务（event）
  action.*          操作执行（request）
```

---

## 插件调用 Core 的方式

### action.request（统一入口）

所有能力调用走统一的 `action.request` 消息格式：

```json
{
  "type": "action.request",
  "requestId": "req_abc",
  "capability": "fs.read",
  "targetNodeId": "node_vps",
  "payload": {
    "path": "/home/user/project/main.go"
  },
  "timestamp": 1712345678000
}
```

### pluginId 注入

`pluginId` 不由请求 payload 决定，由 **Core 在连接认证时注入**：

```
WebSocket 连接认证 → Core 确定 actor.type = "plugin", actor.pluginId = "claude-code"
  → 后续所有 action.request 都用此 pluginId
  → payload 中的 pluginId 被 Core 忽略
  → 插件无法伪造 pluginId

System UI CoreClient:    pluginId = "system-ui"（连接时认证）
Feature Plugin CoreClient: pluginId = "claude-code"（连接时认证）
External App:             无 pluginId（Service Token 认证）
```

---

## 节点路由

### targetNodeId

| 值 | 含义 | 场景 |
|----|------|------|
| `""`（空）| 本机执行 | 本地操作 |
| `"node_vps"` | 指定远程节点 | 跨节点操作 |

### 路由流程

```
请求 → Dispatcher
  ├── targetNodeId 为空 → 本机执行
  └── targetNodeId 有值 → 路由到目标节点
       ├── 本机 Core 校验 actor 有跨节点调用权限
       ├── 转发请求到目标节点
       ├── 目标节点独立校验权限
       └── 结果返回发起节点
```

### 跨节点权限

- 远程操作时，**权限在目标节点上独立校验**
- relay 不代行权限判断
- 目标节点可以有自己的 trustLevel 和本地策略

---

## 危险能力

### 清单

以下能力需要 **Plan Before Apply + 用户确认 + Audit 记录**：

| Capability | 风险 | 原因 |
|-----------|------|------|
| `process.spawn` | high | 任意子进程执行 |
| `fs.write` | medium | 文件系统修改 |
| `fs.delete` | high | 文件系统删除 |
| `stream.write` | medium | 写入任意流 |
| `plugin.install.execute` | high | 安装/更新插件 |
| `plugin.cache.clear.execute` | high | 数据丢失风险 |
| `plugin.permissions.grant` | high | 权限提升 |
| `config.set` | medium | 配置修改 |
| `node.disconnect` | high | 网络中断 |
| `session.stop`（远程）| medium | 中断远程 session |

### 危险能力声明约束

```yaml
core:
  permissions:
    - id: dangerous.op
      description: "必须写描述"    # process.spawn/fs.write/fs.delete 必须非空
      capabilities:
        - fs.delete
      default: ask                 # 不能 default: allow（除非 trusted: true）
      constraints:
        paths:
          allow: ["${workspace}/.cache/**"]  # fs.delete 必须有路径约束
```

---

## Capability 命名空间详解

### session.* — Session 元数据

| Capability | 参数 | 说明 |
|-----------|------|------|
| `session.list` | `{ nodeId?, kind?, status? }` | Session 列表 |
| `session.get` | `{ sessionId }` | Session 详情 |
| `session.create` | `{ kind, nodeId?, command?, cwd?, env? }` | 创建 session |
| `session.stop` | `{ sessionId }` | 停止 session（远程需审批） |
| `session.events` | `{ sessionId }` | Session 事件列表 |

### stream.* — 标准流

| Capability | 参数 | 说明 |
|-----------|------|------|
| `stream.subscribe` | `{ sessionId, streamType }` | 订阅实时流 |
| `stream.replay` | `{ sessionId, streamType, fromSeq? }` | 回放历史流 |
| `stream.tail` | `{ sessionId, streamType, lines? }` | 最近 N 行 |
| `stream.write` | `{ sessionId, data, streamType? }` | 写入流 |

### process.* — 子进程

| Capability | 参数 | 说明 |
|-----------|------|------|
| `process.spawn` | `{ command, args?, cwd?, env? }` | 启动进程（高危） |
| `process.kill` | `{ sessionId, signal? }` | 终止进程 |
| `process.stdin` | `{ sessionId, data }` | 写入 stdin |
| `process.resize` | `{ sessionId, cols, rows }` | 调整终端尺寸 |
| `process.status` | `{ sessionId }` | 进程状态 |

### fs.* — 文件系统

| Capability | 参数 | 说明 |
|-----------|------|------|
| `fs.list` | `{ path }` | 列出目录 |
| `fs.read` | `{ path }` | 读取文件 |
| `fs.write` | `{ path, data }` | 写入文件（中危） |
| `fs.delete` | `{ path }` | 删除文件（高危，需路径约束） |
| `fs.stat` | `{ path }` | 文件信息 |
| `fs.exists` | `{ path }` | 检查存在 |

### env.* — 环境

| Capability | 参数 | 说明 |
|-----------|------|------|
| `env.info` | — | 系统信息 |
| `env.checkBinary` | `{ name }` | 检查可执行文件 |
| `env.path` | — | PATH 列表 |

### config.* — 配置

| Capability | 参数 | 说明 |
|-----------|------|------|
| `config.get` | `{ key? }` | 读取配置 |
| `config.set` | `{ key, value }` | 写入配置（中危） |
| `config.reset` | `{ key }` | 重置配置 |
| `config.schema` | — | 配置 schema |

### logs.* — 运行时日志

| Capability | 参数 | 说明 |
|-----------|------|------|
| `logs.tail` | `{ source, lines?, level? }` | 最近日志 |
| `logs.query` | `{ source?, level?, timeRange?, nodeId?, pluginId? }` | 带过滤查询 |
| `logs.export` | `{ timeRange, format? }` | 导出日志 |

### audit.* — 审计日志

| Capability | 参数 | 说明 |
|-----------|------|------|
| `audit.list` | `{ timeRange?, type?, actor?, target? }` | 审计事件列表 |
| `audit.get` | `{ auditId }` | 审计事件详情 |
| `audit.export` | `{ timeRange }` | 导出审计日志 |

### plugin.* — 插件管理

| Capability | 参数 | 权限 |
|-----------|------|------|
| `plugin.list` | `{ nodeId?, status? }` | plugin.read |
| `plugin.get` | `{ pluginId }` | plugin.read |
| `plugin.check` | `{ nodeId?, pluginId }` | plugin.read |
| `plugin.enable` | `{ pluginId }` | plugin.enable |
| `plugin.disable` | `{ pluginId }` | plugin.disable |
| `plugin.install.plan` | `{ nodeId?, pluginId }` | plugin.install（高危） |
| `plugin.install.execute` | `{ planId }` | plugin.install（高危） |
| `plugin.uninstall` | `{ nodeId?, pluginId }` | plugin.install（高危） |
| `plugin.files.list` | `{ nodeId?, pluginId }` | plugin.read |
| `plugin.files.register` | `{ id, fileType, path, ... }` | plugin.files.register |
| `plugin.cache.list` | `{ nodeId?, pluginId }` | plugin.read |
| `plugin.cache.clear.plan` | `{ nodeId?, pluginId, cacheId? }` | plugin.cache.clear（高危） |
| `plugin.cache.clear.execute` | `{ planId }` | plugin.cache.clear（高危） |
| `plugin.permissions.list` | `{ pluginId }` | plugin.read |
| `plugin.permissions.grant` | `{ pluginId, permissionId, level }` | plugin.permissions.grant（高危） |
| `plugin.permissions.revoke` | `{ pluginId, permissionId }` | plugin.permissions.revoke（高危） |
| `plugin.config.get` | `{ nodeId?, pluginId, key? }` | plugin.read |
| `plugin.config.set` | `{ nodeId?, pluginId, key, value }` | config.write（中危） |
| `plugin.history` | `{ nodeId?, pluginId }` | plugin.read |

### notify.* — 通知

| Capability | 参数 | 说明 |
|-----------|------|------|
| `notify.list` | `{ filter?, since? }` | 通知列表 |
| `notify.markRead` | `{ notificationId }` | 标记已读 |
| `notify.markAllRead` | — | 全部已读 |

### approval.* — 审批

| Capability | 参数 | 说明 |
|-----------|------|------|
| `approval.list` | `{ status?, type? }` | 审批请求列表 |
| `approval.get` | `{ requestId }` | 请求详情 |
| `approval.approve` | `{ requestId, note? }` | 批准 |
| `approval.deny` | `{ requestId, reason? }` | 拒绝 |

### node.* — 节点

| Capability | 参数 | 说明 |
|-----------|------|------|
| `node.list` | — | 所有节点 |
| `node.get` | `{ nodeId }` | 节点详情 |
| `node.health` | `{ nodeId }` | 健康指标 |
| `node.disconnect` | `{ nodeId }` | 断开节点（高危） |

---

## 与 Capability API 的关系

```
┌───────────────────────────────────────────┐
│              Core API                       │
│                                            │
│  /api/actions  ── Capability API          │
│    所有 Actor 可调                          │
│    执行原子能力                              │
│                                            │
│  /api/plugins/:id/*  ── Plugin Mgmt API    │
│    仅管理员 Actor 可调                       │
│    管理插件生命周期                          │
│                                            │
│  /api/sessions  ── Session API             │
│    所有 Actor 可调                          │
│                                            │
└───────────────────────────────────────────┘
```

- 插件开发者只需要知道 Capability API
- Plugin Management API 最终也调用 Capability API（如 `plugin.install.execute` 内部调 `process.spawn`）
