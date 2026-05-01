# SessionBridge — WebSocket 通信协议

所有消息均为 JSON 格式，WebSocket 传输。

---

## 1. 连接阶段

### 客户端 → 服务器

```json
// token 认证（远程模式）
{ "type": "auth", "token": "..." }

// 直连模式（无 token，本地局域网）
{ "type": "direct", "workspace": false, "cols": 120, "rows": 40 }
```

### 服务器 → 客户端

```json
{ "type": "auth_result", "success": true, "sessionId": "inst_1_xxx" }

// 工作区模式连接成功
{ "type": "workspace_connected" }
```

---

## 2. 数据传输

### 客户端 → 服务器

```json
// 输入（多行文本/命令）
{ "type": "input", "data": "npm test\n", "sessionId": "...", "instanceId": "..." }

// 调整终端尺寸
{ "type": "resize", "cols": 120, "rows": 40 }

// 发送命令（非 Claude 指令，框架内部命令）
{ "type": "command", "name": "switch-instance", "args": { "instanceId": "..." } }
```

### 服务器 → 客户端

```json
// 原始终端输出
{ "type": "output", "data": "[32mHello[0m\n" }

// 结构化 block（解析后的 Claude 消息）
{
  "type": "block",
  "blockType": "tool_use",
  "name": "Bash",
  "input": { "command": "npm test" },
  "text": "",
  "sessionId": "...",
  "instanceId": "..."
}

// 命令执行结果
{ "type": "command_result", "name": "switch-instance", "success": true, "data": {} }

// 队列状态
{ "type": "queue_status", "processing": true, "source": "user", "queueDepth": 2 }

// 错误
{ "type": "error", "message": "..." }
```

### Block 类型

Block 是服务器对 Claude stream-json 输出的结构化解析结果。

| blockType | 说明 | 关键字段 |
|-----------|------|---------|
| `thinking` | 模型思考过程 | `text` |
| `tool_use` | 工具调用 | `name`, `input` |
| `tool_result` | 工具执行结果 | `text`, `isError` |
| `text` | 文本回复 | `text` |
| `status` | 状态信息 | `text` |

---

## 3. 实例管理

### 客户端请求

```json
{ "type": "command", "name": "switch-instance", "args": { "instanceId": "inst_1_xxx" } }
{ "type": "command", "name": "list-instances" }
```

### 服务器推送

```json
// 实例列表（初始 / 刷新）
{ "type": "instance_list", "instances": [...], "activeId": "inst_1_xxx" }

// 新实例创建
{ "type": "instance_added", "instance": { "id": "...", "dir": "...", ... } }

// 实例被删除
{ "type": "instance_removed", "instanceId": "inst_1_xxx" }

// 活动实例切换
{ "type": "instance_switched", "instanceId": "inst_2_xxx" }
```

### InstanceInfo 格式

```json
{
  "id": "inst_1_xxx",
  "dir": "/home/user/project",
  "label": "my-project",
  "status": "running",
  "model": "deepseek-v4-flash",
  "blockCount": 15,
  "outputSize": 48291,
  "checkpointCount": 3,
  "createdAt": 1714512345678
}
```

---

## 4. 工作区模式

### 服务器 → 客户端

```json
// 会话列表
{ "type": "sessions_list", "sessions": [...] }

// 新会话加入
{ "type": "session_added", "id": "...", "directory": "...", ... }

// 会话移除
{ "type": "session_removed", "sessionId": "..." }
```

### SessionInfo 格式

```json
{
  "id": "...",
  "directory": "/home/user/project",
  "label": "project",
  "hasBridge": true,
  "hasClient": false,
  "webUrl": "http://..."
}
```

---

## 5. 生命周期

```
浏览器                    relay 服务器
  │                          │
  │── WebSocket 连接 ───────→│
  │── auth/direct ──────────→│
  │←─ auth_result/workspace ─│
  │                          │
  │── input ────────────────→│── stdin ──→ Claude 进程
  │←─ output ◀──────────────│←─ stdout ◀─
  │←─ block ◀───────────────│
  │                          │
  │── command ──────────────→│
  │←─ command_result ◀──────│
  │                          │
  │── 断开 ─────────────────→│── kill → Claude 进程
```

## 6. 消息分类

| 类别 | 消息类型 | 说明 |
|------|----------|------|
| 连接 | auth, direct, auth_result, workspace_connected | 连接生命周期 |
| 数据 | input, output | 流式持续传输 |
| 结构化 | block | 解析后的 Claude 输出 |
| 控制 | command, command_result | 框架指令（非 Claude） |
| 状态 | queue_status, error | 运行状态通知 |
| 实例 | instance_list, instance_added, instance_removed, instance_switched | 实例 CRUD |
| 工作区 | sessions_list, session_added, session_removed | 多会话管理 |
