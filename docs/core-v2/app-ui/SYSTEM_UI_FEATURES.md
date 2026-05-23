# SessionNode v2 — System UI 功能详细设计

> 按统一模板定义 System UI 的 16 个系统功能
> 每个功能定义：UX、UI Surface、Core API、Core Protocol、State Ownership、Permission、Logs/Audit、Failure States、Migration From Existing Code

---

## 1. Dashboard

```
Feature: Dashboard
  节点概览仪表盘，展示整个集群的健康状态、关键指标、最近事件。

UX:
  - 顶部：4 张统计卡片（节点数/在线/离线、会话数/运行中、插件数/已启用、最近错误数）
  - 中部：节点列表（缩略卡片：名称、状态、角色、最后心跳）
  - 底部：最近事件流（来自 audit + session event）
  - 所有卡片可点击进入详情
  - 每 30s 自动刷新（或 WebSocket 推送）

UI Surface:
  main.editor — 默认显示

Core API:
  - node.list → 所有节点信息
  - node.health → 节点健康状态
  - session.list → session 统计
  - plugin.list → 插件统计
  - logs.tail (source: "audit", lines: 20) → 最近事件

Core Protocol:
  - WebSocket: node.health (定期推送)
  - WebSocket: plugin.registered / plugin.unregistered
  - WebSocket: session.created / session.stopped

State Ownership:
  Core 拥有所有事实数据。Dashboard 不缓存，每次渲染或刷新时从 Core 获取。
  UI 状态：选中的时间范围、展开的节点（localStorage 偏好）。

Permission:
  - node.read, session.list, plugin.list, logs.read

Logs/Audit:
  Dashboard 本身不产生 audit。但点击"停止 session"等操作会触发 audit。

Failure States:
  - loading: Skeleton 加载卡片
  - error (Core 未连接): "无法连接到 Core" + 重试按钮
  - error (部分节点超时): 显示已获取的数据 + 指出超时节点
  - empty (无节点): "尚未配置节点" + 引导
  - empty (无 session): "没有活跃会话"（正常状态）

Migration From Existing Code:
  - 现有代码没有专门的 Dashboard
  - 现有 page.tsx 中 `instances`、`logs` 等数据可以复用
  - 需要新增 `system-pages/dashboard.tsx`
```

---

## 2. Node Manager

```
Feature: Node Manager
  查看、管理所有节点。节点是 Core 的连接目标。

UX:
  - 列表视图：节点名、ID、角色（relay/leaf）、状态（online/offline）、最后心跳时间、版本
  - 详情视图（点击节点）：环境信息（OS、arch、uptime）、插件列表、session 列表、日志入口
  - 操作：断开节点、复制节点 ID、ping 节点
  - 搜索/过滤：按名称、状态、角色

UI Surface:
  main.editor — 列表页
  main.editor — 详情页（可视为子页面）

Core API:
  - node.list → 所有节点
  - node.info → 节点详情（name, id, status, version, uptime, os, arch）

Core Protocol:
  - node.health (WebSocket 推送)
  - node.disconnect → action.request

State Ownership:
  - 节点拓扑由 Core 持久化
  - 选中的节点 ID：React state，刷新后重置
  - 列表展开/折叠状态：localStorage 偏好

Permission:
  - node.read (查看)
  - node.disconnect (断开操作，需 audit)

Logs/Audit:
  - node.disconnect → audit log
  - node.connect → audit log（跨机器）

Failure States:
  - loading: 列表 skeleton
  - error: "无法获取节点列表" + 重试
  - empty: "没有配置其他节点"（单机部署正常状态）
  - node unreachable: 节点卡片显示 "unreachable" 标签

Migration From Existing Code:
  - 无现有 Node Manager 代码
  - 新增 `system-pages/node-manager.tsx`
  - Sidebar 中的 SystemPanel 可提供灵感（显示 hostname/platform/uptime）
```

---

## 3. Session Manager

