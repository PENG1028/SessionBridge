# VSCode 插件完整功能实现分析

**基于 Claude Code for VS Code v2.1.123 的反向工程**
**目标：逆向分析所有功能实现方式，指导 sessionBridge 重构**

---

## 一、总体架构

### 1.1 进程模型

```
┌─ VS Code Extension Host ─────────────────────────────────┐
│                                                           │
│  r_ class (Session Manager)                               │
│    ├── fromClient() ← WebView 消息处理                    │
│    │    ├── "launch_claude"  → spawnClaude()              │
│    │    ├── "io_message"     → transportMessage()         │
│    │    ├── "close_channel"  → closeChannel()             │
│    │    ├── "interrupt_claude" → interruptClaude()        │
│    │    └── "request"        → handleRequest()            │
│    │                                                       │
│    ├── spawnClaude()                                      │
│    │    ├── 创建 ProcessTransport (kl)                    │
│    │    ├── 创建 Query (Ql)，包装 transport                │
│    │    └── 返回 async iterator → 消费事件                 │
│    │                                                       │
│    └── launchClaude()                                     │
│         ├── 创建 input stream (y2)                         │
│         ├── 调用 spawnClaude()                             │
│         ├── for await (event of query)                    │
│         │    └── send({type:"io_message", message:event})  │
│         └── 遍历结束 → closeChannel()                     │
│                                                           │
├── WebView (iframe) ────────────────────────────────       │
│  Gn/Jz1 class (Controller)                                │
│    ├── readMessages() ← onmessage from extension          │
│    │    ├── "io_message" → 路由到 channel stream           │
│    │    ├── "request"    → 权限弹窗等                      │
│    │    ├── "response"   → 请求回复                        │
│    │    └── "close_channel" → 结束会话                     │
│    └── 组件                                              │
│         ├── eX (Session) → 管理消息列表                    │
│         ├── Vn/QB1 (Assembler) → 事件→消息转换            │
│         └── React 渲染组件 → 展示 UI                      │
└──────────────────────────────────────────────────────────┘
```

### 1.2 关键类对应表

| 代码名 | 作用 | 对应 sessionBridge 概念 |
|--------|------|------------------------|
| `kl` | ProcessTransport — spawn claude 进程 | —（新加） |
| `Ql` | Query — 包装 transport，提供事件迭代器 | agent-stream.ts |
| `r_` | SessionManager — 多会话管理 | relay-server.ts |
| `y2` | InputStream — 用于 channel 的流 | — |
| `_D` | Stream — 异步队列 | use-ws.ts 的 msgLog |
| `eX` | Session — 单个会话的状态 | page.tsx 的 messages |
| `Vn`/`QB1` | Assembler — 事件→结构化消息 | page.tsx 的 serverBlocks |
| `kz` | Message — 单条消息（user/assistant） | Message interface |
| `uY` | ContentBlock — 消息中的 block | Block interface |
| `Gn`/`Jz1` | WebView Controller — 与 extension 通信 | use-ws.ts hook |
| `Wn` | Session 列表管理器 | page.tsx 顶层 |
| `O0` | Observable signal（响应式值） | useState |
| `l2` | Computed / derived signal（派生值） | useMemo |
| `j4` | Effect / watch（副作用） | useEffect |

### 1.3 核心协议栈

```
Layer 1: 进程通信
  claude --output-format stream-json --input-format stream-json
          → stdout: JSON per line (stream-json protocol)
          → stdin:  JSON per line

Layer 2: Extension ↔ WebView
  postMessage / onmessage
    extension → webview: {type:"io_message", channelId, message, done}
    webview → extension: {type:"launch_claude", channelId, ...}
                          {type:"io_message", channelId, message, done}
                          {type:"request", ...}

Layer 3: 应用层 (WebView 内)
  io_message.message → Vn/QB1 assembler → kz message[] → React 渲染
```

---

## 二、所有事件类型详解

### 2.1 stream-json 协议事件（claude stdout → extension）

| 事件类型 | 子类型 | 作用 | 是否发到 WebView |
|---------|--------|------|-----------------|
| `system` | `init` | 初始化信息（session_id, model, version） | ✅ |
| `system` | `post_turn_summary` | 每轮完成总结 | ✅ |
| `system` | `task_summary` | 任务完成总结 | ✅ |
| `system` | `session_state_changed` | 会话状态变更 | ❌ 过滤 |
| `system` | `bridge_state` | 远程桥接状态 | ❌ 内部处理 |
| `system` | `compact_boundary` | 上下文压缩边界 | ✅（存在 session 文件中） |
| `stream_event` | `message_start` | 新消息开始 | ✅ |
| `stream_event` | `message_delta` | 消息增量更新 | ✅ |
| `stream_event` | `message_stop` | 消息结束 | ✅ |
| `stream_event` | `content_block_start` | 内容块开始（thinking/tool_use/text） | ✅ |
| `stream_event` | `content_block_delta` | 内容块增量（text_delta/input_json_delta/thinking_delta） | ✅ |
| `stream_event` | `content_block_stop` | 内容块结束 | ✅ |
| `user` | — | 用户输入回显 | ✅ |
| `assistant` | — | 完整 assistant 消息 | ✅ |
| `result` | `success`/`error` | 执行结果 + token 统计 | ✅ |
| `progress` | — | 进度更新 | ✅ |
| `attachment` | — | 文件附件 | ✅ |
| `keep_alive` | — | 心跳 | ❌ 过滤 |
| `control_request` | — | 权限/工具回调请求 | ❌ 内部处理 |
| `control_response` | — | 控制请求的响应 | ❌ 内部处理 |
| `control_cancel_request` | — | 控制取消请求 | ❌ 内部处理 |
| `transcript_mirror` | — | 会话镜像数据 | ❌ 内部处理 |

### 2.2 WebView 收到的消息类型

来自 extension 的消息（`fromHost`）:

| 消息 type | 作用 | 内容 |
|-----------|------|------|
| `io_message` | Claude 事件的流式推送 | `{channelId, message:流式事件, done}` |
| `close_channel` | 会话结束 | `{channelId, error?}` |
| `request` | 需要用户交互的请求 | `{requestId, type, ...}` 权限/输入请求 |
| `response` | 对 WebView 请求的回复 | `{requestId, response}` |
| `cancel_request` | 取消进行中的请求 | `{targetRequestId}` |
| `file_updated` | 文件变更通知 | `{filePath}` |
| `plan_comment` | 计划模式评论 | `{channelId, comment}` |
| `speech_audio_level` | 语音输入音量 | `{channelId, level}` |
| `speech_to_text_message` | 语音转文字 | `{channelId, text}` |

WebView 发给 extension 的消息:

| 消息 type | 作用 |
|-----------|------|
| `launch_claude` | 启动新会话 |
| `io_message` | 发送用户输入 |
| `close_channel` | 关闭会话 |
| `interrupt_claude` | 中断 |
| `request` | 通用请求（init, open_file, 等） |
| `start_speech_to_text` | 开始语音输入 |
| `stop_speech_to_text` | 停止语音输入 |

---

## 三、各功能实现详解

### 3.1 Thinking 展示

**数据流**:
```
Claude → stream_events → content_block_start {type:"thinking"}
                        → content_block_delta {type:"thinking_delta", thinking:"..."}
                        → content_block_delta {type:"signature_delta", signature:"..."}
                        → content_block_stop
```

**WebView 处理 (QB1 class)**:
```javascript
processStreamEvent(event) {
  switch (event.type) {
    case "content_block_start":
      // 当 content_block.type === "thinking"
      msg.content.push(event.content_block);  // 收到 {type:"thinking", thinking:""}
      break;
    case "content_block_delta":
      // thinking_delta: msg.content[index].thinking += delta.thinking
      // signature_delta: msg.content[index].signature = delta.signature
      break;
    case "content_block_stop":
      // 标记 thinking block 完成
      break;
  }
}
```

