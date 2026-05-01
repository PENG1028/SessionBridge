# VSCode 插件架构分析与 sessionBridge 优化方案

**基于 Claude Code for VS Code v2.1.123 的反向工程分析**

---

## 一、核心差异：两种架构对比

### 1.1 架构图

**当前 sessionBridge（-p 模式）：**
```
每条消息:
  Browser → Relay → Agent → spawn claude -p "xxx" → claude 回复 → 进程退出
                                                              ↓
  下条消息:                                    重新 spawn + --resume 恢复
```

**VSCode 插件（持久 JSON 通道）：**
```
Browser ←→ Extension ←→ spawn claude --output-format stream-json --input-format stream-json
                                  ↓
                        进程永不退出，stdin/stdout 持续通信
                                  ↓
                        stdin:  {"type":"user", "message":{...}}
                        stdout: {"type":"stream_event", "event":{...}}
                        stdout: {"type":"assistant", "message":{...}}
                        stdin:  {"type":"user", "message":{...}}  ← 继续下一轮
```

### 1.2 一句话总结

| | sessionBridge | VSCode 插件 |
|---|---|---|
| 启动方式 | `claude -p "消息"` | `claude --input-format stream-json` |
| 进程生命周期 | 每条消息 spawn → 回复后退出 | 常驻，永不退出 |
| stdin 使用 | 写一次 → end() | 持续写，不关闭 |
| 多轮对话 | `--resume <session>` 恢复 | 直接写下一条 user 消息 |
| 冷启动 | 每次 2-5s | 零（仅首次） |

---

## 二、当前项目的 8 个核心问题及解决方案

### 问题 1：`-p` 模式导致每次冷启动

**症状**：每条消息 spawn 一个新 `claude -p` 进程，加载模型 + 初始化上下文需 2-5s。

**VSCode 插件怎么做的**：
```javascript
// 插件从不传 -p 参数
const args = [
  "--output-format", "stream-json",  // stdout 输出 JSON 事件
  "--input-format", "stream-json",    // stdin 读取 JSON 指令
  "--verbose",
  // 没有 "-p"！没有查询文本！
];
const proc = spawn(claude, args, { ... });

// 然后通过 stdin 发送格式化的 JSON 消息
proc.stdin.write(JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "text", text: "用户的查询" }]
  }
}) + "\n");
// 注意：不调 proc.stdin.end()！保持打开
```

**解决方案**：
```typescript
// 去掉 -p，改用 --input-format stream-json
const proc = spawn("claude", [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--dangerously-skip-permissions",
]);

// 写 stdin，不关闭
function sendMessage(text: string) {
  proc.stdin.write(JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }]
    }
  }) + "\n");
  // 不要 proc.stdin.end()！
}
```

### 问题 2：Relay Server 三层架构冗余

**症状**：Browser → Relay :8080 → Agent → Claude Code，数据经过 3 次序列化/反序列化，5 跳网络延迟。

**VSCode 插件怎么做的**：没有 Relay Server。Extension Host 直接 spawn claude 进程，WebView 通过 `acquireVsCodeApi().postMessage()` 与 Extension Host 通信。只有 2 层。

**解决方案**：去掉 Relay Server 和 Agent 之间的 WS 跳转。在 Next.js API route 或一个简单的 Node.js 后端中直接 spawn claude 进程，通过 WebSocket 直接推送给浏览器。

```
Browser Web UI ←WS→ 后端服务（直接管理 claude 进程）
```

不需要 `relay-server.ts`、`relay-client.ts`、`ws-client.ts` 这一整套。

### 问题 3：stream-json 解析状态机脆弱

**症状**：`agent-stream.ts` 中手工维护 `BufferState`（thinkingText、toolName、toolArgs、toolResult），处理 `content_block_start/delta/stop` + `user` + `assistant` + `result` 多个事件类型，状态容易错乱。

**VSCode 插件怎么做的**：不自己解析。使用 Node.js 的 `readline` 模块逐行读取 stdout，每行就是一个完整的 JSON 事件。事件直接透传给 consumer。