```
Feature: Session Manager
  查看、管理所有 session。session 是 Core 的长期运行实体。

UX:
  - 列表视图：session ID、kind、pluginId、nodeId、status（running/stopped/failed）、uptime
  - 详情视图：session 元数据、stream 列表、event replay 控制台
  - 操作：停止 session、复制 session ID、查看 session logs
  - 实时更新：session 状态变化通过 WebSocket 推送，列表自动更新

UI Surface:
  main.editor — 列表页
  main.editor — 详情页

Core API:
  - session.list → 全部 session
  - session.get → session 详情
  - session.stop → 停止 session

Core Protocol:
  - WebSocket: session.created / session.stopped / session.event
  - WebSocket: stream.subscribe / stream.replay

State Ownership:
  - Session 列表：Core 事实来源
  - 当前选中的 sessionId：React state（刷新后从 session.list 重建）
  - session event 展示：订阅 Core stream，不缓存

Permission:
  - session.read (查看)
  - session.stop (停止，需 audit)

Logs/Audit:
  - session.stop → audit log
  - session.create → session event + audit log

Failure States:
  - loading: 列表 skeleton
  - error: "无法获取 session 列表" + 重试
  - empty: "没有活跃 session"（正常状态）
  - session 在查看中停止: 显示 "session 已停止" 标记
  - event replay 失败: "无法获取 session event 日志"

Migration From Existing Code:
  - 现有 page.tsx 的 `instances` 列表可复用概念
  - 需要新增 `system-pages/session-manager.tsx`
  - Event replay UI 可参考现有 WorkbenchContext 的消息渲染
```

---

## 4. Plugin Manager

```
Feature: Plugin Manager
  安装、卸载、启用、禁用插件。查看所有插件的状态清单。

UX:
  - 列表视图：插件名、ID、版本、状态（loaded/enabled/disabled/error）、类型（builtin/feature）
  - 批量操作：全选、批量启用/禁用
  - 状态标记：内置插件不可禁用，绿色标记
  - 搜索/过滤：按名称、状态、类型
  - 排序：按名称、状态、安装时间

UI Surface:
  main.editor — 列表页

Core API:
  - plugin.list → 所有插件
  - plugin.enable → 启用
  - plugin.disable → 禁用

Core Protocol:
  - action.request { capability: "plugin.enable" }
  - action.request { capability: "plugin.disable" }
  - WebSocket: plugin.registered / plugin.unregistered

State Ownership:
  - 插件列表：Core 事实来源
  - UI 排序/过滤偏好：localStorage

Permission:
  - plugin.read (查看)
  - plugin.enable / plugin.disable (操作，需 audit)

Logs/Audit:
  - plugin.enable → audit
  - plugin.disable → audit

Failure States:
  - loading: skeleton
  - error: "无法加载插件列表"
  - disable 失败: "插件 xxx 禁用失败" + 错误详情
  - enable 失败: "插件 xxx 启用失败" + 错误详情

Migration From Existing Code:
  - 无现有 Plugin Manager 代码
  - 新增 `system-pages/plugin-manager.tsx`
  - 现有 panel-registry 中的 ProcessPanel 可提供概念参考
```

---

## 5. Plugin Detail

```
Feature: Plugin Detail
  展示单个插件的完整信息，包括 manifest、环境、权限、文件、缓存、历史。

UX:
  - 顶部：插件名、版本、状态 badge、启用/禁用 toggle
  - Tab 导航：
    - Overview: manifest 信息、描述、capabilities 列表
    - Environment: 环境检测结果（见 Feature 6）
    - Permissions: 权限列表 + 授予/撤销（见 Feature 10）
    - Files: 文件位置（见 Feature 9）
    - Cache: 缓存查看/清理（见 Feature 8）
    - Settings: 插件配置（见 Feature 11）
    - Logs: 插件日志（见 Feature 13）
    - History: 安装历史（见 Feature 7）
  - 每个 tab 显示对应的数据和操作

UI Surface:
  plugin.detail — 详情页
  plugin.detail.permissions — 权限子页
  plugin.detail.files — 文件子页
  plugin.detail.cache — 缓存子页

Core API:
  - plugin.status → 状态详情
  - plugin.check → 环境检查
  - plugin.files.list → 文件位置
  - plugin.cache.list / cache.clear → 缓存
  - plugin.permissions.* → 权限
  - plugin.config.get / config.set → 配置
  - logs.query (source: "plugin", pluginId: "...") → 日志
  - plugin.history → 安装历史

Core Protocol:
  - 所有通过 action.request 调用
  - WebSocket: plugin.status 变更推送

State Ownership:
  - 所有数据来自 Core
  - 当前选中的 tab：React state
  - Plugin detail 不缓存 Core 数据

Permission:
  - plugin.read (基础查看)
  - plugin.* 按具体操作

Logs/Audit:
  所有写操作（enable/disable/grant/revoke/clear）→ audit

Failure States:
  - plugin 无法加载: 显示 error state + 错误消息
  - plugin 不存在: 显示 "插件未找到"
  - 权限不足: 显示 "无权限查看此插件详情"
  - Tab 内容加载失败: 只失败那个 tab，不阻塞其他 tab

Migration From Existing Code:
  - 无现有 Plugin Detail 代码
  - 新增 `system-pages/plugin-detail.tsx`
  - 参考现有 SettingsPanel 的 ConfigField 风格渲染配置
```

