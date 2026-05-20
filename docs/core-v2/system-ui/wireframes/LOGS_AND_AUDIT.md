# SessionNode v2 — Logs & Audit 线框图

---

## Purpose

日志查看和审计。Core 日志、插件日志、Audit Trail、Session 事件、安装日志的统一查看。

---

## Entry

- 侧边栏导航「Logs」
- Settings → Logs
- Session Detail → View Logs
- Plugin Detail → Logs tab

---

## Desktop Wireframe — Log Viewer (Core)

```
┌──────────────────────────────────────────────────────────────────┐
│  Logs & Audit                                   [Refresh] [>]    │
│                                                                   │
│  ┌───────────────┬──────────────────────────────────────────┐    │
│  │  Filters       │  Log Content                              │    │
│  │                │                                           │    │
│  │  Source:       │  10:32:15.123  INFO  core.server  listen  │    │
│  │  [Core ▾]     │                      on 0.0.0.0:8080       │    │
│  │                │  10:32:15.456  INFO  core.node    node    │    │
│  │  Level:        │                      init complete         │    │
│  │  [INFO ▾]     │  10:30:00.001  WARN  core.session  sess_abc│    │
│  │                │                      memory usage > 80%    │    │
│  │  Search:       │  10:28:03.789  INFO  core.node    node-   │    │
│  │  [............]│                      staging connected     │    │
│  │                │  10:25:44.000  INFO  core.session  sess_abc│    │
│  │  Time Range:   │                      created               │    │
│  │  [Last 1h ▾]  │  10:20:00.500  ERROR core.plugin   plugin  │    │
│  │                │                      claude-code crash     │    │
│  │  Node:         │                      [stack trace...]      │    │
│  │  [All ▾]      │  10:15:22.111  INFO  core.config   log.level│    │
│  │                │                      changed: debug        │    │
│  │  Plugin:       │                                           │    │
│  │  [All ▾]      │                                           │    │
│  │                │  [Showing 100 of 1,234 lines]              │    │
│  │  Wrap Lines:   │  < 1 2 3 4 5 ... 124 >                    │    │
│  │  [x]           │                                           │    │
│  │                └──────────────────────────────────────────────┘
│  │  [x] Auto-refresh                                            │
│  │  Interval: [5s ▾]                                            │
│  └──────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Audit Table

```
┌──────────────────────────────────────────────────────────────────┐
│  Logs & Audit                                   [Refresh] [>]    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Core Logs ▾] [Audit Trail] [Plugin Logs] [Events]      │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [Search...                   ] [All Types ▾] [Last 24h ▾]│   │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  Time            Type               Actor     Target    │    │
│  │──────────────────────────────────────────────────────────│    │
│  │  10:32:15  session.stopped        user_abc   sess_def   │    │
│  │  10:28:03  node.connected         system     node-stg   │    │
│  │  10:25:44  session.created        user_abc   sess_abc   │    │
│  │  10:20:00  plugin.installed       admin      claude-cd  │    │
│  │  10:15:22  config.changed         admin      log.level  │    │
│  │  10:10:00  permission.granted     admin      plugin-sh  │    │
│  │  09:55:00  session.input.sent     user_abc   sess_abc   │    │
│  │  09:50:00  plugin.disabled        user_abc   file-expl  │    │
│  │  09:45:00  node.disconnected      system     node-stg   │    │
│  │  09:30:00  session.replay.started user_abc   sess_ghi   │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [Showing 10 of 234 entries]   < 1 2 3 ... 24 >         │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Audit Detail Drawer