```javascript
// 插件的核心解析代码就这么多：
const rl = readline.createInterface({ input: proc.stdout });
for await (const line of rl) {
  if (!line.trim()) continue;
  const event = JSON.parse(line);  // 每行一个完整 JSON
  // 根据 event.type 分发即可
  // 不需要状态机，不需要缓冲区
}
```

**为什么这能工作**：因为 `--output-format stream-json` 的输出保证**每行一个完整 JSON 事件**，不是拆分的 SSE 事件。不需要像 Anthropic SDK 那样处理 `content_block_delta` 的局部增量。

**解决方案**：用 readline 替换手动缓冲区解析。去掉 `BufferState` 状态机。

### 问题 4：手工拼接 content blocks

**症状**：agent-stream.ts:126 需要手工累加 `thinking_delta`、`input_json_delta`、`text_delta`。

**VSCode 插件怎么做的**：在 `assistant` 事件（`type: "assistant"`）中，`message.content` 已经是最终完整的 block 数组，不需要自己拼接。

stream-json 输出的关键事件流：
```
stream_event (content_block_start)  →  开始一个 block（thinking/tool_use/text）
stream_event (content_block_delta)  →  增量内容（可忽略，用 assistant 事件的最终结果）
stream_event (content_block_stop)   →  block 结束
assistant                           →  最终完整的 message（含完整 content）
result                              →  完成，含 token 使用信息
```

所以对于 UI 渲染，**只需要监听 `assistant` 事件**就能拿到完整的消息内容。`stream_event` 可用于实时进度显示，但不是构建 UI 状态的唯一依据。

### 问题 5：`--resume` 恢复开销大

**症状**：每次重新 spawn 后用 `--resume <sessionId>` 加载历史上下文。Claude 需要从磁盘读取和重建上下文。

**VSCode 插件怎么做的**：不 `--resume`。进程一直活着，上下文在内存中。消息是追加写入 stdin 的：

```javascript
// 第一轮
proc.stdin.write(JSON.stringify({type:"user", message:{role:"user", content:[{type:"text", text:"记住数字 42"}]}}) + "\n");

// 进程回复... stdin 不关...

// 第二轮（直接追加）
proc.stdin.write(JSON.stringify({type:"user", message:{role:"user", content:[{type:"text", text:"我刚才让你记的数字是？"}]}}) + "\n");
```

### 问题 6：状态管理与 block 累积混乱

**症状**：前端 `useSession` hook 用 `serverBlocks` 累积数组 + `processedRef` 游标做增量处理，逻辑分散在 `use-ws.ts` 和 `page.tsx` 两个 useEffect 中。

**VSCode 插件怎么做的**：使用响应式状态（类似 Jotai 的 store），从 stream-json 事件直接映射到 UI 状态，不需要游标或累积数组：

```
stream_event → 更新 running block（实时进度）
assistant    → 追加完整消息到列表
result       → 标记完成 + 记录 tokens
```

每个事件对应一个明确的 UI 变更，没有"积攒 batch 再处理"的逻辑。

### 问题 7：两套解析模式（stream + pty）

**症状**：`agent-stream.ts`（主力）和 `agent.ts` + `pty-session.ts` + `output-processor.ts`（遗留）做同一件事。

**VSCode 插件怎么做的**：只有一种模式：`--output-format stream-json`。没有 PTY 解析后备方案。

**解决方案**：砍掉 PTY 模式，纯用 stream-json。

### 问题 8：Next.js static export + Relay Server 的静态文件服务

**症状**：`next build && next export` 生成静态文件，由 Relay Server 的 HTTP 服务器提供。构建多了一层。

**VSCode 插件怎么做的**：WebView 是动态 HTML，通过 VS Code API 通信。不需要静态导出。

**解决方案**：用 Next.js 开发模式（`next dev`）开发，生产部署用简单的 Node.js 后端同时提供 WebSocket + 静态文件，或直接用 `next start`。

---

## 三、推荐的新架构

### 3.1 架构图