---

## 6. Plugin Environment Check

```
Feature: Plugin Environment Check
  检查插件的运行环境是否满足要求。

UX:
  - 结果列表：每项显示 binary/依赖名、是否满足、当前版本、要求版本
  - 三种状态：✓ 满足、✗ 不满足（红色）、— 可选（灰色）
  - 点击"重新检查"按钮
  - 如果所有检查都失败，显示整体失败提示

UI Surface:
  plugin.detail — 作为 Plugin Detail 的 Environment tab

Core API:
  - plugin.check → 执行环境检查
    Response: { checks: [{ name, required, current, met, optional }] }

Core Protocol:
  - action.request { capability: "plugin.check", payload: { pluginId: "..." } }

State Ownership:
  - 检查结果由 Core 执行，不缓存
  - 每次查看时重新执行（或缓存 N 秒）

Permission:
  - plugin.read (查看)
  - 不需要额外写权限

Logs/Audit:
  - plugin.check → audit log（记录检查时间和结果）

Failure States:
  - check 失败: "环境检查失败" + 错误消息
  - binary path 不可读: 显示 "无法访问" 而不是崩溃
  - 部分失败: 标记失败项目，不阻断整体

Migration From Existing Code:
  - 无现有代码
  - 新增 `system-pages/plugin-detail/environment-tab.tsx`
```

---

## 7. Plugin Install Plan / Execute

```
Feature: Plugin Install Plan / Execute
  Plan-Before-Apply 模式安装/修复插件。

UX:
  - 用户点击"安装" → 显示 Install Plan：
    - 将要检查的依赖列表
    - 将要下载的文件
    - 将要执行的命令（npm install, brew install, scoop install 等）
    - 预计耗时
    - 风险提示
  - 用户审阅 Plan → 点击"执行" → Core 执行安装
  - 执行过程中显示进度条 + 日志流
  - 执行完成后显示结果：成功/失败/部分成功

UI Surface:
  plugin.detail — 作为 Plugin Detail 的操作

Core API:
  - plugin.install.plan → 生成安装计划
    Request: { pluginId: "claude-code" }
    Response: { steps: [{ type: "binary" | "npm" | "brew" | "download", ... }], risks: string[], estimatedTime: "30s" }

  - plugin.install.execute → 执行安装
    Request: { pluginId: "claude-code", planId: "plan_xxx" }
    Response: { taskId: "task_xxx" } (异步)
    → 后续通过 WebSocket task.event 推送进度

Core Protocol:
  - action.request { capability: "plugin.install.plan" }
  - action.request { capability: "plugin.install.execute" }
  - WebSocket: task.event { taskId, status: "running", progress: "Installing claude-cli..." }

State Ownership:
  - Plan 由 Core 生成，不缓存
  - 执行进度由 Core Task 管理
  - UI 只展示进度，不维护状态

Permission:
  - plugin.install.plan + plugin.install.execute (高危操作组，走 plan→approval→execute 流程，需 audit)

Logs/Audit:
  - plugin.install.plan → audit
  - plugin.install.execute → audit
  - 每一步操作 → audit（命令执行、文件下载）
  - 安装日志写入 ~/.sessionnode/plugins/{id}/install/install-YYYYMMDD-HHmmss.log

Failure States:
  - plan 失败: "无法为插件 xxx 生成安装计划" + 原因
  - execute 失败（网络）: 显示 "下载失败" + 重试按钮
  - execute 失败（权限）: "需要管理员权限" + 建议手动命令
  - execute 部分成功: 显示成功项和失败项
  - 超时: "安装超时" + 查看日志链接

Migration From Existing Code:
  - 无现有代码
  - 新增 `system-pages/plugin-detail/install-tab.tsx`
```

---

## 8. Plugin Files / Cache / Artifacts

