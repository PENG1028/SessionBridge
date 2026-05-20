# SessionNode v2 — UI/UX 审阅和工作建议

> 基于现有 app/ 代码的 UI/UX 观察和建议
> 供后续 UI/UX agent 参考

---

## 1. app/page.tsx 过重

**观察**：`app/page.tsx` 承担了入口初始化、WebSocket 连接、数据同步、WorkbenchProvider 创建、多个子组件渲染、各种同步函数的调用等职责。代码量 ~600 行（超过文件最大读取限制）。

**问题**：
- 注册逻辑和渲染逻辑混合
- `useEffect` 多个，依赖关系不清晰
- 测试困难

**建议**：
- 拆分为 `entry.tsx`（连接初始化 + Core Client 提供）+ `layout.tsx`（Surface 布局渲染）
- `page.tsx` 只做最少的入口工作
- 所有同步逻辑移到 `pluginHost.init()` 或 `coreClient.init()`
- 参考方向：Phase 1 + Phase 5

---

## 2. system settings / plugin settings 混合

**观察**：当前 `settings-panel.tsx` 包含：
- 配置编辑（config schema 驱动的字段编辑）
- Admin 区域（远程访问密码、sessions）
- Updates 区域（检查更新、更新日志、重启）

**问题**：
- 一个组件承担了配置管理、系统管理两套职责
- Admin 区的密码管理/认证切换逻辑和配置编辑逻辑在一个组件中，代码难以维护

**建议**：
- 拆分 SettingsPanel 为 `SystemSettingsPanel`（配置编辑）+ `AdminPanel`（认证管理）+ `UpdatePanel`（更新管理）
- 主 Settings 页面提供 tab 导航，各子页面独立
- 配置编辑本身设计良好（ConfigField 组件可复用），只需拆出父容器

---

## 3. mobile 与 desktop registry 可能分叉

**观察**：现有移动端组件（`mobile-sidebar.tsx`、`mobile-right-panel.tsx`）直接调用了 `getPanels('left')` 和 `getPanels('right')`，然后各自渲染面板。侧边栏组件也直接调用了同一套 panel-registry。

**问题**：
- 如果未来有人为移动端写了额外的注册逻辑，两套 registry 可能分叉
- 移动端和桌面端的 panel 显示逻辑不同（`mobile-right-panel.tsx` 会额外做 `mobile.placement !== 'hidden'` 过滤），但这个过滤逻辑不是强制性的，其他组件可绕过

**建议**：
- 统一通过 SurfaceRegistry 获取贡献，桌面端和移动端共享数据源
- 移动端通过 `useMobileSurface()` hook 映射 SurfaceType，不改变数据源
- `mobile.placement` 等字段保留在 SurfaceContribution 中作为 hint，但不做硬性过滤

---

## 4. panels 和 views 的归属不清

**观察**：当前存在 `view-registry.ts`（管理 view → React 组件）和 `panel-registry.ts`（管理面板 → React 组件），但两者功能高度重叠（都属于"注册一个 React 组件用于特定 surface"）。

**问题**：
- 一个新组件应该注册为 view 还是 panel？界限模糊
- view 有 `ViewMeta`（title, icon, openMode, chrome 等），panel 有 `PanelRegistration`（side, title, order, icon, getActions 等）
- 两套类型定义相似但不相同

**建议**：
- 合并为 `SurfaceRegistry`，统一注册
- `SurfaceContribution` 包含所有元数据字段
- view = surfaceType 以 `main.editor` 开头的 contribution
- panel = surfaceType 以 `sidebar.` 或 `panel.` 开头的 contribution
- 保留 `viewId` / `panelId` 作为别名，底层统一

---

## 5. ClaudeChatView 作为复杂插件页面需要迁出 system-ui

**观察**：`claude-chat-view.tsx` 是 app 目录下最复杂的组件之一，包含消息渲染、工具活动展示、Markdown、斜杠命令、消息折叠/展开、token 计数等，代码量很大。

**问题**：
- 整个组件高度依赖 `useWorkbench()` 巨型上下文（获取 wsUrl、token、messages、turns、phase、sendCommand 等）
- 包含大量 claude-code 专有的业务逻辑（SLASH_COMMANDS、TOOL_SEMANTICS、tool rendering）
- 如果迁出为 feature plugin，需要拆解 10+ 个依赖

**建议**：
- 分为三步迁出：
  1. 先创建 `useClaudeChat()` hook，封装所有 workbench-context 依赖
  2. 再创建 `plugins/claude-code/web/ClaudeChatView.tsx`，使用该 hook
  3. 最后删除 `app/console/main/claude-chat-view.tsx`