```
┌─ 后端（Node.js 进程）────────────────────────┐
│  spawn claude --input-format stream-json ... │
│  readline 逐行读 stdout → 分发给 WS clients  │
│  WS server :3001                              │
└─────────┬────────────────────────────────────┘
          │ WebSocket (JSON 事件)
          ▼
┌─ 前端（Next.js + React）─────────────────────┐
│  WebSocket 直连后端                            │
│  事件 → 直接更新消息列表                       │
│  用户输入 → WS → 后端 → claude stdin          │
└───────────────────────────────────────────────┘
```

### 3.2 数据流

```
用户输入 → WS → 后端 → claude.stdin.write(JSON)
                                     ↓
claude.stdout → readline 逐行 → JSON.parse
                                     ↓
                              event.type?
                                ├─ system    → 提取 session/model 信息
                                ├─ stream_event → 实时进度（可选处理）
                                ├─ assistant → 追加完整消息到 UI
                                ├─ user      → 回显用户输入
                                └─ result    → 标记完成 + tokens
                                     ↓
                              WS → 浏览器 → React 渲染
```

### 3.3 核心代码（约 150 行）

```typescript
// backend.ts — 整个后端的核心
import { spawn } from "child_process";
import { createInterface } from "readline";
import WebSocket from "ws";

const wss = new WebSocket.Server({ port: 3001 });
let claudeProc: ReturnType<typeof spawn> | null = null;

function startClaude() {
  claudeProc = spawn("claude", [
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ]);

  const rl = createInterface({ input: claudeProc.stdout! });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      // 广播给所有连接的浏览器
      wss.clients.forEach((ws) => ws.send(JSON.stringify(event)));
    } catch {}
  });
}

wss.on("connection", (ws) => {
  if (!claudeProc) startClaude();

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "input") {
      // 直接写入 claude 的 stdin
      claudeProc?.stdin!.write(JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: msg.text }] }
      }) + "\n");
    }
  });
});
```

---

## 四、迁移路线

### 第一阶段：改 agent-stream（1 天）

1. 去掉 `-p` 参数，加上 `--input-format stream-json`
2. 改成常驻进程，不每次 spawn 不 end stdin
3. 用 readline 替代手动缓冲区解析
4. 砍掉 BufferState 状态机
5. 砍掉 PTY 模式

### 第二阶段：简化架构（1 天）

1. 把 relay-server 合并到后端
2. 去掉 relay-client、ws-client 的跳转逻辑
3. 前端 WebSocket 直连后端
4. 简化 session 管理（一个进程一个 session）

### 第三阶段：精炼 UI（持续）

1. 修复消息合并逻辑（不用 processedRef 游标）
2. 添加 text delta 流式效果
3. 完善错误处理

### 需要保留的部分

- `page.tsx` 的 UI 渲染（语义卡片、分组折叠、thinking 展开、状态机）
- `TOOL_SEMANTICS` 语义映射
- 文件树自动发现
- RAW/LOG 终端视图

### 可以删除的部分

- `bin/bridge.js`（不需要 CLI entry wrapper）
- `src/agent.ts` + `pty-session.ts` + `output-processor.ts`（PTY 模式）
- `src/relay-server.ts` 的 HTTP 静态文件服务
- `src/relay-client.ts`
- `lib/ws-client.ts`（简化成直接 WebSocket）
- `components/Terminal.tsx`（如果不用 xterm）
- 需求文档中的 Relay Server 相关架构图

---

## 五、关键学习总结

| 问题 | sessionBridge 做法（错） | VSCode 插件做法（对） |
|------|------------------------|---------------------|
| 进程启动 | `claude -p "query"` | `claude --input-format stream-json` |
| 进程生命周期 | 每消息 spawn + 退出 | 常驻，持续通信 |
| stdin 管理 | write + end() | 只 write，不 end() |
| 多轮对话 | `--resume <session>` | 继续写 stdin |
| JSON 解析 | 手动状态机（BufferState） | readline 逐行 |
| 架构层级 | Browser → Relay → Agent → CC | Browser → Extension → CC |
| PTY 兼容 | 两套模式 | 只有 stream-json |
| 启动延迟 | 2-5s（每次） | 0（仅首次后） |
