# SessionNode v2 — Sessions 线框图

---

## Purpose

会话管理页面。查看所有活跃和已停止的 session，查看实时 stream，回放历史输出。

---

## Entry

- Dashboard 点击 session 卡片
- 侧边栏导航「Sessions」
- Settings → Session List

---

## Desktop Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  Sessions                                     [+ New] [Refresh]  │
│                                                                   │
│  [Search...             ] [All ▾] [Running ▾] [Kind ▾]          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  sess_abc     claude-code   ● running   30m   node-vps    │    │
│  │  [View] [Stream] [Stop] [Copy ID]                         │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  sess_def     shell          ● running   15m   node-main  │    │
│  │  [View] [Stream] [Stop] [Copy ID]                         │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  sess_ghi     claude-code   ○ stopped   2h    node-vps   │    │
│  │  [View] [Replay] [Copy ID]                                │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 3 sessions]                                              │
└──────────────────────────────────────────────────────────────────┘
```

### Stream Live View（点击 Stream 后）

```
┌──────────────────────────────────────────────────────────────────┐
│  Stream: sess_abc (stdout)                      [Pause] [Replay] │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  $ claude -p "explain this"                              │    │
│  │  ─────────────────────────────────────────────           │    │
│  │  I'll analyze the code you've shared.                    │    │
│  │                                                          │    │
│  │  [Thinking...]                                           │    │
│  │  ├── The main algorithm processes the input              │    │
│  │  ├── It validates the format                             │    │
│  │  └── Then transforms the data                            │    │
│  │                                                          │    │
│  │  [Tool Use: Read]                                        │    │
│  │  Reading: /src/main.go                                  │    │
│  │                                                          │    │
│  │  Based on the analysis...                               │    │
│  │                                                          │    │
│  │  ■ (cursor blinking — session is outputting)             │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  Session: sess_abc  |  Kind: claude-code  |  Status: ● running  │
│  [Stop Session] [Send Input...                ] [Enter]          │
└──────────────────────────────────────────────────────────────────┘
```

### Session Detail Drawer

```
┌──────────────────────────────────────────────────────────────────┐
│                                                         [Close X]│
│  ┌────────────────────────────────────────────────────────┐      │
│  │ Session Detail                                [Drawer] │      │
│  │                                                        │      │
│  │  ID:       sess_abc                                    │      │
│  │  Kind:     claude-code                                 │      │
│  │  Plugin:   claude-code v1.0.0                          │      │
│  │  Node:     node-vps (relay)                            │      │
│  │  Status:   ● running                                   │      │
│  │  Created:  2026-05-19 10:00:00                         │      │
│  │  Uptime:   30m                                         │      │
│  │                                                        │      │
│  │  ── Streams ──                                         │      │
│  │  stdout    stream_001   ● active   32KB                 │      │
│  │  stderr    stream_002   ● active   1.2KB               │      │
│  │  stdin     stream_003   ● open     0.5KB               │      │
│  │                                                        │      │
│  │  ── Subscribers ──                                     │      │
│  │  browser_xxx  (this device)                            │      │
│  │  browser_yyy  (other device)                           │      │
│  │                                                        │      │
│  │  [Stop] [Replay from Start] [Replay from Seq 0]       │      │
│  └────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Mobile Wireframe

```
┌──────────────────────┐
│  Sessions    [+New]  │
├──────────────────────┤
│  [Search...]          │
├──────────────────────┤
│                       │
│  [●] sess_abc         │
│  claude-code  30m    │
│  node-vps             │
│  >                     │
│                       │
│  [●] sess_def         │
│  shell  15m  node-main│
│  >                     │
│                       │
│  [○] sess_ghi         │
│  stopped  2h          │
│  >                     │
│                       │
├──────────────────────┤
│ [Home] [Sessions] [..]│
└──────────────────────┘

Stream View (mobile):

┌──────────────────────┐
│  Stream    [←] [Pause]│
├──────────────────────┤
│                       │
│  $ claude -p "explain"│
│  ──────────────────── │
│  I'll analyze...      │
│  [Thinking...]        │
│  ├── processes input  │
│  ├── validates format │
│  └── transforms       │
│                       │
│  [Tool Use: Read]     │
│  Reading: /src/...    │
│                       │
│  ■ (live)             │
│                       │
├──────────────────────┤
│ [Stop] [Input...     ]│
└──────────────────────┘
```

---

## States

- **loading**: 列表 skeleton
- **empty**: "没有活跃会话" + 引导创建 session
- **ready**: 正常列表
- **partial**: 部分 session 详情加载失败
- **error**: "无法获取 session 列表" + 重试
- **offline**: [OFFLINE] 横幅，stream 暂停，显示 "连接断开"

### Session 专有状态

| Session 状态 | 列表标记 | Stream 表现 |
|-------------|---------|------------|
| running | ● 绿色，显示 uptime | 实时推送 |
| stopped | ○ 灰色，显示持续时间 | 不可订阅，可 replay |
| interrupted | ◐ 黄色，显示 "可恢复" | 暂停，可恢复 |
| failed | ✗ 红色 | 显示最后输出 + 错误 |
| resumable | ◐ 黄色 + [Resume] 按钮 | 暂停，可 resume |

---

## Components

| 组件 | 用途 |
|------|------|
| SessionList | 会话列表（状态、kind、插件、节点、uptime） |
| SessionDetailPanel | 右侧详情面板 |
| SessionStatusBadge | 状态标签（running/stopped/interrupted/failed） |
| StreamViewer | 实时 stream 查看器（带 pause/resume） |
| StreamHistoryViewer | stream 回放查看器 |
| StreamTailPanel | 底部 stream tail 面板 |
| SessionActionBar | 操作栏（Stop / Replay / Send Input） |
| EmptyState | 空列表引导 |

---

## Core API

| API | 用途 |
|-----|------|
| session.list | 获取所有 session |
| session.get { sessionId } | session 详情 |
| session.stop { sessionId } | 停止 session |
| stream.subscribe { sessionId, streamType } | 订阅实时 stream |
| stream.replay { sessionId, streamType, fromSeq } | 回放历史 |
| stream.tail { sessionId, streamType, lines } | 获取最近 N 行 |
| stream.write { sessionId, data } | 发送输入 |
| WebSocket: session.event | 实时 session 事件 |
| WebSocket: session.stopped | session 停止事件 |

---

## Plugin Contribution

- 插件不能贡献到 Sessions 管理页面
- 插件的 session 由 Core 创建，Sessions 页面统一展示所有 session
- 插件可以通过 manifest 的 `sessions` 声明影响如何展示 session（`kind → viewType` 映射）

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| session 列表 | Core | 每次加载重新获取 |
| stream 实时数据 | Core | WebSocket 推送 |
| stream 历史数据 | Core | 按 eventSeq 持久化 |
| 当前选中的 sessionId | UI | React state，刷新后重置 |
| Stream 暂停状态 | UI | React state，不影响 Core |
| 输入框草稿 | UI | React state，刷新后丢失 |
| Tail 行数偏好 | UI | localStorage 偏好 |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| session 在查看时停止 | Stream 显示 "session 已停止" + replay 按钮 |
| stream 订阅失败 | 显示 "无法连接到输出流" + 重试 |
| replay 数据丢失 | 显示 "部分历史数据不可用" 标记 |
| 发送输入失败 | 输入框显示 [ERROR] + 消息未发送 |
| session 已不存在 | 列表自动移除，stream 显示 "session 已不存在" |
| 多端同时操作 | 状态实时同步，无冲突 |
