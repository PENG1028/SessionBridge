# SessionNode v2 — Approvals 线框图

---

## Purpose

审批中心。收到来自插件的审批请求（如执行高风险操作），用户可批准或拒绝。多设备同步状态。

---

## Entry

- 侧边栏导航「Approvals」(带未处理数量徽章)
- 通知中心点击审批通知
- Dashboard 审批卡片
- 全局通知弹窗点击「View」

---

## Desktop Wireframe — Notification Center

```
┌──────────────────────────────────────────────────────────────────┐
│  Notifications                                    [Mark All Read] │
│                                                                   │
│  [All ▾] [Unread ▾]                                              │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  ●  claude-code 需要审批: 执行命令 rm -rf /data         │    │
│  │     10:32:15  ·  sess_abc  ·  node-main                  │    │
│  │     [Approve] [Deny] [Detail]                             │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  ●  shell 需要审批: 打开连接 203.0.113.5:22             │    │
│  │     10:30:00  ·  sess_def  ·  node-vps                   │    │
│  │     [Approve] [Deny] [Detail]                             │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  ○  claude-code: session sess_abc completed               │    │
│  │     10:28:00                                              │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  ○  node-staging connected                                │    │
│  │     10:25:00                                              │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 4 of 12 notifications]    < 1 2 3 >                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Approval Center

```
┌──────────────────────────────────────────────────────────────────┐
│  Approvals                                  [History] [Refresh]  │
│                                                                   │
│  [Pending ▾] [All Types ▾]                                      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  10:32:15  claude-code  执行命令          pending  30s  │    │
│  │  sess_abc · node-main · 剩余 30s                         │    │
│  │  rm -rf /data                                             │    │
│  │  [Approve] [Deny] [View Context]                          │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  10:30:00  shell         打开连接          pending  52s  │    │
│  │  sess_def · node-vps · 剩余 8s                           │    │
│  │  ssh 203.0.113.5:22                                      │    │
│  │  [Approve] [Deny] [View Context]                          │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  10:25:00  claude-code  写文件           approved  5m   │    │
│  │  sess_abc · node-main · 已批准 by user_abc               │    │
│  │  write /etc/config.yaml                                  │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  10:20:00  file-explorer  删除文件       denied    7m   │    │
│  │  sess_xyz · node-main · 已拒绝 by user_abc               │    │
│  │  delete /var/log/app.log (已归档)                        │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  10:15:00  claude-code  执行命令         timeout   12m  │    │
│  │  sess_abc · node-main · 已超时自动拒绝                    │    │
│  │  curl http://internal.api/secret                         │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 5 requests]                                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Approval Request Modal

```
┌──────────────────────────────────────────────────────────────────┐
│  Approval Request                                   [Close X]     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Plugin:       claude-code v1.0.0                        │    │
│  │  Session:      sess_abc (running, node-main)             │    │
│  │  Requested:    10:32:15                                  │    │
│  │  Timeout:      60s (剩余 45s)                            │    │
│  │                                                          │    │
│  │  ── Request Detail ──                                   │    │
│  │  Action:  进程: spawn                                    │    │
│  │  Command: rm -rf /data                                   │    │
│  │  Reason:  "清理临时数据目录"                              │    │
│  │                                                          │    │
│  │  ⚠ Risk Assessment:                                     │    │
│  │  · 命令会递归删除 /data 目录                             │    │
│  │  · 无法撤销                                              │    │
│  │  · 建议确认备份后再批准                                   │    │
│  │                                                          │    │
│  │  ── Context ──                                          │    │
│  │  CWD:  /data                                             │    │
│  │  User: root                                              │    │
│  │  Node: node-main (relay, 192.168.1.10)                   │    │
│  │                                                          │    │
│  │  [Deny]  [Approve with Note...]  [Approve]               │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Multi-Device Sync State

```
┌──────────────────────────────────────────────────────────────────┐
│  Approvals                                                       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  10:32:15  claude-code  执行命令           approved       │    │
│  │  sess_abc · node-main                                     │    │
│  │  由另一设备 (browser_yyy) 批准                            │    │
│  │                                                          │    │
│  │  ✓ 此请求已在其他设备处理                                  │    │
│  │  [Dismiss]                                                │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  10:30:00  shell         打开连接            pending      │    │
│  │  sess_def · node-vps                                     │    │
│  │  正在其他设备 (browser_zzz) 查看                          │    │
│  │  [View] [Take Over]                                      │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Approval Timeout

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  10:15:00  claude-code  执行命令           ✗ timeout      │    │
│  │  超时自动拒绝                                              │    │
│  │                                                          │    │
│  │  请求未在 60s 内处理，已自动拒绝                           │    │
│  │  [Dismiss]                                                │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Mobile Wireframe