**UI 渲染 (NK1 组件)**:
```javascript
function NK1({thinkingBlock, isExpanded, onToggle, isCurrentlyThinking, durationMillis}) {
  // Props:
  //   thinkingBlock   — {type:"thinking", thinking:"...", signature:"..."}
  //   isExpanded     — 是否展开
  //   isCurrentlyThinking — 是否正在思考（流式进行中）
  //   durationMillis  — 思考耗时
  //
  // 渲染: 折叠时只显示 "Thinking..." / "Thought for Xs"
  //       展开时显示完整 thinking 文本
}
```

**与你的 page.tsx 的对比**: 你的 thinking 展示逻辑（`renderBlock` case 'thinking'）已经很接近了。区别在于你的 thinking 内容是靠 agent-stream.ts 的 `BufferState` 手工累加，插件是直接由 `QB1` 处理 `thinking_delta`。

---

### 3.2 工具调用展示（Read/Bash/Edit 等）

**数据流**:
```
Claude → stream_event → content_block_start {type:"tool_use", name:"Read", input:{...}}
                       → content_block_delta {type:"input_json_delta", partial_json:"..."}
                       → content_block_stop
                          ↓
       助理消息中的 tool_result 由后续的 user 事件回显:
       user → message.content[] → {type:"tool_result", content:"文件内容..."}
```

**WebView 处理**:
```javascript
// content_block_start 时:
//   content_block.type === "tool_use"
//   → msg.content.push({type:"tool_use", name:"Read", input:{file_path:"..."}})
//   → 开始显示 tool 卡片

// input_json_delta 增量更新 tool_use.input（但不实时显示，等 stop 后才显示完整）

// tool_result 实际是通过 user 事件收到的:
//   user → message.content[] → tool_result → 更新对应 tool_use 的结果
```

**UI 渲染**: 工具调用卡片按 `name` 分类显示不同的图标和颜色（与你的 `TOOL_SEMANTICS` 类似）。

**与你的 page.tsx 的对比**: 你的工具卡片展示（`renderBlock` case 'tool_use'/'tool_result'）思路一致。区别在于你收到的是 agent-stream.ts 已经分好的 `tool_use` 和 `tool_result` 事件，插件收到的是原始的 `content_block_start/stop` + `user` 事件。

---

### 3.3 文本消息流式展示

**数据流**:
```javascript
// 方式1：stream_event 推送 text_delta（实时流式）
content_block_start {type:"text"}
content_block_delta {type:"text_delta", text:"这是"}
content_block_delta {type:"text_delta", text:"一条消息"}
content_block_stop

// 方式2：assistant 事件包含完整内容（最终结果）
assistant → message.content[] → {type:"text", text:"这是一条消息"}
```

**WebView 处理**: `QB1.processStreamEvent` 中，`text_delta` 累加到 `currentMessage.content[index].text`，实时触发 UI 更新。

---

### 3.4 用户消息回显

**数据流**:
```javascript
// WebView 发送用户输入
extension.send({type:"io_message", channelId, message: {type:"user", ...}, done:false})

// Claude 回复 user 事件（echo）
user → {type:"user", message:{role:"user", content:[{type:"text", text:"用户输入"}]}}

// WebView 处理: 将 user 事件转换为 user message 加入消息列表
if (event.type === "user") {
  messages.push(new kz("user", [...], {uuid: event.uuid}));
}
```

**与你的 page.tsx 的对比**: 你通过 `bType === 'user'` 处理用户气泡，逻辑相同。

---

### 3.5 消息列表的组装与分组

`QB1` assembler 的工作方式：

```javascript
class QB1 {
  processStreamEvent(event) {
    switch (event.type) {
      case "message_start":
        this.currentMessage = {...event.message, content:[]};
        break;
      case "content_block_start":
        this.currentMessage.content.push(event.content_block);
        this.addContentBlock(event.content_block); // 创建 uY wrapper
        break;
      case "content_block_delta":
        // 更新 this.contentBlocks[index].content
        break;
      case "content_block_stop":
        // 标记对应 block 完成
        break;
      case "message_stop":
        // 消息完成，currentMessage 可被消费
        break;
    }
  }
}
```

消息分组算法：相邻的 user + assistant 消息对按时间分组，连续同一会话的块可以被折叠。

**与你的 page.tsx 的对比**: 你的 `groupedBlocks` 函数做了类似的分组折叠，但你是按 tool 类型分组，插件是按消息对分组。

---

### 3.6 权限系统（Ask before edits / Allow / Deny）

**数据流**:
```javascript
// Claude 发起工具调用时需要权限
Query → 发送 control_request 到 Extension Host

// Extension 处理
handleRequest → requestToolPermission(channelId, toolName, input, suggestions)
  → send({type:"request", requestId, toolName, input, suggestions}) 到 WebView

// WebView 显示权限弹窗
WebView 用户点击 Allow / Allow Once / Deny
  → send({type:"response", requestId, response:{behavior:"allow"}})
  → Extension 回复 Claude
  → Claude 执行工具
```

**权限弹窗组件 (`fe1` 函数)**:
```javascript
function fe1({permissionRequest, session}) {
  // 根据不同工具类型显示不同的 UI:
  // - Edit: 显示 diff 对比，用户可修改后批准
  // - Write: 显示文件内容预览
  // - Bash: 显示命令
  // - Read/Glob/Grep: 显示文件路径/搜索模式
  // - Tool: 显示工具名称 + 参数

  if (toolName === "Edit") {
    // 打开 diff editor 让用户预览修改
    session.openDiff(file_path, file_path, [{oldString, newString, replaceAll}]);
    // 用户确认或拒绝
  } else if (toolName === "Write") {
    // 类似 Edit
  } else if (toolName === "Plan") {
    // 显示 markdown 预览
    session.openMarkdownPreview(planContent, title);
  }
}
```

**权限模式**:
- `default`: 每次工具调用都询问
- `acceptEdits`: 自动接受文件编辑
- `plan`: 只读模式
- `bypassPermissions`: 跳过所有权限检查（对应你的 `--dangerously-skip-permissions`）

**与你的 sessionBridge 的对比**: 你用了 `--dangerously-skip-permissions` 跳过了所有权限检查。插件有完整的允/拒/临时权限 UI。

---

### 3.7 会话管理（历史 / 新建 / fork / resume）

**新建会话**:
```javascript
// WebView
Wn.createSession() → launchClaude(channelId, resume?:undefined, cwd)

// Extension
r_.launchClaude(channelId, resume, cwd, permissionMode)
  → spawnClaude(inputStream, resumeSessionId?, ...)
  → claude 进程启动 → 开始迭代事件
```

**恢复会话 (resume)**:
```javascript
// WebView 点击历史会话
// 传 resume=sessionId 给 launchClaude
extension.send({
  type: "launch_claude",
  channelId,
  resume: "session_abc123",  // ← 复用已有 session
  cwd: workspacePath,
  permissionMode: "default"
});

// Extension: spawnClaude 时传 --resume sessionId
// Claude 加载历史上下文
```

**Fork 会话**:
```javascript
// WebView 操作
session → "Fork" → 调 Connection 的 forkSession()
  → send({type:"request", request: {subtype:"fork_session", ...}})
  → Extension 创建新的 session 但继承上下文

// 实际是通过 Query 的 control_request 机制
// 在 Claude 进程中 fork 当前的 session
```

**会话列表持久化**:
Claude Code 将 session 保存在 `~/.claude/projects/` 目录下。
Extension 通过 `SessionStore` 读取 JSONL 文件：

