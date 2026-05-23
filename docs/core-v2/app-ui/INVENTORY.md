# SessionNode v2 — App UI 现状盘点

> 基于 `app/` 目录的模块盘点
> 格式：模块路径 → 当前职责 → 旧概念依赖 → 未来归属 → 迁移风险 → 迁移建议

---

## 入口层

| 模块 | 当前职责 | 旧概念依赖 | 未来归属 | 迁移风险 | 迁移建议 |
|------|---------|-----------|---------|---------|---------|
| `app/page.tsx` | 初始化 relay 连接、注册 adapter views/panels/commands/menus、同步 extension data、创建 WorkbenchProvider、渲染 MainLayout + WorkbenchLayout + Sidebar + SettingsPanel + ClaudeChatView + TerminalView | instanceId, adapterId, workbench.tabs, localStorage 恢复 `initialState` | **system-ui**（入口职责需拆分） | 入口职责过重，同步逻辑和 UI 渲染混合 | 拆分为：`system-ui/entry.tsx`（Core Client 初始化 + 连接）+ `system-ui/layout.tsx`（Surface 布局）+ `page.tsx` 瘦身为主入口 |
| `app/layout.tsx` | 主布局包裹 | 无 | **system-ui** | 低 | 直接保留，名称可改为 `system-ui/layout.tsx` |

---

## Stage / Workbench 层

| 模块 | 当前职责 | 旧概念依赖 | 未来归属 | 迁移风险 | 迁移建议 |
|------|---------|-----------|---------|---------|---------|
| `app/console/stage/workbench-state.ts` | 定义 WorkbenchState（root LayoutNode / bottom PaneState）、PaneTab（含 instanceId、_surfaceId）、reducer 88 个 action、localStorage 持久化（saveLayoutsToStorage / loadLayoutsFromStorage） | **instanceId** 作为 tab 绑定、**\_surfaceId** 旧概念残留、**localStorage** 存 session 布局 | **system-ui**（但需要大幅简化） | 高。整个 instanceId 绑定模型是旧概念。localStorage 持久化了本应由 Core 恢复的 session 绑定 | 1. 删除 `instanceId` 字段 → 改为 `sessionId`；2. 删除 `_surfaceId`/`_stale`/`_orphaned`；3. localStorage 只存 UI 偏好（面板尺寸、折叠），不存 tab 到 session 的映射；4. tab 列表由 Core 的 `session.list` 重建 |
| `app/console/stage/workbench-layout.tsx` | 递归渲染 LayoutNode（Pane/Split）、底部 dock、可拖动分隔线 | 无直接旧概念 | **system-ui** | 低。逻辑相对纯粹，只关心布局 | 直接保留为 `system-ui/surface/surface-layout.tsx`。将 ViewType 改为 SurfaceType |
| `app/console/stage/pane-view.tsx` | Pane 容器：渲染 PaneTabBar + 活动 tab 的视图 | 无 | **system-ui** | 低 | 改名为 `surface-pane.tsx`，注入 SurfaceRenderContext 替代旧的 `instanceId` 传递 |
| `app/console/stage/pane-tab-bar.tsx` | 标签栏：拖拽排序、右键菜单、kept-tab 菜单 | 使用 `getViewEntry(viewType)` 获取 tab 图标 | **system-ui** | 中。需从 view-registry 迁移到 surface-registry | 改为从 SurfaceRegistry 读取信息，不再依赖 view-registry |
| `app/console/stage/view-selector.tsx` | 视图选择器：列出所有注册视图 | `getAllViewEntries()`, `getAdapterIdForView()` | **system-ui** → **surface-selector** | 中。未来视图选择应由 surface + plugin 声明驱动 | 改为 `surface-selector.tsx`，列出所有可用的 SurfaceType，不再展示 adapter view 映射 |
| `app/console/stage/empty-pane.tsx` | 空 pane 占位 + 打开视图选择器 | 无 | **system-ui** | 低 | 直接保留，打开 surface-selector |

---

## Workbench Context 层

