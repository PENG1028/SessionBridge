# SessionNode v2 — System UI Component Catalog

> 所有 system-ui 内置组件的规格说明。
> 命名约定: `system-ui.*` 为内置组件，`pluginId.*` 为插件贡献组件。

---

## 目录

1. [Shell / Layout](#1-shell--layout)
2. [Plugin Host](#2-plugin-host)
3. [Dashboard](#3-dashboard)
4. [Nodes](#4-nodes)
5. [Sessions](#5-sessions)
6. [Plugins](#6-plugins)
7. [Permissions](#7-permissions)
8. [Settings](#8-settings)
9. [Logs & Audit](#9-logs--audit)
10. [Approvals](#10-approvals)
11. [Common](#11-common)

---

## 1. Shell / Layout

---

### system-ui.AppShell

| 字段 | 值 |
|------|-----|
| **Purpose** | 应用外壳，管理 Sidebar + Main Editor + Bottom Panel + StatusBar 布局 |
| **Surface** | main.editor |
| **Props** | `{ sidebarContent: ReactNode, mainContent: ReactNode, bottomContent?: ReactNode, sidebarWidth?: number, bottomPanelHeight?: number }` |
| **Core API** | 无，纯布局 |
| **State ownership** | sidebarWidth / bottomPanelHeight → localStorage |
| **Reusable by plugin** | 否，仅 system-ui 使用 |
| **Notes** | 响应式断点 768px 切换到 MobileShell |

---

### system-ui.AppHeader

| 字段 | 值 |
|------|-----|
| **Purpose** | 顶部导航栏：Logo + 全局搜索 + 通知图标 + 用户菜单 |
| **Surface** | main.editor |
| **Props** | `{ title: string, actions?: ReactNode[], onSearch?: (q: string) => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 高度固定 48px |

---

### system-ui.Sidebar

| 字段 | 值 |
|------|-----|
| **Purpose** | 左侧主导航：页面导航 + 插件面板列表 |
| **Surface** | main.editor |
| **Props** | `{ navItems: NavItem[], panelItems?: PanelItem[], collapsed?: boolean }` |
| **Core API** | 无 |
| **State ownership** | collapsed → localStorage，activeItem → React state |
| **Reusable by plugin** | 否（插件贡献面板列表到 Sidebar） |
| **Notes** | 支持折叠/展开，宽度 48px(折叠) / 240px(展开) |

---

### system-ui.BottomPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 底部面板容器：Stream Tail、Log Tail、Output Panel |
| **Surface** | main.editor |
| **Props** | `{ tabs: TabItem[], activeTab?: string, height?: number }` |
| **Core API** | 无 |
| **State ownership** | height → localStorage，activeTab → React state，可记住 |
| **Reusable by plugin** | 是，插件可通过 manifest 添加 tab |
| **Notes** | 最小高度 48px，最大高度 50vh |

---

### system-ui.StatusBar

| 字段 | 值 |
|------|-----|
| **Purpose** | 底部状态栏：连接状态 + 节点数 + 时间 + 插件消息 |
| **Surface** | main.editor |
| **Props** | `{ leftItems?: StatusItem[], rightItems?: StatusItem[] }` |
| **Core API** | WebSocket: node.health |
| **State ownership** | 无，实时显示 |
| **Reusable by plugin** | 是，插件可通过 `contributes.status` 添加状态项 |
| **Notes** | 高度固定 24px |

---

### system-ui.TabBar

| 字段 | 值 |
|------|-----|
| **Purpose** | Tab 切换栏，用于详情页或面板内的 tab 导航 |
| **Surface** | 多个 |
| **Props** | `{ tabs: Tab[], activeTab: string, onChange: (id: string) => void }` |
| **Core API** | 无 |
| **State ownership** | activeTab → React state（可 localStorage） |
| **Reusable by plugin** | 是 |
| **Notes** | 支持 scrollable（移动端） |

---

### system-ui.PanelContainer

| 字段 | 值 |
|------|-----|
| **Purpose** | 通用面板容器（右侧抽屉、左侧面板通用） |
| **Surface** | 多个 |
| **Props** | `{ title: string, children: ReactNode, onClose: () => void, width?: number }` |
| **Core API** | 无 |
| **State ownership** | 无，每次打开新实例 |
| **Reusable by plugin** | 是 |
| **Notes** | 支持 slide-in 动画 |

---

## 2. Plugin Host

---

### system-ui.PluginHost

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件加载器：根据 surface 加载并渲染插件 view/panel |
| **Surface** | plugin.detail, main.editor 等 |
| **Props** | `{ surface: SurfaceType, context: SurfaceRenderContext }` |
| **Core API** | plugin.get, plugin.manifest, core.client.connect |
| **State ownership** | 无，按需渲染 |
| **Reusable by plugin** | 否，此为 Plugin Host 自身 |
| **Notes** | 为每个插件创建隔离的 CoreClient 实例 |

---

### system-ui.PluginViewContainer

| 字段 | 值 |
|------|-----|
| **Purpose** | 单个插件 view 的容器：错误边界 + 加载态 + iframe/custom 渲染 |
| **Surface** | 插件贡献的 view surface |
| **Props** | `{ pluginId: string, viewId: string, context: SurfaceRenderContext }` |
| **Core API** | 通过 CoreClient 间接调用 |
| **State ownership** | mountState → React state |
| **Reusable by plugin** | 否，此为 host 基础设施 |
| **Notes** | 包裹 ErrorBoundary，崩溃不影响其余 UI |

---

### system-ui.PluginPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件 panel 容器：类似 PluginViewContainer 但放置在 panel slot |
| **Surface** | 插件贡献的 panel surface |
| **Props** | `{ pluginId: string, panelId: string, context: SurfaceRenderContext }` |
| **Core API** | 通过 CoreClient 间接调用 |
| **State ownership** | mountState → React state |
| **Reusable by plugin** | 否 |
| **Notes** | panel 可以折叠/展开 |

---

### system-ui.ExtensionSandbox

| 字段 | 值 |
|------|-----|
| **Purpose** | iframe sandbox 用于加载不可信插件 UI |
| **Surface** | plugin.detail (custom-react 类型) |
| **Props** | `{ url: string, pluginId: string, coreClientPort: MessagePort }` |
| **Core API** | 通过 postMessage 桥接 CoreClient |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 仅用于 remote 或非可信插件 |

---

## 3. Dashboard

---

### system-ui.HealthSummary

| 字段 | 值 |
|------|-----|
| **Purpose** | 4 张统计卡片：Nodes / Sessions / Plugins / Errors |
| **Surface** | main.editor (Dashboard) |
| **Props** | `{ nodes: { total: number, online: number }, sessions: { total: number, running: number }, plugins: { total: number, enabled: number }, errors: { count: number, since: string } }` |
| **Core API** | node.list, session.list, plugin.list |
| **State ownership** | 无，每次刷新重新获取 |
| **Reusable by plugin** | 否（v2.1+ 可通过 contributes.dashboard.widgets 扩展） |
| **Failure states** | 单卡片超时 → 显示 [timeout]；全部失败 → ErrorState |
| **Notes** | 卡片可点击，跳转到对应管理页 |

---

### system-ui.HealthCard

| 字段 | 值 |
|------|-----|
| **Purpose** | 单张统计卡片（数字 + 说明 + 趋势） |
| **Surface** | main.editor |
| **Props** | `{ label: string, primary: string, secondary: string, icon: IconType, onClick?: () => void, error?: boolean }` |
| **Core API** | 无（由父组件传入数据） |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 数字大字体显示 |

---

### system-ui.NodeSummaryCard

| 字段 | 值 |
|------|-----|
| **Purpose** | 简化版 NodeList（仅显示在 Dashboard） |
| **Surface** | main.editor (Dashboard) |
| **Props** | `{ nodes: NodeSummary[] }` |
| **Core API** | node.list |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 最多显示 5 个节点，超过显示 "View All" |

---

### system-ui.RecentAuditList

| 字段 | 值 |
|------|-----|
| **Purpose** | 最近审计事件列表（Dashboard 版本） |
| **Surface** | main.editor (Dashboard) |
| **Props** | `{ events: AuditEvent[] }` |
| **Core API** | logs.tail (source: "audit", lines: 20) |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 最多显示 5 条事件 |

---

## 4. Nodes

---

### system-ui.NodeList

| 字段 | 值 |
|------|-----|
| **Purpose** | 完整节点列表（状态指示器 + 基本信息） |
| **Surface** | main.editor |
| **Props** | `{ nodes: Node[], onSelect: (id: string) => void, onAction: (action: string, id: string) => void }` |
| **Core API** | node.list, WebSocket: node.health |
| **State ownership** | 无，每次加载获取 |
| **Reusable by plugin** | 否 |
| **Failure states** | 离线节点灰色 + 按钮禁用；重连中显示旋转动画 |
| **Notes** | 空列表显示 EmptyState |

---

### system-ui.NodeListItem

| 字段 | 值 |
|------|-----|
| **Purpose** | 节点列表单行 |
| **Surface** | main.editor |
| **Props** | `{ node: Node, onDetail: () => void, onAction: (action: string) => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 显示状态圆点 + 名称 + 角色 + 版本 + uptime + 指标 |

---

### system-ui.NodeDetailPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 节点详情右侧抽屉 |
| **Surface** | main.editor (drawer) |
| **Props** | `{ nodeId: string, onClose: () => void }` |
| **Core API** | node.info, node.health, session.list (by node), plugin.list (by node) |
| **State ownership** | 无，每次打开获取 |
| **Failure states** | 详情加载失败 → drawer 内 [ERROR] + 重试 |
| **Notes** | 含 System Info, Active Sessions, Installed Plugins |

---

### system-ui.NodeActionMenu

| 字段 | 值 |
|------|-----|
| **Purpose** | 节点操作菜单（Disconnect / Connect / Copy ID / View Logs） |
| **Surface** | main.editor |
| **Props** | `{ nodeId: string, status: NodeStatus, onAction: (action: string) => void }` |
| **Core API** | node.disconnect, node.connect |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Failure states** | 操作失败 → 弹窗提示 |
| **Notes** | 根据节点状态动态显示可用操作 |

---

## 5. Sessions

---

### system-ui.SessionList

| 字段 | 值 |
|------|-----|
| **Purpose** | 完整会话列表（状态 + kind + 节点 + uptime） |
| **Surface** | main.editor |
| **Props** | `{ sessions: Session[], onView: (id: string) => void, onStream: (id: string) => void, onStop: (id: string) => void }` |
| **Core API** | session.list, WebSocket: session.event, session.stopped |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Failure states** | 列表加载失败 → ErrorState；单个 session 在查看时停止 → 标记 |
| **Notes** | 支持 filter（running / stopped / all）和 search |

---

### system-ui.StreamViewer

| 字段 | 值 |
|------|-----|
| **Purpose** | 实时 stream 查看器（stdout/stderr），支持 pause/resume |
| **Surface** | main.editor, mobile.fullscreen |
| **Props** | `{ sessionId: string, streamType: StreamType, paused?: boolean, onPause?: () => void, onResume?: () => void }` |
| **Core API** | stream.subscribe, WebSocket: session.event |
| **State ownership** | paused → React state |
| **Reusable by plugin** | 否 |
| **Failure states** | 流断开 → 重连提示；session 停止 → 显示 "session 已停止" + Replay 按钮 |
| **Notes** | ANSI 转义序列渲染，自动滚动到底部 |

---

### system-ui.StreamHistoryViewer

| 字段 | 值 |
|------|-----|
| **Purpose** | Stream 回放查看器，可按 seq 定位 |
| **Surface** | main.editor, mobile.fullscreen |
| **Props** | `{ sessionId: string, streamType: StreamType, fromSeq?: number }` |
| **Core API** | stream.replay |
| **State ownership** | currentSeq → React state |
| **Reusable by plugin** | 否 |
| **Failure states** | 部分数据不可用 → 标记 "部分历史数据不可用" |
| **Notes** | 支持回放速度控制 (1x / 2x / 4x) |

---

### system-ui.StreamTailPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 底部 panel 的 stream tail（显示最近 N 行） |
| **Surface** | main.editor (bottom panel) |
| **Props** | `{ sessionId: string, streamType: StreamType, lines?: number }` |
| **Core API** | stream.tail |
| **State ownership** | lines 偏好 → localStorage |
| **Reusable by plugin** | 否 |
| **Notes** | 默认显示最近 20 行 |

---

### system-ui.SessionDetailPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 右侧 session 详情面板 |
| **Surface** | main.editor (drawer) |
| **Props** | `{ sessionId: string, onClose: () => void }` |
| **Core API** | session.get |
| **State ownership** | 无 |
| **Failure states** | 详情加载失败 → drawer 内 [ERROR] + 重试 |
| **Notes** | 包含 stream 列表、subscriber 列表 |

---

### system-ui.SessionStatusBadge

| 字段 | 值 |
|------|-----|
| **Purpose** | Session 状态标签（running / stopped / interrupted / failed / resumable） |
| **Surface** | 多个 |
| **Props** | `{ status: SessionStatus, resumable?: boolean }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | running=绿色, stopped=灰色, interrupted=黄色, failed=红色 |

---

### system-ui.SessionActionBar

| 字段 | 值 |
|------|-----|
| **Purpose** | Session 操作栏（Stop / Replay / Send Input） |
| **Surface** | main.editor, mobile.fullscreen |
| **Props** | `{ sessionId: string, status: SessionStatus, onStop: () => void, onReplay: () => void, onSendInput: (data: string) => void }` |
| **Core API** | session.stop, stream.write |
| **State ownership** | 输入框草稿 → React state |
| **Failure states** | 发送失败 → 输入框 [ERROR] + 保留消息 |
| **Notes** | 输入框支持多行 |

---

## 6. Plugins

---

### system-ui.PluginList

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件列表（状态 + 版本 + 类型 + 搜索过滤） |
| **Surface** | main.editor |
| **Props** | `{ plugins: Plugin[], onDetail: (id: string) => void, onEnable: (id: string) => void, onDisable: (id: string) => void }` |
| **Core API** | plugin.list, WebSocket: plugin.registered |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Failure states** | 加载失败 → ErrorState；单个插件出错 → 红色标记 |
| **Notes** | 内置插件显示 "builtin — always on" |

---

### system-ui.PluginListItem

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件列表单行 |
| **Surface** | main.editor |
| **Props** | `{ plugin: Plugin, onDetail: () => void, onToggle: () => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 显示 icon + 名称 + 版本 + 状态圆点 + 类型标签 + 描述 |

---

### system-ui.PluginDetailPage

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件完整详情页（8 tab 导航） |
| **Surface** | plugin.detail |
| **Props** | `{ pluginId: string }` |
| **Core API** | plugin.get, plugin.status, plugin.check |
| **State ownership** | activeTab → React state（可 localStorage 偏好） |
| **Failure states** | 整个页加载失败 → ErrorState |
| **Notes** | 桌面端全屏，移动端 fullscreen |

---

### system-ui.PluginDetailHeader

| 字段 | 值 |
|------|-----|
| **Purpose** | 详情页顶部：标题 + 版本 + 状态 + 操作按钮 |
| **Surface** | plugin.detail |
| **Props** | `{ plugin: Plugin, onDisable: () => void, onRepair: () => void, onUninstall: () => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 跟随详情页滚动 |

---

### system-ui.PluginOverviewPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | Overview tab：基本信息 + 声明的 capabilities + 所需二进制 + contributes |
| **Surface** | plugin.detail |
| **Props** | `{ plugin: PluginDetail }` |
| **Core API** | plugin.get |
| **State ownership** | 无 |
| **Failure states** | 数据加载失败 → panel 内 [ERROR] |
| **Notes** | 只读信息展示 |

---

### system-ui.PluginEnvironmentPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | Environment tab：环境检查结果 |
| **Surface** | plugin.detail |
| **Props** | `{ pluginId: string }` |
| **Core API** | plugin.check |
| **State ownership** | 检查结果缓存到 Core，可重试 |
| **Failure states** | 单项检查失败 → 红色 ✗ + 版本要求说明 |
| **Notes** | 含 [Run Check Again] 按钮 |

---

### system-ui.PluginInstallPlanPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 安装计划展示：步骤列表 + 风险评估 + 预计时间 |
| **Surface** | plugin.detail |
| **Props** | `{ plan: InstallPlan, onExecute: () => void, onCancel: () => void }` |
| **Core API** | plugin.install.plan |
| **State ownership** | 无 |
| **Failure states** | Plan 过期 → "Plan 已过期，请重新生成" |
| **Notes** | 只读，仅在安装前展示 |

---

### system-ui.PluginInstallProgressPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 安装进度展示：进度条 + 当前步骤 + 日志 |
| **Surface** | plugin.detail |
| **Props** | `{ taskId: string }` |
| **Core API** | WebSocket: task.event |
| **State ownership** | 无 |
| **Failure states** | 安装失败 → 面板变红 + 失败步骤详情 |
| **Notes** | 实时更新，含取消按钮 |

---

### system-ui.PluginInstallHistoryPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 安装/更新历史列表 |
| **Surface** | plugin.detail |
| **Props** | `{ pluginId: string }` |
| **Core API** | plugin.history |
| **State ownership** | 无 |
| **Failure states** | 加载失败 → 空列表 + 重试 |
| **Notes** | 含时间线显示 |

---

### system-ui.PluginFilesTable

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件文件位置表格 |
| **Surface** | plugin.detail |
| **Props** | `{ pluginId: string }` |
| **Core API** | plugin.files.list |
| **State ownership** | 无 |
| **Failure states** | 加载失败 → 表格内 [ERROR] |
| **Notes** | 显示路径 + 类型 + 大小 + 访问历史 |

---

### system-ui.PluginCacheTable

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件缓存条目表格 |
| **Surface** | plugin.detail |
| **Props** | `{ pluginId: string }` |
| **Core API** | plugin.cache.list |
| **State ownership** | selectedItems → React state |
| **Failure states** | 加载失败 → 表格内 [ERROR] |
| **Notes** | 支持多选 + 批量清理 |

---

### system-ui.PluginArtifactsTable

| 字段 | 值 |
|------|-----|
| **Purpose** | 下载工件表格 |
| **Surface** | plugin.detail |
| **Props** | `{ pluginId: string }` |
| **Core API** | plugin.files.list (artifact 类型) |
| **State ownership** | 无 |
| **Failure states** | 加载失败 → [ERROR] |
| **Notes** | 显示下载 URL + 大小 + 校验和 |

---

### system-ui.PluginConfigForm

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件配置表单（根据 JSON Schema 自动渲染） |
| **Surface** | plugin.detail, settings.page |
| **Props** | `{ pluginId: string, schema: JSONSchema, values: Record<string, any>, onChange: (key: string, value: any) => void }` |
| **Core API** | plugin.config.get, plugin.config.set |
| **State ownership** | formDirty → React state |
| **Failure states** | Schema 加载失败 → "无法加载配置项" |
| **Notes** | 支持所有 JSON Schema 类型 |

---

### system-ui.PluginPermissionPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件权限管理面板 |
| **Surface** | plugin.detail |
| **Props** | `{ pluginId: string }` |
| **Core API** | plugin.permissions.list, plugin.permissions.grant, plugin.permissions.revoke |
| **State ownership** | 无，权限持久化到 Core |
| **Failure states** | 授予失败 → 单项错误标记 |
| **Notes** | 支持 Allow / Deny / Ask 三级 |

---

## 7. Permissions

---

### system-ui.PermissionList

| 字段 | 值 |
|------|-----|
| **Purpose** | 权限条目列表 |
| **Surface** | plugin.detail.permissions |
| **Props** | `{ permissions: Permission[], onGrant: (perm: string, level: PermissionLevel) => void, onRevoke: (perm: string) => void }` |
| **Core API** | plugin.permissions.list |
| **State ownership** | 无 |
| **Failure states** | 列表加载失败 → [ERROR] |
| **Notes** | 分组显示（process / fs / env / config 等） |

---

### system-ui.PermissionItem

| 字段 | 值 |
|------|-----|
| **Purpose** | 单条权限条目（权限名 + 级别选择器 + 描述） |
| **Surface** | plugin.detail.permissions |
| **Props** | `{ permission: Permission, level: PermissionLevel, onChange: (level: PermissionLevel) => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 三级：[Allow ▾] [Deny ▾] [Ask ▾] |

---

### system-ui.PermissionGrantPanel

| 字段 | 值 |
|------|-----|
| **Purpose** | 批量授权面板 |
| **Surface** | plugin.detail.permissions |
| **Props** | `{ pluginId: string, onGrantAll: () => void, onDenyAll: () => void, onReset: () => void }` |
| **Core API** | plugin.permissions.grant (bulk) |
| **State ownership** | 无 |
| **Notes** | Allow All / Deny All / Reset |

---

## 8. Settings

---

### system-ui.SettingsShell

| 字段 | 值 |
|------|-----|
| **Purpose** | 设置页布局：左侧分类导航 + 右侧内容区 |
| **Surface** | settings.page |
| **Props** | `{ categories: SettingsCategory[], activeCategory: string, onCategoryChange: (id: string) => void }` |
| **Core API** | 无 |
| **State ownership** | activeCategory → React state（可 localStorage） |
| **Reusable by plugin** | 否 |
| **Notes** | 移动端变为列表 → 子页导航 |

---

### system-ui.SettingsNav

| 字段 | 值 |
|------|-----|
| **Purpose** | 设置左侧分类导航 |
| **Surface** | settings.page |
| **Props** | `{ categories: SettingsCategory[], active: string, onChange: (id: string) => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 否 |
| **Notes** | 固定宽度 200px |

---

### system-ui.SettingsSection

| 字段 | 值 |
|------|-----|
| **Purpose** | 设置分组容器（带标题和描述） |
| **Surface** | settings.page |
| **Props** | `{ title: string, description?: string, children: ReactNode }` |
| **Core API** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 分隔线 + 标题 |

---

### system-ui.ConfigField

| 字段 | 值 |
|------|-----|
| **Purpose** | 单行配置项（label + input + description） |
| **Surface** | settings.page, plugin.detail |
| **Props** | `{ key: string, label: string, type: ConfigFieldType, value: any, onChange: (value: any) => void, error?: string, description?: string }` |
| **Core API** | 无 |
| **State ownership** | 由父组件管理 |
| **Reusable by plugin** | 是 |
| **Notes** | 支持 string / number / boolean / enum / secret / multiline |

---

### system-ui.ConfigSchemaForm

| 字段 | 值 |
|------|-----|
| **Purpose** | 根据 JSON Schema 自动渲染表单 |
| **Surface** | settings.page, plugin.detail |
| **Props** | `{ schema: JSONSchema, values: Record<string, any>, onChange: (key: string, value: any) => void }` |
| **Core API** | config.schema |
| **State ownership** | formDirty → React state |
| **Failure states** | Schema 无效 → 降级显示原始 JSON |
| **Notes** | 支持嵌套对象、数组、枚举、多行文本 |

---

### system-ui.SecretField

| 字段 | 值 |
|------|-----|
| **Purpose** | 加密字段组件（mask + show + copy + regenerate） |
| **Surface** | settings.page |
| **Props** | `{ value: string, onSet: (value: string) => void, onRegenerate?: () => string }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Failure states** | 无 |
| **Notes** | 默认 mask，点击 [Show] 显示明文 |

---

### system-ui.SaveResetBar

| 字段 | 值 |
|------|-----|
| **Purpose** | 设置页面底部 Save / Reset 操作栏 |
| **Surface** | settings.page |
| **Props** | `{ dirty: boolean, onSave: () => void, onReset: () => void, saving?: boolean, error?: string }` |
| **Core API** | config.set |
| **State ownership** | 无 |
| **Failure states** | 保存失败 → Save 按钮变红 + 错误消息 |
| **Notes** | 无修改时 Save 禁用 |

---

## 9. Logs & Audit

---

### system-ui.LogViewer

| 字段 | 值 |
|------|-----|
| **Purpose** | 日志行查看器（语法高亮时间戳 + 级别染色） |
| **Surface** | main.editor |
| **Props** | `{ lines: LogLine[], wrap?: boolean, maxLines?: number }` |
| **Core API** | logs.tail, logs.query |
| **State ownership** | wrap → localStorage |
| **Failure states** | 行解析失败 → 灰色斜体显示原始行 |
| **Notes** | 虚拟列表渲染，支持大文件 |

---

### system-ui.LogFilters

| 字段 | 值 |
|------|-----|
| **Purpose** | 日志过滤面板 |
| **Surface** | main.editor |
| **Props** | `{ filters: LogFiltersState, onChange: (filters: LogFiltersState) => void }` |
| **Core API** | 无 |
| **State ownership** | filters → React state（可 localStorage） |
| **Failure states** | 无 |
| **Notes** | Source / Level / Search / Time Range / Node / Plugin |

---

### system-ui.AuditTable

| 字段 | 值 |
|------|-----|
| **Purpose** | 审计事件表格 |
| **Surface** | main.editor |
| **Props** | `{ events: AuditEvent[], onSelect: (event: AuditEvent) => void }` |
| **Core API** | audit.list |
| **State ownership** | 无 |
| **Failure states** | 加载失败 → ErrorState |
| **Notes** | 列: Time / Type / Actor / Target |

---

### system-ui.AuditDetailDrawer

| 字段 | 值 |
|------|-----|
| **Purpose** | 审计事件详情侧边面板 |
| **Surface** | main.editor (drawer) |
| **Props** | `{ event: AuditEvent, onClose: () => void }` |
| **Core API** | audit.get |
| **Failure states** | 详情加载失败 → [ERROR] |
| **Notes** | 含原始事件 JSON + Copy 按钮 |

---

### system-ui.EventTimeline

| 字段 | 值 |
|------|-----|
| **Purpose** | Session 事件时间线 |
| **Surface** | main.editor, plugin.detail |
| **Props** | `{ events: SessionEvent[] }` |
| **Core API** | session.events |
| **State ownership** | 无 |
| **Failure states** | 部分事件丢失 → "部分事件数据不可用" |
| **Notes** | 垂直时间线布局 |

---

### system-ui.InstallLogTable

| 字段 | 值 |
|------|-----|
| **Purpose** | 插件安装历史表格 |
| **Surface** | plugin.detail, main.editor |
| **Props** | `{ entries: InstallLogEntry[] }` |
| **Core API** | plugin.history |
| **State ownership** | 无 |
| **Failure states** | 加载失败 → 空态 |
| **Notes** | 日期 + 操作 + 版本 + 结果 |

---

### system-ui.LogSearchBox

| 字段 | 值 |
|------|-----|
| **Purpose** | 日志全文搜索框（支持关键词高亮） |
| **Surface** | main.editor |
| **Props** | `{ value: string, onChange: (q: string) => void, highlight?: string }` |
| **Core API** | 无 |
| **State ownership** | value → React state |
| **Failure states** | 无 |
| **Notes** | 支持正则搜索（高级模式） |

---

## 10. Approvals

---

### system-ui.NotificationCenter

| 字段 | 值 |
|------|-----|
| **Purpose** | 通知列表（审批请求 + 系统通知） |
| **Surface** | notification.center |
| **Props** | `{ notifications: Notification[], onMarkRead: (id: string) => void, onMarkAllRead: () => void, onAction: (notification: Notification) => void }` |
| **Core API** | notification.list |
| **State ownership** | 无 |
| **Failure states** | 加载失败 → ErrorState |
| **Notes** | 未读标记 ● |

---

### system-ui.ApprovalList

| 字段 | 值 |
|------|-----|
| **Purpose** | 审批请求列表 |
| **Surface** | notification.center, main.editor |
| **Props** | `{ requests: ApprovalRequest[], onApprove: (id: string) => void, onDeny: (id: string) => void, onDetail: (id: string) => void }` |
| **Core API** | approval.list |
| **State ownership** | 无 |
| **Failure states** | 加载失败 → ErrorState |
| **Notes** | pending / approved / denied / timeout / synced / reviewing |

---

### system-ui.ApprovalRequestModal

| 字段 | 值 |
|------|-----|
| **Purpose** | 审批请求详情弹窗 |
| **Surface** | notification.center |
| **Props** | `{ request: ApprovalRequest, onApprove: (note?: string) => void, onDeny: (reason?: string) => void, onClose: () => void }` |
| **Core API** | approval.get |
| **State ownership** | 无 |
| **Failure states** | 详情加载失败 → 弹窗内 [ERROR] |
| **Notes** | 含倒计时、风险评估、上下文 |

---

### system-ui.ApprovalActionBar

| 字段 | 值 |
|------|-----|
| **Purpose** | 审批操作栏 |
| **Surface** | notification.center |
| **Props** | `{ requestId: string, onApprove: () => void, onDeny: () => void, disabled?: boolean }` |
| **Core API** | approval.approve, approval.deny |
| **State ownership** | 无 |
| **Failure states** | 操作失败 → 按钮变红 + 错误消息 |
| **Notes** | 审批后按钮禁用 |

---

### system-ui.ApprovalHistory

| 字段 | 值 |
|------|-----|
| **Purpose** | 已处理的审批历史 |
| **Surface** | notification.center |
| **Props** | `{ entries: ApprovalHistoryEntry[] }` |
| **Core API** | approval.list (status: approved/denied/timeout) |
| **State ownership** | 无 |
| **Notes** | 显示批准/拒绝人 + 时间 + 备注 |

---

### system-ui.MultiDeviceIndicator

| 字段 | 值 |
|------|-----|
| **Purpose** | 多设备同步状态指示 |
| **Surface** | notification.center |
| **Props** | `{ status: 'synced' | 'viewing' | 'alone', viewerCount?: number }` |
| **Core API** | WebSocket: approval.viewing |
| **State ownership** | 无 |
| **Notes** | 显示 "已在其他设备处理" 或 "其他设备正在查看" |

---

### system-ui.RiskBadge

| 字段 | 值 |
|------|-----|
| **Purpose** | 风险等级标记 |
| **Surface** | notification.center |
| **Props** | `{ level: 'low' | 'medium' | 'high' | 'critical' }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 颜色编码: low=灰色, medium=蓝色, high=橙色, critical=红色 |

---

### system-ui.TimeoutCountdown

| 字段 | 值 |
|------|-----|
| **Purpose** | 审批倒计时进度条 |
| **Surface** | notification.center |
| **Props** | `{ expiresAt: number, onTimeout?: () => void }` |
| **Core API** | 无 |
| **State ownership** | remaining → React state（本地时钟） |
| **Notes** | < 10s 变红 + 脉冲动画 |

---

## 11. Common

---

### system-ui.SearchBox

| 字段 | 值 |
|------|-----|
| **Purpose** | 通用搜索输入框 |
| **Surface** | 多个 |
| **Props** | `{ value: string, onChange: (q: string) => void, placeholder?: string, debounce?: number }` |
| **Core API** | 无 |
| **State ownership** | value → React state |
| **Reusable by plugin** | 是 |
| **Notes** | 默认 debounce 300ms |

---

### system-ui.FilterBar

| 字段 | 值 |
|------|-----|
| **Purpose** | 通用过滤栏（下拉选择器组合） |
| **Surface** | 多个 |
| **Props** | `{ filters: Filter[], onChange: (filters: Record<string, string>) => void }` |
| **Core API** | 无 |
| **State ownership** | filters → React state（可 localStorage） |
| **Reusable by plugin** | 是 |
| **Notes** | 每个 filter 支持 Select / MultiSelect / Search |

---

### system-ui.EmptyState

| 字段 | 值 |
|------|-----|
| **Purpose** | 空数据显示（插画 + 标题 + 描述 + 操作按钮） |
| **Surface** | 所有页面 |
| **Props** | `{ icon?: IconType, title: string, description?: string, action?: { label: string, onClick: () => void } }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 居中显示，适配所有页面 |

---

### system-ui.ErrorState

| 字段 | 值 |
|------|-----|
| **Purpose** | 错误状态显示（错误图标 + 消息 + 重试） |
| **Surface** | 所有页面 |
| **Props** | `{ message: string, detail?: string, onRetry?: () => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | [ERROR] 标记 + 重试按钮 |

---

### system-ui.LoadingState

| 字段 | 值 |
|------|-----|
| **Purpose** | 加载骨架屏 |
| **Surface** | 所有页面 |
| **Props** | `{ rows?: number, type?: 'card' | 'table' | 'list' | 'detail' }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 模拟内容布局的 skeleton |

---

### system-ui.OfflineBanner

| 字段 | 值 |
|------|-----|
| **Purpose** | 离线横幅（WebSocket 断开时显示） |
| **Surface** | 所有页面（全局） |
| **Props** | `{ since?: string, reconnecting?: boolean, onDismiss?: () => void }` |
| **Core API** | 无 |
| **State ownership** | 由全局连接状态管理 |
| **Reusable by plugin** | 否 |
| **Notes** | [OFFLINE] + 自动重连指示 |

---

### system-ui.PermissionDenied

| 字段 | 值 |
|------|-----|
| **Purpose** | 权限不足提示 |
| **Surface** | 所有页面 |
| **Props** | `{ message?: string, action?: { label: string, onClick: () => void } }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 锁图标 + 消息 + 可选操作 |

---

### system-ui.PageHeader

| 字段 | 值 |
|------|-----|
| **Purpose** | 页面标题栏（标题 + 操作按钮） |
| **Surface** | 所有页面 |
| **Props** | `{ title: string, subtitle?: string, actions?: ReactNode[], onRefresh?: () => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 桌面端固定，移动端可滚动 |

---

### system-ui.ConfirmDialog

| 字段 | 值 |
|------|-----|
| **Purpose** | 确认操作弹窗 |
| **Surface** | 全局 |
| **Props** | `{ title: string, message: string, confirmLabel?: string, cancelLabel?: string, variant?: 'danger' | 'warning' | 'info', onConfirm: () => void, onCancel: () => void }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 危险操作为红色按钮 |

---

### system-ui.Badge

| 字段 | 值 |
|------|-----|
| **Purpose** | 徽章/标签 |
| **Surface** | 多个 |
| **Props** | `{ text: string, variant?: 'default' | 'success' | 'warning' | 'error' | 'info' }` |
| **Core API** | 无 |
| **State ownership** | 无 |
| **Reusable by plugin** | 是 |
| **Notes** | 用于状态标记、插件类型标签等 |

---

### system-ui.DataTable

| 字段 | 值 |
|------|-----|
| **Purpose** | 通用数据表格 |
| **Surface** | 多个 |
| **Props** | `{ columns: Column[], data: any[], onSort?: (col: string) => void, onSelect?: (row: any) => void, pagination?: PaginationConfig }` |
| **Core API** | 无 |
| **State ownership** | sort / pagination → React state |
| **Reusable by plugin** | 是 |
| **Notes** | 虚拟滚动支持 |

---

## 组件索引

| 组件名 | 分类 | Surface | 插件可复用 |
|--------|------|---------|-----------|
| system-ui.AppShell | Shell | main.editor | 否 |
| system-ui.AppHeader | Shell | main.editor | 否 |
| system-ui.Sidebar | Shell | main.editor | 否（可贡献面板） |
| system-ui.BottomPanel | Shell | main.editor | 是（贡献 tab） |
| system-ui.StatusBar | Shell | main.editor | 是（贡献状态项） |
| system-ui.TabBar | Shell | 多个 | 是 |
| system-ui.PanelContainer | Shell | 多个 | 是 |
| system-ui.PluginHost | Plugin Host | 多个 | 否 |
| system-ui.PluginViewContainer | Plugin Host | 插件 view surface | 否 |
| system-ui.PluginPanel | Plugin Host | 插件 panel surface | 否 |
| system-ui.ExtensionSandbox | Plugin Host | plugin.detail | 否 |
| system-ui.HealthSummary | Dashboard | main.editor | 否 |
| system-ui.HealthCard | Dashboard | main.editor | 是 |
| system-ui.NodeSummaryCard | Dashboard | main.editor | 否 |
| system-ui.RecentAuditList | Dashboard | main.editor | 否 |
| system-ui.NodeList | Nodes | main.editor | 否 |
| system-ui.NodeListItem | Nodes | main.editor | 否 |
| system-ui.NodeDetailPanel | Nodes | main.editor (drawer) | 否 |
| system-ui.NodeActionMenu | Nodes | main.editor | 否 |
| system-ui.SessionList | Sessions | main.editor | 否 |
| system-ui.StreamViewer | Sessions | main.editor / mobile | 否 |
| system-ui.StreamHistoryViewer | Sessions | main.editor / mobile | 否 |
| system-ui.StreamTailPanel | Sessions | main.editor (bottom) | 否 |
| system-ui.SessionDetailPanel | Sessions | main.editor (drawer) | 否 |
| system-ui.SessionStatusBadge | Sessions | 多个 | 是 |
| system-ui.SessionActionBar | Sessions | main.editor / mobile | 否 |
| system-ui.PluginList | Plugins | main.editor | 否 |
| system-ui.PluginListItem | Plugins | main.editor | 否 |
| system-ui.PluginDetailPage | Plugins | plugin.detail | 否 |
| system-ui.PluginDetailHeader | Plugins | plugin.detail | 否 |
| system-ui.PluginOverviewPanel | Plugins | plugin.detail | 否 |
| system-ui.PluginEnvironmentPanel | Plugins | plugin.detail | 否 |
| system-ui.PluginInstallPlanPanel | Plugins | plugin.detail | 否 |
| system-ui.PluginInstallProgressPanel | Plugins | plugin.detail | 否 |
| system-ui.PluginInstallHistoryPanel | Plugins | plugin.detail | 否 |
| system-ui.PluginFilesTable | Plugins | plugin.detail | 否 |
| system-ui.PluginCacheTable | Plugins | plugin.detail | 否 |
| system-ui.PluginArtifactsTable | Plugins | plugin.detail | 否 |
| system-ui.PluginConfigForm | Plugins | plugin.detail / settings | 否 |
| system-ui.PluginPermissionPanel | Plugins | plugin.detail | 否 |
| system-ui.PermissionList | Permissions | plugin.detail.permissions | 否 |
| system-ui.PermissionItem | Permissions | plugin.detail.permissions | 否 |
| system-ui.PermissionGrantPanel | Permissions | plugin.detail.permissions | 否 |
| system-ui.SettingsShell | Settings | settings.page | 否 |
| system-ui.SettingsNav | Settings | settings.page | 否 |
| system-ui.SettingsSection | Settings | settings.page | 是 |
| system-ui.ConfigField | Settings | settings.page / plugin.detail | 是 |
| system-ui.ConfigSchemaForm | Settings | settings.page / plugin.detail | 否 |
| system-ui.SecretField | Settings | settings.page | 是 |
| system-ui.SaveResetBar | Settings | settings.page | 否 |
| system-ui.LogViewer | Logs | main.editor | 否 |
| system-ui.LogFilters | Logs | main.editor | 否 |
| system-ui.AuditTable | Logs | main.editor | 否 |
| system-ui.AuditDetailDrawer | Logs | main.editor (drawer) | 否 |
| system-ui.EventTimeline | Logs | main.editor / plugin.detail | 是 |
| system-ui.InstallLogTable | Logs | plugin.detail / main.editor | 否 |
| system-ui.LogSearchBox | Logs | main.editor | 是 |
| system-ui.NotificationCenter | Approvals | notification.center | 否 |
| system-ui.ApprovalList | Approvals | notification.center / main.editor | 否 |
| system-ui.ApprovalRequestModal | Approvals | notification.center | 否 |
| system-ui.ApprovalActionBar | Approvals | notification.center | 否 |
| system-ui.ApprovalHistory | Approvals | notification.center | 否 |
| system-ui.MultiDeviceIndicator | Approvals | notification.center | 否 |
| system-ui.RiskBadge | Approvals | notification.center | 是 |
| system-ui.TimeoutCountdown | Approvals | notification.center | 否 |
| system-ui.SearchBox | Common | 所有 | 是 |
| system-ui.FilterBar | Common | 所有 | 是 |
| system-ui.EmptyState | Common | 所有 | 是 |
| system-ui.ErrorState | Common | 所有 | 是 |
| system-ui.LoadingState | Common | 所有 | 是 |
| system-ui.OfflineBanner | Common | 所有（全局） | 否 |
| system-ui.PermissionDenied | Common | 所有 | 是 |
| system-ui.PageHeader | Common | 所有 | 是 |
| system-ui.ConfirmDialog | Common | 全局 | 是 |
| system-ui.Badge | Common | 多个 | 是 |
| system-ui.DataTable | Common | 多个 | 是 |