```
Feature: Plugin Files / Cache / Artifacts
  查看插件注册的文件位置、缓存内容、下载工件。

UX:
  - Files tab：插件声明的文件路径列表，每个路径显示用途（config/data/logs/cache）
    - 支持"在文件管理器中打开"、"复制路径"
    - 文件访问历史时间线（哪个 session 在什么时间访问了什么文件）

  - Cache tab：缓存条目列表
    - 每条显示：缓存 key、大小、创建时间、最后访问时间
    - "清理缓存" → Core 生成 cache.clear.plan → 用户确认 → Core 执行

  - Artifacts tab：下载的安装工件（tar.gz、.exe 等）
    - 列表：文件名、大小、下载时间、来源 URL
    - "删除工件" 操作

UI Surface:
  plugin.detail.files — 文件子页
  plugin.detail.cache — 缓存子页

Core API:
  - plugin.files.list → 文件位置声明
  - plugin.files.accessHistory → 文件访问历史
  - plugin.cache.list → 缓存条目
  - plugin.cache.clear.plan → 生成清理计划
  - plugin.cache.clear.execute → 执行清理
  - plugin.artifacts.list → 下载工件列表
  - plugin.artifacts.delete → 删除工件

Core Protocol:
  所有通过 action.request 调用。cache.clear.plan 返回 Plan，用户确认后调用 execute。

State Ownership:
  - 所有文件/缓存数据来自 Core
  - UI 不缓存任何文件路径

Permission:
  - plugin.files.register (写)
  - plugin.cache.clear (需 audit)

Logs/Audit:
  - cache.clear → audit
  - artifacts.delete → audit
  - 文件访问 → 写入 access-history.jsonl

Failure States:
  - files.list 失败: "无法获取文件列表"（插件未完全安装）
  - cache.clear 失败: "清理失败" + 错误详情
  - 文件路径不存在: 显示 "路径不可访问" 而不是崩溃
  - 大缓存列表: 分页加载，不一次渲染所有条目

Migration From Existing Code:
  - 无现有代码
  - 可以使用 system-ui 内置组件（system-ui.cache-panel、system-ui.file-tree、system-ui.history-timeline）
```

---

## 9. Permission Grant UI

```
Feature: Permission Grant UI
  管理插件的权限授予、撤销、详情查看。

UX:
  - 权限列表：每个权限显示：
    - 权限 ID、标签、描述
    - 关联的 capabilities
    - 当前状态：已授权 / 已拒绝 / 待定（never asked）
  - 操作：
    - Allow / Deny 切换
    - 按路径约束细化（如果支持）
    - "重置为默认"
  - 首次安装后自动触发权限申请弹窗：
    - 显示所有需要的权限列表
    - 每个权限有 Allow / Deny / Ask Each Time 三个选项
    - "记住选择" 复选框

UI Surface:
  plugin.detail.permissions — 权限子页
  dialog.approval — 首次安装弹窗

Core API:
  - plugin.permissions.list → 权限声明 + 当前授权状态
  - plugin.permissions.grant → 授予权限
  - plugin.permissions.revoke → 撤销权限
  - plugin.permissions.reset → 重置为默认

Core Protocol:
  - action.request { capability: "plugin.permissions.grant", payload: { pluginId, permissionId, action: "allow" } }
  - WebSocket: notify.approval.request（插件运行时请求权限）

State Ownership:
  - 权限状态存储在 Core (~/.sessionnode/config.yaml)
  - UI 展示实时状态，不缓存

Permission:
  - plugin.permissions.grant (高危)
  - plugin.permissions.revoke (高危)
  - 更改后需立即写入 audit log

Logs/Audit:
  - grant → audit（记录 actor、pluginId、permissionId、action）
  - revoke → audit
  - reset → audit

Failure States:
  - grant 失败: "授权失败" + Core 错误消息
  - revoke 失败: "撤销失败"
  - 并发权限变更: 乐观锁，提交时校验

Migration From Existing Code:
  - 无现有权限管理 UI
  - 新增 `system-pages/plugin-detail/permissions-tab.tsx`
  - 新增 `system-pages/permission-dialog.tsx`
```

---

## 10. Config / Settings