| 模块 | 当前职责 | 旧概念依赖 | 未来归属 | 迁移风险 | 迁移建议 |
|------|---------|-----------|---------|---------|---------|
| `app/console/workbench/workbench-context.tsx` | 巨型上下文：WebSocket 连接、消息/会话/turn、instance 管理、文件建议、命令面板、log | **instanceId**, **activeInstanceId**, **createInstance(bindCurrentTabInstance)**, **activeExternalSession**, **messages/turns** 等 claude-chat 专用状态 | **拆分** | **极高**。混合了连接管理、Instance 管理、Claude Chat 状态、CLI 命令 | 拆为：1. `core-client-context.tsx`（连接 + Core API 调用）2. `SurfaceContext`（surfaceId + sessionId + nodeId）；3. claude-chat 的状态移入 feature plugin |
| `app/console/workbench/slots/main-slot.tsx` | 根据 viewId + instanceId 渲染视图 | **instanceId**, viewId → viewRegistry 查找 | **system-ui** → **SurfaceRenderer** | 中。改为注入 SurfaceRenderContext，不再传 instanceId | 改为 `SurfaceRenderer.tsx`，接收 SurfaceRenderContext，通过 componentRegistry 解析组件 |
| `app/console/workbench/slots/sidebar-slot.tsx` | 侧边栏容器：open/close | 无 | **system-ui** | 低 | 保留，名称改为 `sidebar-surface.tsx` |
| `app/console/workbench/focus-context.tsx` | 焦点状态 + when-context | 无 | **system-ui** | 低 | 保留 |

---

## Sidebar 层

| 模块 | 当前职责 | 旧概念依赖 | 未来归属 | 迁移风险 | 迁移建议 |
|------|---------|-----------|---------|---------|---------|
| `app/console/sidebar/left-sidebar.tsx` | 左侧边栏：加载 panel-registry 的 left panels、DockPanelFrame、拖拽调整宽度、localStorage 保存宽度 + 面板顺序 | panel-registry 的 `getPanels('left')`、**localStorage** 保存宽度和顺序 | **system-ui** | 低。逻辑可复用 | 保留，改为从 SurfaceRegistry 获取 left panels，而不是 panel-registry |
| `app/console/sidebar/right-sidebar.tsx` | 右侧边栏：同 left，方向相反 | 同上 | **system-ui** | 低 | 保留，改为从 SurfaceRegistry 获取 right panels |
| `app/console/sidebar/mobile-sidebar.tsx` | 移动端左侧弹出：FileExplorer + panel 内容 + 快捷操作 | panel-registry | **system-ui** | 中。移动端可能维护重复逻辑 | 改为 Surface 映射模式：通过 mobile surface mapping 映射 left panels |
| `app/console/sidebar/mobile-right-panel.tsx` | 移动端右侧面板：筛选 mobile-friendly panels | panel-registry + `p.mobile.placement` | **system-ui** | 中 | 同上，映射 mobile.sheet |

---

## Panel 层

