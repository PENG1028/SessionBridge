# SessionNode v2 — App UI 文档体系

> 当前 app 目录模块地图、App UI 定位、与 Go Core / Feature Plugin / External Client 的边界
> 配套文档：SYSTEM_UI_PLUGIN.md、UX_SURFACES.md、INVENTORY.md

---

## App UI 的定位

App UI 是 SessionNode Go Core 的**内置控制面**。它不是"普通前端"，而是一个**拥有最高 UI 权限但仍然走 Core Protocol 的 system plugin**。

```
┌─────────────────────────────────────────────────────────────┐
│                    App UI Plugin                               │
│  React SPA                                                    │
│  Dashboard · Nodes · Sessions · Plugin Manager · Settings    │
│  Log Viewer · Permission Grant · Notification Center         │
│  Layout Engine · Tab/View Projection · Command Palette       │
│  Plugin Host（加载 Feature Plugin Web 贡献）                  │
│                                                               │
│  所有操作都通过 Core Client (TS) → HTTP/WS → Go Core          │
└─────────────────────────────────────────────────────────────┘
```

### App UI 的核心原则

1. **不拥有 Core 状态** — session 列表、节点拓扑、插件安装状态全部由 Core 维护
2. **不绕过 Core 权限** — 即使权限高，也必须走 `action.request`，受 audit 记录
3. **不实现插件业务逻辑** — 不解析 claude-code stream-json，不实现终端模拟器
4. **不依赖 Feature Plugin** — Core + App UI 独立可用

---

## 当前 app 目录模块地图

当前 `app/` 目录（旧 sessionBridge 演进产物）包含了后续 App UI 的绝大部分代码：

```
app/
├── page.tsx                      # 入口，负责注册/同步太多东西
├── layout.tsx                    # 主布局
│
├── console/                      # 主控制台 UI
│   ├── main/
│   │   ├── view-registry.ts      # View 注册表（含 adapter mapping、chrome policy）
│   │   ├── claude-chat-view.tsx  # Claude Chat 视图（应成为 feature plugin）
│   │   ├── terminal-view.tsx     # 终端视图（应成为 feature plugin）
│   │   └── system-context-bar.tsx
│   │
│   ├── stage/
│   │   ├── workbench-state.ts    # 状态 + reducer + localStorage 持久化
│   │   ├── workbench-layout.tsx  # 布局渲染
│   │   ├── pane-view.tsx        # Pane 容器
│   │   ├── pane-tab-bar.tsx     # 标签栏（拖拽、右键菜单）
│   │   ├── view-selector.tsx    # 视图选择器
│   │   └── empty-pane.tsx       # 空 Pane 占位
│   │
│   ├── workbench/
│   │   ├── workbench-context.tsx # WorkbenchContext（超大上下文）
│   │   ├── slots/
│   │   │   ├── main-slot.tsx    # MainSlot（viewId + instanceId）
│   │   │   └── sidebar-slot.tsx # SidebarSlot（open + children）
│   │   └── focus-context.tsx    # FocusContext
│   │
│   ├── sidebar/
│   │   ├── left-sidebar.tsx     # 左侧边栏（DockPanelFrame + panels）
│   │   ├── right-sidebar.tsx    # 右侧边栏
│   │   ├── mobile-sidebar.tsx   # 移动端左侧弹出
│   │   └── mobile-right-panel.tsx # 移动端右侧面板
│   │
│   ├── panels/
│   │   ├── panel-registry.ts        # Panel 注册表 + component override
│   │   ├── register-panel-components.ts # 注册内置 panel 组件
│   │   ├── extension-panels.tsx     # 扩展/内置 panel 组件
│   │   ├── files-panel.tsx
│   │   ├── files-context-panel.tsx
│   │   ├── task-panel.tsx
│   │   ├── quick-actions-panel.tsx
│   │   ├── session-actions-panel.tsx
│   │   ├── snapshots-panel.tsx
│   │   ├── path-bookmarks-panel.tsx
│   │   └── terminal-log-panel.tsx
│   │
│   ├── commands/
│   │   └── command-registry.ts  # Command 注册表
│   │
│   ├── actions/
│   │   ├── action-registry.ts   # Action Surface Registry
│   │   ├── action-types.ts      # ActionSurface / WorkbenchAction
│   │   └── workbench-command-dispatch.ts
│   │
│   ├── menus/
│   │   ├── context-menu-registry.ts   # ContextMenu 合并器
│   │   └── context-menu-types.ts
│   │
│   ├── shell/
│   │   ├── settings-panel.tsx    # 设置面板（含 管理密码、更新、配置编辑）
│   │   ├── context-menu.tsx
│   │   └── panel-dnd-wrapper.tsx
│   │
│   └── dialogs/
│       └── directory-picker.tsx
│
├── extensions/                   # 扩展/适配器层
│   ├── registry.ts
│   ├── types.ts
│   ├── agent-core/              # agent 运行时
│   └── ...
│
└── lib/                          # 客户端共享工具
```