```
Feature: Config / Settings
  管理 Core 和插件的配置。

UX:
  - 设置面板（右侧滑出）：类似 VS Code 的设置 UI
  - 搜索：全文搜索配置 key、description、enum 值
  - 分节：按 extensionId 分组
  - 两级 scope：User / Workspace
  - 修改标记：dirty 状态、modified badge
  - "Save (N)" 批量保存
  - reset 到默认值
  - 特殊字段：secret（password 输入）、enum（dropdown）、boolean（checkbox）
  - Admin 子区域（远程访问密码、session 管理）
  - Updates 子区域（检查更新、更新日志）

UI Surface:
  settings.page — 设置页
  settings.page.general — 通用设置
  settings.page.plugins — 插件设置

Core API:
  - config.get / config.set → 读写配置
  - config.schema → 配置 schema（JSON Schema 格式）
  - auth.check / auth.toggle / auth.change-password
  - update.check / update.execute

Core Protocol:
  - action.request { capability: "config.get" }
  - action.request { capability: "config.set" }
  - WebSocket: config.changed（配置变更时推送）

State Ownership:
  - 配置值存在 Core 的 config.yaml
  - Dirty map：React state，用户修改但未保存
  - 搜索/折叠状态：localStorage 偏好

Permission:
  - config.read (查看所有配置)
  - config.write (修改配置，需 audit)

Logs/Audit:
  - config.set → audit（记录 key、old value、new value）

Failure States:
  - schema 加载失败: "无法加载配置 schema"
  - save 失败（部分）: 显示失败项 + 成功项
  - secret 字段: 显示 masked，但可以覆盖
  - validation 错误: 字段级别显示错误消息

Migration From Existing Code:
  - `app/console/shell/settings-panel.tsx` → 直接复用
  - 需要改：API 调用路径从 REST 改为 Core Client
  - 需要改：admin auth 区域改为 Core Protocol 调用
  - 需要改：update 区域改为 Core Protocol 调用
  - 新增：插件 config 编辑（按 plugin 过滤）
```

---

## 11. Logs / Audit Viewer

```
Feature: Logs / Audit Viewer
  查看 Core 日志、Audit 日志、Session 日志。

UX:
  - 顶部工具栏：日志源切换（Core / Audit / Session）、级别过滤、时间范围、关键词搜索
  - 日志列表：时间、级别、消息、source
  - 点击展开查看完整 JSON
  - 实时 tail：WebSocket 推送新日志，自动滚动到底部
  - 日志导出：复制选中行、下载文件

UI Surface:
  main.editor — 日志页

Core API:
  - logs.tail → 最近日志（按行数）
  - logs.query → 按条件查询（过滤器、时间范围）
  - logs.session → session event 日志

Core Protocol:
  - action.request { capability: "logs.tail" }
  - action.request { capability: "logs.query" }
  - WebSocket: log.event（实时推送新日志）

State Ownership:
  - 所有日志来自 Core，不缓存
  - UI 偏好（选中源、过滤条件、展开的行）：localStorage

Permission:
  - logs.read (查看所有日志)

Logs/Audit:
  - 查看日志本身不写 audit（否则循环）
  - 但日志查看器展示 audit log，所以是"读取审计日志的工具"

Failure States:
  - loading: 日志行 skeleton
  - error: "无法获取日志" + 重试
  - 大量日志: 虚拟滚动（只渲染可见行）
  - 实时连接断开: 显示 "连接断开，正在重连..."，重连后自动补缺失

Migration From Existing Code:
  - 无现有 Logs Viewer 组件
  - 现有 LogsPanel（extension-panels.tsx）可提供日志行渲染参考
  - 新增 `system-pages/logs-viewer.tsx`
```

---

## 12. Notification / Approval Center

