# SessionBridge — WebSocket 通信协议

所有消息均为 JSON 格式，通过 WebSocket 传输。本文档涵盖 v1 协议的所有消息类型。

协议定义在 [`adapters/protocol.ts`](../adapters/protocol.ts)，服务端实现在 [`src/relay-server.ts`](../src/relay-server.ts)，客户端实现在 [`lib/ws-client.ts`](../lib/ws-client.ts)，Agent 端实现在 [`adapters/agent-core/relay-connection.ts`](../adapters/agent-core/relay-connection.ts)。

---

## 1. 消息信封 (v1 Envelope)

所有消息默认使用统一信封格式。解析器同时接受旧版扁平格式（无 envelope），自动将 body 字段提升到顶层。

```json
{
  "v": 1,
  "id": "msg_xxx",
  "ts": 1714512345678,
  "type": "消息类型",
  "body": { }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `v` | `number` | 是 | 协议版本，固定为 `1` |
| `id` | `string` | 否 | 消息唯一 ID，可用于请求-响应关联 |
| `ts` | `number` | 是 | Unix 毫秒时间戳 |
| `type` | `string` | 是 | 消息类型标识 |
| `body` | `object` | 是 | 消息体，承载具体数据 |

向后兼容：服务器通过 `parseMsg()` 同时接受旧版扁平格式（直接将 type 和字段放在顶层），解析时自动将 body 字段提升到顶层访问。

---

## 2. 连接与握手

### 2.1 标准握手 (hello / welcome)

所有客户端连接后必须先发送 `hello`，服务器回复 `welcome`。这是当前主要握手方式。

握手同时承担**加密密钥交换**：如果客户端在 `features` 中声明 `"crypto_v1"`，双方会在 hello/welcome 中附加公钥，通过 ECDH 派生 AES-256-GCM 会话密钥。后续所有消息自动加密。

```json
// 客户端 → 服务器
{
  "type": "hello",
  "role": "browser",
  "version": "0.5.0",
  "features": ["crypto_v1", "structured_chat", "instance_list", "shell"],
  "token": "可选认证令牌",
  "clientToken": "可选会话恢复令牌",
  "nodeId": "可选节点标识",
  "staticKey": "Ed25519 身份公钥 (base64)",
  "ephemeralKey": "X25519 临时公钥 (base64, 每连接重新生成)",
  "cols": 120,
  "rows": 40
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `role` | `string` | 是 | `"browser"` 或 `"agent"` |
| `version` | `string` | 是 | 客户端版本号 |
| `token` | `string` | 否 | 认证令牌（若服务端配置了 `BRIDGE_TOKEN`） |
| `features` | `string[]` | 否 | 客户端支持的 feature 列表。含 `"crypto_v1"` 时启用加密 |
| `clientToken` | `string` | 否 | 会话恢复令牌（浏览器断线重连时使用） |
| `nodeId` | `string` | 否 | 节点标识（Agent 端使用，用于 EventBus 路由） |
| `staticKey` | `string` | 仅加密 | 节点 Ed25519 身份公钥，用于身份认证。`features` 含 `"crypto_v1"` 时必填 |
| `ephemeralKey` | `string` | 仅加密 | X25519 临时公钥，用于 ECDH 密钥交换。每连接重新生成，确保前向安全 |
| `cols` / `rows` | `number` | 否 | 终端尺寸 |

```json
// 服务器 → 客户端（支持加密的响应）
{
  "type": "welcome",
  "version": "0.5.0",
  "features": ["crypto_v1", "agent_registration", "shell", "multi_instance", "structured_chat", "queue", "update_notification", "session_recovery"],
  "sessionId": "inst_1_xxx",
  "serverTime": 1714512345678,
  "instances": [ ... ],
  "restoredInstances": [ ... ],
  "staticKey": "服务端 Ed25519 身份公钥 (base64)",
  "ephemeralKey": "服务端 X25519 临时公钥 (base64)"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | `string` | 服务端版本号 |
| `features` | `string[]` | 服务端支持的 feature 列表。含 `"crypto_v1"` 表示后续消息加密 |
| `sessionId` | `string` | 当前会话 ID（即活动实例 ID） |
| `serverTime` | `number` | 服务端时间戳 |
| `instances` | `array` | 当前所有实例列表 |
| `restoredInstances` | `array` | 仅断线重连时出现，表示恢复的实例 |
| `staticKey` | `string` | 仅加密返回。服务端 Ed25519 身份公钥 |
| `ephemeralKey` | `string` | 仅加密返回。服务端 X25519 临时公钥 |

### 2.2 加密握手过程

当双方 `features` 都含 `"crypto_v1"` 时，hello/welcome 交换后立即派生会话密钥：

```
客户端                                          服务端
  │                                               │
  │ 生成 ephemeral X25519 密钥对                   │
  │ hello { staticKey, ephemeralKey }             │
  │──────────────────────────────────────────────▶│
  │                                               │ 生成 ephemeral X25519 密钥对
  │ welcome { staticKey, ephemeralKey }            │
  │◀──────────────────────────────────────────────│
  │                                               │
  │ 双方独立计算:                                  │
  │ secret1 = X25519(eph_priv, peer_eph_pub)      │ ← 前向安全
  │ secret2 = X25519(static_priv, peer_static_pub) │ ← 身份绑定
  │ session_key = HKDF-SHA256(                     │
  │   secret1 || secret2,                          │
  │   "session-bridge-v1",                         │
  │   32                                           │
  │ )                                              │
  │                                               │
  │ 所有后续消息使用 AES-256-GCM 加密               │
  │══════════════════════════════════════════════▶│
```

如果客户端不支持加密（`features` 不含 `"crypto_v1"`），服务端回复普通 welcome，后续走明文。

### 2.2 兼容握手 (旧版)

```json
// 客户端 → 服务器（令牌认证）
{ "type": "auth", "token": "..." }

// 客户端 → 服务器（直连本地）
{ "type": "direct", "workspace": false, "cols": 120, "rows": 40 }

// 服务器 → 客户端
{ "type": "auth_result", "success": true, "sessionId": "inst_1_xxx", "instances": [...] }

// 服务器 → 客户端（直连确认）
{ "type": "workspace_connected" }
```

旧版握手已弃用但仍受支持。推荐所有新客户端使用 `hello`/`welcome`。

### 2.3 断开连接

```json
// Agent → 服务器（正常关闭前发送）
{ "type": "bye", "reason": "shutdown" }
```

### 2.4 加密消息格式

当加密握手完成后，所有 WebSocket 消息使用以下加密信封：

```json
{
  "enc": true,
  "iv": "随机 12 字节 IV (base64)",
  "tag": "GCM 认证标签 16 字节 (base64)",
  "data": "AES-256-GCM 密文 (base64)"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `enc` | `boolean` | 固定 `true`，标记此消息为加密消息 |
| `iv` | `string` | 每条消息随机生成的 12 字节 IV，base64 编码 |
| `tag` | `string` | AES-256-GCM 认证标签（16 字节），确保消息完整性和防篡改 |
| `data` | `string` | 加密后的原始 v1 信封 JSON 数据，base64 编码 |

解密后的内容即为标准 v1 信封：

```json
// 解密后
{ "v": 1, "ts": 1714512345678, "type": "instance.block", "body": { ... } }
```

处理规则：
- 中继服务器收到 `enc: true` 的消息**不解密**，直接透传
- 只有最终接收端（浏览器 JS / agent / APK）解密
- 未加密的消息（无 `enc` 字段）按原有明文流程处理
- 不支持加密的旧客户端不受影响

---

## 3. 心跳

服务器每 30 秒向所有已连接客户端发送 `ping`，客户端必须在收到后回复 `pong`。

```json
// 服务器 → 客户端（每 30 秒）
{ "v": 1, "ts": 1714512345678, "type": "ping", "body": {} }

// 客户端 → 服务器
{ "v": 1, "ts": 1714512345678, "type": "pong", "body": {} }
```

若客户端连续两个 `ping` 未回复 `pong`，服务器断开该连接。心跳使用 `WeakMap` 追踪状态，每个 ping 将标记设为 `false`，收到 pong 或 pong 事件后恢复 `true`。

---

## 4. 会话恢复

服务器支持客户端断线重连后的会话恢复机制。

### 4.1 clientToken

客户端可以在 `hello` 消息中携带 `clientToken`。服务器分配并追踪该令牌：

- 首次连接：服务器创建新的 `ClientSession`，记录 WebSocket 引用和 shell ID 集合
- 断线重连：客户端在 60 秒内以相同 `clientToken` 重新连接，服务器恢复会话状态
- 超时清理：60 秒后未重连，服务器清理会话及相关 shell 实例

```json
// 首次连接
{ "type": "hello", "role": "browser", "clientToken": "abc123", ... }

// 服务器回复 welcome 中包含恢复的实例
{
  "type": "welcome",
  "restoredInstances": [{ "id": "inst_1_xxx", ... }],
  ...
}
```

### 4.2 会话持久化

实例状态通过 `SessionPersistence` 组件持久化到磁盘 `.sessionbridge/sessions.json`，防写抖 500ms：

```json
{
  "version": 1,
  "savedAt": 1714512345678,
  "activeId": "inst_1_xxx",
  "instances": [
    {
      "id": "inst_1_xxx",
      "dir": "/home/user/project",
      "label": "my-project",
      "status": "stopped",
      "source": "local",
      "adapterId": "shell",
      "agentVersion": null,
      "createdAt": 1714512345000,
      "restoredAt": 1714512345678,
      "lastOperation": { "kind": "chat", "status": "running", "command": "npm test" }
    }
  ]
}
```

重启后，`NodeRelayServer.start()` 会恢复上一轮的实例列表（状态统一为 `stopped`，进程需重新启动）。

---

## 5. 数据传输

### 5.1 客户端 → 服务器：用户输入

```json
// 输入文本/命令，发送到 Claude 进程或远程 agent
{ "type": "instance.input", "data": "npm test\n", "instanceId": "inst_1_xxx", "sessionId": "..." }

// 兼容旧名称
{ "type": "input", "data": "npm test\n", "instanceId": "inst_1_xxx" }
```

服务器收到后：
1. 广播 `instance.block` (blockType: "user") 将用户输入回显到前端
2. 将输入放入实例的待处理队列
3. 记录审计日志并启动操作状态机

### 5.2 服务器 → 客户端：原始输出

```json
{ "type": "instance.output", "data": "[32mHello[0m\n" }

// 兼容旧名称
{ "type": "output", "data": "[32mHello[0m\n" }
```

原始输出包含 ANSI 转义序列，适合终端渲染。每个实例最多缓存 512KB 输出。

### 5.3 服务器 → 客户端：结构化 Block

```json
{
  "type": "instance.block",
  "blockType": "tool_use",
  "name": "Bash",
  "input": { "command": "npm test" },
  "text": "",
  "ts": 1714512345678,
  "instanceId": "inst_1_xxx"
}

// 兼容旧名称
{ "type": "block", "blockType": "thinking", "text": "...", ... }
```

#### Block 类型一览

| blockType | 说明 | 关键字段 |
|-----------|------|---------|
| `thinking` | 模型思考过程 | `text`, `status` (running/done), `id` |
| `tool_use` | 工具调用 | `name`, `input` / `args`, `status` (running/done), `result`, `id` |
| `tool_progress` | 工具执行进度 | `toolUseId`, `innerToolUseId`, `progress` |
| `text` | 文本回复 | `text` |
| `status` | 状态信息 | `text` |
| `user` | 用户消息回显 | `text` |
| `token_usage` | Token 用量 | `cost`, `tokens`, `model` |
| `done` | 本轮处理完成 | `text` |
| `error` | 错误 | `text` |
| `task_started` | 后台任务开始 | `taskId`, `taskType`, `description`, `prompt` |
| `task_progress` | 后台任务进度 | `taskId`, `description`, `lastToolName`, `usage`, `summary` |
| `task_notification` | 后台任务通知 | `taskId` |

### 5.4 命令执行结果

```json
// 服务器 → 客户端
{ "type": "instance.command_result", "name": "switch-instance", "success": true, "data": { "instanceId": "inst_2_xxx" } }
{ "type": "command_result", "name": "list-instances", "success": true, "data": { "instances": [...], "activeId": "..." } }
```

### 5.5 大消息分块传输

当消息超过 64KB 时，发送端自动分割为多个分块帧，接收端重新组装：

```json
// 分块帧示例（agent.stdout 使用 chunk 字段）
{
  "type": "agent.stdout",
  "instanceId": "inst_2_xxx",
  "line": "部分数据...",
  "chunk": {
    "msgId": "inst_2_xxx-1",
    "seq": 0,
    "total": 3
  }
}
```

| chunk 字段 | 说明 |
|-----------|------|
| `msgId` | 块传输唯一 ID |
| `seq` | 当前分片序号（从 0 开始） |
| `total` | 总分片数 |

- 接收端（`reassembleChunk`）缓存未完成的分片
- 分片超时 30 秒后自动清理
- `agent.stdout` 使用 `line` 字段，`agent.stderr` 使用 `data` 字段

---

## 6. 实例管理

### 6.1 客户端命令

```json
// 发送框架级命令（不发送到 Claude）
{ "type": "instance.command", "name": "switch-instance", "args": { "instanceId": "inst_2_xxx" }, "instanceId": "inst_1_xxx" }

// 兼容旧格式
{ "type": "command", "name": "list-instances", "args": {} }
```

#### 命令列表

| name | 参数 | 说明 |
|------|------|------|
| `switch-instance` | `instanceId` | 切换到指定实例 |
| `list-instances` | — | 获取所有实例列表 |
| `interrupt` | — | 中断当前操作，回滚文件变更（仅本地实例） |
| `clear` | `model?` | 清空会话并重新创建进程；可选切换模型 |
| `restart` | `model?` | 同 `clear` |
| `rewind` | — | 回滚上一个 checkpoint |
| `rewind-all` | — | 回滚当前 turn 的所有 checkpoint |
| `setMode` | `mode` | 设置权限模式：`default` / `acceptEdits` / `plan` |
| `setEffort` | `level` | 设置思考力度：`low` / `medium` / `high` |

### 6.2 服务器推送

```json
// 实例列表（响应 list-instances 命令）
{ "type": "instance.list", "instances": [...], "activeId": "inst_1_xxx" }

// 新实例创建
{ "type": "instance.added", "instance": { "id": "inst_2_xxx", "dir": "/home/user/project", "label": "my-project", "status": "starting" } }

// 实例被删除
{ "type": "instance.removed", "instanceId": "inst_1_xxx" }

// 活动实例切换
{ "type": "instance.switched", "instanceId": "inst_2_xxx" }
```

兼容旧名：`instance_list`、`instance_added`、`instance_removed`、`instance_switched`。

### 6.3 InstanceInfo 格式

```json
{
  "id": "inst_1_xxx",
  "dir": "/home/user/project",
  "label": "my-project",
  "status": "running",
  "source": "local",
  "adapterId": "shell",
  "model": "deepseek-v4-flash",
  "blockCount": 15,
  "outputSize": 48291,
  "checkpointCount": 3,
  "agentVersion": "0.5.0",
  "createdAt": 1714512345678,
  "currentOperation": { "id": "op_1_xxx", "kind": "chat", "status": "running", ... },
  "operationCount": 5
}
```

### 6.4 实例管理 HTTP API

| HTTP 方法 | 路径 | 说明 |
|-----------|------|------|
| GET | `/api/instances` | 列出所有实例 |
| GET | `/api/instances/:id` | 获取单个实例详情 |
| GET | `/api/instances/:id/status` | 获取实例轻量状态 |
| POST | `/api/instances` | 创建新实例（不启动进程） |
| POST | `/api/instances/:id/command` | 向实例发送控制命令 |
| DELETE | `/api/instances/:id` | 删除实例 |
| GET | `/api/health` | 健康检查含完整状态 |
| GET | `/api/sessions` | 列出历史会话 |
| GET | `/api/sessions/search` | 搜索历史会话 |
| GET | `/api/sessions/detail` | 获取会话详细内容 |
| GET | `/api/sessions/current` | 获取当前会话内容 |

---

## 7. 操作状态机 (EventBus)

InstanceManager 内置操作状态机，通过 EventBus 发射事件。操作生命周期：`pending → running → succeeded / failed / cancelled`。

### 7.1 状态迁移

```
pending ──→ running ──→ succeeded
                      ├──→ failed
                      └──→ cancelled
cancelled ──→ pending  (可重试)
```

### 7.2 EventBus 事件

```json
// 操作开始
{ "type": "instance.operation.started", "instanceId": "inst_1_xxx", "operationId": "op_1_xxx", "kind": "chat", "command": "npm test" }

// 操作完成
{ "type": "instance.operation.completed", "instanceId": "inst_1_xxx", "operationId": "op_1_xxx", "kind": "chat", "status": "succeeded", "exitCode": 0, "result": "Tests passed" }
```

### 7.3 自动发射的 EventBus 事件

| 事件类型 | 说明 | 数据字段 |
|----------|------|---------|
| `instance.created` | 实例创建 | `nodeId`, `instanceId`, `label` |
| `instance.destroyed` | 实例销毁 | `nodeId`, `instanceId` |
| `instance.status` | 实例状态变更 | `nodeId`, `instanceId`, `status`, `previousStatus?` |
| `agent.connected` | Agent 连接 | `nodeId`, `instanceId`, `label`, `version` |
| `agent.disconnected` | Agent 断开 | `nodeId`, `instanceId`, `label` |
| `config.updated` | 配置更新 | `nodeId`, `key`, `value`, `source` |
| `task.progress` | 任务进度 | `nodeId`, `taskId`, `percent`, `message` |
| `audit.log` | 审计日志 | `nodeId`, `action`, `detail`, `timestamp` |

注意：EventBus 事件是内部组件通信机制，通常不直接通过 WebSocket 广播到前端。前端接收的是经过服务端逻辑转换后的 WebSocket 消息。

---

## 8. Shell 终端协议

SessionBridge 内置独立的 shell 终端，独立于 Claude 进程。Shell 实例可以是本地进程或远程 agent 上的进程。

### 8.1 Shell 生命周期

```json
// 客户端 → 服务器：创建 shell
{ "type": "shell.spawn", "instanceId": "inst_1_xxx" }

// 兼容旧名
{ "type": "shell_spawn", "instanceId": "inst_1_xxx" }
```

`shell.spawn` 会创建一个新的 shell 实例（本地运行 bash/powershell，远程通过 agent stdin 转发），并将该实例的所有权与 WebSocket 连接绑定。

### 8.2 数据通道

```json
// 客户端 → 服务器：发送输入
{ "type": "shell.input", "data": "ls -la\n", "instanceId": "inst_1_xxx" }

// 兼容旧名
{ "type": "shell_input", "data": "ls -la\n" }

// 客户端 → 服务器：调整终端尺寸
{ "type": "shell.resize", "cols": 120, "rows": 40 }
{ "type": "shell_resize", "cols": 120, "rows": 40 }

// 服务器 → 客户端：输出
{ "type": "shell.output", "data": "total 42\n", "stream": "stdout" }

// 服务器 → 客户端：stderr 输出
{ "type": "shell.output", "data": "error: ...\n", "stream": "stderr" }

// 服务器 → 客户端：shell 进程退出
{ "type": "shell.exit", "code": 0 }
```

### 8.3 Shell 写锁 (Write Lock)

Shell 输入受写锁保护，确保同一时刻只有一条 WebSocket 连接可以向指定实例的 shell 写入 stdin。

```json
// 客户端 → 服务器：获取写锁
{ "type": "shell.lock", "instanceId": "inst_1_xxx" }

// 客户端 → 服务器：释放写锁
{ "type": "shell.unlock", "instanceId": "inst_1_xxx" }

// 服务器 → 客户端：锁状态变更
{ "type": "shell.lock_status", "instanceId": "inst_1_xxx", "locked": true, "owner": "browser" }

// 锁已被其他浏览器占用时
{ "type": "shell.lock_status", "instanceId": "inst_1_xxx", "locked": true, "owner": "another-browser" }
```

**规则：**
- 锁是 per-instanceId 的，映射到 WebSocket 连接（`shellLockMap`）
- `shell.input` 在发送时若检测到当前连接不是锁持有者，则拒绝发送并返回 `shell.lock_status` 通知
- 首次输入会自动获取锁（无需先发 `shell.lock`）
- 连接断开时，所有该连接持有的锁自动释放，并广播 `lock_status: false`
- `shell.unlock` 显式释放锁

---

## 9. 远程 Agent 协议

远程 Agent（如家庭电脑）主动连接 VPS 中继服务器，实现跨网络代理。

### 9.1 Agent 生命周期

```json
// Agent → 服务器：注册
{
  "type": "agent.register",
  "dir": "/home/user/project",
  "label": "my-pc",
  "nodeId": "node_xxx"
}

// 兼容旧名
{ "type": "agent_register", "dir": "/home/user/project", "label": "my-pc" }

// 服务器 → Agent：注册成功
{ "type": "agent.registered", "instanceId": "inst_2_xxx", "sessionId": "inst_2_xxx" }

// Agent → 服务器：主动注销
{ "type": "agent.unregister", "instanceId": "inst_2_xxx" }
{ "type": "agent_unregister", "instanceId": "inst_2_xxx" }
```

Agent 断开 WebSocket 连接时自动注销（服务器检测到 `ws.on("close")` 且 `ws._isAgent` 为 true）。

注册时，服务器会进行版本兼容性检查（semver 感知）。主版本不匹配时发出错误通知，次版本不匹配时发出警告通知。

### 9.2 数据传输

```json
// Agent → 服务器：转发 stdout
{ "type": "agent.stdout", "instanceId": "inst_2_xxx", "line": "{\"type\":\"stream_event\",...}" }

// 兼容旧名
{ "type": "agent_stdout", "instanceId": "inst_2_xxx", "line": "..." }

// Agent → 服务器：转发 stderr
{ "type": "agent.stderr", "instanceId": "inst_2_xxx", "data": "..." }

// Agent → 服务器：发送通知（转发到浏览器）
{ "type": "agent.notification", "title": "Task completed", "detail": "...", "scenarioId": "task.done" }

// 服务器 → Agent：转发用户输入
{ "type": "agent.stdin", "instanceId": "inst_2_xxx", "data": "{\"type\":\"user\",...}\n" }

// 服务器 → Agent：控制请求
{ "type": "agent.control", "request_id": "rxxx", "request": { "subtype": "set_max_thinking_tokens", "maxThinkingTokens": 31999 } }
```

Agent stdout 的处理：
- 如果实例的 adapterId 为 `"shell"`，直接作为原始 shell 输出广播到所有浏览器
- 否则通过 `processStreamLine` 解析结构化 stream-json

### 9.3 远程子实例管理

Agent 可以在中继服务器上创建/销毁子实例（用于 `bridge run` 等场景）：

```json
// Agent → 服务器：创建子实例
{ "type": "agent.instance.spawn", "requestId": "req_xxx", "label": "Shell", "dir": "/home/user/project", "command": "npm test" }

// 服务器 → Agent：子实例创建成功
{ "type": "agent.instance.spawned", "requestId": "req_xxx", "instanceId": "inst_3_xxx" }

// Agent → 服务器：子实例退出
{ "type": "agent.instance.exit", "instanceId": "inst_3_xxx", "exitCode": 0 }
```

### 9.4 Agent 子实例 stdout/stderr

Agent 可以使用 `sendStdoutForInstance` 和 `sendStderrForInstance` 方法将输出定向到特定子实例：

```json
{ "type": "agent.stdout", "instanceId": "inst_3_xxx", "line": "..." }
{ "type": "agent.stderr", "instanceId": "inst_3_xxx", "data": "..." }
```

---

## 10. 配置推送 (Config Sync)

服务器可以向已连接的 Agent 推送配置变更。Agent 端接收后验证并应用。

### 10.1 协议消息

```json
// 服务器 → Agent：推送配置
{
  "type": "config.push",
  "entries": [
    { "key": "label", "value": "my-new-label" },
    { "key": "permissions", "value": { "Bash": "allow" } }
  ],
  "requestId": "cfg-1-1714512345678"
}

// Agent → 服务器：确认
{
  "type": "config.ack",
  "requestId": "cfg-1-1714512345678",
  "applied": ["label", "permissions"],
  "rejected": [
    { "key": "relayPort", "reason": "requires_restart" },
    { "key": "unknown_key", "reason": "unknown_key" }
  ]
}
```

### 10.2 校验规则

| 规则 | 行为 |
|------|------|
| 未知 key | 拒绝，reason: `"unknown_key"` |
| 需要重启的 key | 拒绝，reason: `"requires_restart"` |
| 已知可热更新的 key | 立即应用，调用 `applyFn` 回调 |

#### 已知配置键（14 个）

```
label, role, workingDirectory, relayPort, relayBind, relayToken,
upstreamRelay, dashboardPort, dashboardBind, adapters, permissions,
notificationSettings, ntfyTopic, logFile, pidFile
```

#### 需要重启的键（更改后必须重启进程）

```
role, relayPort, relayBind, dashboardPort, dashboardBind
```

### 10.3 服务端管理

`RelayConfigManager` 维护待发送的配置更改列表，通过 `set()` / `setBatch()` 添加，通过 `ack()` 移除已确认的条目。

### 10.4 Agent 端处理

`AgentConfigReceiver.apply()` 负责校验和应用。应用后：
- `NodeConfig` 对象原地更新
- `applyFn` 回调被调用
- EventBus 发射 `config.updated` 事件

---

## 11. 队列系统

队列是**源锁定**的：一旦消息从 "web" 或 "terminal" 进入，队列锁定为该源直到处理完成。

```json
// 服务器 → 客户端：队列状态变更
{ "type": "queue.status", "processing": true, "source": "web", "queueDepth": 2 }

// 兼容旧名
{ "type": "queue_status", "processing": true, "source": "web", "queueDepth": 0 }

// 服务器 → 客户端：队列被阻塞（另一源正在处理）
{ "type": "system.queue_blocked", "message": "Cannot send — web is currently processing. Wait or interrupt first.", "blockedSource": "terminal", "activeSource": "web" }
```

---

## 12. 系统消息

### 12.1 通知

```json
// 服务器 → 客户端：系统通知
{ "type": "system.notification", "type": "success", "title": "Agent connected", "detail": "Instance: inst_2_xxx" }

// 版本不匹配警告
{ "type": "system.notification", "type": "warning", "title": "Agent \"my-pc\" version mismatch", "detail": "... minor version difference ..." }

// 错误通知
{ "type": "system.notification", "type": "error", "title": "Agent \"my-pc\" version mismatch", "detail": "... major version difference ..." }
```

### 12.2 服务器关闭

```json
{ "type": "system.shutdown", "message": "Server is shutting down..." }
```

### 12.3 模式/力度变更广播

```json
{ "type": "system.mode_changed", "mode": "default", "effort": "medium" }
```

### 12.4 控制请求已发送

```json
{ "type": "instance.control_sent", "subtype": "set_max_thinking_tokens", "maxThinkingTokens": 31999, "instanceId": "inst_1_xxx" }

// 兼容旧名
{ "type": "claude.control_sent", "subtype": "set_permission_mode", "mode": "plan" }
```

### 12.5 错误通知

```json
{ "type": "error", "code": "NOT_FOUND", "message": "Instance xxx not found", "replyTo": "msg_xxx" }
{ "type": "error", "code": "UNAUTHORIZED", "message": "Invalid or missing token" }
{ "type": "error", "code": "INTERNAL_ERROR", "message": "Shell spawn failed: ..." }
```

### 12.6 TodoWrite 更新（待实现）

当 Claude 调用 `TodoWrite` 工具时，服务器广播 todo 列表更新：

```json
{ "type": "todos_updated", "instanceId": "inst_1_xxx", "todos": [
  { "content": "Set up project structure", "status": "in_progress", "activeForm": "Setting up project structure" },
  { "content": "Implement core logic", "status": "pending", "activeForm": "Implementing core logic" }
] }
```

### 12.7 Plan 模式问题（待实现）

当 Claude 调用 `EnterPlanMode` 工具时，服务器广播问题并等待用户选择：

```json
// 服务器 → 客户端
{ "type": "plan_question", "instanceId": "inst_1_xxx", "question": "Which testing framework should we use?", "options": [
  { "label": "Vitest (Recommended)", "description": "Fastest option, native ESM support" },
  { "label": "Jest", "description": "Most widely used, more community resources" }
], "toolUseId": "toolu_abc123" }

// 客户端 → 服务器：用户选择
{ "type": "plan_choice", "instanceId": "inst_1_xxx", "toolUseId": "toolu_abc123", "selected": "Vitest (Recommended)" }
```

---

## 13. 消息分类总表

| 类别 | 消息类型 | 方向 | 说明 |
|------|----------|------|------|
| **连接** | `hello` / `welcome` | 双向 | 标准握手 |
| 连接 | `auth` / `auth_result` | 双向 | 旧版令牌认证握手 |
| 连接 | `direct` / `workspace_connected` | 双向 | 旧版直连握手 |
| 连接 | `bye` | C→S | 优雅断开 |
| **心跳** | `ping` / `pong` | 双向 | 服务器每 30s 发送，客户端立即回复 |
| **数据** | `instance.input` / `input` | C→S | 用户文本输入 |
| 数据 | `instance.output` / `output` | S→C | 原始终端输出（含 ANSI 转义） |
| 数据 | `instance.block` / `block` | S→C | 结构化 block（thinking, tool_use, text 等） |
| 数据 | `instance.command_result` / `command_result` | S→C | 命令执行结果反馈 |
| 数据 | `instance.control_sent` / `claude.control_sent` | S→C | 控制请求已发送确认 |
| **命令** | `instance.command` / `command` | C→S | 框架级指令（switch, interrupt, clear 等） |
| **实例** | `instance.list` / `instance_list` | S→C | 实例列表 |
| 实例 | `instance.added` / `instance_added` | S→C | 新实例创建 |
| 实例 | `instance.removed` / `instance_removed` | S→C | 实例删除 |
| 实例 | `instance.switched` / `instance_switched` | S→C | 活动实例切换 |
| **会话** | `session.list_req` / `list_sessions` | C→S | 请求会话列表 |
| 会话 | `session.list` / `sessions_list` | S→C | 会话列表 |
| 会话 | `session.added` / `session_added` | S→C | 新会话 |
| 会话 | `session.removed` / `session_removed` | S→C | 会话移除 |
| **Agent** | `agent.register` / `agent_register` | C→S | Agent 注册 |
| Agent | `agent.registered` | S→C | Agent 注册成功 |
| Agent | `agent.unregister` / `agent_unregister` | C→S | Agent 注销 |
| Agent | `agent.stdout` / `agent_stdout` | C→S | 远程 stdout 转发 |
| Agent | `agent.stderr` / `agent_stderr` | C→S | 远程 stderr 转发 |
| Agent | `agent.stdin` | S→C | 用户输入转发到远程 |
| Agent | `agent.control` | S→C | 控制请求转发到远程 |
| Agent | `agent.notification` / `agent_notification` | C→S | Agent 通知转发 |
| Agent | `agent.instance.spawn` | C→S | Agent 请求创建子实例 |
| Agent | `agent.instance.spawned` | S→C | 子实例创建成功 |
| Agent | `agent.instance.exit` | C→S | 子实例退出通知 |
| **Shell** | `shell.spawn` / `shell_spawn` | C→S | 创建 shell 实例 |
| Shell | `shell.input` / `shell_input` | C→S | Shell 输入 |
| Shell | `shell.resize` / `shell_resize` | C→S | 终端尺寸调整 |
| Shell | `shell.output` | S→C | Shell 输出（stdout/stderr） |
| Shell | `shell.exit` | S→C | Shell 进程退出 |
| Shell | `shell.lock` | C→S | 获取 shell 写锁 |
| Shell | `shell.unlock` | C→S | 释放 shell 写锁 |
| Shell | `shell.lock_status` | S→C | 写锁状态通知 |
| **配置** | `config.push` | S→C | 配置推送 |
| 配置 | `config.ack` | C→S | 配置确认 |
| **队列** | `queue.status` / `queue_status` | S→C | 队列状态变更 |
| 队列 | `system.queue_blocked` | S→C | 队列被阻塞 |
| **系统** | `system.notification` | S→C | 系统通知（成功/警告/错误） |
| 系统 | `system.shutdown` | S→C | 服务器关闭通知 |
| 系统 | `system.mode_changed` | S→C | 权限模式/思考力度变更 |
| 系统 | `todos_updated` | S→C | TodoWrite 检测更新（待实现） |
| 系统 | `plan_question` | S→C | Plan 模式问题（待实现） |
| 系统 | `plan_choice` | C→S | 用户 Plan 选择（待实现） |
| 系统 | `error` | S→C | 错误通知 |
| **EventBus** | `instance.operation.started` | 内部 | 操作状态机 - 开始 |
| EventBus | `instance.operation.completed` | 内部 | 操作状态机 - 完成 |
| EventBus | `instance.created` | 内部 | 实例创建 |
| EventBus | `instance.destroyed` | 内部 | 实例销毁 |
| EventBus | `instance.status` | 内部 | 实例状态变更 |
| EventBus | `agent.connected` | 内部 | Agent 连接 |
| EventBus | `agent.disconnected` | 内部 | Agent 断开 |
| EventBus | `config.updated` | 内部 | 配置更新 |
| EventBus | `task.progress` | 内部 | 任务进度 |
| EventBus | `audit.log` | 内部 | 审计日志 |

> 注：EventBus 事件是内部组件间通信机制（通过 `RelayEventBus.emit()`），不直接通过 WebSocket 发送到前端。上表将其列出以体现完整的协议架构。

---

## 14. 生命周期图示

```
浏览器                    Relay 服务器                    Agent (远程)
  │                          │                              │
  │══ WebSocket 连接 ═══════▶│                              │
  │══ hello + crypto keys ══▶│                              │
  │◀══ welcome + crypto keys │                              │
  │   (ECDH → session key)   │                              │
  │                          │◀══ WebSocket 连接 ═══════════│
  │                          │◀══ hello + crypto keys +     │
  │                          │    agent.register ═══════════│
  │                          │══ agent.registered ═════════▶│
  │                          │   (ECDH → session key)       │
  │                          │                              │
  │══ instance.input ═══════▶│                              │
  │     (AES-256-GCM)        │══ 透传(不解密) agent.stdin ═▶│
  │                          │◀══ agent.stdout ═════════════│
  │◀══ instance.output ═════│                              │
  │◀══ instance.block ══════│                              │
  │                          │                              │
  │══ command (interrupt) ══▶│                              │
  │                          │══ 透传 agent.control ═══════▶│
  │                          │                              │
  │══ 断开 ═════════════════▶│                              │
  │                          │◀══ 断开 ═════════════════════│
  │                          │                              │
  │ Legend:                    │                              │
  │ ══ 加密通道 (AES-256-GCM)  │                              │
  │ ── 明文通道 (旧客户端/旧版) │                              │
```

## 15. 附录：协议演变历史

| 版本 | 变更 |
|------|------|
| v0.1 | 基础 WebSocket 通信，`auth`/`auth_result`，`claude.input`/`claude.output` |
| v0.2 | 引入 `hello`/`welcome` 标准握手，`claude.block` 结构化消息 |
| v0.3 | 多实例支持，`instance.*` 消息族，`command` 框架指令 |
| v0.4 | Shell 终端协议（`shell.spawn`/`shell.input`/`shell.output`），Agent 注册协议 |
| v0.5 | 队列系统（`queue.status`/`system.queue_blocked`），v1 信封格式规范化，chunked 传输 |
| v0.6 | Shell 写锁（`shell.lock`/`shell.unlock`），配置推送（`config.push`/`config.ack`），会话恢复，EventBus 操作状态机，Agent 子实例管理 |
| v0.7 (规划) | AES-256-GCM 加密层, 加密握手 (ECDH + HKDF), 加密/非加密客户端共存, Flutter APK |
