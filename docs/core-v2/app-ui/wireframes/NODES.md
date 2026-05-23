# SessionNode v2 — Nodes 线框图

---

## Purpose

节点管理页面。查看所有节点（relay/leaf）的状态、详情，执行节点操作。

---

## Entry

- Dashboard 点击节点卡片
- 侧边栏导航「Nodes」
- Dashboard 节点列表点击 "View All"

---

## Desktop Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  Nodes                                    [+ Add Node] [Refresh] │
│                                                                   │
│  [Search...                        ] [All ▾] [Online ▾]          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [●] node-main     relay    v2.0.0    up 2h    CPU 12%   │    │
│  │      node_abc123                        192.168.1.10      │    │
│  │      [Detail] [Disconnect] [Copy ID]                      │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [●] node-vps      leaf     v2.0.0    up 45m   CPU 8%    │    │
│  │      node_def456                        203.0.113.5       │    │
│  │      [Detail] [Disconnect] [Copy ID]                      │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [○] node-staging leaf     —          offline  last 5m   │    │
│  │      node_ghi789                        —                 │    │
│  │      [Detail] [Connect] [Copy ID]                         │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 3 nodes]                                                │
└──────────────────────────────────────────────────────────────────┘
```

### Node Detail Drawer（点击 Detail 后）

```
┌──────────────────────────────────────────────────────────────────┐
│                                                         [Close X]│
│  ┌────────────────────────────────────────────────────────┐      │
│  │ Node Detail                                   [Drawer] │      │
│  │                                                         │      │
│  │  Name:     node-vps                                     │      │
│  │  ID:       node_def456                                  │      │
│  │  Role:     leaf                                         │      │
│  │  Status:   ● online                                     │      │
│  │  Address:  203.0.113.5:8080                             │      │
│  │  Version:  v2.0.0                                       │      │
│  │  Uptime:   45m                                          │      │
│  │                                                         │      │
│  │  ── System Info ──                                      │      │
│  │  OS:       Linux 6.2.0 x86_64                           │      │
│  │  CPU:      Intel Xeon 2c4t @ 2.5GHz                    │      │
│  │  Memory:   4GB / 8GB                                    │      │
│  │  Disk:     45GB / 100GB                                 │      │
│  │                                                         │      │
│  │  ── Active Sessions ──                                  │      │
│  │  sess_abc   claude-code    running    30m               │      │
│  │  sess_def   shell          running    15m               │      │
│  │                                                         │      │
│  │  ── Installed Plugins ──                                │      │
│  │  claude-code   v1.0.0    enabled                        │      │
│  │  shell         v1.0.0    enabled                        │      │
│  │  file-explorer v0.5.0    enabled                        │      │
│  │                                                         │      │
│  │  [Disconnect]  [Copy ID]  [View Logs]                   │      │
│  └────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Mobile Wireframe

```
┌──────────────────────┐
│  Nodes       [+Add]   │
├──────────────────────┤
│  [Search...     ]     │
├──────────────────────┤
│                       │
│  [●] node-main        │
│      relay · up 2h    │
│      192.168.1.10     │
│      >                 │
│                       │
│  [●] node-vps         │
│      leaf · up 45m    │
│      203.0.113.5      │
│      >                 │
│                       │
│  [○] node-staging     │
│      leaf · offline    │
│      >                 │
│                       │
├──────────────────────┤
│ [Home]  [●Nodes] [..] │
└──────────────────────┘

点击 > 打开详情:

┌──────────────────────┐
│  Node Detail   [←]   │
├──────────────────────┤
│  Name:   node-vps    │
│  Status: ● online    │
│  ID:     node_def456 │
│  Addr:   203.0.113.5 │
│  OS:     Linux 6.2   │
│  Uptime: 45m         │
│                       │
│  ── Sessions ──      │
│  sess_abc  claude .. │
│  sess_def  shell     │
│                       │
│  ── Plugins ──       │
│  claude-code   enab  │
│  shell         enab  │
│                       │
│  [Disconnect]         │
│  [Copy ID]            │
└──────────────────────┘
```

---

## States

- **loading**: 列表 skeleton 行（每行高度固定）
- **empty**: "没有配置任何节点" + "添加节点"向导
- **ready**: 节点列表
- **partial**: 部分节点详情加载失败，列表正常显示，详情页标记失败
- **error**: "无法获取节点列表" + 重试
- **offline**: 顶部 [OFFLINE] 横幅 + 列表显示内存中 last-known snapshot（不持久化到 localStorage）
- **permission denied**: 当前 actor 无权查看，显示提示

---

## Components

| 组件 | 用途 |
|------|------|
| NodeList | 节点列表（含状态指示器） |
| NodeDetailPanel | 右侧滑出详情面板 |
| NodeActionMenu | 节点操作菜单 |
| EmptyState | 空列表引导 |
| SearchBox | 搜索过滤 |
| FilterBar | 状态/角色过滤 |

---

## Core API

| API | 用途 |
|-----|------|
| node.list | 获取所有节点 |
| node.info { nodeId } | 节点详情 |
| node.health { nodeId } | 节点健康指标 |
| session.list { nodeId } | 节点上的 session |
| plugin.list { nodeId } | 节点上的插件 |
| WebSocket: node.health | 健康状态推送 |
| WebSocket: node.connected / node.disconnected | 节点连接事件 |

---

## Plugin Contribution

- 插件不能直接贡献到 Nodes 页面
- 插件可通过 manifest 声明 `contributes.nodes.contextMenu` 添加右键菜单项（v2.1+）

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| 节点列表 | Core | 每次加载重新获取 |
| 节点详情 | Core | 打开详情时获取 |
| 节点上的 session/plugin | Core | 打开详情时获取 |
| 选中节点 ID | UI | React state，刷新后重置 |
| 搜索/过滤条件 | UI | React state 或 localStorage 偏好 |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| 节点离线 | 状态指示器灰色，操作按钮禁用（除 Connect） |
| 详情加载失败 | Drawer 内显示 [ERROR] + 重试，不关闭 drawer |
| 断开节点失败 | 确认弹窗后显示失败消息 |
| 权限不足 | 操作按钮禁用 + tooltip 显示原因 |
| 节点重连中 | 状态显示 "reconnecting..." + 旋转动画 |