```
Feature: Notification / Approval Center
  展示系统通知和处理审批请求。

UX:
  - 通知列表：所有通知（info/warn/error 类型）
    - 时间、标题、消息体
    - 未读标记
    - 可清除
  - 审批请求：需要用户操作的通知
    - 显示：请求方（哪个插件）、请求内容、detail
    - 操作按钮：Allow / Deny
    - 超时倒计时
    - 审批历史

UI Surface:
  notification.center — 通知中心

Core API:
  - notify.list → 通知列表
  - notify.markRead → 标记已读
  - notify.respond → 审批响应

Core Protocol:
  - WebSocket: notify.send（推送通知）
  - WebSocket: notify.approval.request（推送审批请求）
  - action.request { capability: "notify.respond", payload: { requestId, action } }

State Ownership:
  - 通知由 Core 维护
  - 未读计数：localStorage（刷新重置）或 Core 维护
  - UI 展示列表，不持久化

Permission:
  - notify.respond (批准/拒绝，需 audit)

Logs/Audit:
  - notify.respond { action: "allow" } → audit
  - notify.respond { action: "deny" } → audit
  - 通知发送 → audit（可选）

Failure States:
  - 通知列表失败: 通知中心显示 "无法加载"（不影响主 UI）
  - 审批操作失败: "审批提交失败" + 重试按钮
  - 审批超时: 按钮变灰，显示 "已超时"

Migration From Existing Code:
  - 无现有 Notification Center
  - 新增 `system-pages/notification-center.tsx`
  - Toast 通知可参考现有 `useWorkbench().notify` 模式
```

---

## 13. Command Palette

```
Feature: Command Palette
  快速搜索和执行命令。

UX:
  - 快捷键（Ctrl+Shift+P）打开
  - 搜索框：按命令名、类别、关键词过滤
  - 结果显示：命令名、类别、快捷键
  - 选中执行
  - 支持最近使用

UI Surface:
  commandPalette — 覆盖层弹窗

Core API:
  不需要 Core API。命令列表来自本地注册的 commands（system-ui 和 plugin）。

Core Protocol:
  执行命令时可能调用 Core API（由命令 handler 自己决定）。

State Ownership:
  - 命令列表：React state，由 command-registry 提供
  - 搜索词、选中项：React state
  - 最近使用列表：localStorage

Permission:
  不需要 Core 权限。命令执行时的具体操作受各自权限约束。

Logs/Audit:
  命令执行不写 audit（除非命令本身调用了需 audit 的 Core API）。

Failure States:
  - 空搜索: "没有匹配的命令"
  - 命令执行失败: 通知错误（通过 Notification Center）

Migration From Existing Code:
  - `app/console/commands/command-registry.ts` → 直接复用
  - 新增 `system-pages/command-palette.tsx`
  - 参考现有 ViewSelector 的 UI 风格
```

---

## 14. View / Tab / Surface Manager

```
Feature: View / Tab / Surface Manager
  管理当前打开的视图、标签页、surface 布局。

UX:
  - 视图选择器：当 pane 为空时，显示可用视图列表
  - Tab 栏：标题、关闭按钮、拖拽排序、右键菜单
  - Surface 布局：分屏、关闭 pane、移动端映射

UI Surface:
  main.editor — 主要影响
  mobile.sheet / mobile.fullscreen — 移动端映射

Core API:
  - session.list → 从 Core 重建 tab 列表（刷新后恢复打开的 session tab）
  - session.get → 获取单个 session 详情（tab 激活时加载）
  - plugin.get → 获取插件信息（关联 view 到插件）
  - stream.replay → 回放历史输出（session 恢复时）

  Surface 布局管理本身是纯 UI 操作，但 Tab 列表是从 Core session.list 投影而来，不是 UI 自己的状态。每次刷新后需要从 Core 重建哪些 tab 对应哪些 session。

Core Protocol:
  - WebSocket: session.created / session.stopped（tab 状态跟随 session 变化）
  - WebSocket: plugin.registered（view 可用性变化）

State Ownership:
  - Tab 列表：从 Core session.list 重建（刷新后）
  - Surface 布局（分屏、尺寸）：localStorage 偏好
  - Tab 关闭/打开：React state，不持久化

Permission:
  - session.read（打开 session tab 时自动校验）
  - plugin.read（打开插件 view 时自动校验）

Logs/Audit:
  - 关闭 tab 不写 audit
  - 但"停止 session"（通过 Session Manager）写 audit

Failure States:
  - 视图组件加载失败: 显示 "组件加载失败" + 查看日志
  - Session 已停止但 tab 仍显示: session.stopped WebSocket 事件到达后自动关闭或标记为 "stopped"
  - Session 列表加载失败: tab 不恢复，显示空工作台
  - Surface 配置损坏: 重置为默认布局

Migration From Existing Code:
  - `app/console/stage/` 全部可复用
  - `app/console/workbench/slots/` → SurfaceRenderer
  - 主要改动：instanceId → sessionId，localStorage 不存 tab 真相
```

---

## 15. Mobile Shell

