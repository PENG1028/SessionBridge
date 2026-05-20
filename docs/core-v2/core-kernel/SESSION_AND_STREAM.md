# SessionNode v2 — Session 与 Stream 设计

> Session 是长期运行对象的事实来源。Stream 是 Session 的数据通道。
> 配套文档：ARCHITECTURE.md、CORE_PROTOCOL.md、PERMISSIONS.md、UX_SURFACES.md

---

## 目录

1. [核心概念](#一核心概念)
2. [Session 生命周期](#二session-生命周期)
3. [Session 类型](#三session-类型)
4. [Stream 模型](#四stream-模型)
5. [Event 系统](#五event-系统)
6. [Event Replay](#六event-replay)
7. [多浏览器订阅](#七多浏览器订阅)
8. [持久化](#八持久化)
9. [Session 恢复流程](#九session-恢复流程)
10. [ClaudeCode 工作流示例](#十claudecode-工作流示例)
11. [防回退规则](#十一防回退规则)

---

## 一、核心概念

### 定义

```
Session = Go Core 管理的长期运行实体
  - 一个 session = 一个进程（shell, claude, 或其他）
  - 有唯一的 sessionId
  - 有 event log（eventSeq 单调递增）
  - 有自己的数据目录（持久化）

Stream = Session 的数据通道
  - stdin: 输入到进程
  - stdout: 进程的标准输出
  - stderr: 进程的错误输出
  - event: 进程/系统事件
  - control: resize, signal 等控制消息

Tab/View = 前端对 Session 的投影
  - 一个 session 可以有多个 tab（多浏览器）
  - 一个 tab 只投影一个 session
  - Tab 不拥有 session 状态
  - Tab 可以关闭而不影响 session
```

### 概念关系图

```
┌──────────────────────────────────────────────────────────┐
│                         Go Core                           │
│                                                           │
│  ┌──────────────────────────────────────────────────┐     │
│  │              Session Manager                       │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │     │
│  │  │ sess_abc  │  │ sess_def  │  │ sess_ghi  │       │     │
│  │  │           │  │           │  │           │       │     │
│  │  │ process   │  │ process   │  │ process   │       │     │
│  │  │   │       │  │   │       │  │   │       │       │     │
│  │  │ stdin     │  │ stdin     │  │ stdin     │       │     │
│  │  │ stdout    │  │ stdout    │  │ stdout    │       │     │
│  │  │ stderr    │  │ stderr    │  │ stderr    │       │     │
│  │  │ events[]  │  │ events[]  │  │ events[]  │       │     │
│  │  └──────────┘  └──────────┘  └──────────┘        │     │
│  └──────────────────────────────────────────────────┘     │
│                                                           │
│  Event Log: ~/.sessionnode/sessions/                      │
│    sess_abc/meta.json                                     │
│    sess_abc/events.jsonl  ← eventSeq 1, 2, 3...          │
│    sess_abc/stdout.log    ← 原始输出                       │
│    sess_abc/stderr.log    ← 原始错误输出                   │
└──────────────────────────────────────────────────────────┘
         │
         │ WebSocket streams
         ▼
┌──────────────────────────────────────────────────────────┐
│                     Web UI (System UI + Plugin)            │
│                                                           │
│  Browser A                    Browser B                    │
│  ┌──────────────┐             ┌──────────────┐            │
│  │ Tab: sess_abc│             │ Tab: sess_abc│            │
│  │ (投影)       │             │ (投影)       │            │
│  │ stdout       │             │ stdout       │            │
│  └──────────────┘             └──────────────┘            │
└──────────────────────────────────────────────────────────┘
```

### 禁止

```
Tab = 纯 UI 投影
Tab 不是 session 的"所有者"
关闭 tab ≠ 停止 session
刷新浏览器后通过 session list 重建 tab
localStorage 不能保存 session 真相
```

---

## 二、Session 生命周期

### 状态机

```
                    ┌──────────┐
                    │ 创建请求  │
                    └────┬─────┘
                         │ session.create
                         ▼
                    ┌──────────┐
              ┌────▶│ creating │◀────┐
              │     └────┬─────┘     │
              │          │           │
              │     ┌────▼─────┐     │
              │     │ running  │─────┤── session.event (stdout)
              │     └────┬─────┘     │
              │          │           │
              │     ┌────▼─────┐     │
              │     │ stopping │     │
              │     └────┬─────┘     │
              │          │           │
              │     ┌────▼─────┐     │
              │     │ stopped  │─────┘
              │     └──────────┘
              │
              │     ┌──────────┐
              └────▶│ failed   │
                    └──────────┘
```

### 状态说明

| 状态 | 含义 | 是否持久化 | 是否可恢复 |
|------|------|-----------|-----------|
| `creating` | 正在创建（进程启动中） | 否 | 否 |
| `running` | 正常运行 | 是 | 刷新后可见 |
| `stopping` | 正在停止 | 否 | 否 |
| `stopped` | 已正常停止 | 是（有限时间） | 否 |
| `failed` | 启动失败或异常退出 | 是（有限时间） | 否 |

### 创建过程

```
1. 插件调 session.create
   → { kind, command, args, cwd, env }

2. Core 验证：
   - 插件有 session.create 权限
   - command 在 allow list 中
   - cwd 存在（可选）
   - 参数合法

3. Core 创建 Session 对象：
   - sessionId = 生成唯一 ID
   - 创建数据目录 ~/.sessionnode/sessions/sess_xxx/
   - 创建 streams（stdin/stdout/stderr/event）
   - 分配 streamIds
   - 状态 → creating

4. Core 启动进程：
   - spawn process（或 pty）
   - 连接 stdin/stdout/stderr 到 streams
   - 状态 → running

5. Core 返回 session.created：
   → { sessionId, streamIds }
   → eventSeq: 1: "session.created"
```

### 停止过程

```
1. 插件调 session.stop
   → { sessionId }

2. Core 验证：
   - 插件有 session.stop 权限
   - session 存在且 running

3. Core 开始停止：
   - 发送信号（SIGTERM → 超时 → SIGKILL）
   - 关闭 streams
   - 状态 → stopping

4. 进程退出：
   - 记录 exitCode
   - 状态 → stopped
   - eventSeq: N: "session.stopped"

5. 广播 session.stopped 事件

6. 保留 session 数据一段时间（可配置，默认 1 小时）
```

### Session 清理

```
Core 启动时扫描 sessions/ 目录：
  - running sessions → 停止（上次 crash 残留）
  - stopped sessions → 保留（可配置保留时间，默认 1 小时）
  - 超期 stopped → 删除目录

Core 运行时定期清理：
  - 停超过 N 小时的 session → 删除数据目录
  - 保留至少最近 100 条 event log
```

---

## 三、Session 类型

### Process Session

最核心的类型。创建一个后台进程，连接其 stdio。

```json
{
  "type": "session.create",
  "pluginId": "shell",
  "payload": {
    "kind": "process",
    "command": "bash",
    "args": [],
    "cwd": "/home/user",
    "env": {
      "TERM": "xterm-256color"
    },
    "pty": true,
    "rows": 24,
    "cols": 80
  }
}
```

特点：
- 一个 session 对应一个进程
- stdout/stderr 实时流式传输
- stdin 支持写
- pty 支持 resize
- 进程退出后 session 自动 stopped

### Shell Session

一种特殊的 process session，用于交互式 shell。

```json
{
  "type": "session.create",
  "pluginId": "shell",
  "payload": {
    "kind": "shell",
    "command": "bash",       // 或 zsh, powershell
    "cwd": "/home/user",
    "pty": true,
    "rows": 24,
    "cols": 80
  }
}
```

与 process session 的区别：
- 总是用 pty
- 默认不退出（除非 exit 或 Ctrl+D）
- 显示 login shell 提示

### Agent Session

用于 AI agent 类型的长时间任务。目前主要是 ClaudeCode。

```json
{
  "type": "session.create",
  "pluginId": "claude-code",
  "payload": {
    "kind": "agent",
    "command": "claude",
    "args": ["--output-format", "stream-json"],
    "cwd": "/repo",
    "env": {
      "CLAUDE_MODEL": "sonnet"
    }
  }
}
```

特点：
- 与 process session 相同的基础架构
- 输出是 stream-json 格式（由 TS 插件解析）
- 支持 approval 请求/响应
- TS 插件订阅并解析流

### Task Session

未来可能支持的定时/后台任务。

```json
{
  "type": "session.create",
  "pluginId": "scheduler",
  "payload": {
    "kind": "task",
    "command": "node",
    "args": ["/scripts/backup.js"],
    "cwd": "/home/user",
    "schedule": "0 3 * * *"   // 可选，定时任务
  }
}
```

### 类型扩展规则

```
Session 类型不是 Core 的硬编码概念。
Core 只区分：
  - process（需要 pty）
  - task（不需要 pty，后台运行）
  - shell（process + pty 的别名）

Agent type 是 TS 插件的分类，不是 Core 的类型。
ClaudeCode 用的就是 process session，只是 command=claude。
```

---

## 四、Stream 模型

### Stream 定义

每个 Stream 是一个只追加、顺序递增的数据通道。

```go
type Stream struct {
    ID        string      `json:"id"`
    SessionID string      `json:"sessionId"`
    Type      StreamType  `json:"type"`   // stdin | stdout | stderr | event | control
    Buffer    *RingBuffer `json:"-"`      // 内存环形缓冲区（最近 N 条）
    // ...
}

type StreamType string
const (
    StreamStdin  StreamType = "stdin"
    StreamStdout StreamType = "stdout"
    StreamStderr StreamType = "stderr"
    StreamEvent  StreamType = "event"
    StreamCtrl   StreamType = "control"
)
```

### Stream 与 Session 的关系

```
每个 Session 默认有 3 个 Stream:
  - stdin  (可写，从外部写入进程)
  - stdout (可读，进程写入外部)
  - stderr (可读，进程写入外部)

每个 Stream 有独立的事件序列，但共享 Session 的 eventSeq：
  eventSeq 1:  session.created  (event stream)
  eventSeq 2:  stream.stdout    "Hello\n"  (stdout stream)
  eventSeq 3:  stream.stderr    "Warning"  (stderr stream)
  eventSeq 4:  stream.stdin     "ls\n"     (stdin stream)
```

### Stream 订阅

```json
// 订阅 stdout，从 eventSeq 0 开始（从头 replay）
{
  "type": "stream.subscribe",
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "sessionId": "sess_abc",
  "streamType": "stdout",
  "fromSeq": 0
}

// 订阅确认
{
  "type": "stream.subscribed",
  "requestId": "req_abc",
  "ok": true,
  "sessionId": "sess_abc",
  "streamType": "stdout"
}

// 实时 chunk
{
  "type": "stream.chunk",
  "sessionId": "sess_abc",
  "streamType": "stdout",
  "eventSeq": 42,
  "data": "base64...",
  "timestamp": 1712345679000
}
```

### Stream 写入

```json
{
  "type": "stream.write",
  "requestId": "req_def",
  "pluginId": "claude-code",
  "sessionId": "sess_abc",
  "streamType": "stdin",
  "data": "base64..."
}
```

### 订阅者管理

```
Core 维护每个 Stream 的订阅者集合：
  stdout → [Browser A (fromSeq: 0), Browser B (fromSeq: 42)]
  stderr → [Browser C (fromSeq: 0)]

新 chunk 产生时：
  1. 写入 event log
  2. 写入 ring buffer
  3. 广播给所有订阅者（含 chunk 的 eventSeq）

订阅者断开时：
  1. 从订阅者集合中移除
  2. 记录 lastKnownSeq
  3. 重连后从 lastKnownSeq 恢复
```

### 环形缓冲区

```go
const DefaultBufferSize = 1000 // 保留最近 1000 条 event

type RingBuffer struct {
    events []Event
    head   int  // 指向最早的事件
    tail   int  // 指向最新事件的下一个位置
    size   int
    max    int
}
```

作用：
- 新订阅的客户端不需要从磁盘 replay
- 直接从内存 buffer 获取最近 N 条
- 减少 disk I/O

### Stream 权限

```
stream.subscribe：
  - 校验插件有 stream.subscribe 权限
  - 校验插件可以访问该 session（session 的 pluginId 校验）

stream.write：
  - 校验插件有 stream.write 权限
  - 校验 streamType=stdin（只能写 stdin）
  - stdout/stderr 只读
```

---

## 五、Event 系统

### Event 定义

```go
type Event struct {
    SessionID string    `json:"sessionId"`
    EventSeq  int64     `json:"eventSeq"`   // session 级别单调递增
    EventType string    `json:"eventType"`  // "session.created" | "stream.stdout" | ...
    PluginID  string    `json:"pluginId"`
    Payload   interface{} `json:"payload"`
    Timestamp int64     `json:"timestamp"`
}
```

### Event 类型

| eventType | 触发者 | payload | 说明 |
|-----------|--------|---------|------|
| `session.created` | Core | `{ kind, command, args?, cwd? }` | session 创建 |
| `session.stopped` | Core | `{ exitCode, signal? }` | session 停止 |
| `session.errored` | Core | `{ error }` | session 异常 |
| `stream.stdout` | Core | `{ data: base64 }` | stdout chunk |
| `stream.stderr` | Core | `{ data: base64 }` | stderr chunk |
| `stream.stdin` | Core | `{ data: base64 }` | stdin chunk (data always redacted in history replay/tail) |
| `stream.control` | Core | `{ type: "resize", rows, cols }` | resize |
| `session.user.meta` | Plugin | `{ key, value }` | 插件自定义 metadata |
| `session.user.label` | Plugin | `{ label }` | 用户可设置 label |

### EventSeq

```
- eventSeq 从 1 开始，单调递增
- 同一个 session 内不重复
- 所有 stream 类型共享同一个 eventSeq
- 事件写入 event log 后才产生
- eventSeq 用于：
  1. Replay 断点
  2. 多端同步（订阅断点续传）
  3. 排序（严格顺序）

eventSeq 保证：
  如果 A 的 eventSeq < B 的 eventSeq，A 一定在 B 之前发生
  如果 A 和 B 是同一个 session 的事件，eventSeq 不会跳跃
```

### Event Log 文件

```
~/.sessionnode/sessions/sess_xxx/events.jsonl

{"eventSeq":1,"eventType":"session.created","pluginId":"claude-code","payload":{"kind":"process","command":"claude"},"timestamp":1712345678000}
{"eventSeq":2,"eventType":"stream.stdout","pluginId":"claude-code","payload":{"data":"base64..."},"timestamp":1712345678005}
{"eventSeq":3,"eventType":"stream.stdout","pluginId":"claude-code","payload":{"data":"base64..."},"timestamp":1712345678010}
```

---

## 六、Event Replay

### 为什么需要 Replay

```
场景 1: 浏览器刷新
  - 浏览器重新连接 WebSocket
  - 需要看到 session 的完整输出（或从断点续传）
  - 从 eventSeq 0 或 lastKnownSeq 开始 replay

场景 2: 新浏览器打开 session tab
  - 用户在两台电脑上工作
  - 新电脑打开后需要看到 session 的历史输出

场景 3: Session 数据分析
  - 需要导出 session 的所有事件
  - 用于调试、分析、审计
```

### Replay 请求

```json
{
  "type": "stream.replay",
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "sessionId": "sess_abc",
  "streamType": "stdout",
  "fromSeq": 0,
  "toSeq": 100
}
```

### Replay 响应

```json
{
  "type": "stream.replayed",
  "requestId": "req_abc",
  "ok": true,
  "payload": {
    "sessionId": "sess_abc",
    "streamType": "stdout",
    "fromSeq": 0,
    "toSeq": 100,
    "events": [
      { "eventSeq": 2, "data": "base64...", "timestamp": ... },
      { "eventSeq": 5, "data": "base64...", "timestamp": ... }
    ]
  }
}
```

### Replay 与 Subscribe 的区别

```
stream.replay:
  - 一次性请求-响应
  - 返回历史数据
  - 不建立长连接
  - 不推送后续数据

stream.subscribe:
  - 建立长连接
  - 先 replay fromSeq 到最新
  - 然后保持连接接收实时推送
  - 断开后自动清理
```

---

## 七、多浏览器订阅

### 场景

```
Browser A (桌面)           Go Core                Browser B (手机)
     │                        │                        │
     │ session.create         │                        │
     │ ─────────────────────▶ │                        │
     │ session.created        │                        │
     │ ◀───────────────────── │                        │
     │                        │                        │
     │ stream.subscribe       │                        │
     │ ─────────────────────▶ │                        │
     │                        │                        │
     │           ┌────────────┴────────────┐            │
     │           │ Event Log: events.jsonl │            │
     │           │ Subscribers: [A]        │            │
     │           └─────────────────────────┘            │
     │                        │                        │
     │ stream.chunk (42)      │                        │
     │ ◀───────────────────── │                        │
     │                        │                        │
     │                        │     stream.subscribe   │
     │                        │ ◀───────────────────── │
     │                        │                        │
     │           ┌────────────┴────────────┐            │
     │           │ Subscribers: [A, B]     │            │
     │           └─────────────────────────┘            │
     │                        │                        │
     │ stream.chunk (43)      │                        │
     │ ◀─────────────────────┼────────────────────────▶│
     │                        │                        │
```

### 同步规则

```
1. 所有订阅者收到相同的 event（按 eventSeq 顺序）
2. 没有 "谁在控制" 的概念
   - Browser A 和 Browser B 都可以写 stdin
   - Core 不区分 "主动" 和 "被动"
3. 写入者无关
   - A 写 stdin → 进程输出 → 所有订阅者收到 stdout
   - B 也能看到 A 的输入（如果订阅了 stdin）
4. 断开不影响其他人
   - A 断开 → B 仍然接收
   - A 重连 → 从 lastKnownSeq 续传
```

---

## 八、持久化

### 数据目录结构

```
~/.sessionnode/sessions/
  sess_abc/                        # session abc 的数据目录
    meta.json                      # session 元数据
    events.jsonl                   # 所有 event（eventSeq 顺序）
    stdout.log                     # stdout 原始数据（纯文本，非 base64）
    stderr.log                     # stderr 原始数据
    # stdin.log - 不写入, see Stdin Security Policy

  sess_def/                        # session def 的数据目录
    ├── meta.json
    ├── events.jsonl
    ├── stdout.log
    ├── stderr.log
    └── # stdin.log - 不写入, see Stdin Security Policy
```

### meta.json

```json
{
  "sessionId": "sess_abc",
  "kind": "process",
  "pluginId": "claude-code",
  "nodeId": "node_abc",
  "status": "running",
  "command": "claude",
  "args": ["--output-format", "stream-json"],
  "cwd": "/repo",
  "createdAt": 1712345678000,
  "lastEventSeq": 42,
  "exitCode": null,
  "stoppedAt": null
}
```

### 日志文件处理

```
stdout.log / stderr.log:
  - 进程直接输出，纯文本
  - 不经过 base64
  - 用于分析、搜索、导出
  - 可设置最大大小（默认 100MB）
  - 超过后截断（保留尾部）

events.jsonl:
  - JSON Lines 格式
  - 每条包含 eventSeq
  - 用于 replay
  - 不截断（保留完整 event 历史）
```

### Stdin Security Policy

```
Go Core 对 stdin 数据实施两层防护：

Layer 1 — Default Policy (HistoryPolicy.Streams)
  默认的 HistoryPolicy.Streams = ["stdout", "stderr"]
  stdin 不在默认 stream 列表中 → trackStream() 跳过，不做 Record()
  ✅ 默认配置下 stdin 从不写入 history

Layer 2 — Defense-in-Depth (Record() 层)
  即使调用方显式将 "stdin" 加入 policy.Streams，Record() 仍会在
  写入前将 data 替换为 "[stdin redacted]"
  ✅ 任何路径、任何配置都不会在历史中存储原始 stdin 数据

效果:
  - Event metadata 保留: eventSeq, timestamp, streamType="stdin"
  - Event data 始终为 "[stdin redacted]"
  - Disk 模式: writeDiskLocked 的 default: return 已跳过 stdin
  - DataLen 使用 redacted 长度（16 bytes），不受原始输入大小影响
  - file-explorer 的 fs.* 操作和终端 echo 不属于 stdin scope

例外:
  - 进程已 running 时走 pipe 路径，不经过 History.Record()
  - stdin 数据仍然实时写入进程，不影响功能
  - 仅影响 replay/tail 返回的历史数据
```

### 清理策略

```
停止的 session 保留时间: 可配置（默认 1 小时）
保留 event 数量上限: 不设上限（磁盘空间允许）
stdout.log 大小上限: 100MB（超过则截断尾部）
```

---

## 九、Session 恢复流程

### 浏览器刷新后

```
1. 浏览器建立 WebSocket 连接
2. 发送 hello { nodeId, lastKnownSeq? }

3. Core 回复 welcome:
   {
     sessions: [
       { sessionId, kind, status, pluginId, ... },
       ...
     ]
   }

4. 前端遍历 session list：
   for (const session of welcome.sessions) {
     // 根据 session.kind + pluginId 确定渲染什么 view
     // shell → TerminalView
     // process + claude → ClaudeChatView
     createTab({
       sessionId: session.sessionId,
       viewType: resolveViewType(session),
       label: session.kind,
     })
   }

5. 对每个在 tab 中显示的 session：
   stream.subscribe { sessionId, fromSeq: lastKnownSeq || 0 }

6. 恢复完成——前端与断开前状态一致
```

### 跨设备恢复

```
1. 用户在电脑 A 创建 session
2. 电脑 A 显示 session tab
3. 用户在手机 B 打开同一 Core
4. 手机 B 收到 welcome（包含该 session）
5. 手机 B stream.subscribe → 看到相同内容
6. 输入、输出、事件三端同步
```

### 断线重连

```
1. Client 断开 WebSocket
2. Core 保持 session 运行（进程继续）
3. Client 重连 → 重新 hello → 重新 welcome
4. Client 带 lastKnownSeq → Core 推送未同步的事件
5. Client 恢复显示

断线时间长（超过 ring buffer 大小）：
  → 从磁盘 replay 补齐
  → 发送 replay 请求，不用 subscribe
```

---

## 十、ClaudeCode 工作流示例

### 完整流程

```
1. 环境检测
  TS 插件调 action.request { capability: "env.checkBinary", payload: { name: "claude" } }
  Core 返回 { found: true, path: "/usr/local/bin/claude", version: "0.21.0" }

2. 创建 Session
  TS 插件调 session.create {
    pluginId: "claude-code",
    kind: "process",
    command: "claude",
    args: ["--output-format", "stream-json"],
    cwd: "/repo"
  }
  Core 返回 { sessionId: "sess_abc", streamIds: { stdin, stdout, stderr } }

3. 订阅 Stream
  TS 插件调 stream.subscribe { sessionId: "sess_abc", streamType: "stdout", fromSeq: 0 }
  Core 开始推送 stream.chunk

4. 解析 Stream
  TS 插件（ClaudeChatView）解析 stream-json：
    {"type":"text","content":"Hello!"}          → 渲染为文本
    {"type":"tool_use","name":"Read","input":...} → 渲染为 tool block
    {"type":"thinking","content":"..."}           → 渲染为 thinking...

5. Approval 请求
  Claude 调用工具需要审批：
  TS 插件调 notify.request { title: "Read file", body: "/etc/hosts" }
  Core 推送给 system-ui: notify.approval.request
  UI 显示审批弹窗 → 用户点 Allow → notify.respond
  Core 回调 TS 插件: notify.approval.result

6. 用户输入
  TS 插件调 stream.write { sessionId: "sess_abc", streamType: "stdin", data: "..." }
  Core 写入进程 stdin

7. 用户关闭 Tab（不停止 session）
  前端关闭 tab → 取消 stream.subscribe
  Core 的 session 继续运行
  再次打开 → stream.subscribe from lastKnownSeq

8. 用户停止 Session
  TS 插件调 session.stop { sessionId: "sess_abc" }
  Core kill 进程 → session stopped → 广播给所有客户端
```

### Tab/Session 关系图

```
┌────────┐     ┌────────┐     ┌────────┐
│ Tab A  │     │ Tab B  │     │ Tab C  │ (UI 投影)
│        │     │        │     │        │
│ Claude │     │ Terminal    │ Terminal  │
└───┬────┘     └───┬────┘     └───┬────┘
    │              │              │
    │ subscribe    │ subscribe    │ subscribe
    ▼              ▼              ▼
┌────────┐     ┌────────┐     ┌────────┐
│sess_abc│     │sess_def│     │sess_ghi│ (Core 实体)
│claude  │     │bash    │     │bash    │
└────────┘     └────────┘     └────────┘
```

注意：
- Tab A（Claude session）可以被两个浏览器同时投影
- Tab B 和 Tab C 都是 Terminal，但绑定不同 session
- 关闭 Tab A → session 还在跑（除非主动 stop）
- 关闭 Tab C → session ghi 还在跑

---

## 十一、防回退规则

| # | 规则 | 后果 |
|---|------|------|
| 1 | **禁止用 tabId 当 sessionId** | 刷新后 tab 消失却不知道 session 还在跑 |
| 2 | **禁止用 instanceId 代表所有东西** | session、stream、action 生命周期不同，ID 必须分开 |
| 3 | **禁止浏览器维护 session 真相** | session 列表必须来自 Core 的 session.list |
| 4 | **禁止 localStorage 保存 session 状态** | 刷新后通过 welcome 重建，不读 localStorage |
| 5 | **禁止关闭 tab 时自动停止 session** | 除非用户明确点"停止"，tab 关闭不影响 session |
| 6 | **禁止没有 eventSeq 的 session event** | replay 无法确定顺序，多端同步断裂 |
| 7 | **禁止 session event 跨 session 共享 eventSeq** | eventSeq 只在单个 session 内单调递增 |
| 8 | **禁止通过 stream.write 写 stdout 或 stderr** | stdin/out/err 角色严格分离 |
| 9 | **禁止 session 停止后立即删除数据** | 保留一段时间（默认 1 小时），防止"刚刚关了还想看" |
| 10 | **禁止 Core 重启后自动恢复 running session** | 上次 crash 残留的进程标记为 stopped，客户端手动恢复 |
| 11 | **禁止订阅者看到不属于它的 session 数据** | 权限校验在订阅时执行，不能订阅其他插件的 session（除非授权） |
| 12 | **禁止 stream.chunk 推送不按 eventSeq 顺序** | 接收方依赖顺序渲染，乱序会导致 UI 错乱 |

---

## 十二、EventSeq Replay 细节

### EventSeq 生成规则

```go
type EventSeqManager struct {
    mu       sync.Mutex
    sessionID string
    current   int64      // 当前最大 eventSeq
    lastFlush int64      // 上次持久化的 eventSeq
}

func (m *EventSeqManager) Next() int64 {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.current++
    return m.current
}
```

```
生成规则:
  1. eventSeq 从 1 开始
  2. 同一 session 内单调递增，永不重复
  3. 所有 stream 类型共享同一个 eventSeq 序列
  4. 事件写入 events.jsonl 后才产生 eventSeq
  5. 即使 event 写入失败，eventSeq 不重用

持久化:
  - 每次 event 写入后更新 meta.json 中的 lastEventSeq
  - Core 重启后从 lastEventSeq + 1 继续
  - 不依赖内存状态保证递增
```

### Replay 性能策略

```
小范围 replay（ring buffer 范围内）:
  → 从内存 RingBuffer 读取
  → 延迟 < 1ms
  → 适用于断线重连

大范围 replay（超出 ring buffer）:
  → 从磁盘 events.jsonl 读取
  → 延迟取决于文件大小
  → 适用于新订阅者从头开始

全量 replay:
  → 从磁盘 events.jsonl 逐行读取
  → 支持 fromSeq / toSeq 范围限定
  → 支持 streamType 过滤
```

### Replay 数据一致性

```text
保证:
  1. eventSeq 顺序与 events.jsonl 中的行顺序一致
  2. 写入 events.jsonl 成功后才会广播给订阅者
  3. 广播失败不影响 eventSeq 生成
  4. Replay 时如有新 event 同时产生，不遗漏

不保证:
  1. 两个 event 的精确时间间隔
  2. 跨 session 的 eventSeq 顺序
```

---

## 十三、Interrupted/Resumable Session 状态

### 状态扩展

除了已有的 running / stopped / failed 等状态，引入以下状态处理断线场景：

```text
                    ┌──────────┐
                    │ running  │
                    └────┬─────┘
                         │ 网络断线 / relay 断开
                    ┌────▼─────┐
                    │interrupted│  ← 进程仍在运行，但 relay 连接断开
                    └────┬─────┘
                         │ 重连成功
                    ┌────▼─────┐
                    │ running  │  ← 恢复正常
                    │          │
                    │ 或超时    │
                    ▼          ▼
                ┌────────┐ ┌────────┐
                │stopped │ │ failed │
                └────────┘ └────────┘
```

| 状态 | 含义 | 是否持久化 | 是否可恢复 |
|------|------|-----------|-----------|
| `interrupted` | 进程仍在运行，但面向客户端的网络连接中断 | 是 | 是（重连后回到 running） |
| `resumable` | session 已停止但数据保留，可手动恢复 | 是 | 是（创建新 session + replay） |

### Interrupted 状态详解

```
触发条件:
  - relay 连接断开
  - 客户端 WebSocket 断开（进程不停止）
  - 网络分区

表现:
  - session status: "interrupted"
  - 进程继续运行
  - stdout/stderr 继续写入 events.jsonl
  - 等待客户端重连

恢复:
  - 客户端重连后 stream.subscribe
  - Core 从 lastEventSeq 续传
  - status 恢复为 running

超时:
  - 可配置 interrupted 超时时间（默认 5 分钟）
  - 超时后自动尝试停止进程
  - 如果进程可分离（detach），转为 stopped
```

### Resumable 状态详解

```
触发条件:
  - session 已停止但仍有保留价值
  - 用户手动标记为 resumable
  - 自动化任务可配置 "onExit: resume"

表现:
  - session status: "resumable"
  - 进程已停止
  - events.jsonl 和日志保留
  - 可查看历史输出

恢复方式:
  - 用户点 "Resume" → 创建新 session 并 replay 历史
  - 不允许多个 resume session 操作同一数据目录

清理:
  - 可配置 resumable 保留时间（默认 1 小时）
  - 超期后自动清理数据目录
```

### 断线重连数据流

```
客户端断线:
  1. Core 检测到 WebSocket 断开
  2. session 状态 → interrupted（进程继续运行）
  3. Core Log: session interrupted, sessionId, reason
  4. 客户端无法接收新数据

客户端重连:
  1. hello { lastKnownSeq: N }
  2. Core 回复 welcome { sessions: [..., { status: "interrupted" }] }
  3. 客户端发现上次的 session 为 interrupted
  4. stream.subscribe { fromSeq: N+1 }
  5. Core 推送未同步的 events
  6. 客户端恢复显示
  7. 状态 → running
```

### 防回退

```text
1. interrupted ≠ stopped
   进程仍在运行，不能自动清理

2. resumable ≠ running
   进程已停止，不能写入 stdin

3. Core 重启后不自动恢复 interrupted session
   标记为 stopped（进程已随 Core 退出）

4. 断线期间的 events 需要在重连后 replay
   不丢失、不重复
```