- Hook 应返回 `{ messages, sendMessage, phase, tools, ... }`，不暴露底层 wsUrl/token

---

## 6. localStorage 恢复策略需要降级为 UI preference

**观察**：`workbench-state.ts` 中的 `saveLayoutsToStorage()` / `loadLayoutsFromStorage()` 在 localStorage 保存了完整的 `instanceStates: Record<string, WorkbenchState>`，包括 tab 列表、instanceId 绑定等。

**问题**：
- 刷新后从 localStorage 恢复 tab 列表和 sessionId 绑定，但 Core 的 session 可能已结束
- 多 browser 之间不一致（Browser A 的 localStorage 不会同步到 Browser B）
- 违反新模型原则

**建议**：
- 改为只保存 UI 布局偏好（Pane 分屏结构、尺寸、面板折叠/展开状态）
- 不保存 `PaneTab[]` 或 `instanceId → sessionId` 映射
- 刷新后从 Core `session.list` 重建 tab 列表
- 提供一个"保留"功能（类似"Pinned Tab"），但不是 session 持久化

---

## 7. 插件管理 UX 需要 plan-before-apply 风险确认

**观察**：插件安装涉及下载二进制、运行脚本、修改系统环境。

**问题**：
- 如果 UI 直接"一键安装"，用户可能不知道安装带来的影响
- 缺少 Plan-Before-Apply 的风险提示中间步骤
- 安装过程中没有进度展示

**建议**：
- 强制 Plan-Before-Apply 流程：用户点"安装" → 显示 Plan → 用户确认 → 执行
- Plan 必须包含：下载大小、要安装的依赖、风险提示、预计时间
- 执行中显示：进度条 + 实时日志
- 失败后显示：错误详情 + 建议操作 + 完整日志链接

---

## 8. 权限授予 UX 需要展示完整上下文

**观察**：当前没有权限授予 UI（新功能）。

**问题**：
- 权限请求需要展示的信息不足可能导致用户盲目允许/拒绝
- 用户需要知道：谁请求的（哪个插件）、请求什么能力、目标节点、是否有路径约束、是否有时间限制

**建议**：
- 权限弹窗必须包含：
  - 请求者：pluginId + 插件名称 + 图标
  - 请求能力：capability 名称 + 描述
  - 目标节点：nodeId（如果有）
  - 约束条件：路径 allow/deny 等
  - 是否可"Ask Each Time"
  - 超时倒计时

---

## 9. 安装历史和 cache/artifact 不能只显示成功失败

**观察**：插件安装历史和缓存管理 UI 目前没有（新功能）。

**建议**：
- 安装历史需要显示：
  - 时间线（按时间倒序）
  - 操作类型（安装/更新/修复/卸载）
  - 版本号变更（from → to）
  - 状态（成功/失败/部分成功）
  - 耗时
  - 日志链接
- 缓存管理需要显示：
  - 每条缓存的 key、大小、路径、创建时间
  - 清理 Plan 预估释放空间
  - 清理结果（成功/失败/部分成功）

---

## 10. WorkbenchContext 过于庞大

**观察**：`workbench-context.tsx` 定义了包含 40+ 个字段的 `WorkbenchContextValue`，从连接状态、消息、工具活动、文件建议、命令面板到 instance 管理。

**问题**：
- 任何组件只要使用 `useWorkbench()`，就获得了整个上下文，即使它只需要其中 1–2 个字段
- 上下文变化会导致所有消费者重新渲染
- 测试困难

**建议**：
- 拆分为多个小 context：
  - `ConnectionContext` — wsUrl, token, connStatus
  - `CoreClientContext` — sendCommand, sendInput, createSession
  - `SurfaceContext` — surfaceId, sessionId, nodeId, params
  - `NotificationContext` — notify, approval
- 只在需要的地方提供对应的 context
- 参考方向：Phase 5

---

## 11. 移动端 touch 手势需要系统化

**观察**：`mobile-sidebar.tsx` 和 `mobile-right-panel.tsx` 各自实现了滑动关闭手势，但逻辑有细微差异。

**问题**：
- left sidebar 只监听了 touchStart 和 touchEnd
- right panel 监听 touchStart, touchMove, touchEnd
- 一个用 `dx > 80` 关闭，另一个也是 `dx > 80`
- 但 left sidebar 的 touchStart 条件（`e.touches[0].clientX < 40`）和 right panel 条件（`clientX > window.innerWidth - 40`）是定长

