# SessionNode v2 — App UI API Map

> 统一所有 UI 页面、组件、插件合同中的 Core API 命名。
> 所有 UI 文档必须使用此映射表中的命名，不得混用。

---

## 1. 命名空间约定

```
notify.*      通知（推送、标记已读）
approval.*    审批（请求、批准、拒绝）
logs.*        运行时日志（Core/Plugin diagnostic log）
audit.*       审计日志（权限变更、安装、配置变更）
session.*     Session 元数据（CRUD）
stream.*      标准流（stdout/stderr/stdin）
plugin.*      插件管理（安装、状态、权限、文件、缓存）
config.*      配置（读写、schema）
task.*        异步任务进度
node.*        节点管理（发现、健康、identity、invite 配对、peer 信任网格）
update.*      自更新状态与计划（source/policy/status/check/plan/ignore）
action.*      操作审计
```

---

## 2. 完整 API 映射表

### 2.1 notify — 通知

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `notify.list` | `notification.list` | `{ filter?, since? }` | 通知列表 | Approvals |
| `notify.markRead` | `notification.markRead` | `{ notificationId }` | 标记已读 | Approvals |
| `notify.markAllRead` | `notification.markAllRead` | — | 全部已读 | Approvals |
| `notify.request` | — | `{ pluginId?, capability?, action, detail? }` | 发起审批请求（primary approval flow） | Approvals, Plugin Detail |
| `notify.respond` | — | `{ requestId, action: "allow"|"deny" }` | 批准/拒绝审批请求（替代 approval.approve/deny） | Approvals, Plugin Detail, ApprovalCenter |
| WebSocket `notify.event` | `notification.event` | `{ type, title, body }` | 推送通知 | Approvals |
| WebSocket `notify.approval.request` | — | `{ type, requestId, pluginId, payload }` | 新审批请求推送（Go Core 实际事件名） | ApprovalCenter (global overlay), Approvals |
| WebSocket `notify.approval.result` | — | `{ type, requestId, action, respondedBy }` | 审批结果同步（Go Core 实际事件名） | ApprovalCenter (auto-remove resolved) |

### 2.2 approval — 审批

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `approval.list` | — | `{ status? }` | 审批请求列表（R13 thin facade，仅返回 pending，底层委托 notify manager） | Approvals, ApprovalCenter (hydration) |
| WebSocket `notify.approval.request` | `approval.request` | `{ type, requestId, pluginId, payload }` | 新审批请求推送（Go Core 实际事件名，UI 监听此事件） | ApprovalCenter, Approvals |
| WebSocket `notify.approval.result` | `approval.response` | `{ type, requestId, action, respondedBy }` | 审批结果同步（Go Core 实际事件名） | ApprovalCenter, Approvals |

> **注意**: `approval.approve`、`approval.deny`、`approval.get`、`approval.takeOver`、`approval.viewing` **没有实现**。审批/拒绝操作统一走 `notify.respond`（见 2.1 节），action 字段为 `"allow"` | `"deny"`。`approval.list` 是 R13 实现的 thin facade，仅返回 pending 状态的请求。

> **ApprovalCenter 全局面板**: `app/console/overlays/approval-center.tsx` 是一个固定在右下角（`z-[200]`）的可折叠全局审批面板，无需导航到 Approvals 页面即可查看和处理审批。挂载时通过 `approval.list` 拉取已有 pending approvals（hydration），WS 重连后自动重新 hydration。同时监听 `notify.approval.request` 接收新推送，监听 `notify.approval.result` 自动移除已处理的请求。通过 `ConsoleOverlays` 组件渲染为全局浮层。

### 2.3 logs — 运行时日志

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `logs.tail` | — | `{ source, lines?, level? }` | 获取最近日志 | Logs |
| `logs.query` | — | `{ source?, level?, timeRange?, search?, nodeId?, pluginId? }` | 带过滤日志查询 | Logs |
| `logs.export` | — | `{ timeRange, format? }` | 导出日志 | Logs |
| WebSocket `logs.event` | — | `{ source, level, message, timestamp }` | 实时日志推送 | Logs |

**source 枚举**: `"core"` | `"plugin"` | `"system"` | `"session"`