```
┌──────────────────────────────────────────────────────────────────┐
│                                                         [Close X]│
│  ┌────────────────────────────────────────────────────────┐      │
│  │ Audit Detail                                  [Drawer] │      │
│  │                                                        │      │
│  │  Timestamp:  2026-05-19 10:32:15.000                  │      │
│  │  Type:       session.stopped                           │      │
│  │  Actor:      user_abc (user)                           │      │
│  │  Target:     sess_def (session)                        │      │
│  │  Node:       node-main                                 │      │
│  │                                                        │      │
│  │  ── Metadata ──                                       │      │
│  │  session.kind:   shell                                 │      │
│  │  session.uptime: 15m                                   │      │
│  │  reason:         user requested stop                    │      │
│  │                                                        │      │
│  │  ── Raw Event ──                                       │      │
│  │  {                                                      │      │
│  │    "type": "session.stopped",                          │      │
│  │    "actor": "user_abc",                                │      │
│  │    "target": "sess_def",                               │      │
│  │    ...                                                 │      │
│  │  }                                                      │      │
│  │                                                        │      │
│  │  [Copy Raw Event]                                      │      │
│  └────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Plugin Logs

```
┌──────────────────────────────────────────────────────────────────┐
│  Logs & Audit                                   [Refresh] [>]    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Core Logs] [Audit Trail] [Plugin Logs ▾] [Events]      │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  Plugin:  [claude-code ▾]     Level: [WARN ▾]            │    │
│  │  Search:  [................]  Time:   [Last 1h ▾]        │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  10:30:00  WARN  claude-code.model  rate limit hit,      │    │
│  │                                   retry in 5s            │    │
│  │  10:25:00  WARN  claude-code.session session_abc         │    │
│  │                                   context over 80%       │    │
│  │  10:20:00  ERROR claude-code.exec   process exited       │    │
│  │                                   with code 1            │    │
│  │  10:15:00  INFO  claude-code.cache  cache hit: model     │    │
│  │                                   /sonnet-4.bin          │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [Showing 50 of 320 lines]                               │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Session Event Viewer

```
┌──────────────────────────────────────────────────────────────────┐
│  Logs & Audit                                   [Refresh] [>]    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Core Logs] [Audit Trail] [Plugin Logs] [Events ▾]      │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  Session: [sess_abc ▾]        Type: [All ▾]              │    │
│  │  View:    [Timeline ▾]                                   │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │                                                          │    │
│  │  ┌── 10:32:15 ─────────────────────────────────────────┐ │    │
│  │  │  ● session.stopped            reason: user stop      │ │    │
│  │  └──────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  │  ┌── 10:30:00 ─────────────────────────────────────────┐ │    │
│  │  │  ◐ session.interrupted        memory limit exceeded  │ │    │
│  │  └──────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  │  ┌── 10:25:00 ─────────────────────────────────────────┐ │    │
│  │  │  ◌ session.resumed           from seq 1420           │ │    │
│  │  └──────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  │  ┌── 10:20:00 ─────────────────────────────────────────┐ │    │
│  │  │  ● session.created           kind: shell             │ │    │
│  │  └──────────────────────────────────────────────────────┘ │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [Showing 4 events]                                       │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Install Logs

```
┌──────────────────────────────────────────────────────────────────┐
│  Logs & Audit                                   [Refresh] [>]    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Core Logs] [Audit Trail] [Plugin Logs] [Install ▾]     │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  Plugin: [claude-code ▾]      Status: [All ▾]            │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  2026-05-19 10:30:00  Update   v1.0.0 → v1.1.0  ✓      │    │
│  │  2026-05-18 15:20:00  Install  v1.0.0           ✓      │    │
│  │  2026-05-17 09:00:00  Install  v1.0.0-rc        ✗      │    │
│  │    → binary claude not found                              │    │
│  │  2026-05-16 14:00:00  Install  v0.9.0           ✓      │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [Showing 4 entries]                                      │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Mobile Wireframe