```javascript
// Session 文件格式（JSONL，每行一个事件）
{type:"user", uuid:"...", message:{...}}
{type:"assistant", uuid:"...", message:{...}}
{type:"progress", uuid:"...", ...}
{type:"system", uuid:"...", subtype:"compact_boundary", ...}
{type:"attachment", uuid:"...", ...}

// 解析时构建树结构：parentUuid → 子事件
// 支持 fork/sidechain 分支
```

**与你的 sessionBridge 的对比**: 你用 `--resume sessionId` 恢复，但每次重新 spawn 进程加载 session。插件在常驻进程中直接 fork，零开销。

---

### 3.8 文件操作展示（diff / 新建 / 编辑）

**文件 Edit 的展示**:
```javascript
// Claude 调用 Edit 工具
tool_use {name:"Edit", input:{file_path:"src/index.ts", old_string:"旧文本", new_string:"新文本"}}

// tool_result 返回编辑结果
// 但没有结构化 diff 数据！只有描述文本
// "已将 10 行替换为 12 行"

// 插件的 diff 展示不是在工具调用层面做的
// 而是通过 vscode MCP 服务跟踪文件变更
// "claude-vscode" MCP 服务器提供了文件变更通知能力
```

**关键**: 插件不做 diff 预览！文件改动的可视化靠 VSCode 的 SCM/git 能力，不是靠 Claude 的 stream-json 输出。插件注册了一个 `"claude-vscode"` MCP 服务器，在 Claude 工作目录中跟踪文件状态：

```javascript
// extension.js 中的 MCP 服务器注册
const vscodeMcpServer = {
  "claude-vscode": {
    // 提供文件变更通知
    // 提供 diff 对比
    // 打开文件等
  }
};
```

这个 MCP 服务器会在文件被修改时发送 `file_updated` 通知给 WebView。

**与你的 sessionBridge 的对比**: 你的项目也面临同样的问题（需求文档中记录了"只显示 result 描述文本"）。插件也没有流式 diff 展示。

---

### 3.9 多智能体 / 子代理

**数据流**:
```javascript
// 主 Claude 调用 Agent 工具
tool_use {name:"Agent", input:{task:"搜索并读取文件"}}

// 子代理启动后，事件流中会出现 sidechain 标记
// 事件中的 isSidechain, teamName 字段区分主/子代理

// Session 文件中的树结构:
user (parentUuid: null)
  └─ assistant (parentUuid: user.uuid)
       └─ tool_use: Agent
            └─ user (parentUuid: tool_use.uuid, isSidechain: true)  ← 子代理
                 └─ assistant (parentUuid: user.uuid, isSidechain: true)
                      ├─ thinking
                      ├─ tool_use: Read
                      └─ text
```

**UI 展示**: WebView 中的消息列表按 `parentToolUseId` 树状嵌套。子代理的消息带缩进和标签（如 "Agent" badge）。

**与你的 sessionBridge 的对比**: 你的需求文档 3.4 节已经规划了这个展示方案，但 agent-stream.ts 没有实现主/子代理区分。

---

### 3.10 撤回 / Checkpoint

```javascript
// Claude 的 Edit 操作前自动创建 checkpoint
// 通过 control_request 机制询问 Extension
// Extension 回复后，Claude 执行操作

// 撤回操作:
WebView → sendCommand("rewind") → sendRequest({type:"rewind_files", ...})
  → Extension 通过 Query 的 request 机制
  → Claude 执行 rewind → 返回结果

// Checkpoint 文件保存在工作目录的 .claude/checkpoints/ 下
```

**与你的 sessionBridge 的对比**: 你用 `-p` 模式 + `--dangerously-skip-permissions`，没有 checkpoint 机制。

---

### 3.11 Slash 命令

命令有两种实现方式：

**方式1：claude 原生处理**
```javascript
// 用户输入 /cost
WebView → sendInput("/cost")
  → extension → claude.stdin → {"type":"user", message:{content:[{text:"/cost"}]}}
  → claude 内部解析 /cost → 回复 token 统计
```

**方式2：Extension 拦截处理**
```javascript
// 某些命令（如 /clear, /model）由 Extension 拦截
readFromClient switch:
  case "/clear":
    // 关闭当前 channel，新建一个
    break;
  case "/model":
    // 修改下次 launch 的参数
    break;
```

**为什么终端模式有 50+ 命令，而你的 `-p` 模式只有 3 个？**

因为 `-p` 模式是"一次性查询"，没有常驻交互式会话。命令如 `/status` 需要读取会话内部状态（上下文压力、token 计数等），这些信息在 `-p` 模式下进程退出后就丢了。

而插件使用的是持久 JSON 通道模式（与终端模式相同的后端），Claude 进程常驻，所有命令都可用。

---

### 3.12 模型切换

```javascript
// WebView 用户选择模型 → Extension
session.setModel("opus")
  → sendRequest({type:"set_model", model:"opus"})
  → Query.request({subtype:"set_model", model:"opus"})
  → claude 进程内部切换模型

// 或通过重启 session（切换大模型时）
session.closeChannel()
session.launchClaude(newChannelId, ...{model:"opus"})
```

---

### 3.13 语音输入

```javascript
// WebView 中点击语音按钮
controller.startSpeechToText(channelId, (level) => {
  // level 回调：实时音量指示
});

// Extension 启动音频捕获
// 通过 resources/audio-capture/x64-win32/audio-capture.node
// 这是一个原生 Node.js addon

// 语音转文字后发送为普通文本
sendInput(transcribedText);
```

---

### 3.14 计划模式 (Plan)

```javascript
// Claude 提交计划
tool_use {name:"Plan", input:{plan:"## 步骤1..."}}
  → Extension 检测到 Plan 工具调用
  → send({type:"request", toolName:"Plan", planContent})
  → WebView 打开 markdown 预览面板

// Plan 面板支持评论
WebView → sendRequest({type:"open_markdown_preview", content, title, enableComments:true})
  → Extension 创建 plan preview WebView panel

// 用户在 plan 上添加评论
sendRequest({type:"add_plan_comment", channelId, comment})
```

---

### 3.15 多工作区 (Workspace / Worktree)

```javascript
// 插件可以同时管理多个 Claude 会话
// 每个 session 有自己的 channelId、cwd、进程

// 工作区树 (worktree):
// 创建 git worktree 并在其中启动新的 Claude 会话
async createSession({useWorktree: true, worktreeName: "feature-branch"}) {
  // 1. git worktree add feature-branch
  // 2. launchClaude(newChannelId, undefined, worktreePath)
  // 3. 在 tree 中彼此隔离
}
```

---

### 3.16 上下文压缩

```javascript
// Claude 自动压缩上下文（当 token 接近限制时）
// 发送 compact_boundary 事件
system {type:"compact_boundary", compactMetadata:{...}}

// 压缩后的边界信息存储在 session 文件中
// WebView 显示 "Context compressed" 提示
```

---

### 3.17 文件树 / 文件引用

插件没有独立的文件树面板。文件展示通过：
1. **@-mention**: 在输入框中 `@` 可以搜索并引用文件
2. **工具调用结果**: Read/Edit/Write 的路径在 UI 中显示为可点击链接

---

## 四、事件流时序图

### 4.1 一次完整交互