### 2.4 audit — 审计日志

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `audit.list` | `logs.tail(source: "audit")` | `{ timeRange?, type?, actor?, target? }` | 审计事件列表 | Logs |
| `audit.get` | — | `{ auditId }` | 审计事件详情 | Logs |
| `audit.export` | — | `{ timeRange }` | 导出审计日志 | Logs |
| WebSocket `audit.event` | — | `{ type, actor, target, metadata }` | 实时审计推送 | Logs |

### 2.5 session — Session 元数据

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `session.list` | — | `{ nodeId?, kind?, status? }` | Session 列表 | Sessions, Dashboard, Nodes |
| `session.get` | — | `{ sessionId }` | Session 详情 | Sessions |
| `session.create` | — | `{ kind, nodeId?, pluginId?, command?, cwd?, env?, historyPolicy?, config? }` | 创建 session | Sessions |
| `session.stop` | — | `{ sessionId }` | 停止 session | Sessions |
| `session.events` | `logs.session` | `{ sessionId }` | Session 事件列表 | Sessions, Logs |
| WebSocket `session.created` | — | `{ sessionId, kind, nodeId }` | Session 创建事件 | Sessions, Dashboard |
| WebSocket `session.stopped` | — | `{ sessionId, reason }` | Session 停止事件 | Sessions, Dashboard |

### 2.6 stream — 标准流

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `stream.subscribe` | — | `{ sessionId, streamType }` | 订阅实时流 | Sessions |
| `stream.replay` | — | `{ sessionId, streamType, fromSeq? }` | 回放历史流 | Sessions |
| `stream.tail` | — | `{ sessionId, streamType, lines? }` | 获取最近 N 行 | Sessions |
| `stream.write` | `stream.stdin`, `process.stdin` | `{ sessionId, data, streamType? }` | 写入 stream（默认 stdin） | Sessions |

**streamType 枚举**: `"stdout"` | `"stderr"` | `"stdin"`

### 2.7 plugin — 插件管理

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `plugin.list` | — | `{ nodeId?, status? }` | 插件列表 | Dashboard, Plugins |
| `plugin.get` | — | `{ pluginId }` | 插件详情 | Plugin Detail |
| `plugin.status` | — | `{ pluginId }` | 插件状态 | Plugin Detail |
| `plugin.enable` | — | `{ pluginId }` | 启用插件 | Plugins |
| `plugin.disable` | — | `{ pluginId }` | 禁用插件 | Plugins |
| `plugin.check` | — | `{ nodeId?, pluginId }` | 环境检查（本机/VPS 分开） | Plugin Detail |
| `plugin.install.plan` | — | `{ nodeId?, pluginId }` | 生成安装计划（按节点） | Plugin Detail |
| `plugin.install.execute` | — | `{ planId }` | 执行安装 | Plugin Detail |
| `plugin.uninstall` | — | `{ nodeId?, pluginId }` | 卸载插件（按节点） | Plugin Detail |
| `plugin.files.list` | — | `{ nodeId?, pluginId }` | 文件位置（按节点） | Plugin Detail |
| `plugin.cache.list` | — | `{ nodeId?, pluginId }` | 缓存列表（按节点） | Plugin Detail |
| `plugin.cache.clear.plan` | — | `{ nodeId?, pluginId }` | 生成清理计划（按节点） | Plugin Detail |
| `plugin.cache.clear.execute` | — | `{ planId }` | 执行清理 | Plugin Detail |
| `plugin.permissions.list` | — | `{ pluginId }` | 权限列表 | Plugin Detail |
| `plugin.permissions.grant` | — | `{ pluginId, capability, mode }` | 授予权限（高危险操作走 notify.request/respond 审批流） | Plugin Detail |
| `plugin.permissions.revoke` | — | `{ pluginId, capability }` | 撤销权限 | Plugin Detail |
| `plugin.permissions.reset` | — | `{ pluginId }` | 重置权限 | Plugin Detail |
| `plugin.config.get` | — | `{ nodeId?, pluginId, key? }` | 读插件配置（按节点） | Plugin Detail |
| `plugin.config.set` | — | `{ pluginId, key, value, expectedRevision? }` | 写插件配置（单键值对，非整对象） | Plugin Detail |
| `plugin.config.schema` | `config.schema` | `{ pluginId }` | 配置 JSON Schema | Plugin Detail |
| `plugin.history` | — | `{ nodeId?, pluginId }` | 安装历史（按节点） | Plugin Detail |
| WebSocket `plugin.registered` | — | `{ pluginId, version }` | 插件注册事件 | Dashboard, Plugins |
| WebSocket `plugin.unregistered` | — | `{ pluginId }` | 插件注销事件 | Dashboard, Plugins |