```
┌──────────────────────┐
│  Approvals    [3]    │
├──────────────────────┤
│                       │
│  10:32  claude-code   │
│  执行命令  pending    │
│  >                     │
│                       │
│  10:30  shell         │
│  打开连接  pending    │
│  >                     │
│                       │
│  10:25  claude-code   │
│  写文件  approved    │
│  >                     │
│                       │
├──────────────────────┤
│ [Home] [Approvals●]  │
│ [More]                │
└──────────────────────┘

Detail (mobile):

┌──────────────────────┐
│  Approval     [←]    │
├──────────────────────┤
│                       │
│  Plugin: claude-code  │
│  Session: sess_abc    │
│  剩余: 45s            │
│                       │
│  执行命令:             │
│  rm -rf /data         │
│                       │
│  ⚠ 高风险操作          │
│  递归删除 /data       │
│  不可撤销              │
│                       │
│  CWD: /data           │
│  Node: node-main      │
│                       │
│  [Deny]  [Approve]    │
└──────────────────────┘
```

---

## States

- **loading**: 列表 skeleton 行
- **empty**: "没有待处理的审批请求"
- **ready**: 审批列表 + 操作按钮
- **partial**: 部分请求详情加载失败，列表正常
- **error**: "无法加载审批请求" + 重试
- **offline**: [OFFLINE] 横幅，审批按钮禁用
- **timeout**: 请求超时，自动拒绝 + 标记

### Approval 专有状态

| 状态 | 列表标记 | 操作 |
|------|---------|------|
| pending | ◌ 蓝色 + 剩余时间 | Approve / Deny / View |
| approved | ✓ 绿色 + 批准人 | 不可操作 |
| denied | ✗ 红色 + 拒绝人 | 不可操作 |
| timeout | ⌛ 灰色 + "超时" | 不可操作 |
| synced | ↻ + "已在其他设备处理" | Dismiss |
| reviewing | 👁 被其他设备查看 | Take Over |

---

## Components

| 组件 | 用途 |
|------|------|
| NotificationCenter | 通知列表（审批 + 系统通知） |
| ApprovalList | 审批请求列表（含专有状态） |
| ApprovalRequestModal | 审批请求详情弹窗 |
| ApprovalActionBar | 批准/拒绝操作栏 |
| ApprovalHistory | 已处理的审批历史 |
| MultiDeviceIndicator | 多设备同步状态指示 |
| RiskBadge | 风险等级标记（低/中/高/严重） |
| TimeoutCountdown | 倒计时进度条（< 10s 变红） |

---

## Core API

| API | 用途 |
|-----|------|
| `approval.list` `{ status? }` | 审批请求列表（R13 thin facade over notify manager，仅返回 pending） |
| `notify.request` `{ capability, action, detail? }` | 发起审批请求（primary approval flow） |
| `notify.respond` `{ requestId, action: "allow"\|"deny" }` | 批准/拒绝审批请求 |
| `notify.list` `{ filter?, since? }` | 通知列表 |
| `notify.markRead` `{ notificationId }` | 标记已读 |
| `notify.markAllRead` | 全部已读 |
| WebSocket: `notify.approval.request` | 新审批请求推送 |
| WebSocket: `notify.approval.result` | 审批结果推送（多设备同步） |
| WebSocket: `notify.event` | 新通知推送 |

> **已废弃**: `approval.get`、`approval.approve`、`approval.deny`、`approval.takeOver`、`approval.viewing`、`approval.timeout` 均未实现。审批/拒绝统一走 `notify.respond`，详情统一走 `approval.list`。

---

## Plugin Contribution

- 插件通过 `contributes.approval.actions` 声明需要审批的操作类型
- 每个需要审批的操作必须包含：actionId、riskLevel、description、timeout
- 插件不能修改审批 UI 的布局
- 审批请求通过 Core API 发出，UI 只负责展示和操作
- 插件可以自定义 `approval.request` 通知的消息格式

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| 审批请求列表 | Core | 每次加载获取，WebSocket 推送更新 |
| 当前选中请求 | UI | React state |
| 审批操作结果 | Core | 多设备实时同步 |
| 通知已读状态 | Core | 持久化 |
| 审批倒计时 | UI | 本地计算，Core 在超时时推送 |
| 多设备查看状态 | Core | WebSocket 推送 |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| 批准失败 | 按钮变红 + "操作失败，请重试" |
| 网络断开 | 所有操作按钮禁用 + [OFFLINE] 横幅 |
| 请求已超时 | 按钮禁用 + 灰色标记 "已超时" |
| 请求已在其他设备处理 | 按钮禁用 + 指示 "已在其他设备处理" |
| 审批并发冲突 | 后提交的显示 "请求已被其他设备处理" |
| 审批详情加载失败 | 弹窗内显示 [ERROR] + 重试 |
| 多设备同时批准 | 只有第一个成功，后续显示 "已被处理" |