```
WebView                  Extension               Claude 进程
   │                        │                        │
   │── launch_claude ──────→│                        │
   │                        │── spawn ──────────────→│
   │                        │   --output-format      │
   │                        │   stream-json          │
   │                        │   --input-format       │
   │                        │   stream-json          │
   │                        │                        │
   │← io_message ──────────│← stdout: system(init)   │
   │  system:init           │                        │
   │                        │                        │
   │── io_message ────────→│── stdin ──────────────→│
   │  {type:"user",...}     │   {"type":"user",...}   │
   │                        │                        │
   │← io_message ──────────│← stdout: user(event)   │
   │  user (echo)           │                        │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  message_start         │   message_start         │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  content_block_start   │   content_block_start   │
   │  {type:"thinking"}     │   {type:"thinking"}     │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  content_block_delta   │   thinking_delta        │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  content_block_stop    │   content_block_stop    │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  content_block_start   │   {type:"tool_use",     │
   │  {type:"tool_use"}     │    name:"Read"}         │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  content_block_stop    │   content_block_stop    │
   │                        │                        │
   │← io_message ──────────│← user(event)           │
   │  user:{tool_result}    │   {tool_result,         │
   │                        │    content:"..."}       │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  content_block_start   │   {type:"text"}         │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  content_block_delta   │   text_delta            │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  content_block_stop    │   content_block_stop    │
   │                        │                        │
   │← io_message ──────────│← stream_event          │
   │  message_stop          │   message_stop          │
   │                        │                        │
   │← io_message ──────────│← result                │
   │  result                │   {cost, tokens, ...}   │
   │                        │                        │
```

---

## 五、关键差异总结：插件 vs 你的 sessionBridge

| 功能 | VSCode 插件实现 | sessionBridge 当前实现 |
|------|---------------|----------------------|
| **进程模式** | 常驻进程，`--input-format stream-json` | 每消息 spawn，`-p` 模式 |
| **多轮对话** | stdin 保持打开，持续写 | `--resume` 恢复，每次冷启动 |
| **事件解析** | readline 逐行读，每行一个 JSON | BufferState 手工状态机 |
| **消息组装** | QB1 assembler 处理 content_block 事件 | page.tsx 的 useEffect 处理 serverBlocks |
| **Thinking** | QB1 累加 thinking_delta → NK1 组件 | agent-stream.ts 累加 → renderBlock |
| **工具调用** | content_block_start/stop + user 事件 | agent-stream.ts 的 tool_use event |
| **文本流式** | content_block_delta(text_delta) → 实时更新 | text delta 合并 → 阶段性涌现 |
| **权限系统** | control_request 机制 + WebView 弹窗 | `--dangerously-skip-permissions` |
| **Slash 命令** | 全部可用（插件主进程解析） | 仅 3 个 |
| **模型切换** | Query.request({subtype:"set_model"}) | 重启 agent |
| **撤回** | 内置 checkpoint 机制 | 不支持 |
| **会话历史** | 本地 JSONL 文件 + 树结构 | 无持久化 |
| **子代理** | sidechain + parentToolUseId 树 | 未实现 |
| **Fork** | Query 层 fork_session 机制 | 不支持 |
| **语音** | 原生 addon 音频捕获 | 不支持 |
| **Plan 模式** | Plan 工具 + markdown 预览 | 不支持 |
| **MCP 服务器** | 完整支持（插件注册 vscode MCP） | 在 claude 进程中支持 |
| **文件 diff** | VSCode 原生 diff editor + MCP 通知 | 只显示 result 文本 |

---

## 六、核心功能实现深度解析

### 6.1 Fork 会话

#### 数据流全景

```
WebView                              Extension                           Claude 进程
  │                                      │                                  │
  │ [用户点击消息的"Fork"按钮]             │                                  │
  │                                      │                                  │
  │ forkConversation(N, X, y) ──────────→│                                  │
  │ {forkedFromSession, resumeSessionAt}  │                                  │
  │                                      │                                  │
  │                                      │ sessionStore.forkSession(V, K)   │
  │                                      │   ├─ ensureSessionLoaded(V)      │
  │                                      │   │   └─ 读取 .jsonl 文件         │
  │                                      │   ├─ getTranscript(latest)        │
  │                                      │   │   └─ parentUuid 链 → root     │
  │                                      │   ├─ 截断到 resumeSessionAt       │
  │                                      │   ├─ 生成新 UUID 和 sessionId     │
  │                                      │   ├─ 写入新 .jsonl 文件           │
  │                                      │   └─ 返回 newSessionId            │
  │                                      │                                  │
  │ ←─ {sessionId: newId} ──────────────│                                  │
  │                                      │                                  │
  │ startNewConversationTab(newId)        │                                  │
  │   └─ launchClaude(channelId,          │                                  │
  │        {forkSession: true,            │                                  │
  │         sessionId: newId,             │                                  │
  │         resumeSessionAt: uuid})      ─→│                                  │
  │                                      │ spawnClaude({                     │
  │                                      │   forkSession: true,              │
  │                                      │   sessionId: newId,               │
  │                                      │   resumeSessionAt: uuid           │
  │                                      │ })                                │
  │                                      │   ├─ "--fork-session"             │
  │                                      │   ├─ "--session-id", newId        │
  │                                      │   └─ "--resume-session-at", uuid  │
  │                                      │              │                    │
  │                                      │              └──→ claude 加载 fork │
  │                                      │                    session 继续    │
```

#### forkSession 完整代码（反编译）

```javascript
async forkSession(V, K) {
  // V = 原始 sessionId, K = resumeSessionAt UUID (可选)
  
  // 1. 重新加载 session（确保最新）
  this.loadedSessions.delete(V);
  await this.ensureSessionLoaded(V);
  
  // 2. 获取 session 的所有消息 UUID
  let messageUuids = this.sessionMessages.get(V);
  
  // 3. 找到最新一条消息
  let latestMessage = Array.from(this.messages.values())
    .filter(m => messageUuids.has(m.uuid))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  
  // 4. 获取完整消息链（父→子）
  let transcript = this.getTranscript(latestMessage, !!K);
  
  // 5. 如果指定了恢复点，截断历史
  if (K) {
    let idx = -1;
    for (let i = transcript.length - 1; i >= 0; i--)
      if (transcript[i].uuid === K) { idx = i; break; }
    transcript = transcript.slice(0, idx + 1);
  }
  
  // 6. 创建新 session
  let newId = randomUUID();
  let sessionsDir = getProjectSessionsDir(this.projectRoot);
  let newFile = path.join(sessionsDir, `${newId}.jsonl`);
  
  // 7. 将旧 session 中的 file-history-snapshots 复制过来
  let oldSnapshots = new Map();
  for (let event of await readJsonLines(oldFile))
    if (event.type === "file-history-snapshot")
      oldSnapshots.set(event.messageId, event);
  
  // 8. 为每个事件生成新 UUID，更新 parentUuid 引用
  let uuidMap = new Map();  // old UUID → new UUID
  for (let event of transcript) uuidMap.set(event.uuid, randomUUID());
  
  let newEvents = [];
  let jsonlContent = "";
  for (let event of transcript) {
    if (event.type === "progress") continue;  // 过滤 progress
    
    let newUuid = uuidMap.get(event.uuid);
    let newParentUuid = event.parentUuid
      ? uuidMap.get(event.parentUuid) || null
      : null;
    
    let newEvent = {
      ...event,
      uuid: newUuid,
      parentUuid: newParentUuid,
      sessionId: newId,
      timestamp: (isLast ? now : event.timestamp),
    };
    newEvents.push(newEvent);
    jsonlContent += JSON.stringify(newEvent) + "\n";
    
    // 复制 file-history-snapshot 并更新 messageId
    let snapshot = oldSnapshots.get(event.uuid);
    if (snapshot) {
      snapshot.messageId = newUuid;
      jsonlContent += JSON.stringify(snapshot) + "\n";
    }
  }
  
  // 9. 追加 summary（如果有）
  let lastSummary = this.summaries.get(transcript[transcript.length - 1].uuid);
  if (lastSummary) {
    jsonlContent += JSON.stringify({
      type: "summary",
      leafUuid: newEvents[newEvents.length - 1].uuid,
      summary: lastSummary,
    }) + "\n";
  }
  
  // 10. 写入新 session 文件并注册内存
  await fs.promises.writeFile(newFile, jsonlContent);
  this.sessionMessages.set(newId, new Set(newEvents.map(e => e.uuid)));
  for (let event of newEvents) this.messages.set(event.uuid, event);
  this.loadedSessions.add(newId);
  return newId;  // 返回新 sessionId 给 WebView
}
```