| 模块 | 当前职责 | 旧概念依赖 | 未来归属 | 迁移风险 | 迁移建议 |
|------|---------|-----------|---------|---------|---------|
| `app/console/panels/panel-registry.ts` | Panel 注册表：register/unregister/getPanels/syncPluginPanels、component overrides、plugin panel 同步 | **plugin manifest 概念**、旧称 `syncExtensionPanels`，已由 `syncPluginPanels()` 取代 | **app-ui** → **surface-registry** 的子集 | 高。Panel 和 View 当前是两套注册表，未来应统一为 surface 贡献 | 合并 panel-registry 和 view-registry 为 **surface-registry.ts**。panels 只是 `surface-type = "sidebar.left"` 或 `"panel.bottom"` 的特殊 surface |
| `app/console/panels/register-panel-components.ts` | 注册已知 panel 的 React 组件（LogsPanel/TerminalPanel/SystemPanel 等） | 通过 `registerPanelComponent()` 回调注册 | **app-ui** → **plugin-host** 的内置组件注册 | 中。需区分"系统内置"和"插件贡献" | 迁移到 `plugin-host/component-registry.ts`，app-ui 组件标记为 `type: "builtin"`，插件组件标记为 `type: "custom"` |
| `app/console/panels/extension-panels.tsx` | 内置 panel 组件实现（LogsPanel/TerminalPanel/SystemPanel/ProcessesPanel） | 部分组件依赖 adapterId 概念 | **system-ui**（作为内置组件保留） | 低。组件本身可复用 | 保留，移动到 `system-ui/panels/` 目录。后续扩展 panel 移到 feature plugin |
| `app/console/panels/files-panel.tsx` | 文件浏览器 panel | 无 | **feature plugin** → file-explorer | 中。文件浏览是产品功能，不属于系统管理 | 移到 `plugins/file-explorer/web/` |
| `app/console/panels/files-context-panel.tsx` | 文件上下文 panel | 无 | **feature plugin** | 中 | 同上 |
| `app/console/panels/task-panel.tsx` | 任务 panel | 无 | **system-ui**（系统管理功能） | 低 | 保留为 system-ui 内置 |
| `app/console/panels/quick-actions-panel.tsx` | 快捷操作 panel | 无 | **system-ui** | 低 | 保留 |
| `app/console/panels/session-actions-panel.tsx` | Session 操作 panel | 可能依赖 instanceId | **system-ui** | 中 | 保留，instanceId → sessionId |
| `app/console/panels/snapshots-panel.tsx` | 快照 panel | 无 | **deprecated**（session event 替代 snapshot） | 低。旧功能 | 在新模型中，session event 本身就支持 replay，不需要手动保存快照。标记为 deprecated |
| `app/console/panels/path-bookmarks-panel.tsx` | 路径书签 panel | localStorage 保存路径 | **system-ui**（UI 偏好） | 低 | 保留，localStorage 只存路径字符串 |
| `app/console/panels/terminal-log-panel.tsx` | 终端日志 panel | 无 | **feature plugin** → shell | 中 | 移到 `plugins/shell/web/` |

---

## Command / Action / Menu 层

| 模块 | 当前职责 | 旧概念依赖 | 未来归属 | 迁移风险 | 迁移建议 |
|------|---------|-----------|---------|---------|---------|
| `app/console/commands/command-registry.ts` | Command 注册表：register/get/execute/getAll | 无 | **system-ui** | 低。这部分设计合理 | 直接保留。未来 feature plugin 的 commands 通过 manifest 声明，由 PluginHost 同步进来 |
| `app/console/actions/action-registry.ts` | Action Surface Registry：按 surface 查询、when-condition 过滤 | ActionSurface 类型中包含 'quickActions'/'header.right' 等旧 surface 名 | **system-ui** | 中。ActionSurface 类型需要与 SurfaceType 对齐 | 将 ActionSurface 映射到新的 SurfaceType。部分 action surface 合并 |
| `app/console/actions/action-types.ts` | ActionRunContext、WorkbenchAction 类型 | **instanceId**, **activeAdapterId**, **createInstance/killInstance** | **system-ui** | 中。ActionRunContext 引用了旧概念 | ActionRunContext 中的 instanceId → sessionId，去掉 activeAdapterId，增加 pluginId/sessionId/nodeId |
| `app/console/menus/context-menu-registry.ts` | 三源合并器：manifest + action + local | adapterId/instanceId 在 mergedWhen 中 | **system-ui** | 中。旧概念引用 | ContextMenuRequest 中 adapterId → pluginId, instanceId → sessionId |

---

## Shell 层

| 模块 | 当前职责 | 旧概念依赖 | 未来归属 | 迁移风险 | 迁移建议 |
|------|---------|-----------|---------|---------|---------|
| `app/console/shell/settings-panel.tsx` | 设置面板：配置编辑、管理密码、更新管理 | REST API 路径 `/api/configuration/...`, `/api/auth/...`, `/api/check-update` | **system-ui** | 中。API 路径需更新为 Core Protocol | 保留功能，改为通过 Core Client 调用 `config.get/set`、`auth.*`、`update.*`。UI 设计合理，Core API 调用统一 |
| `app/console/shell/context-menu.tsx` | 右键菜单渲染组件 | 无 | **system-ui** | 低 | 保留 |
| `app/console/shell/panel-dnd-wrapper.tsx` | 面板拖拽包装（DockPanelFrame） | 无 | **system-ui** | 低 | 保留，改为 surface-drag-wrapper |