---

## 哪些保留、哪些迁移、哪些废弃

| 归类 | 范围 | 理由 |
|------|------|------|
| **保留为 system-ui 内置** | stage/, workbench/slots/, sidebar/, panels/panel-registry, commands/command-registry, actions/action-registry, menus/context-menu-registry, shell/settings-panel | 这些构成 UI 基础设施和管理页面，属于控制面 |
| **迁移为 feature plugin** | claude-chat-view.tsx, terminal-view.tsx, extensions/agent-core/* | Claude Chat 和 Terminal 是产品功能，不属于系统管理 |
| **迁移为 plugin-host** | panels/register-panel-components.ts（内置组件注册逻辑）, panels/extension-panels.tsx（内置 panel 组件） | 组件注册机制应归 PluginHost 管理 |
| **废弃/删除** | view-registry.ts 中的 adapterId/surface 映射、adapterMeta 缓存、localStorage session 持久化 | 旧概念，在新模型中不存在 |
| **需要重写** | page.tsx（职责过重）, workbench-state.ts（instanceId 绑定）, workbench-context.tsx（过大） | 逐步拆分为 surface 模型 |

---

## 与 Go Core / Feature Plugin / External Client 的边界

```
┌──────────────────────────────────────────────────────────────────┐
│                     External Client                                │
│  直接调 Core API（无 pluginId，走 Service Token）                  │
│  不加载 UI，不参与 surface 系统                                    │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     Feature Plugin                                 │
│  通过 PluginHost 在 App UI 中获得渲染位置                            │
│  调用 Core Capability API（带 pluginId，受权限校验）                │
│  不直接修改 App UI 的布局/注册表                                     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     App UI                                          │
│  通过 Core Client 调用 Core API（pluginId: "system-ui"）           │
│  拥有 PluginHost 加载 Feature Plugin 的 Web 贡献                   │
│  拥有 Layout Engine 管理 Surface 的布局和投影                      │
│  不绕过 Core 权限校验，不缓存 Core 状态为事实来源                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     Go Core                                        │
│  不区分调用者是 system-ui 还是 feature plugin                      │
│  统一走 Dispatcher → Permission Check → Route → Execute → Audit   │
│  不存储 UI 状态（tabId、面板折叠、surface 尺寸）                   │
└──────────────────────────────────────────────────────────────────┘
```

### 通信路径

```
App UI ─── Core Client ─── HTTP/WS ───▶ Go Core
Feature Plugin ─── Core Client ─── HTTP/WS ───▶ Go Core
External Client ─── HTTP ───▶ Go Core

Feature Plugin ↔ App UI：不直接通信，都通过 Core
```

---

## 与现有顶层文档的冲突和建议

当前 `docs/core-v2/app-ui/UX_SURFACES.md` 和 `docs/core-v2/app-ui/SYSTEM_UI_PLUGIN.md` 是现有顶层文档。以下子文档可能与之产生重叠或冲突，在此列出建议：

| 子文档 | 冲突点 | 建议 |
|--------|--------|------|
| SURFACE_MODEL.md | UX_SURFACES.md 已有 Surface 类型定义。SURFACE_MODEL.md 会进一步细化从现有 MainSlot/SidebarSlot 的迁移路径 | 不冲突，UX_SURFACES.md 是设计规范，SURFACE_MODEL.md 是迁移指引 |
| PLUGIN_HOST.md | SYSTEM_UI_PLUGIN.md 已概述 Plugin Host 职责，但缺少目录结构设计 | PLUGIN_HOST.md 补全目录和迁移步骤，不重复职责描述 |
| SYSTEM_UI_FEATURES.md | SYSTEM_UI_PLUGIN.md 已有 Dashboard/Nodes/Sessions/Logs/Settings/Plugin Manager/Permission Grant 的概述 | SYSTEM_UI_FEATURES.md 使用统一模板补全所有功能的失败状态和 Core API 映射 |
| SETTINGS_AND_PLUGIN_MANAGER.md | SYSTEM_UI_PLUGIN.md 的 Settings 和 Plugin Manager 描述较简略 | SETTINGS_AND_PLUGIN_MANAGER.md 作为子文档提供完整 IA 和所有 Core API 调用 |
| MIGRATION_PLAN.md | 全新内容，不与现有文档冲突 | — |
| APP_UI_API_MAP.md | 现有 wireframe 和 feature 文档中使用了不同的 API 别名 | APP_UI_API_MAP.md 作为规范参考，其他文档逐步对齐 |
| ACCESS_CONTROL_WIREFRAMES.md | SETTINGS.md 原有 Access Control 子段过于简略 | 独立成完整页面，Settings 中的 Access Control 改为指向此文档 |
| PLUGIN_UI_BOUNDARIES.md | PLUGIN_UI_CONTRACT.md 中的 ClaudeCode 示例前后不一致 | PLUGIN_UI_BOUNDARIES.md 作为边界参考，PLUGIN_UI_CONTRACT.md 以文档为准 |

建议：未来如果 UX_SURFACES.md 和 SYSTEM_UI_PLUGIN.md 需要修订，可以合并 system-ui 子文档中的迁移/实现细节作为附录。

---

## Wireframes 线框图

`wireframes/` 目录包含 App UI 所有页面的 ASCII 线框图，描述布局、组件、交互、状态。

| 文档 | 描述 |
|------|------|
| [wireframes/README.md](wireframes/README.md) | 通用规范、状态定义、布局模板、约定 |
| [wireframes/DASHBOARD.md](wireframes/DASHBOARD.md) | Dashboard 总览页（4 统计卡片 + 节点健康 + 最近事件） |
| [wireframes/NODES.md](wireframes/NODES.md) | 节点管理（列表 + 详情抽屉 + 操作） |
| [wireframes/SESSIONS.md](wireframes/SESSIONS.md) | 会话管理（列表 + Stream 实时查看 + 回放） |
| [wireframes/PLUGINS.md](wireframes/PLUGINS.md) | 插件管理（列表 + 8 tab 详情 + 安装计划/进度） |
| [wireframes/SETTINGS.md](wireframes/SETTINGS.md) | 设置（外壳 + 5 分类 + ConfigSchemaForm + SecretField） |
| [wireframes/LOGS_AND_AUDIT.md](wireframes/LOGS_AND_AUDIT.md) | 日志和审计（Log Viewer + Audit Table + 事件时间线） |
| [wireframes/APPROVALS.md](wireframes/APPROVALS.md) | 审批中心（通知列表 + 审批请求 + 多设备同步） |
| [wireframes/MOBILE.md](wireframes/MOBILE.md) | 移动端（Shell + 底部导航 + Surface 映射 + 触摸交互） |

## Access Control Wireframes

[ACCESS_CONTROL_WIREFRAMES.md](ACCESS_CONTROL_WIREFRAMES.md) 独立访问控制管理页面：

- Users（创建/禁用/查看详情 + 角色/组归属）
- Groups（创建/编辑成员）
- Roles（创建/编辑策略 + Policy Editor）
- Policy Bindings（Subject + Role + Scope）
- Service Tokens（生成/撤销 + 一次性展示）
- Plugin Grants（按插件聚合的权限概览）
- Permission Audit Log（不可篡改的权限变更记录）

## App UI API Map

[APP_UI_API_MAP.md](APP_UI_API_MAP.md) 统一所有 UI 文档中的 Core API 命名（11 个命名空间）：

| 命名空间 | 覆盖 |
|---------|------|
| `notify.*` | 通知（推送、标记已读） |
| `approval.*` | 审批（请求、批准、拒绝、多设备同步） |
| `logs.*` | 运行时日志（Core/Plugin diagnostic，三分法） |
| `audit.*` | 审计日志（权限变更、安装、配置变更） |
| `session.*` | Session 元数据（CRUD + 事件） |
| `stream.*` | 标准流（stdout/stderr/stdin） |
| `plugin.*` | 插件管理（安装、状态、权限、文件、缓存） |
| `config.*` | 配置（读写、schema、revision 乐观锁） |
| `task.*` | 异步任务进度 |
| `node.*` | 节点管理 |
| `action.*` | 操作审计 |

包含完整的 页面 → API 依赖矩阵 和 日志三分法（Stream History / Diagnostic Logs / Audit Logs）映射。

## Plugin UI Boundaries

[PLUGIN_UI_BOUNDARIES.md](PLUGIN_UI_BOUNDARIES.md) 明确不同渲染方式的边界：

- 决策树：custom-react / host-rendered / iframe / system component reuse
- 核心业务 UI → custom-react（复杂交互、特有数据格式、用户 facing）
- 管理/配置 UI → host-rendered（App UI 提供组件）
- 禁止模式清单（6 项）
- 边界校验清单（7 项，实现前逐项检查）
- 以 ClaudeCode 为例展示分层：聊天 UI = custom-react、配置/权限/缓存 = host-rendered、内部 SearchBox/EmptyState = system-ui 复用
- Surface 分配规则

## Plugin UI Contract

[PLUGIN_UI_CONTRACT.md](PLUGIN_UI_CONTRACT.md) 定义插件如何与 App UI 集成：

- 5 种贡献类型（custom-react view/panel、host-rendered component、settings section、command、menu、status item、approval request、notification）
- Manifest 声明示例（host-rendered、custom-react、settings）
- PluginComponentProps 和 CoreClient 接口定义
- CoreClient 访问规则（权限 grant 覆盖范围内的 Core API）
- Host-rendered 组件数据绑定机制
- 插件可复用的 system-ui 组件列表（20 个）
- 插件禁用/卸载时的 UI 行为
- ClaudeCode 完整集成示例
- 安全约束（3 级信任模型，DOM 容器隔离）
- Surface 生命周期
- 错误处理约定

## 文档阅读顺序

```
1. SYSTEM_UI_PLUGIN.md           — 先读：App UI 是什么、职责边界
2. UX_SURFACES.md                — 再读：Surface 模型、SurfaceType
3. INVENTORY.md                  — 再读：当前 app 现状盘点
4. SURFACE_MODEL.md              — 再读：从旧模型到新 Surface 的迁移
5. SYSTEM_UI_FEATURES.md         — 再读：16 个系统功能的详细设计
6. PLUGIN_HOST.md                — 再读：Plugin Host 设计
7. SETTINGS_AND_PLUGIN_MANAGER.md — 再读：设置和插件管理
8. APP_UI_API_MAP.md              — 再读：API 命名映射（所有文档的 API 参考）
9. PLUGIN_UI_BOUNDARIES.md       — 再读：插件渲染方式边界和决策树
10. PLUGIN_UI_CONTRACT.md        — 再读：插件 UI 集成契约
11. COMPONENT_CATALOG.md         — 再读：组件规格手册（实现参考）
12. ACCESS_CONTROL_WIREFRAMES.md — 再读：访问控制管理页面
13. wireframes/README.md         — 再读：线框图规范和约定
14. wireframes/DASHBOARD.md      — 再读：Dashboard 线框图
15. wireframes/NODES.md          — 再读：节点管理线框图
16. wireframes/SESSIONS.md       — 再读：会话管理线框图
17. wireframes/PLUGINS.md        — 再读：插件管理线框图
18. wireframes/SETTINGS.md       — 再读：设置页线框图
19. wireframes/LOGS_AND_AUDIT.md — 再读：日志和审计线框图
20. wireframes/APPROVALS.md      — 再读：审批中心线框图
21. wireframes/MOBILE.md         — 再读：移动端线框图
22. MIGRATION_PLAN.md            — 最后读：分阶段执行计划
23. UI_UX_REVIEW_NOTES.md        — 最后读：UI/UX agent 工作建议
```

---

## 分层责任矩阵

| 功能 | 实现层 | 数据源 | UI Surface |
|------|--------|--------|-----------|
| Dashboard | system-ui | Core: node.list, session.list, plugin.list, node.health | main.editor |
| Node Manager | system-ui | Core: node.list, node.info, node.disconnect | main.editor |
| Session Manager | system-ui | Core: session.list, session.get, session.stop | main.editor |
| Plugin Manager | system-ui | Core: plugin.*, env.checkBinary | main.editor |
| Plugin Detail | system-ui | Core: plugin.status, permissions.*, files.*, cache.* | plugin.detail |
| Logs Viewer | system-ui | Core: logs.tail, logs.query, logs.session | main.editor |
| Settings | system-ui | Core: config.get, config.set | settings.page |
| Notification Center | system-ui | Core: notify.* | notification.center |
| Command Palette | system-ui | Core: 无（纯前端注册） | commandPalette |
| Claude Chat | claude-code plugin | Core: process.spawn, stream.* | main.editor |
| Terminal | shell plugin | Core: process.spawn, stream.* | main.editor / panel.bottom |
| File Explorer | file-explorer plugin | Core: fs.* | sidebar.left |
| Plugin Host | system-ui | Core: plugin.registered 事件 | 所有 surface |