#### 关键细节

- **UUID 重新映射**：fork 后的每个事件都有新 UUID，但是 parentUuid 关系保持不变（只是指向新的 UUID）
- **file-history-snapshot 复制**：checkpoint 数据随 fork 一起复制，保证新 session 的撤回功能完整
- **不拷贝 summaries**：虽然会复制最后一个 summary，但 summaries map 只在内存中，fork 后的新 session 会重新生成 summary
- **时间戳更新**：最新一条事件的时间戳更新为 fork 时的当前时间

---

### 6.2 会话文件格式

#### 文件位置

```
~/.claude/projects/<project-hash>/
  ├── <sessionId>.jsonl          # 会话事件文件
  ├── <sessionId>.jsonl          # 可能多个 session
  └── ...
```

#### 事件类型完整列表

| JSONL 事件类型 | 字段 | 说明 |
|---------------|------|------|
| `user` | `uuid, parentUuid, sessionId, timestamp, cwd, type, message, userType, version, isSidechain, teamName?, isMeta?` | 用户消息 |
| `assistant` | `uuid, parentUuid, sessionId, timestamp, cwd, type, message, userType, version, isSidechain, requestId` | 助手回复 |
| `progress` | `uuid, ...` | 进度更新事件 |
| `system` | `uuid, parentUuid, type, subtype, ...` | 系统事件（init, compact_boundary, mirror_error 等） |
| `attachment` | `uuid, ...` | 文件附件 |
| `summary` | `type, leafUuid, summary` | 上下文压缩摘要（leafUuid 指向被摘要的事件） |
| `ai-title` | `type, aiTitle, sessionId` | AI 自动生成的会话标题 |
| `custom-title` | `type, customTitle, sessionId` | 用户手动设置的标题 |
| `teleported-from` | `type, remoteSessionId, branch, messageCount` | Teleport 会话来源信息 |
| `teleport-skipped-branch` | `type, branch, failed` | Teleport 跳过的分支 |
| `file-history-snapshot` | `type, messageId, snapshot` | 文件 checkpoint 快照 |

#### 消息事件字段示例

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "hello" }]
  },
  "uuid": "a1b2c3d4-...",
  "parentUuid": null,
  "sessionId": "session_abc",
  "timestamp": "2026-04-30T10:00:00.000Z",
  "cwd": "/home/user/project",
  "userType": "unknown",
  "version": "1.0",
  "isSidechain": false
}
```

#### 会话存储 API

**saveSession** — 写入新的 teleport 会话文件：
```javascript
async saveSession(sessionId, messages, summary, teleportBranch, teleportFromSessionId) {
  let filePath = getSessionFilePath(this.projectRoot, sessionId);
  await fs.promises.mkdir(dir, { recursive: true });
  
  let jsonlContent = "";
  let messageUuids = new Set();
  let parentUuid = null;
  
  for (let msg of messages) {
    let uuid = msg.uuid || randomUUID();
    messageUuids.add(uuid);
    
    let event = {
      type: msg.type,  // "user" | "assistant"
      message: msg.message,
      uuid,
      parentUuid,
      sessionId,
      timestamp: new Date().toISOString(),
      cwd: this.projectRoot,
      isSidechain: false,
      version: "1.0",
      userType: "unknown",
    };
    if (msg.type === "assistant") event.requestId = uuid;
    
    jsonlContent += JSON.stringify(event) + "\n";
    messagesMap.set(uuid, event);
    parentUuid = uuid;
  }
  
  // 追加 teleport 元数据
  if (teleportFromSessionId) {
    jsonlContent += JSON.stringify({
      type: "teleported-from",
      remoteSessionId: teleportFromSessionId,
      branch: teleportBranch,
      messageCount: messages.length,
    }) + "\n";
  }
  
  await fs.promises.writeFile(filePath, jsonlContent);
  // 注册到内存 cache
  this.sessionMessages.set(sessionId, messageUuids);
  for (let [uuid, event] of messagesMap) this.messages.set(uuid, event);
  this.loadedSessions.add(sessionId);
}
```

---

### 6.3 事件树结构与线程重建

#### 树结构规则

```
每条消息的 parentUuid 指向其父消息：
  user (uuid: A, parentUuid: null)                    ← 根消息
    └─ assistant (uuid: B, parentUuid: A)
         ├─ content[0]: thinking
         ├─ content[1]: tool_use (name: "Agent")      ← 子代理入口
         └─ content[2]: text
              └─ user (uuid: C, parentUuid: B,         ← 子代理的输入
                       isSidechain: true,
                       teamName: "explorer")
                   └─ assistant (uuid: D, parentUuid: C,
                                 isSidechain: true,
                                 teamName: "explorer")
                        ├─ content[0]: thinking
                        ├─ content[1]: tool_use (name: "Read")
                        └─ content[2]: text
                             └─ user (uuid: E, parentUuid: D,  ← 子代理的工具结果
                                      isSidechain: true,
                                      teamName: "explorer")
                                  └─ assistant (...) ← 继续嵌套
