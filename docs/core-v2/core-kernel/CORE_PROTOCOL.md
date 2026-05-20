# SessionNode v2 — Core Protocol 定义

> 统一协议参考：HTTP + WebSocket 消息格式、错误码、版本协商
> 配套文档：ARCHITECTURE.md、CAPABILITY_API.md、PERMISSIONS.md

---

## 目录

1. [设计目标](#一设计目标)
2. [通用消息格式](#二通用消息格式)
3. [消息类型总表](#三消息类型总表)
4. [HTTP API](#四http-api)
5. [WebSocket 协议](#五websocket-协议)
6. [消息详述](#六消息详述)
7. [错误码总表](#七错误码总表)
8. [版本协商](#八版本协商)
9. [安全约束](#九安全约束)
10. [防回退规则](#十防回退规则)

---

## 一、设计目标

```
1. 统一入口
   所有操作（查询、动作、订阅、提交）都通过同一套消息协议。
   HTTP 用于查询和一次性请求。
   WebSocket 用于流式、订阅、推送。
   消息格式统一，不分 HTTP/WS。

2. 可追踪
   每个消息有 requestId，全链路可追踪。
   Actor（谁发的）是必填字段。pluginId 在插件调用时必填，External Client/Service Token 不填。

3. 权限自然
   Plugin 请求带 pluginId，Core 按 Plugin Grant 校验权限。
   Service Token 请求不带 pluginId，Core 按 Token 权限配置校验。
   不需要"登录 session"的概念——每个请求独立鉴权。

4. 向前兼容
   消息 type 永远不删，只加。
   新字段可选（omitempty），旧客户端忽略。
   版本协商在连接阶段完成。
```

---

## 二、通用消息格式

### 所有消息的公共字段

```json
{
  "type": "xxx.xxx",          // 消息类型，所有消息的第一个字段
  "requestId": "req_xxx",     // 请求 ID，调用方生成，用于追踪
  "pluginId": "xxx",          // 发起请求的插件 ID（插件调用时必填，External Client 不填）
  "actor": {                  // 发起者身份（Core 填充，客户端建议不填）
    "type": "web" | "cli" | "node" | "service",
    "id": "xxx"
  },
  "targetNodeId": "node_xxx", // 目标节点（空=本机）
  "timestamp": 1712345678000,  // 毫秒时间戳
  "payload": {}                // 具体 payload（与 type 相关）
}
```

### 响应的公共字段

```json
{
  "type": "xxx.xxx",          // 对应的响应类型
  "requestId": "req_xxx",     // 对应请求的 ID
  "ok": true | false,         // 成功/失败
  "payload": {},              // 成功时返回的数据
  "error": {                  // 失败时返回的错误
    "code": "ERROR_CODE",
    "message": "Human readable"
  },
  "timestamp": 1712345678001
}
```

### 事件的公共字段

```json
{
  "type": "xxx.xxx",          // 事件类型
  "sessionId": "sess_xxx",    // 关联 session（如有）
  "eventSeq": 42,             // 单调递增序号（如有）
  "pluginId": "xxx",          // 事件来源插件
  "payload": {},
  "timestamp": 1712345679000
}
```

### ID 格式规则

| ID 类型 | 格式 | 示例 | 生成者 |
|---------|------|------|--------|
| requestId | `req_` + 随机字符串 | `req_4mN7k2` | 调用方 |
| sessionId | `sess_` + 随机字符串 | `sess_1Lg3X9` | Core |
| streamId | `stream_` + 随机字符串 | `stream_stdout_1Lg3` | Core |
| actionId | `act_` + 随机字符串 | `act_8kF2` | Core |
| nodeId | `node_` + 随机字符串 | `node_abc123` | Core（安装时生成） |
| eventSeq | 从 1 递增的整数 | `42` | Core（session 级别） |
| installId | `inst_` + 日期 + 序号 | `inst_20260519_001` | Core |
| tabId | `tab_` + 随机字符串 | `tab_3bF9` | 前端（仅 UI） |
| notificationId | `ntf_` + 随机字符串 | `ntf_x7K2` | Core |

---

## 三、消息类型总表

### 会话管理 (Session)

| type | 方向 | 用途 |
|------|------|------|
| `session.create` | Client → Core | 创建 session |
| `session.created` | Core → Client | 创建成功响应 |
| `session.stop` | Client → Core | 停止 session |
| `session.stopped` | Core → Client | 停止成功事件 |
| `session.list` | Client → Core | 列出 session |
| `session.listed` | Core → Client | session 列表响应 |
| `session.get` | Client → Core | 获取 session 详情 |
| `session.got` | Core → Client | session 详情响应 |
| `session.event` | Core → Client | session 事件推送 |
| `session.events` | Client → Core | 查询 session 事件 |
| `session.events_result` | Core → Client | 事件查询响应 |

### 流管理 (Stream)

| type | 方向 | 用途 |
|------|------|------|
| `stream.subscribe` | Client → Core | 订阅 stream |
| `stream.subscribed` | Core → Client | 订阅确认 |
| `stream.chunk` | Core → Client | stream 数据块 |
| `stream.write` | Client → Core | 写入 stream（stdin） |
| `stream.written` | Core → Client | 写入确认 |
| `stream.replay` | Client → Core | 回放 stream 历史 |
| `stream.replayed` | Core → Client | 回放数据 |

### 动作 (Action) — 一次性能力调用

| type | 方向 | 用途 |
|------|------|------|
| `action.request` | Client → Core | 发起能力调用 |
| `action.response` | Core → Client | 能力调用响应 |

### 配置 (Config)

| type | 方向 | 用途 |
|------|------|------|
| `config.get` | Client → Core | 读取配置 |
| `config.got` | Core → Client | 配置值响应 |
| `config.set` | Client → Core | 写入配置 |
| `config.set_result` | Core → Client | 写入结果 |
| `config.list` | Client → Core | 列出配置 |
| `config.listed` | Core → Client | 配置列表响应 |
| `config.changed` | Core → Client | 配置变更推送 |

### 通知/审批 (Notify)

| type | 方向 | 用途 |
|------|------|------|
| `notify.send` | Plugin → Core | 发送通知 |
| `notify.sent` | Core → Client | 通知已发送响应 |
| `notify.request` | Plugin → Core | 发起审批请求 |
| `notify.approval.request` | Core → All UI | 向所有 UI 推送审批弹窗 |
| `notify.respond` | UI → Core | 用户响应审批 |
| `notify.approval.result` | Core → Plugin | 审批结果回调 |
| `notify.approval.expired` | Core → Plugin/UI | 审批超时 |

### 插件管理 (Plugin)

| type | 方向 | 用途 |
|------|------|------|
| `plugin.list` | Client → Core | 列出插件 |
| `plugin.listed` | Core → Client | 插件列表响应 |
| `plugin.get` | Client → Core | 插件详情 |
| `plugin.got` | Core → Client | 插件详情响应 |
| `plugin.enable` | Client → Core | 启用插件 |
| `plugin.disable` | Client → Core | 禁用插件 |
| `plugin.check` | Client → Core | 环境检测 |
| `plugin.checked` | Core → Client | 环境检测结果 |
| `plugin.install.plan` | Client → Core | 生成安装计划 |
| `plugin.install.planned` | Core → Client | 安装计划响应 |
| `plugin.install.execute` | Client → Core | 执行安装 |
| `plugin.install.executing` | Core → Client | 安装已开始 |
| `plugin.install.event` | Core → Client | 安装过程事件 |
| `plugin.install.result` | Core → Client | 安装最终结果 |
| `plugin.repair` | Client → Core | 修复插件 |
| `plugin.uninstall` | Client → Core | 卸载插件 |
| `plugin.history` | Client → Core | 安装历史 |
| `plugin.history_result` | Core → Client | 历史记录 |
| `plugin.install.logs` | Client → Core | 安装日志 |
| `plugin.install.logs_result` | Core → Client | 日志内容 |
| `plugin.registered` | Core → Client | 插件注册事件（广播） |
| `plugin.status_changed` | Core → Client | 插件状态变更 |

### 插件文件/缓存 (Plugin Files)

| type | 方向 | 用途 |
|------|------|------|
| `plugin.files.list` | Client → Core | 文件列表 |
| `plugin.files.listed` | Core → Client | 文件列表响应 |
| `plugin.files.register` | Client → Core | 注册文件位置 |
| `plugin.files.registered` | Core → Client | 注册成功 |
| `plugin.files.access` | Client → Core | 文件访问历史 |
| `plugin.files.access_result` | Core → Client | 访问历史响应 |
| `plugin.cache.list` | Client → Core | 缓存列表 |
| `plugin.cache.listed` | Core → Client | 缓存列表响应 |
| `plugin.cache.info` | Client → Core | 缓存详情 |
| `plugin.cache.clear.plan` | Client → Core | 生成清理计划 |
| `plugin.cache.clear.planned` | Core → Client | 清理计划响应 |
| `plugin.cache.clear.execute` | Client → Core | 执行清理 |
| `plugin.cache.clear.result` | Core → Client | 清理结果 |
| `plugin.cache.history` | Client → Core | 清理历史 |
| `plugin.cache.history_result` | Core → Client | 清理历史结果 |

### 插件权限 (Plugin Permissions)

| type | 方向 | 用途 |
|------|------|------|
| `plugin.permissions.get` | Client → Core | 查看权限 |
| `plugin.permissions.got` | Core → Client | 权限列表 |
| `plugin.permissions.grant` | Client → Core | 授予权限 |
| `plugin.permissions.granted` | Core → Client | 授权成功 |
| `plugin.permissions.revoke` | Client → Core | 撤销权限 |
| `plugin.permissions.revoked` | Core → Client | 撤销成功 |

### 系统 (System)

| type | 方向 | 用途 |
|------|------|------|
| `hello` | Client → Core | 连接建立 |
| `welcome` | Core → Client | 连接确认 + 初始状态 |
| `ping` | Client/Core | 心跳 |
| `pong` | Client/Core | 心跳响应 |
| `error` | Core → Client | 通用错误 |
| `node.list` | Client → Core | 节点列表 |
| `node.listed` | Core → Client | 节点列表响应 |
| `node.info` | Client → Core | 节点信息 |
| `node.info_result` | Core → Client | 节点信息响应 |

---

## 四、HTTP API

### 基础信息

```
Base URL: http://<host>:8080/api
Content-Type: application/json
Authentication: X-SessionNode-Token header
```

### 端点列表

```
### 健康检查
GET /api/health
→ { status: "ok", version: "2.0.0", uptime: 3600 }

### 节点
GET  /api/nodes                          → 节点列表
GET  /api/nodes/:nodeId                  → 节点详情

### Sessions
GET  /api/sessions                       → session 列表
POST /api/sessions                       → 创建 session
GET  /api/sessions/:sessionId            → session 详情
DELETE /api/sessions/:sessionId          → 停止 session
GET  /api/sessions/:sessionId/events     → session 事件列表

### Actions（一次性能力调用）
POST /api/actions                        → 执行能力调用
GET  /api/actions/:requestId             → 查询调用结果

### 配置
GET  /api/config                         → 列出所有配置
GET  /api/config/:key                    → 读取配置
PUT  /api/config/:key                    → 写入配置

### 日志
GET  /api/logs/core                      → Core 日志
GET  /api/logs/audit                     → Audit 日志
GET  /api/logs/plugin/:pluginId          → 插件日志
GET  /api/logs/session/:sessionId        → Session 日志

### 插件
GET  /api/plugins                        → 插件列表
GET  /api/plugins/:pluginId              → 插件详情
POST /api/plugins/:pluginId/enable       → 启用
POST /api/plugins/:pluginId/disable      → 禁用
POST /api/plugins/:pluginId/check        → 环境检测
POST /api/plugins/:pluginId/install/plan  → 安装计划
POST /api/plugins/:pluginId/install/execute → 执行安装
POST /api/plugins/:pluginId/repair       → 修复
DELETE /api/plugins/:pluginId            → 卸载
GET  /api/plugins/:pluginId/history      → 安装历史
GET  /api/plugins/:pluginId/install/:installId/logs → 安装日志

### 插件文件/缓存
GET  /api/plugins/:pluginId/files        → 文件列表
POST /api/plugins/:pluginId/files/register → 注册文件
GET  /api/plugins/:pluginId/files/access → 访问历史
GET  /api/plugins/:pluginId/cache        → 缓存列表
POST /api/plugins/:pluginId/cache/clear   → 清理缓存（先返回 plan）

### 插件权限
GET  /api/plugins/:pluginId/permissions  → 权限列表
POST /api/plugins/:pluginId/permissions/grant → 授权
POST /api/plugins/:pluginId/permissions/revoke → 撤销
```

### HTTP Action 请求示例

```http
POST /api/actions
Content-Type: application/json
X-SessionNode-Token: ntf8_2kD...

{
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "capability": "fs.list",
  "targetNodeId": "node_vps",
  "payload": {
    "path": "/home/user/project"
  }
}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "requestId": "req_abc",
  "ok": true,
  "payload": {
    "entries": [
      { "name": "main.go", "type": "file", "size": 1024, "modTime": "2026-05-19T10:00:00Z" },
      { "name": "src", "type": "dir", "size": 0, "modTime": "2026-05-19T09:00:00Z" }
    ]
  },
  "timestamp": 1712345678001
}
```

### HTTP 错误响应

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "requestId": "req_abc",
  "ok": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "plugin claude-code does not have fs.read permission"
  },
  "timestamp": 1712345678001
}
```

| HTTP Status | 含义 | 常见场景 |
|-------------|------|---------|
| 200 | 请求处理完成（包括业务错误） | 正常/权限拒绝/节点不可达 |
| 400 | 请求格式错误 | 缺少必填字段 |
| 401 | 未认证 | token 缺失/无效 |
| 404 | 资源不存在 | sessionId 无效 |
| 502 | 目标节点不可达 | 远程节点离线 |

---

## 五、WebSocket 协议

### 连接

```
URL: /ws
Protocol: JSON over WebSocket
```

### 连接生命周期

```
1. 客户端建立 WebSocket 连接
2. 客户端发送 hello 消息：
   {
     "type": "hello",
     "nodeId": "browser_xxx",
     "version": "2.0.0",
     "token": "web_tok_abc"
   }
3. Core 回复 welcome：
   {
     "type": "welcome",
     "nodeId": "node_abc",
     "version": "2.0.0",
     "sessionId": "wsc_xxx",      // 此连接的 WebSocket 会话 ID
     "sessions": [...],           // 当前活跃 sessions
     "nodes": [...],              // 已知节点
     "plugins": [...]             // 已注册插件
   }
4. 开始正常通信
5. 心跳：客户端每 30 秒发 ping，Core 回复 pong（或 Core 主动 ping）
6. 断开：任意一方关闭连接
```

### 请求-响应模式

```json
// 客户端请求（通过 WebSocket 发送）
{
  "type": "action.request",
  "requestId": "req_abc",
  "pluginId": "system-ui",
  "capability": "plugin.list",
  "payload": {},
  "timestamp": 1712345678000
}

// Core 回复
{
  "type": "action.response",
  "requestId": "req_abc",
  "ok": true,
  "payload": { "plugins": [...] },
  "timestamp": 1712345678001
}
```

### 订阅-推送模式

```json
// 客户端订阅
{
  "type": "stream.subscribe",
  "requestId": "req_def",
  "pluginId": "claude-code",
  "sessionId": "sess_abc",
  "streamType": "stdout",
  "fromSeq": 0
}

// Core 确认
{
  "type": "stream.subscribed",
  "requestId": "req_def",
  "ok": true,
  "sessionId": "sess_abc",
  "streamType": "stdout"
}

// Core 推送（实时）
{
  "type": "stream.chunk",
  "sessionId": "sess_abc",
  "streamType": "stdout",
  "eventSeq": 42,
  "data": "base64EncodedString",
  "timestamp": 1712345679000
}
```

### 事件推送（无需订阅）

以下事件类型 Core 自动推送给所有连接的 WebSocket 客户端（按需推送）：

| 事件类型 | 触发条件 | 推送范围 |
|---------|---------|---------|
| `session.event` | session 产生任何事件 | 该 session 的订阅者 |
| `session.stopped` | session 停止 | 所有连接 |
| `plugin.status_changed` | 插件状态变更 | 所有连接 |
| `plugin.registered` | 新插件注册 | 所有连接 |
| `config.changed` | 配置被修改 | 所有连接 |
| `notify.approval.request` | 审批请求 | 所有连接 |
| `notify.approval.expired` | 审批超时 | 相关连接 |
| `node.joined` | 新节点连接 | 所有连接 |
| `node.left` | 节点断开 | 所有连接 |

### 远程转发

当请求中的 `targetNodeId` 指向远程节点时，Core 通过 relay 连接转发消息：

```
Client A → Core A → [relay WebSocket] → Core B → 处理 → 返回
```

消息格式完全不变，targetNodeId 由 Core A 的路由器解析。

---

## 六、消息详述

### Hello / Welcome

```json
// Client → Core
{
  "type": "hello",
  "nodeId": "browser_xxx",
  "version": "2.0.0",
  "token": "web_tok_abc",
  "lastKnownSeq": 42
}

// Core → Client
{
  "type": "welcome",
  "nodeId": "node_abc",
  "version": "2.0.0",
  "sessionId": "wsc_xxx",
  "sessions": [
    { "sessionId": "sess_1Lg3", "kind": "process", "status": "running", "pluginId": "shell" }
  ],
  "nodes": [
    { "nodeId": "node_abc", "label": "PENGSPC", "status": "connected", "role": "relay" }
  ],
  "plugins": [
    { "pluginId": "system-ui", "title": "System UI", "status": "loaded", "builtin": true },
    { "pluginId": "shell", "title": "Shell", "status": "loaded" }
  ]
}
```

### Session Create

```json
// Client → Core
{
  "type": "session.create",
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "targetNodeId": "node_vps",
  "payload": {
    "kind": "process",
    "command": "claude",
    "args": ["--output-format", "stream-json"],
    "cwd": "/repo",
    "env": {
      "CLAUDE_MODEL": "sonnet"
    }
  }
}

// Core → Client (成功)
{
  "type": "session.created",
  "requestId": "req_abc",
  "ok": true,
  "sessionId": "sess_1Lg3",
  "streamIds": {
    "stdin": "stream_stdin_1Lg3",
    "stdout": "stream_stdout_1Lg3",
    "stderr": "stream_stderr_1Lg3"
  }
}

// Core → Client (失败)
{
  "type": "session.created",
  "requestId": "req_abc",
  "ok": false,
  "error": {
    "code": "BINARY_NOT_FOUND",
    "message": "claude binary not found on node_vps"
  }
}
```

### Action Request / Response

```json
// Client → Core
{
  "type": "action.request",
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "actor": { "type": "web", "id": "browser_abc" },
  "targetNodeId": "node_vps",
  "capability": "fs.read",
  "payload": {
    "path": "/home/user/project/main.go",
    "offset": 0,
    "limit": 4096
  },
  "timestamp": 1712345678000
}

// Core → Client (成功)
{
  "type": "action.response",
  "requestId": "req_abc",
  "ok": true,
  "capability": "fs.read",
  "payload": {
    "data": "base64EncodedContent",
    "size": 1024,
    "truncated": false
  },
  "timestamp": 1712345678001
}

// Core → Client (失败)
{
  "type": "action.response",
  "requestId": "req_abc",
  "ok": false,
  "capability": "fs.read",
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "path /home/user/project/main.go not in allowed paths"
  },
  "timestamp": 1712345678001
}
```

### Session Event (Core → Client 推送)

```json
{
  "type": "session.event",
  "sessionId": "sess_1Lg3",
  "eventSeq": 1,
  "pluginId": "claude-code",
  "event": "session.created",
  "payload": {
    "kind": "process",
    "command": "claude"
  },
  "timestamp": 1712345678000
}

{
  "type": "session.event",
  "sessionId": "sess_1Lg3",
  "eventSeq": 2,
  "event": "stream.stdout",
  "payload": {
    "data": "base64..."
  },
  "timestamp": 1712345678005
}

{
  "type": "session.event",
  "sessionId": "sess_1Lg3",
  "eventSeq": 99,
  "event": "session.stopped",
  "payload": {
    "exitCode": 0,
    "signal": ""
  },
  "timestamp": 1712345680000
}
```

### Event 类型总表

| event 值 | 含义 | payload |
|----------|------|---------|
| `session.created` | session 已创建 | `{ kind, command, args, cwd }` |
| `stream.stdout` | stdout 输出 | `{ data: base64 }` |
| `stream.stderr` | stderr 输出 | `{ data: base64 }` |
| `stream.stdin` | 用户输入 | `{ data: base64 }` |
| `process.resized` | pty resize | `{ rows, cols }` |
| `session.stopped` | session 已停止 | `{ exitCode, signal? }` |
| `session.errored` | session 错误 | `{ error: string }` |
| `notify.approval` | 审批事件 | `{ requestId, action }` |

### Notify / Approval

```json
// 插件发起审批
{
  "type": "notify.request",
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "payload": {
    "title": "Claude wants to read a file",
    "body": "/etc/hosts",
    "actions": [
      { "id": "allow-once", "label": "Allow Once" },
      { "id": "deny", "label": "Deny" }
    ],
    "timeout": 30000
  }
}

// Core 推送给所有 UI
{
  "type": "notify.approval.request",
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "payload": {
    "title": "Claude wants to read a file",
    "body": "/etc/hosts",
    "actions": [
      { "id": "allow-once", "label": "Allow Once" },
      { "id": "deny", "label": "Deny" }
    ],
    "timeout": 30000,
    "remaining": 25000
  }
}

// 用户响应
{
  "type": "notify.respond",
  "requestId": "req_abc",
  "pluginId": "system-ui",
  "action": "allow-once",
  "actor": { "type": "web", "id": "browser_abc" }
}

// Core 回调给请求方
{
  "type": "notify.approval.result",
  "requestId": "req_abc",
  "action": "allow-once",
  "respondedBy": "user",
  "responderId": "browser_abc",
  "timestamp": 1712345680000
}

// 超时
{
  "type": "notify.approval.expired",
  "requestId": "req_abc",
  "timestamp": 1712345708000
}
```

### Plugin Check / Install

```json
// 环境检测
{
  "type": "plugin.check",
  "requestId": "req_abc",
  "pluginId": "system-ui",
  "payload": {
    "pluginId": "claude-code",
    "targetNodeId": "node_vps"
  }
}

// 响应
{
  "type": "plugin.checked",
  "requestId": "req_abc",
  "ok": true,
  "payload": {
    "pluginId": "claude-code",
    "nodeId": "node_vps",
    "checkedAt": 1712345678000,
    "status": "missing",
    "dependencies": [
      { "id": "claude-cli", "type": "binary", "name": "claude", "found": false, "required": true },
      { "id": "git", "type": "binary", "name": "git", "found": true, "path": "/usr/bin/git", "optional": true }
    ]
  }
}

// 安装计划
{
  "type": "plugin.install.plan",
  "requestId": "req_def",
  "pluginId": "system-ui",
  "payload": {
    "pluginId": "claude-code",
    "nodeId": "node_vps"
  }
}

// 计划生成
{
  "type": "plugin.install.planned",
  "requestId": "req_def",
  "ok": true,
  "payload": {
    "installId": "inst_20260519_001",
    "pluginId": "claude-code",
    "steps": [
      {
        "dependencyId": "claude-cli",
        "method": "npm",
        "command": "npm install -g @anthropic-ai/claude-code",
        "risk": "medium",
        "requiresApproval": true,
        "estimatedDuration": "30s",
        "notes": "Will install claude CLI globally via npm"
      }
    ],
    "totalRisk": "medium",
    "requiresApproval": true
  }
}

// 执行安装
{
  "type": "plugin.install.execute",
  "requestId": "req_ghi",
  "pluginId": "system-ui",
  "payload": {
    "installId": "inst_20260519_001"
  }
}

// 安装进程事件（实时推送）
{
  "type": "plugin.install.event",
  "installId": "inst_20260519_001",
  "eventSeq": 1,
  "event": "stdout",
  "data": "npm install -g @anthropic-ai/claude-code\n",
  "timestamp": 1712345679000
}

// 安装完成
{
  "type": "plugin.install.result",
  "requestId": "req_ghi",
  "ok": true,
  "payload": {
    "installId": "inst_20260519_001",
    "status": "success",
    "startedAt": 1712345678000,
    "finishedAt": 1712345680000
  }
}
```

---

## 七、错误码总表

### 通用错误 (1xxx)

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `UNKNOWN_ERROR` | 500 | 未知错误 |
| `INVALID_REQUEST` | 400 | 请求格式错误（缺字段、类型不对） |
| `INVALID_REQUEST_ID` | 400 | requestId 格式无效或重复 |
| `UNSUPPORTED_VERSION` | 400 | 协议版本不支持 |
| `TIMEOUT` | 504 | 操作超时 |

### 认证错误 (2xxx)

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `UNAUTHENTICATED` | 401 | 未认证（token 缺失或无效） |
| `TOKEN_EXPIRED` | 401 | token 已过期 |
| `FORBIDDEN` | 403 | 认证通过但无权操作 |

### 权限错误 (3xxx)

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `PERMISSION_DENIED` | 403 | 权限被拒绝（已明确 deny） |
| `NEED_APPROVAL` | 403 | 权限模式为 ask，需要用户审批 |
| `CAPABILITY_NOT_DECLARED` | 403 | 插件未在 manifest 中声明此能力 |
| `NOT_GRANTED` | 403 | 用户未授予此能力 |
| `PATH_NOT_ALLOWED` | 403 | 路径不在 allow list 中 |
| `PLUGIN_NOT_REGISTERED` | 403 | 插件未注册 |

### 节点/路由错误 (4xxx)

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `NODE_UNREACHABLE` | 502 | 目标节点不可达 |
| `NODE_NOT_FOUND` | 404 | 节点不存在 |
| `FORWARD_ERROR` | 502 | 转发到目标节点失败 |

### Session 错误 (5xxx)

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `SESSION_NOT_FOUND` | 404 | session 不存在 |
| `SESSION_ALREADY_STOPPED` | 400 | session 已停止 |
| `SESSION_CREATE_FAILED` | 500 | 创建 session 失败 |
| `SESSION_TIMEOUT` | 504 | session 操作超时 |

### 插件错误 (6xxx)

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `PLUGIN_NOT_FOUND` | 404 | 插件不存在 |
| `PLUGIN_DISABLED` | 403 | 插件已被禁用 |
| `PLUGIN_ALREADY_INSTALLED` | 400 | 插件已安装 |
| `PLUGIN_NOT_INSTALLED` | 400 | 插件未安装 |
| `PLUGIN_CHECK_FAILED` | 500 | 环境检测失败 |
| `PLUGIN_INSTALL_FAILED` | 500 | 安装失败 |
| `PLUGIN_INSTALL_NOT_FOUND` | 404 | 安装记录不存在 |

### 能力执行错误 (7xxx)

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `BINARY_NOT_FOUND` | 404 | 二进制不存在 |
| `FILE_NOT_FOUND` | 404 | 文件不存在 |
| `FILE_READ_ERROR` | 500 | 文件读取失败 |
| `FILE_WRITE_ERROR` | 500 | 文件写入失败 |
| `PROCESS_SPAWN_FAILED` | 500 | 进程启动失败 |
| `PROCESS_KILL_FAILED` | 500 | 进程终止失败 |
| `STREAM_NOT_FOUND` | 404 | stream 不存在 |
| `CONFIG_KEY_NOT_FOUND` | 404 | 配置项不存在 |
| `CONFIG_KEY_INVALID` | 400 | 配置项格式错误 |

### 缓存/文件错误 (8xxx)

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `CACHE_NOT_FOUND` | 404 | 缓存条目不存在 |
| `CACHE_NOT_CLEARABLE` | 400 | 缓存不可清理 |
| `CACHE_CLEAR_FAILED` | 500 | 清理失败 |
| `CACHE_RISK_HIGH` | 403 | 高危操作需要额外确认 |
| `FILE_NOT_REGISTERED` | 404 | 文件未在 registry 中 |

---

## 八、版本协商

### 协议版本

```
当前版本: 2.0.0
格式: major.minor.patch
```

### 版本规则

```
major: 不兼容变更（消息格式、字段增减、删除 type）
minor: 向后兼容的新 type、新字段（旧客户端忽略未知字段）
patch: 修复，不改变协议
```

### 协商流程

```
1. 客户端 hello 中声明 version: "2.0.0"
2. Core 检查版本兼容性：
   - major 相同 → 兼容
   - major 不同 → 返回 UNSUPPORTED_VERSION
3. Core 在 welcome 中返回自己的 version
4. 如果客户端 version > Core version：
   - Core 仍然接受，但只返回 Core 支持的功能
   - 客户端需要降级
5. 如果客户端 version < Core version：
   - Core 正常服务，新功能客户看不到
```

### 字段兼容

```
旧客户端必须忽略响应中的未知字段。
Core 必须忽略请求中的未知字段。

不能删除字段，只能标记 deprecated。
Deprecated 字段保留至少 2 个 major 版本。
```

---

## 九、安全约束

### Transport

```
1. 本地开发: ws://localhost:8080/ws
2. 远程访问: wss://host:8080/ws（需要 TLS）
3. Relay 连接: wss://relay/ws（节点间 TLS 加密）
```

### 认证

```
WebSocket:
  → hello { token: "xxx" } 中带 token

HTTP:
  → Header: X-SessionNode-Token: xxx

Token 类型:
  - admin: 管理 token，首次启动打印
  - web: 浏览器 token，从 Web UI 生成
  - node: 节点间 token，配置时设置
```

### 消息大小限制

```
WebSocket 单条消息: 最大 16MB
  - 大文件通过 fs.read 分片读取，不通过 WS 传输

HTTP request body: 最大 10MB
```

### 频率限制

```
所有请求: 1000 req/min/plugin (建议值，可在 config.yaml 调整)
Stream chunks: 无限制（实时数据）
```

---

## 十、防回退规则

| # | 规则 | 后果 |
|---|------|------|
| 1 | **禁止新增消息 type 时删除旧的** | 旧客户端连接后无法识别，报错。应该标记 deprecated |
| 2 | **禁止依赖消息顺序跨 session** | session.event 的 eventSeq 只在单个 session 内单调递增 |
| 3 | **禁止在 HTTP API 中实现订阅/推送** | HTTP 是请求-响应模型。推送必须走 WebSocket |
| 4 | **禁止 WebSocket 消息不带 requestId** | 无法追踪请求-响应关系，无法调试 |
| 5 | **禁止 action.response 中省略 capability 字段** | 接收方不知道是哪个能力的响应 |
| 6 | **禁止通过 relay 绕过认证** | relay 连接也必须通过 token 认证 |
| 7 | **禁止错误码用 HTTP status 代替业务错误码** | HTTP 200 + 业务错误码，不依赖 HTTP status 判断业务 |
| 8 | **禁止让客户端通过多个 HTTP 请求拼凑状态** | 需要多次请求才能知道"插件是否可用" → 应该提供聚合 API |

---

## 十一、Service Token 认证

### Token 配置

```yaml
# ~/.sessionnode/config.yaml
core:
  auth:
    serviceTokens:
      - token: "svc_ci_deploy_abc123"
        label: "CI 部署脚本"
        permissions:
          capabilities:
            - session.create
            - session.stop
            - fs.read
          constraints:
            commands:
              allow: ["bash", "node"]
            paths:
              allow: ["/home/user/deploy/**"]
        expiresAt: "2027-01-01T00:00:00Z"

      - token: "svc_k8s_operator_def456"
        label: "Kubernetes Operator"
        permissions:
          capabilities:
            - session.create
            - session.stop
          constraints:
            commands:
              allow: ["kubectl", "helm"]
```

### 认证流程

```
HTTP:
  1. 客户端在 Header 中带 Token: X-SessionNode-Token: svc_xxx
  2. Core 查 token 表
  3. 验证 token 存在且未过期
  4. 提取权限范围
  5. 注入 Actor { type: "service", id: token_label }

WebSocket:
  1. hello 消息中带 token 字段: { token: "svc_xxx" }
  2. Core 验证后确定 Actor
  3. welcome 确认身份
```

### Token 认证消息示例

```json
// HTTP 请求
POST /api/actions
X-SessionNode-Token: svc_ci_deploy_abc123
Content-Type: application/json

{
  "requestId": "req_ci_001",
  "capability": "session.create",
  "targetNodeId": "node_vps",
  "payload": {
    "kind": "process",
    "command": "bash",
    "args": ["./deploy.sh"]
  }
}

// 认证失败
HTTP/1.1 401 Unauthorized
{
  "requestId": "req_ci_001",
  "ok": false,
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "invalid or expired service token"
  }
}
```

### Token 安全规则

```
1. Token 不可在日志中明文记录（脱敏为 [token:svc_xxx]）
2. Token 过期后自动失效
3. 管理员可随时撤销 Token（从 config.yaml 移除）
4. Token 权限变更立即生效
5. External Client 不能调 Plugin Management API
```

---

## 十二、Task 生命周期消息

### 消息类型

| type | 方向 | 用途 |
|------|------|------|
| `task.create` | Client → Core | 创建任务 |
| `task.created` | Core → Client | 任务已创建 |
| `task.event` | Core → Client | 任务进度事件 |
| `task.completed` | Core → Client | 任务完成 |
| `task.failed` | Core → Client | 任务失败 |
| `task.cancelled` | Core → Client | 任务取消 |
| `task.cancel` | Client → Core | 取消任务 |
| `task.list` | Client → Core | 列出任务 |
| `task.listed` | Core → Client | 任务列表响应 |

### 消息示例

```json
// 创建 Task
{
  "type": "task.create",
  "requestId": "req_task_001",
  "pluginId": "system-ui",
  "payload": {
    "taskType": "reconcile",
    "target": "claude-code",
    "priority": "normal"       // normal | high | low
  }
}

// Task 创建成功
{
  "type": "task.created",
  "requestId": "req_task_001",
  "ok": true,
  "taskId": "task_001",
  "taskType": "reconcile",
  "status": "pending",
  "createdAt": 1712345678000
}

// Task 进度推送
{
  "type": "task.event",
  "taskId": "task_001",
  "eventSeq": 1,
  "status": "running",
  "progress": "Step 1/3: Checking dependencies...",
  "timestamp": 1712345679000
}

// Task 完成
{
  "type": "task.completed",
  "taskId": "task_001",
  "status": "success",
  "result": {
    "pluginId": "claude-code",
    "previousState": "missing_dep",
    "currentState": "enabled"
  },
  "duration": 30000
}

// Task 失败
{
  "type": "task.failed",
  "taskId": "task_001",
  "error": {
    "code": "INSTALL_FAILED",
    "message": "npm install failed: network error"
  },
  "failedStep": "Step 2/3"
}
```

### Task 与 Action 的区别

```
Task:
  - 异步执行
  - 有进度推送
  - 可取消
  - 用于长时间操作（安装、reconcile、缓存清理）

Action:
  - 同步 request-response
  - 无进度
  - 不可取消
  - 用于短时间原子操作（fs.read, config.get）
```

---

## 十三、健康检查与指标端点

### HTTP 端点

```http
### 基础健康检查
GET /api/health
→ {
    "status": "ok",
    "version": "2.0.0",
    "uptime": 3600,
    "nodeId": "node_abc",
    "nodes": { "total": 3, "connected": 2, "disconnected": 1 },
    "sessions": { "total": 5, "running": 3, "stopped": 2 },
    "plugins": { "total": 4, "enabled": 3, "disabled": 1 }
  }

### 详细健康检查
GET /api/health/detail
→ {
    "memory": { "used": "128MB", "total": "512MB", "usagePercent": 25 },
    "goroutines": 42,
    "eventLoopLag": "5ms",
    "disk": {
      "dataDir": "/home/user/.sessionnode",
      "free": "50GB",
      "total": "256GB",
      "usagePercent": 80.5
    },
    "metrics": {
      "capability.calls.total": 1024,
      "capability.calls.allowed": 1000,
      "capability.calls.denied": 24,
      "sessions.created": 50,
      "sessions.stopped": 45,
      "plugins.installed": 3
    }
  }

### WebSocket 事件
Core 定期广播健康状态:
{
  "type": "node.health",
  "nodeId": "node_abc",
  "status": "ok",
  "sessions": 5,
  "uptime": 3600,
  "timestamp": 1712345678000
}
```

### 指标字段

| 指标 | 类型 | 说明 |
|------|------|------|
| `capability.calls.total` | counter | 总能力调用次数 |
| `capability.calls.allowed` | counter | 通过的调用 |
| `capability.calls.denied` | counter | 拒绝的调用 |
| `sessions.created` | counter | 创建的 session 数 |
| `sessions.stopped` | counter | 停止的 session 数 |
| `nodes.current` | gauge | 当前连接节点数 |
| `plugins.enabled` | gauge | 启用的插件数 |
| `plugins.disabled` | gauge | 禁用的插件数 |
| `memory.usagePercent` | gauge | 内存使用率 |
| `disk.usagePercent` | gauge | 磁盘使用率 |

---

## 十四、防回退规则补充

| # | 规则 | 后果 |
|---|------|------|
| 9 | **禁止 Token 在日志中明文记录** | Token 必须脱敏 |
| 10 | **禁止 Task 消息没有 taskId** | 无法追踪进度 |
| 11 | **禁止 health 端点返回敏感信息** | 不暴露 Token、密码等 |
| 12 | **禁止 Service Token 使用 pluginId** | External Client 不是插件 |
| 13 | **禁止 External Client 调 Plugin Management API** | 插件管理是管理员操作 |