### 2.8 config — Core 配置

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `config.list` | — | `{ namespace? }` | 配置列表 | Settings |
| `config.get` | — | `{ key }` | 获取配置（返回 `{ key, value, revision }`） | Settings |
| `config.set` | — | `{ key, value, expectedRevision? }` | 设置配置（带乐观锁 revision） | Settings |
| `config.reset` | — | `{ key }` | 重置配置 | Settings |
| WebSocket `config.changed` | — | `{ key, oldValue, newValue, revision }` | 配置变更推送 | Settings |

### 2.9 task — 异步任务

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| WebSocket `task.event` | — | `{ taskId, status, progress?, message? }` | 任务进度推送 | Plugin Detail |

### 2.10 node — 节点

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `node.list` | — | — | 所有节点 | Dashboard, Nodes |
| `node.get` | `node.info` | `{ nodeId }` | 节点详情 | Nodes |
| `node.health` | — | `{ nodeId }` | 健康指标 | Nodes |
| `node.update` | — | `{ nodeId, labels? }` | 更新节点 | Settings |
| WebSocket `node.health` | — | `{ nodeId, cpu, mem, disk, uptime }` | 健康推送 | Dashboard, Nodes |
| WebSocket `node.connected` | — | `{ nodeId }` | 节点连接 | Dashboard, Nodes |
| WebSocket `node.disconnected` | — | `{ nodeId }` | 节点断开 | Dashboard, Nodes |

### 2.11 action — 操作审计

| 规范命名 | 别名（已废弃） | 参数 | 用途 | 页面 |
|---------|-------------|------|------|------|
| `action.request` | — | `{ capability, payload }` | 请求执行操作（走 audit） | 所有写操作 |

### 2.12 node — Mesh Security

| 规范命名 | 参数 | 用途 |
|---------|------|------|
| `node.identity.get` | — | 返回本地节点的 nodeId, publicKey, fingerprint（不返回 privateKey） |
| `node.invite.create` | `{ ttlSeconds?, trustDurationSeconds?, roleHint?, nameHint? }` | 创建短期 invite code |
| `node.invite.list` | — | 列出未过期 invite（不含 code） |
| `node.invite.revoke` | `{ inviteId }` | 撤销 invite |
| `node.invite.accept` | `{ peerUrl, code, nameHint? }` | 接受 invite，建立信任 |
| `node.peer.list` | — | 信任 peer 列表 + 运行时连接状态 |
| `node.peer.info` | `{ nodeId }` | 单个 peer 详情 |
| `node.peer.reconnect` | `{ nodeId }` | 触发立即重连 |
| `node.peer.disconnect` | `{ nodeId }` | 断开连接，保留信任 |
| `node.peer.revoke` | `{ nodeId }` | 撤销信任并断开连接 |
| `node.reachability.check` | — | 可公网访问性检查 |

### 2.x update — 自更新状态与计划

| 规范命名 | 参数 | 用途 |
|---|---|---|
| `update.status` | — | 返回当前 UpdateStatus（commit、behindBy、dirty 等） |
| `update.source.get` | — | 返回当前 UpdateSource（type、remote、branch、mode） |
| `update.source.set` | `{ type?, remote?, branch?, repoUrl?, mode? }` | 验证并持久化新 source |
| `update.policy.get` | — | 返回当前 UpdatePolicy |
| `update.policy.set` | `{ autoCheck?, autoApply?, checkIntervalSeconds?, allowDirtyWorktree?, allowWhenRunsActive?, ignoredVersions? }` | 合并并持久化新 policy |
| `update.check` | — | Git ls-remote + rev-parse HEAD + commit 比较；更新 status。无副作用：不写入 .git/refs/ 或 FETCH_HEAD |
| `update.plan` | — | 返回 canUpdate + blockers + steps（仅计划，不执行；无副作用，不调用 fetch/pull） |
| `update.ignore` | `{ version }` | 将 commit hash 加入 ignoredVersions |

> **update.apply 不存在。** Core 只提供检查/计划/忽略，实际的 git merge 和重启由管理员手动执行。