```

#### 字段语义

| 字段 | 类型 | 意义 |
|------|------|------|
| `uuid` | string | 全局唯一事件 ID |
| `parentUuid` | string\|null | 指向父事件（构成链） |
| `isSidechain` | boolean | true = 子代理事件，不在主线程显示 |
| `teamName` | string\|null | 子代理团队名称（用于分组显示） |
| `isMeta` | boolean | true = 内部事件（/compact 等），不显示 |
| `logicalParentUuid` | string\|null | compact 后重建的逻辑父引用 |
| `isCompactSummary` | boolean | 是否是压缩摘要 |

#### getTranscript — 事件链提取

```javascript
// 从指定消息开始，沿 parentUuid 链回溯到根
getTranscript(message, useLogicalParent = false) {
  let result = [];
  let current = message;
  while (current) {
    result.unshift(current);  // 从根到当前消息的顺序
    let parentId = current.parentUuid 
      ?? (useLogicalParent ? current.logicalParentUuid : null);
    current = parentId ? this.messages.get(parentId) : undefined;
  }
  return result;  // [root, msg2, ..., latest]
}
```

#### vO4 — 主线程重建算法

```javascript
function rebuildMainThread(allEvents) {
  // 1. 构建 uuid → event 索引
  let eventMap = new Map();
  for (let event of allEvents) eventMap.set(event.uuid, event);
  
  // 2. 处理 compact_boundary：调整 parentUuid 关系
  for (let event of eventMap.values()) {
    if (event.type !== "system" || event.subtype !== "compact_boundary") continue;
    let meta = event.compactMetadata?.preservedSegment;
    if (!meta) continue;
    
    // headUuid 获得 parentUuid = anchorUuid（接回主链）
    let head = eventMap.get(meta.headUuid);
    if (head) eventMap.set(meta.headUuid, { ...head, parentUuid: meta.anchorUuid });
    
    // tailUuid 成为新的压缩边界终点
    for (let [uuid, ev] of eventMap) {
      if (ev.parentUuid === meta.anchorUuid && uuid !== meta.headUuid) {
        eventMap.set(uuid, { ...ev, parentUuid: meta.tailUuid });
      }
    }
  }
  
  // 3. 找出所有根事件（没有 parent 指向它们）
  let hasParent = new Set();
  for (let event of eventMap.values()) {
    if (event.parentUuid) hasParent.add(event.parentUuid);
  }
  let roots = [...eventMap.values()].filter(e => !hasParent.has(e.uuid));
  
  // 4. 从每个根向上找顶级 user/assistant
  let topLevel = [];
  for (let root of roots) {
    let current = root;
    let seen = new Set();
    while (current) {
      if (seen.has(current.uuid)) break;
      seen.add(current.uuid);
      if (current.type === "user" || current.type === "assistant") {
        topLevel.push(current);
        break;
      }
      current = current.parentUuid ? eventMap.get(current.parentUuid) : undefined;
    }
  }
  
  // 5. 过滤掉 sidechain/teamName/isMeta
  let mainThread = topLevel.filter(e => !e.isSidechain && !e.teamName && !e.isMeta);
  
  // 6. 找到最深的（最新的）事件
  let eventOrder = new Map();
  for (let i = 0; i < allEvents.length; i++) eventOrder.set(allEvents[i].uuid, i);
  
  let newest = mainThread.length > 0
    ? mainThread.reduce((a, b) => eventOrder.get(a.uuid) > eventOrder.get(b.uuid) ? a : b)
    : topLevel.reduce((a, b) => eventOrder.get(a.uuid) > eventOrder.get(b.uuid) ? a : b);
  
  // 7. 从 newest 回溯到根 → 主线程
  let thread = [];
  let seen = new Set();
  let current = newest;
  while (current) {
    if (seen.has(current.uuid)) break;
    seen.add(current.uuid);
    thread.push(current);
    current = current.parentUuid ? eventMap.get(current.parentUuid) : undefined;
  }
  
  return thread.reverse();  // 从根到最新
}
```

---

### 6.4 子代理 / Sidechain 渲染

#### WebView 端的嵌套结构

```javascript
// Message 类 (kz)
class kz {
  type;           // "user" | "assistant"
  uuid;
  content = [];   // uY (ContentBlock) 数组
  parentToolUseId; // 如果这条消息是子代理的回复，指向父 tool_use 的 ID
  isSynthetic;
  
  constructor(data, parentToolUseId) {
    this.uuid = data.uuid;
    this.parentToolUseId = parentToolUseId;
    this.content = data.content.map(block => new uY(block));
  }
}

// ContentBlock 类 (uY)
class uY {
  type;           // "thinking" | "tool_use" | "text" | "tool_result"
  toolResult;     // Observable signal - 工具执行结果
  progress;       // Observable signal - 进度信息
  
  constructor(block, parentToolUseId) {
    this.type = block.type;
    // ...
  }
}
```

#### 嵌套渲染规则

```
消息列表:
  ┌─ user (parentToolUseId: null)
  │    "帮我分析代码"
  │
  ├─ assistant (parentToolUseId: null)
  │    ├─ thinking
  │    ├─ tool_use: Agent (teamName: "explorer")
  │    │    └─ 子对话 (嵌套渲染, 带缩进 + 标签)
  │    │       ├─ user (parentToolUseId: Agent.uuid, isSidechain: true)
  │    │       │    "搜索 src/ 下的文件"
  │    │       ├─ assistant (parentToolUseId: Agent.uuid, isSidechain: true)
  │    │       │    ├─ thinking
  │    │       │    ├─ tool_use: Read
  │    │       │    └─ text: "找到了..."
  │    │       └─ user (parentToolUseId: Agent.uuid, isSidechain: true) ...
  │    │
  │    └─ tool_use: Edit
  │
  └─ assistant (parentToolUseId: null) ...
```

UI 上子代理的内容带缩进、不同背景色、以及 `teamName` 标签（如 "explorer" 徽章）。

---

### 6.5 Checkpoint / Rewind

#### 数据流

```
WebView                               Extension                         Claude
  │                                      │                                │
  │ [用户选择"Rewind code to here"]       │                                │
  │                                      │                                │
  │ rewindCode(sessionId, messageId) ───→│                                │
  │                                      │                                │
  │                                      │ query.rewindFiles(messageId,   │
  │                                      │   {dryRun: false}) ──────────→│
  │                                      │                                │
  │                                      │ ←─ control_response ──────────│
  │                                      │     {canRewind, filesChanged,  │
  │                                      │      insertions, deletions}    │
  │                                      │                                │
  │ ←─ {canRewind, filesChanged, ...} ──│                                │
  │                                      │                                │
  │ insertMetaMessage(                   │                                │
  │   "Code rewind successful")          │                                │
```

#### 实现机制

```javascript
// Extension 端
async rewindFiles(messageId, options) {
  return await this.query.request({
    subtype: "rewind_files",
    user_message_id: messageId,
    dry_run: options?.dryRun,
  });
}

// WebView 端 fork/rewind 弹窗组件 (Js)
function Js({session, userMessageId, willForkAfter, onClose, onConfirm}) {
  // 点击 "Rewind code to here":
  // 1. 调用 Z.rewindCode(messageUuid)
  // 2. 检查 canRewind
  // 3. 如果成功, insertMetaMessage("Code rewind successful")
  // 4. 如果需要 fork after rewind, 则调用 forkConversation()
}
```

#### file-history-snapshot 格式

```json
{
  "type": "file-history-snapshot",
  "messageId": "对应的消息 UUID",
  "snapshot": {
    "files": {
      "src/file1.ts": { "content": "...文件快照内容..." },
      "src/file2.ts": { "content": "..." }
    },
    "messageId": "快照 ID"
  }
}
```

Checkpoints 是**在 Claude 执行 Edit/Write 工具前自动创建**的。每次编辑前，Claude 通过 `control_request` 询问 Extension，Extension 回复前让 Claude 先创建文件快照。Rewind 时恢复指定消息之前的所有文件版本。

---

### 6.6 CLS 的关键区别

#### spawn 参数对比

| 参数 | VSCode 插件 | sessionBridge 新架构 |
|------|-------------|---------------------|
| 基础模式 | `--input-format stream-json` | `--input-format stream-json` ✅ |
| fork | `--fork-session` + `--session-id` + `--resume-session-at` | 需要实现 |
| session 持久化 | 默认启用 | 需要实现 |
| 会话标题 | `--session-id` 自定义 ID | 未实现 |
| 管理设置 | `--managed-settings` | 不需要 |

---

### 6.7 Plan / TodoWrite UI 渲染

#### 6.7.1 整体架构

Plan 功能涉及两个核心部分：
1. **Plan 面板（Markdown 预览）** — 通过 `openMarkdownPreview` 打开的独立预览视图
2. **Plan tool_use 卡片** — 显示在对话流中的 `ExitPlanMode` 工具卡片

TodoWrite 则是对话流中渐进式完成列表的展示。

```
用户消息流:
  ┌─ assistant 消息
  │    ├─ text: "这是计划..."
  │    ├─ tool_use: ExitPlanMode (plan: "# 计划\n1. ...")
  │    │    └─ 触发 openMarkdownPreview → 弹出 Plan 面板
  │    ├─ tool_use: TodoWrite (todos: [{...}, {...}])
  │    │    └─ 渲染 ✓ 待办列表（渐进式完成）
  │    ├─ tool_use: Edit / Write
  │    └─ text: "完成"
```

#### 6.7.2 Content Block 渲染流水线

```
kW (memo wrapper)
  └─ Zk (ErrorBoundary)
       └─ CO0 (content type router)
            ├─ type === "text"      → wG (Markdown)
            ├─ type === "image"     → aD (图片)
            ├─ type === "document"  → aD (文档)
            ├─ type === "thinking"  → NK1 (思考块)
            ├─ type === "tool_use"  → xn1 (工具卡片)
            │    └─ Qz(name).header() + Qz(name).body()
            └─ type === "tool_result" → 结果预览