---

## View 层

| 模块 | 当前职责 | 旧概念依赖 | 未来归属 | 迁移风险 | 迁移建议 |
|------|---------|-----------|---------|---------|---------|
| `app/console/main/claude-chat-view.tsx` | Claude Chat 视图：消息渲染、工具活动、Markdown、slash commands | **useWorkbench()** 获取巨型上下文、instanceId | **feature plugin** → claude-code | **极高**。紧密耦合 workbench-context，包含大量 claude-code 专有逻辑（消息解析、工具渲染、toggle 逻辑） | 拆分为 feature plugin：1. 通过 PluginHost 注入 Core Client + SurfaceRenderContext；2. 所有消息/turn/claude 状态由插件自己管理；3. 不再依赖 workbench-context |
| `app/console/main/terminal-view.tsx` | 终端视图：auto-create instance、surface publish | **createInstance(bindCurrentTabInstance)**, **ensureSurfacePublished**, **\_surfaceId** | **feature plugin** → shell | **高**。紧密耦合 createInstance/bindCurrentTabInstance 逻辑 | 拆分为 feature plugin：1. 通过 Core Client 调 `process.spawn` 创建 session；2. 订阅 stdout/stderr stream；3. 不再需要 surface publish |
| `app/console/main/view-registry.ts` | View 注册表 + Adapter mapping + Adapter meta + Capabilities + ChromePolicy | **adapterId**（核心依赖）、**surface** 概念、**adapter mapping**、**adapterMeta**、**adapterCapabilities**、**chromePolicy** | **system-ui**（但大幅精简） | **极高**。view-registry 混合了 view 注册、adapter 映射、capabilities、chrome 策略，都是旧概念 | 1. 只保留 view 注册功能 → 改为 surface-registry；2. 删除 adapterId/adapterMeta/adapterCapabilities/ChromePolicy；3. PluginId 由 manifest 声明，不由 UI 维护 |

---

## 旧概念影响范围汇总

| 旧概念 | 涉及文件 | 影响程度 |
|--------|---------|---------|
| `instanceId` | view-registry.ts, workbench-state.ts, workbench-layout.tsx, main-slot.tsx, pane-view.tsx, terminal-view.tsx, claude-chat-view.tsx, context-menu-registry.ts, workbench-context.tsx, pane-tab-bar.tsx | **极高**。10+ 个文件依赖，是旧模型的根基 |
| `adapterId` | view-registry.ts, action-types.ts, context-menu-registry.ts, panel-registry.ts | **高**。adapter 概念被 plugin 替代 |
| `\_surfaceId` | workbench-state.ts, terminal-view.tsx | **中**。旧 surface 协议残留 |
| `localStorage session/instance 持久化` | workbench-state.ts (saveLayoutsToStorage, loadLayoutsFromStorage) | **高**。违反新模型原则 |
| `workbench-context 巨型上下文` | workbench-context.tsx, claude-chat-view.tsx, terminal-view.tsx, extension-panels.tsx | **极高**。紧耦合，拆分风险大 |
| `adapter 驱动的 view 选择` | view-registry.ts (getAdapterViewId, getDefaultViewType), view-selector.tsx | **中**。视图选择应基于 surface + plugin |
| `ChromePolicy` | view-registry.ts | **低**。chrome 策略可以由 surface 声明替代 |
| `syncPluginPanels`（旧称 `syncExtensionPanels`） | panel-registry.ts | **中**。extension 概念升级为 plugin，已重命名 |

---

## 未来归属统计

| 归属 | 文件数 | 占比 |
|------|--------|------|
| **system-ui 保留/重写** | ~20 个 | ~60% |
| **feature plugin 迁出** | ~6 个 | ~18% |
| **plugin-host 迁移** | ~3 个 | ~9% |
| **deprecated** | ~2 个 | ~6% |
| **纯 UI 组件保留** | ~3 个 | ~9% |

估计：60% 的现有代码可以在 system-ui 中复用（需要适配新模型），20% 需要迁出，20% 需要清理或重写。