---

## 3. 日志三分法

所有日志在 UI 中分为三类，各有独立入口：

| 分类 | Core API | 存储位置 | UI 入口 | 用途 |
|------|---------|---------|---------|------|
| **Stream History** | `stream.replay`, `stream.tail` | Core 持久化（按 eventSeq） | Sessions → Stream Viewer | stdout/stderr/stdin 内容 |
| **Diagnostic Logs** | `logs.tail`, `logs.query` | 文件系统 (`~/.sessionnode/logs/`) | Logs → Core/Plugin Logs tab | 运行时调试信息 |
| **Audit Logs** | `audit.list`, `audit.get` | Core 持久化（append-only） | Logs → Audit Trail tab | 权限/安装/配置变更元信息 |

### UI 三入口

```
Logs & Audit 页面:

  [Core Logs ▾] [Audit Trail] [Plugin Logs] [Events] [Install]

  Core Logs    → logs.tail / logs.query      → diagnostic logs
  Audit Trail  → audit.list / audit.get       → audit logs
  Plugin Logs  → logs.query(source: plugin)   → plugin diagnostic logs
  Events       → session.events              → session event timeline
  Install      → plugin.history              → plugin install history

Stream 页面:

  Session Detail → Stream Live View → stream.subscribe → stream history (实时)
  Session Detail → Stream Replay    → stream.replay    → stream history (回放)
```

---

## 4. 页面 → API 依赖矩阵

| 页面 | 调用的 Core API |
|------|----------------|
| Dashboard | `node.list`, `node.health` (WS), `session.list`, `plugin.list`, `audit.list`, `session.created` (WS), `session.stopped` (WS), `plugin.registered` (WS) |
| Nodes | `node.list`, `node.get`, `node.health` (WS), `session.list`, `plugin.list`, `node.connected` (WS), `node.disconnected` (WS) |
| Sessions | `session.list`, `session.get`, `session.stop`, `session.events`, `stream.subscribe`, `stream.replay`, `stream.tail`, `stream.write`, `session.created` (WS), `session.stopped` (WS) |
| Plugins | `plugin.list`, `plugin.enable`, `plugin.disable`, `plugin.registered` (WS) |
| Plugin Detail | `plugin.get`, `plugin.status`, `plugin.check`, `plugin.install.plan`, `plugin.install.execute`, `plugin.files.list`, `plugin.cache.list`, `plugin.cache.clear.plan`, `plugin.cache.clear.execute`, `plugin.permissions.list`, `plugin.permissions.grant`, `plugin.permissions.revoke`, `plugin.config.get`, `plugin.config.set`, `plugin.config.schema`, `plugin.history`, `logs.query(source: plugin)`, `task.event` (WS) |
| Settings | `config.list`, `config.get`, `config.set`, `config.reset`, `node.list`, `node.update`, `plugin.list`, `config.changed` (WS) |
| Logs & Audit | `logs.tail`, `logs.query`, `logs.export`, `logs.event` (WS), `audit.list`, `audit.get`, `audit.export`, `audit.event` (WS), `session.events`, `plugin.history` |
| Approvals | `notify.list`, `notify.markRead`, `notify.markAllRead`, `notify.event` (WS), `notify.request`, `notify.respond`, `approval.list`, `notify.approval.request` (WS), `notify.approval.result` (WS) |
| ApprovalCenter (global overlay) | `approval.list` (hydration on mount/reconnect), `notify.approval.request` (WS — new approval), `notify.approval.result` (WS — auto-remove resolved), `notify.respond` (Approve/Deny), `connectionStatus` (WS — re-hydrate on reconnect) |

---

## 5. 命名迁移注意事项

1. **增量迁移**：现有代码中的旧命名（如 `logs.tail(source: "audit")`）不需要一次性全部修改，可以在 Phase 0-3 中逐步对齐
2. **Core 实现优先**：新的 Go Core 应直接使用规范命名，不需要实现别名
3. **插件接入**：Feature Plugin 通过 CoreClient.call() 使用规范命名，Core 根据 `pluginId + method` 做权限校验
4. **向后兼容**：如果旧 relay server 仍在使用，UI 层可以做一层 thin wrapper 做命名映射
5. **文档对齐**：所有 wireframe、COMPONENT_CATALOG.md、PLUGIN_UI_CONTRACT.md、SYSTEM_UI_FEATURES.md 中的 API 引用应逐步迁移到此映射表