```

#### 6.7.3 Tool Renderer 注册机制

所有工具渲染器通过 `Qz($, Z)` 函数按名称查找：

```javascript
function Qz(toolName, context) {
  let renderers = [
    new Tt,                           // AgentOutputTool
    new yt,                           // Bash
    new Et,                           // TaskOutput
    new fG1,                          // Agent
    new hG1,                          // TodoWrite
    new TG1(fileOpener),              // Read
    new eb(fileOpener),               // Write (pT = "Write")
    new tb(fileOpener),               // Edit (ST = "Edit")
    new LG1,                          // Glob
    new RG1,                          // Grep
    new kG1,                          // Search
    new SG1,                          // WebFetch
    new mT(fileOpener),               // ExitPlanMode (CT = "ExitPlanMode")
    new ft(fileOpener),               // ReadCoalesced
    new pa(fileOpener),               // NotebookEdit
    new xG1,                          // Skill
    ...kn1 ? [new kn1] : [],          // 插件自定义工具
    new Rt,                           // AskUserQuestion
    new pG1,                          // WebSearch
    new vG1,                          // ToolSearch
    new yG1,                          // REPL
    new bG1,                          // SandboxNetworkAccess
  ];
  let found = renderers.find(r => r.name === toolName);
  if (found) return found;
  if (isMcpTool(toolName)) return new xt(toolName);   // MCP 工具
  if (isServerTool(toolName)) return new IG1(toolName); // 自定义服务器工具
  return new CG1(toolName);  // 未知工具（只显示名称）
}
```

每个 renderer 继承自 `W2` 基类，提供：
- `header(context, input)` → 工具名称行（显示在卡片顶部）
- `body(context, input, toolResult, progress)` → 工具主体内容
- `permissionRequest(context, input, onInputChange, meta)` → 权限弹窗内容
- `hidden` → 是否隐藏该工具

#### 6.7.4 ExitPlanMode（Plan 卡片）

**定义** (`mT` class, `CT = "ExitPlanMode"`)：

```javascript
class mT extends W2 {
  static toolName = "ExitPlanMode";
  name = "ExitPlanMode";

  header(context, input) {
    // 如果 planFilePath 存在，显示 "Claude's Plan" + 可点击文件名
    if (input?.planFilePath) {
      let fileName = input.planFilePath.split("/").pop();
      return (
        <span className={J0.toolNameText}>Claude's Plan </span>
        <span className={J0.toolNameTextSecondary}>
          <a href="#" onClick={() => opener.open(input.planFilePath)}>
            {fileName}
          </a>
        </span>
      );
    }
    // 否则显示 "Claude's Plan" 或 "Plan Mode"
    let label = input?.plan ? "Claude's Plan" : "Plan Mode";
    return <span className={J0.toolNameText}>{label}</span>;
  }

  body(context, input, toolResult) {
    // 仅在解析后显示结果状态
    if (!toolResult) return null;
    let message = toolResult.is_error
      ? "Stayed in plan mode"
      : "User approved the plan";
    return <D4>{message}</D4>;
  }

