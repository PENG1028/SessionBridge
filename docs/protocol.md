# SessionBridge — WebSocket 通信协议

所有消息均为 JSON 格式，WebSocket 传输。

---

## 1. 消息信封 (v1 Envelope)

所有消息使用统一信封格式（定义在 [`src/protocol.ts`](../src/protocol.ts)）：

```json
{
  "v": 1,
  "id": "msg_xxx",
  "ts": 1714512345678,
  "type": "消息类型",
  "body": { }
}
```

- `v`: 协议版本，固定为 1
- `id`: 可选，消息 ID
- `ts`: 时间戳
- `type`: 消息类型
- `body`: 消息体

向后兼容：服务器同时接受旧版扁平格式（无 envelope），解析时自动将 body 字段提升到顶层。

---

## 2. 连接阶段

### 握手（当前协议）

客户端连接后发送 `hello`，服务器回复 `welcome`：

```json
// 客户端 → 服务器
{ "type": "hello", "role": "browser", "version": "0.5.0" }
```

```json
// 服务器 → 客户端
{
  "type": "welcome",
  "version": "0.5.0",
  "features": ["agent_registration", "shell", "multi_instance", "claude_chat", "queue"],
  "sessionId": "inst_1_xxx",
  "serverTime": 1714512345678,
  "instances": [ ... ]
}
```

### 兼容握手（旧版）

直连模式（本地局域网）：
```json
{ "type": "direct", "workspace": false, "cols": 120, "rows": 40 }
```

令牌认证（远程模式）：
```json
{ "type": "auth", "token": "..." }
```

服务器回复：
```json
{ "type": "auth_result", "success": true, "sessionId": "inst_1_xxx", "instances": [...] }
```

---

## 3. 心跳

服务器每 30 秒发送 ping，客户端需回复 pong：

```json
// 服务器 → 客户端
{ "v":1, "ts":..., "type": "ping", "body": {} }
// 客户端 → 服务器
{ "v":1, "ts":..., "type": "pong", "body": {} }
```

若客户端连续两个 ping 未回复 pong，服务器断开连接。

---

## 4. 数据传输

### 客户端 → 服务器

```json
// Claude 输入（多行文本/命令）
{ "type": "claude.input", "data": "npm test\n", "instanceId": "..." }

// command 兼容名
{ "type": "input", "data": "npm test\n", "instanceId": "..." }

// 框架命令（非 Claude 指令）
{ "type": "claude.command", "name": "switch-instance", "args": { "instanceId": "..." }, "instanceId": "..." }

// command 兼容名
{ "type": "command", "name": "...", "args": {...}, "instanceId": "..." }
```

### 服务器 → 客户端（原始输出）

```json
{ "type": "claude.output", "data": "[32mHello[0m\n" }
```

### 服务器 → 客户端（结构化 block）

所有 block 通过 `claude.block` 消息传输：

```json
{
  "type": "claude.block",
  "blockType": "tool_use",
  "name": "Bash",
  "input": { "command": "npm test" },
  "text": "",
  "ts": 1714512345678
}
```

### Block 类型

| blockType | 说明 | 关键字段 |
|-----------|------|---------|
| `thinking` | 模型思考过程 | `text`, `status` (running/done) |
| `tool_use` | 工具调用 | `name`, `input`/`args`, `status` (running/done), `result` |
| `tool_progress` | 工具执行进度 | `toolUseId`, `innerToolUseId`, `progress` |
| `text` | 文本回复 | `text` |
| `status` | 状态信息 | `text` |
| `user` | 用户消息回显 | `text` |
| `token_usage` | token 用量 | `cost`, `tokens`, `model` |
| `done` | 本轮结束 | `text` |
| `error` | 错误 | `text` |
| `task_started` | 后台任务开始 | `taskId`, `taskType`, `description`, `prompt` |
| `task_progress` | 后台任务进度 | `taskId`, `description`, `lastToolName`, `usage`, `summary` |
| `task_notification` | 后台任务通知 | `taskId` |

---

## 5. 实例管理

### 客户端请求

```json
{ "type": "command", "name": "switch-instance", "args": { "instanceId": "inst_1_xxx" } }
{ "type": "command", "name": "list-instances" }
```

### 服务器推送

```json
// 实例列表（响应 list-instances 命令）
{ "type": "instance.list", "instances": [...], "activeId": "inst_1_xxx" }

// 新实例创建
{ "type": "instance.added", "instance": { "id": "...", "dir": "...", ... } }

// 实例被删除
{ "type": "instance.removed", "instanceId": "inst_1_xxx" }

// 活动实例切换
{ "type": "instance.switched", "instanceId": "inst_2_xxx" }
```

### InstanceInfo 格式

```json
{
  "id": "inst_1_xxx",
  "dir": "/home/user/project",
  "label": "my-project",
  "status": "running",
  "source": "local",
  "model": "deepseek-v4-flash",
  "blockCount": 15,
  "outputSize": 48291,
  "checkpointCount": 3,
  "createdAt": 1714512345678
}
```

### 实例管理 API

| HTTP 方法 | 路径 | 说明 |
|-----------|------|------|
| GET  | `/api/instances` | 列出所有实例 |
| POST | `/api/instances` | 创建新实例 |
| DELETE | `/api/instances/:id` | 删除实例 |
| POST | `/api/instances/:id/activate` | 切换到指定实例 |

---

## 6. 队列状态

### 服务器推送

```json
// 队列状态变更
{ "type": "queue.status", "processing": true, "source": "web", "queueDepth": 2 }

// 队列被阻塞（其他 source 正在处理）
{ "type": "system.queue_blocked", "message": "...", "blockedSource": "terminal", "activeSource": "web" }
```