---

## 6. Known Gaps & Caveats

### 6.1 Entry Points

- **`/plugins` is the only plugin management entry point.** There is no "AI page" or alternative plugin management surface. All plugin listing, enable/disable, permission grant/revoke, install, and config operations happen through the Plugin Management and Plugin Detail pages.

### 6.2 Launchability

- **Plugins must be launchable/direct to open from "New Tab".** If a plugin's views are not registered as `launchable: true` or `direct: true` in the view registry, they cannot be opened as a new tab. The Plugin Manager and Plugin Detail pages display the launchability status. See `isViewLaunchable()` in `app/console/plugin-host/launchability.ts`.

### 6.3 Runs Tab Attach

- **`run.attach` is implemented.** The Attach button in the Runs tab calls `run.attach({ runId, replay: false })` to verify the run exists and retrieve its sessionId. After a successful attach, the button displays "Attach verified" with the session ID. The `run.attach` capability does NOT create a process, change policy, or stop/restart — it only returns metadata, process snapshot, and optional replay data.
- **Orphaned / restorable states (Round 21).** `run.list`, `run.info`, and `run.attach` now classify runs as `orphaned` (registry has record but no live process) or `restorable` (process exited, policy.restartRestore=true). Orphaned/restorable runs show with distinct badges in UI (yellow/blue). `run.stop` on orphaned/restorable transitions directly to `stopped`. `run.attach` on non-running runs returns metadata with a descriptive reason string.
- **Run registry persistence (Round 21).** Run records are persisted to `~/.sessionnode/runs.json` via atomic writes. All mutations auto-persist. Counter is recovered from existing run IDs on startup.
- **Policy update (Round 21).** `restartRestore: true` is now accepted by `ValidatePolicy` (declaration only — Core does not auto-respawn). `onCoreShutdown: keep_running` is accepted alongside `terminate`.
- **Cross-page tab creation is NOT wired.** From Plugin Detail's Runs tab, attaching does not open a workbench terminal tab. To actually resume input/output on an existing run, use the TerminalView's "Runs" dropdown which calls `run.attach` and then `stream.subscribe` to restore interactive control.

### 6.4 Install Execute — Dry Run Stub

- **`plugin.install.execute` is a dry-run stub.** The Core handler validates the plan is approved, iterates through steps marking them completed, but does NOT execute real system commands. The UI's Install tab in Plugin Detail shows a warning: "Install execution is not implemented by Core yet." The execution result includes `dryRun: true`.

### 6.5 `plugin.cache.clear` — Bulk Clear Stub

- **`plugin.cache.clear` (bulk clear without plan) returns `not_implemented`.** Use `plugin.cache.clear.plan` + `plugin.cache.clear.execute` instead for targeted cache clearing.

### 6.6 API Mismatches Between Docs and Core

| Doc Reference | Issue | Actual |
|---|---|---|
| `plugin.permissions.revoke` params | Doc said `{ pluginId, permissionId }` (wrong field name) | Core expects `{ pluginId, capability }` |
| `plugin.config.set` params | Doc described it as taking full config object | Core expects `{ pluginId, key, value }` (single key-value pair) |
| `logs.*` / `audit.*` status | CAPABILITY_STATUS.md said "not implemented" | `logs.tail`, `logs.query`, `audit.list` are implemented |

### 6.7 API Names Without Core Handlers

The following API names appear in documentation or type definitions but have **no registered Core handler**:

- `notify.list`, `notify.markRead`, `notify.markAllRead` — no handlers; use `approval.list` + WS events
- `logs.export` — not registered
- `audit.get`, `audit.export` — not registered
- `session.events`, `session.stop` — not registered; use `session.destroy` for stop
- `node.get`, `node.update` — not registered; use `node.info` for get
- `config.get` (global non-plugin) — not registered; use `config.list`
- `approval.approve`, `approval.deny` — intentionally not implemented; use `notify.respond`

### 6.8 `plugin.config.set` — Single Key-Value Contract

Core's `plugin.config.set` operates on individual key-value pairs (`{ pluginId, key, value }`), not on entire config objects. The UI's ConfigTab in Plugin Detail iterates over all config entries and saves them individually. Any batch save is best-effort (individual errors are collected).