  permissionRequest(context, input, onInputChange, meta) {
    // 显示 plan 预览 + 注释系统
    let channelId = meta?.channelId ?? "";
    let comments = context.getPlanComments(channelId);

    return (
      <>
        {comments.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Comments ({comments.length})
            </div>
            {comments.map(comment => (
              <div key={comment.id} style={commentStyle}>
                <div style={{ flex: 1 }}>
                  <div style={selectedTextStyle}>
                    "{comment.selectedText}"
                  </div>
                  <div>{comment.comment}</div>
                </div>
                <button onClick={() => removePlanComment(channelId, comment.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={q5.permissionRequestHeader}>
          {comments.length > 0
            ? "Continue planning"
            : "Accept this plan?"}
        </div>
        <div className={q5.permissionRequestDescription}>
          {comments.length > 0
            ? `${comments.length} comment(s) will be included as feedback`
            : "Select text in the preview to add comments"}
        </div>
      </>
    );
  }
}
```

#### 6.7.5 Plan 面板打开流程

当 Claude 调用 `ExitPlanMode` 工具时：

```javascript
// 在 fe1 (Permission Request Handler) 中:
if ($.toolName === mT.toolName) {
  let planContent = $.inputs?.plan;

  if (planContent) {
    // 从第一个 Markdown 标题提取面板标题
    let title = xe1(planContent) ?? "Claude's Plan";
    // 打开 Markdown 预览面板（启用注释）
    session.openMarkdownPreview(planContent, title, true);
  }

  // 用户批准后关闭预览
  $.onResolved((result) => {
    if (result.behavior === "allow")
      session.closePlanPreview();
  });
}
```

**`xe1` 标题提取函数**：
```javascript
function xe1(markdown) {
  for (let line of markdown.split('\n')) {
    let trimmed = line.trim();
    if (!trimmed) continue;
    let match = trimmed.match(/^#(?!#)\s+(.+?)(?:\s+#+)?\s*$/);
    if (!match) return;
    let title = match[1]?.trim();
    if (!title || /^#+$/.test(title) || title.length > 200) return;
    return title;
  }
}
```

**`openMarkdownPreview`** 发送 `open_markdown_preview` 请求到 Extension：
```javascript
openMarkdownPreview(channelId, content, title, enableComments) {
  // 初始化注释存储
  if (!enableComments) {
    let newMap = new Map(this.planCommentsByChannel.value);
    newMap.set(channelId, []);
    this.planCommentsByChannel.value = newMap;
  }
  return this.sendRequest({
    type: "open_markdown_preview",
    channelId,
    content,       // Markdown 内容
    title,
    enableComments, // true = 允许用户在预览上添加注释
  });
}
```

**注释管理** (`planCommentsByChannel`)：
- 类型：`O0(new Map)` — 一个 `Map<channelId, Comment[]>` 的 observable
- `plan_comment` 事件从 Extension 到达时，追加到对应 channel 的数组
- 每个 comment 有 `{ id, selectedText, comment }` 结构
- `removePlanComment(channelId, commentId)` 从数组中移除

#### 6.7.6 TodoWrite（渐进式完成列表）

这是用户看到的"一个慢慢实现然后可以显示完成的完成"的功能。

**定义** (`hG1` class)：

```javascript
class hG1 extends W2 {
  name = "TodoWrite";

  header(context) {
    return <span className={J0.toolNameText}>Update Todos</span>;
  }

  body(context, input, toolResult) {
    if (input && input.todos && Array.isArray(input.todos)) {
      return <bn1 todos={input.todos} />;
    }
    return super.body(context, input, toolResult);
  }
}
```

**Todo 列表渲染** (`bn1` 组件)：

```javascript
function bn1({ todos }) {
  if (!todos || todos.length === 0) return null;
  return (
    <div className={IA.todoListContainer}>
      <ul className={IA.todoList}>
        {todos.map((item, index) => (
          <li
            key={index}
            className={`${IA.todoItem} ${
              item.status === "completed" ? IA.completed : ""
            }`}
          >
            <kO0 status={item.status} />
            <div className={IA.content}>{item.content}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**三态复选框** (`kO0` 组件)：

```javascript
function kO0({ status }) {
  let ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      if (status === "completed") {
        ref.current.checked = true;
        ref.current.indeterminate = false;
      } else if (status === "in_progress") {
        ref.current.checked = false;
        ref.current.indeterminate = true;  // 短横线状态
      } else {
        ref.current.checked = false;
        ref.current.indeterminate = false; // 未选中
      }
    }
  }, [status]);

  return <input ref={ref} type="checkbox" className={IA.checkbox} disabled />;
}
```

**三态视觉表现**：
| `status` 值 | 复选框状态 | 视觉样式 |
|-------------|-----------|---------|
| `completed` | checked | ✓ 选中 + 文本 strikethrough |
| `in_progress` | indeterminate | ▬ 短横线（方块中一横） |
| `pending`（或其他） | unchecked | □ 空白 |

#### 6.7.7 ProgressSignal 驱动更新

ContentBlock (`uY` class) 维护一个 `progressSignal` 用于跟踪工具执行的进度：

```javascript
class uY {
  content;              // 原始 content block 数据
  toolResultSignal = O0();    // 工具执行结果（Observable）
  progressSignal = O0([]);    // 进度数组（Observable）
  hash = Math.random();
  endTime = null;
  startTime = null;
  lastModifiedTime = Date.now();

  // 添加进度条目
  addProgress(entry) {
    let arr = [...this.progressSignal.value];
    let idx = arr.findIndex(e => e.innerToolUseId === entry.innerToolUseId);
    if (idx >= 0) arr[idx] = entry;
    else arr.push(entry);
    this.progressSignal.value = arr;
    this.lastModifiedTime = Date.now();  // 触发 key 变更
  }

  // key 用于 React 的重新渲染判断
  get key() { return this.hash + this.lastModifiedTime; }
}
```

**`tool_progress`** 流事件会调用 `addProgress()` 更新对应 content block 的进度。由于 `key` 改变（因为 `lastModifiedTime` 更新），React 重新渲染该 block。

在 `xn1`（tool_use 渲染器）中，progress 信号被传入 `body()`：

```javascript
function hO0(contentBlock, rawBlock, context) {
  return Qz(rawBlock.name, context).body(
    context,
    rawBlock.input,
    contentBlock.toolResult.value,  // 工具结果
    contentBlock.progress.value     // 进度信息 ← 驱动渐进式更新
  );
}
```

TodoWrite 当前版本**优先使用输入数据**（todos array）而非 progressSignal，所以每次 TodoWrite 调用都会传递完整的 todos 状态（包含各 item 的 status），重新渲染整个列表。

#### 6.7.8 Edit/Write 工具卡片（Diff 显示）

Edit/Write 工具渲染器继承自 `RA` 基类：

```javascript
class RA extends W2 {
  // 通用文件工具基类
  fileToolHeader(name, filePath, options) {
    let fileName = filePath?.split("/").pop();
    if (fileName) {
      return (
        <span className={J0.toolNameText}>{name} </span>
        <span className={J0.toolNameTextSecondary}>
          <a href="#" onClick={() => opener.open(filePath, options)}>
            {fileName}
          </a>
        </span>
      );
    }
    return <span className={J0.toolNameText}>{name} file</span>;
  }
}

// Edit (tb)
class tb extends RA {
  name = "Edit";
  header(context, input) {
    return this.fileToolHeader(this.name, input.file_path, {
      searchText: input.new_string
    });
  }
  body(context, input, toolResult) {
    let diffLine = toolResult?.is_error
      ? "Edit failed"
      : PO0(input.old_string || "", input.new_string || "");
    // PO0 计算变更行数: "Added 3 lines, removed 1 line"
    let errorBanner = BP(toolResult);  // 错误信息
    return (
      <D4>{diffLine}</D4>
      {errorBanner && <D4>{errorBanner}</D4>}
      <div className={toolBodyWrapper}>
        <Rn1                          // Monaco DiffEditor
          original={input.old_string}
          modified={input.new_string}
          filePath={input.file_path}
        />
      </div>
    );
  }
}

// Write (eb)
class eb extends RA {
  name = "Write";
  body(context, input, toolResult) {
    // 类似 Edit，但显示完整文件写入
  }
}
```

#### 6.7.9 Tab 级别 Todos 状态管理

Session 级别在收到 `message_start` 事件时，会检查是否包含 TodoWrite 工具的调用并更新全局 todos 状态：

```javascript
// 在 stream event 处理中:
if ($.type === "assistant") {
  for (let block of $.message.content) {
    if (block.type === "tool_use" && block.name === "TodoWrite") {
      if (block.input && typeof block.input === "object" && "todos" in block.input) {
        this.todos.value = block.input.todos;  // 更新全局 todos
      }
    }
  }
}
```

这允许 Tab 级别显示当前 todo 进度概览（即使 tool_use 卡片被折叠）。

#### 6.7.10 关键设计要点

1. **Plan 与 TodoWrite 是独立的**：Plan 使用 `ExitPlanMode` 工具 + Markdown 预览面板，TodoWrite 是对话流中的 tool_use 卡片
2. **渐进式更新机制**：TodoWrite 通过多次调用（每次携带完整的 todos 数组）实现"逐步完成"的效果，而非实时流式更新
3. **三态复选框**：pending → in_progress → completed 是 TodoWrite 的三个状态，视觉上通过 checkbox 的 checked/indeterminate 区分
4. **Plan 注释流**：Plan 面板的注释通过 `plan_comment` 事件从 Extension 流到 WebView，存储在 `planCommentsByChannel` 的 observable Map 中
5. **重渲染触发器**：ContentBlock 的 `key` 基于 `hash + lastModifiedTime`，任何更新（tool_progress 事件、content_block_delta）都会触发 React 重新渲染

### 6.8 IDE 选中上下文（Selection Context）

编辑器选中文本后自动在输入框显示为上下文，无需手动操作。

#### 触发方式

在 VS Code 编辑器中选中任意代码/文本 → Claude Code 面板输入框自动出现：

```
1 line selected from file:///f:/path/to/file.tsx
```

不需要输入 `@` 或任何命令。选中即自动关联。

#### 输入框布局（从左到右）

| 元素 | 说明 |
|------|------|
| `+` | 手动添加附件上下文 |
| "X lines selected from file:///..." | 自动检测到的编辑器选中内容 |
| Token 计数 | 当前对话长度统计 |
| `/` | 权限模式选择器（default/acceptEdits/plan/auto/bypassPermissions） |

#### 关键行为

- **自动检测**：编辑器有选中文本时自动感知，不需要用户主动操作
- **文件 URI**：显示完整的 `file://` 路径 + 文件名
- **行数统计**：显示选中行数（"1 line selected" / "5 lines selected"）
- **多文件支持**：可以从多个文件分别选中内容
- **关闭方式**：点击输入框中的 `x` 可移除选中上下文

#### 需要实现的功能列表

从插件移植到 sessionBridge 时需要实现的完整功能：

1. **session 文件持久化** — 读写 `.jsonl` 文件，构建事件树
2. **主线程重建** — 从事件树中提取主对话线程（过滤 sidechain/teamName/isMeta）
3. **Fork** — session 文件复制 + 新 UUID 生成 + 新进程启动
4. **子代理渲染** — 基于 parentToolUseId 的嵌套消息展示
5. **Checkpoint** — file-history-snapshot 的创建与恢复
6. **上下文压缩** — compact_boundary 事件的处理
7. **权限系统** — control_request 机制的 WebView 弹窗
8. **Slash 命令** — 全部 50+ 命令的常驻进程支持
9. **Plan 面板** — Markdown 预览 + 注释系统（openMarkdownPreview + planCommentsByChannel）
10. **TodoWrite 渲染** — 三态复选框 + 渐进式完成列表
11. **Tool Renderer 注册** — Qz 工具查找 + 各工具 header/body/permissionRequest
12. **IDE 选中上下文** — 编辑器选中内容自动显示在输入框，支持文件 URI 路径和行数统计