队列是**源锁定**的：一旦消息从 "web" 或 "terminal" 进入，队列锁定为该源，另一源发消息会被拒绝并广播 `queue_blocked`。

---

## 7. 框架控制命令

通过 `command` 消息发送的框架级指令（不传给 Claude）：

| name | 参数 | 说明 |
|------|------|------|
| `clear` | `model?` | 清空会话，可选切换模型 |
| `restart` | `model?` | 同 clear |
| `interrupt` | — | 中断当前操作并自动回滚文件变更 |
| `rewind` | — | 回滚上一个 checkpoint |
| `rewind-all` | — | 回滚当前 turn 的所有 checkpoint |
| `setMode` | `mode` | 设置权限模式 (`default`/`acceptEdits`/`plan`) |
| `setEffort` | `level` | 设置思考力度 (`low`/`medium`/`high`) |
| `switch-instance` | `instanceId` | 切换到指定实例 |
| `list-instances` | — | 获取实例列表 |

### 模式/力度变更广播

```json
{ "type": "system.mode_changed", "mode": "default", "effort": "medium" }
```

---

## 8. 远程 Agent

远程 agent（家里电脑）主动连接 VPS 中继服务器。

### Agent 注册

```json
// Agent → 服务器
{ "type": "agent.register", "dir": "/home/user/project", "label": "my-pc" }

// 兼容名
{ "type": "agent_register", "dir": "/home/user/project", "label": "my-pc" }
```

```json
// 服务器 → Agent
{ "type": "agent.registered", "instanceId": "inst_2_xxx", "sessionId": "inst_2_xxx" }
```

### Agent 注销

```json
{ "type": "agent.unregister", "instanceId": "inst_2_xxx" }
{ "type": "agent_unregister", "instanceId": "inst_2_xxx" }
```

### Agent 数据中继

Agent 将本地 Claude 的 stdout 逐行转发给服务器：

```json
{ "type": "agent.stdout", "instanceId": "inst_2_xxx", "line": "{\"type\":\"stream_event\",...}" }
{ "type": "agent_stdout", "instanceId": "inst_2_xxx", "line": "..." }
```

Agent 将 stderr 转发：

```json
{ "type": "agent.stderr", "instanceId": "inst_2_xxx", "data": "..." }
{ "type": "agent_stderr", "instanceId": "inst_2_xxx", "data": "..." }
```

服务器向 Agent 转发用户输入：

```json
// 服务器 → Agent
{ "type": "agent.stdin", "instanceId": "inst_2_xxx", "data": "{\"type\":\"user\",...}\n" }
```

---

## 9. Shell 终端

SessionBridge 内置独立的 shell 终端（独立于 Claude 进程）。

```json
// 创建 shell
{ "type": "shell.spawn" }

// 发送输入
{ "type": "shell.input", "data": "ls -la\n" }

// 调整尺寸
{ "type": "shell.resize", "cols": 120, "rows": 40 }
```

```json
// 服务器 → 客户端: 输出
{ "type": "shell.output", "data": "...", "stream": "stdout" }

// 服务器 → 客户端: 退出
{ "type": "shell.exit", "code": 0 }
```

---

## 10. 系统消息

```json
// 控制请求已发送（claude.control_sent）
{ "type": "claude.control_sent", "subtype": "set_max_thinking_tokens", "maxThinkingTokens": 31999, "requestId": "rxxx" }

// 服务器关闭
{ "type": "system.shutdown", "message": "Server is shutting down..." }

// 错误
{ "type": "error", "code": "NOT_FOUND", "message": "Instance xxx not found" }
```

---

## 11. 消息分类总表

| 类别 | 消息类型 | 方向 | 说明 |
|------|----------|------|------|
| 连接 | hello, welcome | 双向 | 握手（当前协议） |
| 连接 | auth, direct, auth_result | 双向 | 握手（兼容旧版） |
| 心跳 | ping, pong | 双向 | 每 30s |
| 数据 | claude.input (input) | C→S | 用户输入 |
| 数据 | claude.output | S→C | 原始终端输出 |
| 数据 | claude.block | S→C | 结构化 block |
| 控制 | claude.command (command) | C→S | 框架指令 |
| 控制 | claude.control_sent | S→C | 控制请求已发送 |
| 状态 | queue.status | S→C | 队列状态 |
| 状态 | system.queue_blocked | S→C | 队列阻塞 |
| 状态 | system.mode_changed | S→C | 模式/力度变更 |
| 状态 | system.shutdown | S→C | 服务器关闭 |
| 实例 | instance.list / .added / .removed / .switched | S→C | 实例生命周期 |
| Agent | agent.register, agent.registered | 双向 | Agent 注册 |
| Agent | agent.unregister, agent.stdout, agent.stderr, agent.stdin | 双向 | Agent 数据传输 |
| Shell | shell.spawn, shell.input, shell.resize, shell.output, shell.exit | 双向 | 独立终端 |
| 错误 | error | S→C | 错误通知 |

---

## 12. 生命周期

```
浏览器                    relay 服务器
  │                          │
  │── WebSocket 连接 ───────→│
  │── hello ────────────────→│── spawn Claude ──→ Claude 进程
  │←─ welcome ──────────────│
  │                          │
  │── claude.input ─────────→│── stdin ──────────→ Claude 进程
  │←─ claude.block ◀────────│←─ stdout ◀─────────
  │←─ claude.output ◀───────│
  │                          │
  │── command (interrupt) ──→│── SIGINT ─────────→ Claude 进程
  │                          │
  │── 断开 ─────────────────→│── kill ───────────→ Claude 进程
```
