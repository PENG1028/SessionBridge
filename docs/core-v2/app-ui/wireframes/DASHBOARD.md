# SessionNode v2 — Dashboard 线框图

---

## Purpose

Dashboard 是 System UI 的首页，提供整个集群的概览：节点健康、活跃会话、插件状态、最近事件。用户一眼能看出系统是否正常。

---

## Entry

- 默认首页（进入 System UI 时第一个看到的页面）
- 导航栏「Dashboard」菜单项
- 快捷键 `Ctrl+Shift+D`

---

## Desktop Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  Dashboard                                         [Refresh] [>] │
│                                                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                │
│  │ Nodes    │ │ Sessions│ │ Plugins │ │ Errors  │                │
│  │  3       │ │  5      │ │  4      │ │  0      │                │
│  │  2 online│ │  3 run  │ │  3 enab │ │  last h │                │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘                │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Node Health                               [View All >]  │    │
│  │                                                           │    │
│  │  [●] node-main     relay   v2.0.0   up 2h    CPU 12%    │    │
│  │  [●] node-vps      leaf    v2.0.0   up 45m   CPU 8%     │    │
│  │  [○] node-staging  leaf    —        offline last 5m     │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Recent Events                              [View All >] │    │
│  │                                                           │    │
│  │  10:32:15  session.shell.stopped   sess_def    node-main │    │
│  │  10:28:03  node.connected          node-staging          │    │
│  │  10:25:44  session.claude.created  sess_abc    node-vps  │    │
│  │  10:20:00  plugin.enabled          claude-code           │    │
│  │  10:15:22  config.changed          host.logLevel         │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Mobile Wireframe

```
┌──────────────────────┐
│  Dashboard    [Refresh]│
├──────────────────────┤
│                       │
│  ┌──────┐ ┌──────┐   │
│  │ Nodes│ │Sess..│   │
│  │  3   │ │  5   │   │
│  │ 2 on │ │ 3 run│   │
│  └──────┘ └──────┘   │
│  ┌──────┐ ┌──────┐   │
│  │Plgins│ │Err.. │   │
│  │  4   │ │  0   │   │
│  │ 3 en │ │ lst h│   │
│  └──────┘ └──────┘   │
│                       │
│  Node Health          │
│  [●] node-main  relay │
│  [●] node-vps   leaf  │
│  [○] node-stag  offln │
│                       │
│  Recent Events        │
│  10:32 sess.stopped   │
│  10:28 node.connect   │
│  ...                  │
│                       │
├──────────────────────┤
│ [●Home] [Sess] [Logs] │
│ [Plugs] [Settings]    │
└──────────────────────┘
```

---

## States

- **loading**: 4 张卡片 skeleton + 列表 skeleton 行
- **empty**: "集群尚未配置任何节点" + 引导安装插件和连接节点
- **ready**: 卡片数据 + 节点列表 + 事件列表
- **partial**: 部分节点健康检查超时，已获取的数据正常展示，超时节点显示 "timeout"
- **error**: 完全无法获取数据，显示 "无法连接到 Core" + 重试按钮
- **offline**: 顶部 [OFFLINE] 横幅，显示内存中 last-known snapshot，不持久化到 localStorage

---

## Components

| 组件 | 用途 |
|------|------|
| HealthSummary | 4 张统计卡片 |
| NodeSummaryCard | 节点健康列表（简版 NodeList） |
| RecentAuditList | 最近事件列表（简版 AuditTable） |
| EmptyState | 空集群引导 |
| LoadingState | Skeleton 骨架屏 |
| ErrorState | 连接错误提示 |

---

## Core API

| API | 用途 | 频率 |
|-----|------|------|
| node.list | 节点列表 + 状态 | 页面加载 + 每 30s 轮询 |
| node.health | 节点健康指标 | 页面加载 |
| session.list | session 统计 | 页面加载 |
| plugin.list | 插件统计 | 页面加载 |
| logs.tail (source: "audit", lines: 20) | 最近事件 | 页面加载 |
| WebSocket: node.health | 健康状态推送 | 实时 |
| WebSocket: session.created/stopped | session 变更 | 实时 |
| WebSocket: plugin.registered | 插件变更 | 实时 |

---

## Plugin Contribution

- 插件不能在 Dashboard 主页贡献内容
- 后续可通过 `contributes.dashboard.widgets` 扩展（v2.1+），当前不开放

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| 节点列表 | Core | 每次加载重新获取 |
| session 统计 | Core | 每次加载重新获取 |
| 最近事件 | Core | 每次加载重新获取 |
| 卡片布局偏好 | localStorage | 卡片排序、折叠 |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| Core 未连接 | 全页显示 "正在连接 Core..." + 旋转图标 |
| 节点列表超时 | 节点卡片显示 "unreachable"，不阻塞其他数据 |
| 部分数据源失败 | 失败卡片显示 [ERROR] 标记 + 单卡片重试按钮 |
| 完全离线 | [OFFLINE] 横幅 + 灰色数据（上次快照） |
| 数据为空 | 空状态 + 引导 "添加第一个节点" |

---

## Notes

- Dashboard 是只读页面，不包含任何写操作
- 所有卡片点击后跳转到对应的管理页面
- 刷新频率不宜过高（30s 轮询或依赖 WebSocket 推送）
- 首次启动引导要显示明确的下一步操作