```
┌──────────────────────┐
│  Logs        [Refresh]│
├──────────────────────┤
│                       │
│  [Core ▾] [INFO ▾]   │
│  [Search...]          │
│                       │
│  10:32  INFO  server  │
│  listening :8080      │
│  10:30  WARN  session │
│  memory > 80%         │
│  10:28  INFO  node    │
│  staging connected    │
│  10:25  INFO  session │
│  sess_abc created     │
│  10:20  ERROR plugin  │
│  claude-code crash    │
│  ...                  │
│                       │
├──────────────────────┤
│ [Home] [Logs●] [More] │
└──────────────────────┘

Audit on mobile:

┌──────────────────────┐
│  Audit        [←]    │
├──────────────────────┤
│                       │
│  10:32  sess.stopped  │
│  10:28  node.connect  │
│  10:25  sess.created  │
│  10:20  plugin.inst  │
│  10:15  config.chg   │
│  ...                  │
│                       │
│  > Tap to view detail │
│                       │
├──────────────────────┤
│ [Back]                │
└──────────────────────┘
```

---

## States

- **loading**: 表格 skeleton 行
- **empty**: "没有日志记录"
- **ready**: 日志行列表（无限滚动或分页）
- **partial**: 部分时间范围数据加载失败，已加载数据正常显示
- **error**: "无法加载日志" + 重试
- **permission denied**: "无权限查看日志"（Audit 需要更高权限）
- **corrupt**: "部分日志行无法解析" + 跳过显示
- **streaming**: 底部 "等待新日志..." + 旋转图标

---

## Components

| 组件 | 用途 |
|------|------|
| LogViewer | Core/Plugin 日志查看器（带语法高亮的时间戳） |
| LogFilters | 日志过滤面板（Source / Level / Search / Time / Node / Plugin） |
| AuditTable | 审计事件表格（Time / Type / Actor / Target） |
| AuditDetailDrawer | 审计事件详情侧边面板 |
| EventTimeline | Session 事件时间线 |
| InstallLogTable | 插件安装历史表格 |
| LogSearchBox | 日志全文搜索（支持关键词高亮） |
| LogPagination | 日志分页控制 |
| TabSwitcher | Logs / Audit / Plugin Logs / Events / Install 切换 |

---

## Core API

| API | 用途 |
|-----|------|
| logs.tail { source, lines } | 获取最近日志行 |
| logs.query { source, level, timeRange, search } | 带过滤的日志查询 |
| logs.stream.subscribe { source } | 实时日志流 |
| audit.list { timeRange, type, actor } | 审计事件列表 |
| audit.get { auditId } | 审计事件详情 |
| audit.export { timeRange } | 导出审计事件 |
| session.events { sessionId } | Session 事件列表 |
| plugin.history { pluginId } | 插件安装历史 |
| WebSocket: logs.event | 实时日志推送 |
| WebSocket: audit.event | 实时审计推送 |

---

## Plugin Contribution

- 插件不可贡献到 Logs & Audit 管理页面
- 插件日志在 Plugin Logs tab 中统一查看，通过 `logs.query { source: "plugin", pluginId }` 获取
- 插件可通过 `contributes.logs.namespaces` 声明日志命名空间（如 `claude-code.model`）
- Audit Trail 对所有插件事件自动记录，无需插件手动调用

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| 日志行 | Core | 每次查询获取，不持久化到 UI |
| 过滤条件 | UI | React state，可 localStorage 记住偏好 |
| 当前 tab | UI | React state |
| 分页位置 | UI | React state |
| 审计事件 | Core | 只读，按需查询 |
| 实时日志流 | Core | WebSocket 推送，UI 仅追加渲染 |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| 日志加载超时 | 显示 "加载超时" + 重试 |
| 日志文件轮转/丢失 | 显示 "日志文件已被轮转" + 提示 |
| 审计事件不完整 | 行显示 "部分审计数据可能丢失" |
| 实时流断开 | 横幅 "日志流已断开" + 自动重连 |
| 查询结果过多 | 显示 "结果过多 (N 行)，请缩小过滤范围" |
| 权限不足（Audit） | 整个 tab 禁用 + 锁图标 + "需要 admin 权限" |
| 日志行解析失败 | 灰色斜体显示原始行 + "unparsed" 标记 |