```
Feature: Mobile Shell
  移动端自适应界面。

UX:
  - 底部导航：主页 / Sessions / Logs / Settings
  - 主内容：全屏显示当前 surface
  - 侧面板：底部 sheet 滑入
  - 支持手势：滑动关闭 sheet
  - 触控优化：按钮尺寸扩大、间距增大

UI Surface:
  mobile.sheet — 弹出面板
  mobile.fullscreen — 全屏内容

Core API:
  与桌面端共享同一套 Core API。

Core Protocol:
  与桌面端共享同一套 Core Protocol。

State Ownership:
  - 与桌面端共享 Core 状态
  - 当前导航 tab：React state
  - 用户偏好（上次打开的 tab）：localStorage

Permission:
  与桌面端相同。

Logs/Audit:
  与桌面端相同。

Failure States:
  - 网络切换（WiFi → 移动数据）: WebSocket 重连 + 状态恢复
  - 屏幕旋转: 布局自适应，不丢失状态
  - 低带宽: 减少实时更新频率

Migration From Existing Code:
  - `app/console/sidebar/mobile-sidebar.tsx` → 复用
  - `app/console/sidebar/mobile-right-panel.tsx` → 复用
  - 需要新增：底部导航栏
  - 需要新增：mobile surface 映射逻辑
```

---

## 16. ClaudeChatView — 作为对比参照

```
Feature: Claude Chat View（NOT system-ui — 列为对比）

UX:
  - 消息列表（用户/助手交替）
  - 工具活动展示（thinking → tool_use → tool_result）
  - 输入框 + slash commands
  - 对话管理

UI Surface:
  main.editor — 主编辑器

Core API:
  - process.spawn → 创建 claude session
  - stream.write → 发送用户输入
  - stream.subscribe → 订阅 stdout
  - stream.replay → 断线恢复

Core Protocol:
  标准 action.request + WebSocket stream.subscribe

State Ownership:
  - Session 由 Core 管理
  - 消息解析在插件端完成（parser.ts）
  - UI 状态（展开/折叠的工具块）：React state

Permission:
  - process.spawn, process.stdin, process.stdout, fs.*, env.*

Logs/Audit:
  标准 session event + audit

Failure States:
  - claude binary 不存在: 安装引导
  - session 意外停止: 提示 + 重连
  - approval 超时: 通知

Migration From Existing Code:
  - `app/console/main/claude-chat-view.tsx` → `plugins/claude-code/web/ClaudeChatView.tsx`
  - 不再依赖 workbench-context
  - 通过 PluginHost 获取 Core Client
```

---

## 功能优先级矩阵

| 功能 | 优先级 | 复杂度 | Core API 就绪度 | 现有代码复用度 |
|------|--------|--------|----------------|--------------|
| Dashboard | P1 | 中 | 依赖 node.health（待实现） | 0% |
| Node Manager | P1 | 中 | 依赖 node.list（待实现） | 0% |
| Session Manager | P1 | 中 | session.list 已实现 | 20%（instance list） |
| Plugin Manager | P1 | 中 | plugin.list（待实现） | 0% |
| Plugin Detail | P2 | 高 | 多项 plugin.* 待实现 | 0% |
| Environment Check | P2 | 低 | plugin.check（待实现） | 0% |
| Install Plan/Execute | P2 | 高 | plugin.install.plan / plugin.install.execute（dry-run 已实现） | 0% |
| Files/Cache/Artifacts | P2 | 中 | plugin.files.*（待实现） | 0% |
| Permission Grant | P1 | 中 | plugin.permissions.*（待实现） | 0% |
| Config/Settings | P1 | 中 | config.get/set + schema（已有） | 80%（settings-panel.tsx） |
| Logs/Audit Viewer | P1 | 中 | logs.tail/query（待实现） | 10%（LogsPanel） |
| Notification Center | P2 | 中 | notify.*（待实现） | 0% |
| Command Palette | P2 | 低 | 纯前端 | 50%（command-registry） |
| View/Tab/Surface Mgr | P0 | 中 | 纯前端 | 80%（stage/*） |
| Mobile Shell | P2 | 高 | 纯前端 | 60%（mobile-sidebar） |
| Claude Chat（参考） | — | — | process.*（已有） | 80%（需拆解） |

Core API 就绪度注释：config.get/set 和 process.* 已在当前 relay server 中实现。plugin.* 和 node.* 需要在 Go Core 中实现，不在当前 scope 内。