**建议**：
- 抽取通用的 `useSwipeClose(direction, threshold)` hook
- 统一手势参数（触发区域、关闭阈值、动画时间）
- 避免每个移动端组件各自实现手势逻辑

---

## 12. PaneTabBar 的图标方案需要调整

**观察**：`pane-tab-bar.tsx` 的 `tabIcon()` 使用 `getViewEntry(viewType)` 获取 tab 图标，返回类型名称的首字符。

**问题**：
- 当 viewType 改成 SurfaceType 时，getViewEntry 不再存在
- 用首字符作为图标在多语言环境下不友好
- 对于长数字 ID 的 viewType，首字符可能没有意义

**建议**：
- 改为从 SurfaceContribution 获取图标
- 如果图标不存在，使用 Lucide icon 的默认 icon 回退
- 不再使用 `viewType.charAt(0)` 作为图标

---

## 13. action-registry ActionSurface 需要对齐 SurfaceType

**观察**：`action-types.ts` 中的 `ActionSurface` 类型包含 `'commandPalette' | 'contextMenu' | 'quickActions' | 'header.right' | 'header.left' | 'statusBar.left' | 'statusBar.right' | 'keybinding'`。

**问题**：
- ActionSurface 是 SurfaceType 的子集，但两者是独立的类型系统
- `'quickActions'` 在 SurfaceType 中没有对应项
- `'keybinding'` 在 SurfaceType 中没有对应项

**建议**：
- ActionSurface 应定义为 `SurfaceType` 的子集或别名
- 缺少的 surface（quickActions, keybinding）可以补充到 SurfaceType 中，或者由 action-registry 内部映射
- 保持 surface 概念统一

---

## 14. extension-panels 数据传递模式问题

**观察**：`extension-panels.tsx` 中的各 panel 组件（LogsPanel、TerminalPanel、SystemPanel、ProcessesPanel）通过 props 接收数据，但这些 props 是由父组件通过 `{...props}` spread 传递的。

**问题**：
- 类型不安全：`LogsPanel` 接收 `{ logs?, msgLog? }`，`ProcessesPanel` 接收 `{ instances?, activeInstanceId? }`，但在左/右侧边栏中这些 props 是通过 `PanelComponent {...props}` spread 传递的，TypeScript 无法校验各 panel 是否需要这些 props
- 未来新增 panel 时，父组件需要知道所有 panel 需要的 props

**建议**：
- 改为每个 panel 通过 Core Client 自己获取数据，不再依赖 props spread
- 或者定义统一的 `PanelProps` 类型，包含所有可能需要的数据
- PluginHost 注入 `coreClient` 后，panel 组件自己调用 `coreClient.request()` 获取数据

---

## 15. FocusContext 和 dock-profile 的设计可复用

**观察**：`focus-context.tsx` 提供 `whenContext` 和 `dockProfileKey`，`panel-dnd-wrapper.tsx` 提供 `DockPanelFrame` 组件。这些是良好的关注点分离。

**建议**：
- FocusContext 和 DockPanelFrame 直接保留
- 在 Surface 模型中扩展 FocusContext 支持更多 surface 类型
- DockPanelFrame 改为 SurfacePanelFrame，支持所有 surface 类型的拖拽

---

## 16. Dashboard 的空状态引导

**问题**：当用户首次安装 SessionNode，没有任何节点连接、没有 session 运行时，Dashboard 应该显示引导信息而不是空页面。

**建议**：
- Dashboard 空状态显示分步引导：
  1. "Core 正在运行" ✓
  2. "连接其他节点" → `coreClient.request('node.connect', ...)` 相关文档
  3. "安装插件" → Plugin Manager 入口
  4. "查看文档" → 文档链接
- 按用户的完成进度逐步推进

---

## 总结：UI Agent 工作原则

```
1. 数据从 Core 来，从不缓存为本地真相
2. Surface 是渲染容器，组件不依赖 surface 之外的上下文
3. 移动端不是独立 UI，只是 SurfaceType 的映射
4. 所有写操作通过 Core Protocol，不含 UI 侧业务逻辑
5. Plan-Before-Apply 是安全基线，不能跳过
6. 权限展示须完整（谁 + 什么 + 哪里 + 范围）
7. 失败状态和错误处理与主流程同等重要
8. localStorage 只存主题/尺寸/折叠等纯 UI 偏好
9. 每个 surface 只渲染它需要的组件，不过度注入
10. 新功能先用 system-ui 内置开发，成熟后考虑 feature plugin 迁移
```
