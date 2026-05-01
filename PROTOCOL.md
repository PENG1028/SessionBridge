# SessionBridge Protocol v1

## 1. 消息信封

所有消息（WebSocket text frame）统一包一层信封：

```json
{
  "v": 1,
  "id": "msg_abc123",
  "ts": 1714512345678,
  "type": "...",
  "body": { }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `v` | number | 是 | 协议版本，当前为 1 |
| `id` | string | 否 | 消息 ID，请求-响应配对时必填 |
| `ts` | number | 否 | 发送方时间戳（ms） |
| `type` | string | 是 | 消息类型（见下方分类） |
| `body` | object | 是 | 具体消息内容 |

- 对方收到 `id` 时，如果需要回复，在回复中带 `replyTo: <原id>`
- 不认识的 `type` 直接静默丢弃（向前兼容）

---

## 2. 连接生命周期

### 2.1 能力协商（连接建立后立即）

**Browser → Relay / Agent → Relay:**

```json
{
  "v": 1,
  "type": "hello",
  "body": {
    "role": "browser",
    "version": "0.5.0",
    "features": ["shell", "instance_list", "queue_status"]
  }
}
```

`role`: `"browser"` | `"agent"`

**Relay → Browser / Relay → Agent:**

```json
{
  "v": 1,
  "type": "welcome",
  "body": {
    "version": "0.5.0",
    "features": ["agent_registration", "shell", "multi_instance"],
    "sessionId": "sess_xxx",
    "serverTime": 1714512345678
  }
}
```

### 2.2 心跳

**Relay → Peer** (every 30s):

```json
{ "v": 1, "type": "ping", "body": {} }
```

**Peer → Relay:**

```json
{ "v": 1, "type": "pong", "body": {} }
```

60s 内无响应判定断开。

---

## 3. 消息分类

### 3.1 控制类 (Control)

| type | 方向 | body | 说明 |
|---|---|---|---|
| `hello` | C→S, A→S | `{role, version, features}` | 连接建立后立即发送 |
| `welcome` | S→C, S→A | `{version, features, sessionId, serverTime}` | 服务端确认 |
| `ping` / `pong` | S→C, S→A | `{}` | 心跳 |
| `error` | 任意方向 | `{code, message, replyTo?}` | 结构化错误 |
| `bye` | 任意方向 | `{reason?}` | 优雅关闭 |

**错误码：**

| code | 含义 |
|---|---|
| `UNKNOWN_TYPE` | 不认识的消息类型 |
| `BAD_REQUEST` | 消息格式错误 |
| `UNAUTHORIZED` | 未认证/认证失败 |
| `NOT_FOUND` | 实例或会话不存在 |
| `INTERNAL_ERROR` | 服务内部错误 |
| `FEATURE_NOT_SUPPORTED` | 对方不支持此功能 |

---

### 3.2 Agent 生命周期 (Agent Lifecycle)

Agent（受控端）专用，role=agent：

| type | 方向 | body | 说明 |
|---|---|---|---|
| `agent.register` | A→S | `{dir, label?, features?}` | 注册为受控端实例 |
| `agent.registered` | S→A | `{instanceId}` | 注册成功确认 |
| `agent.unregister` | A→S | `{instanceId, reason?}` | 主动注销 |
| `agent.unregistered` | S→A | `{instanceId}` | 注销确认 |

---

### 3.3 Claude 数据流 (Claude Data)

| type | 方向 | body | 说明 |
|---|---|---|---|
| `claude.output` | S→C | `{data, instanceId?}` | Claude stdout（转发到浏览器） |
| `claude.stderr` | S→C | `{data, instanceId?}` | Claude stderr |
| `claude.block` | S→C | `{blockType, ...blockData, instanceId?}` | 结构化 block（text/thinking/tool_use） |
| `claude.input` | C→S | `{data, sessionId?, instanceId?}` | 用户输入转发给 Claude |
| `claude.command` | C→S | `{name, args?, instanceId?}` | 控制命令 |

Agent 方向：

| type | 方向 | body | 说明 |
|---|---|---|---|
| `agent.stdout` | A→S | `{instanceId, line}` | Agent 端 Claude 的 stdout（逐行） |
| `agent.stderr` | A→S | `{instanceId, data}` | Agent 端 Claude 的 stderr |
| `agent.stdin` | S→A | `{instanceId, data}` | 转发输入到 Agent 端 Claude |
| `agent.control` | S→A | `{instanceId, request}` | 转发控制请求到 Agent 端 Claude |

---

### 3.4 Shell 终端 (Shell Terminal)

| type | 方向 | body | 说明 |
|---|---|---|---|
| `shell.spawn` | C→S | `{instanceId?, sessionId?}` | 在目标上启动 OS shell |
| `shell.input` | C→S | `{data, instanceId?}` | 键盘输入到 shell stdin |
| `shell.resize` | C→S | `{cols, rows, instanceId?}` | 终端 resize |
| `shell.output` | S→C | `{data, stream}` | shell stdout/stderr |
| `shell.exit` | S→C | `{code}` | shell 进程退出 |

`stream`: `"stdout"` | `"stderr"`

Shell 位置通过 `instanceId` 控制：
- 无 `instanceId` → relay 本地 shell
- 有 `instanceId` 且是 agent → 转发到 agent 再 spawn（未来扩展）

---

### 3.5 实例管理 (Instance Management)

| type | 方向 | body | 说明 |
|---|---|---|---|
| `instance.list` | S→C | `{instances, activeId}` | 实例列表 |
| `instance.added` | S→C | `{instance}` | 新实例上线 |
| `instance.removed` | S→C | `{instanceId}` | 实例下线 |
| `instance.switched` | S→C | `{instanceId}` | 活跃实例切换 |
| `instance.switch` | C→S | `{instanceId}` | 请求切换实例 |

---

### 3.6 会话管理 (Session Management)

| type | 方向 | body | 说明 |
|---|---|---|---|
| `session.list` | S→C | `{sessions}` | 会话列表 |
| `session.added` | S→C | `{...sessionInfo}` | 新会话 |
| `session.removed` | S→C | `{sessionId}` | 会话关闭 |
| `session.list_req` | C→S | `{}` | 请求会话列表 |

---

## 4. 连接模型

```
Browser ←──→ Relay ←──→ Agent
   │                      │
   ├─ hello/welcome       ├─ hello/welcome
   ├─ claude.input        ├─ agent.stdout/stderr
   ├─ claude.output       ├─ agent.register
   ├─ shell.spawn/input   └─ (未来: shell 转发)
   └─ instance.*
```

一条 WS 承载所有流量，通过 `type` 命名空间区分。

## 5. 兼容性规则

1. 发送方只发 `hello.features` 中对方确认支持的类型
2. 不认识的 `type` 静默丢弃
3. 新增功能只需在 `features` 数组中加新字符串
4. `v` 只在破坏性变更时递增
