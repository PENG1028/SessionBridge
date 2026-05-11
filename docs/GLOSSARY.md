# SessionBridge 术语表

> 最后更新: 2026-05-06

## 一、术语定义

| 中文 | English | 代码映射 | 定义 |
|------|---------|----------|------|
| 节点 | **Node** | `NodeRuntime` (`agent-core/node-runtime.ts`) | 一台运行 SessionBridge 的设备（PC/手机/服务器）。所有 Node 运行相同的核心代码，每个 Node 提供仅供本地使用的 Dashboard 面板 |
| 面板 | **Dashboard** | `dashboard-server.ts` + Next.js UI | 每个 Node 在 `127.0.0.1:9843` 提供的统一 Web UI。默认仅供本地使用；当前实现包含本机网络检测与 `dashboardBind` 切换接口，远程节点的一键对外访问仍在收口中。面板显示 relay 已知实例，可直接操控已连接远程 Node 上的进程 |
| 中继 | **Relay** | `NodeRelayServer` (`src/relay-server.ts`) | 一种 Node 角色，提供 WebSocket 中继服务。Node 之间通过 Relay 通信，但 Relay 本身对上层透明 |
| 显示区 | **Stage** | `app/page.tsx` `<main>` 区域 | 浏览器主视口中央的固定区域。容纳多个 Scene 以 Tab 形式组织。支持全屏/行列/网格布局 |
| 场景 | **Scene** | `activeInstanceId` → `adapterToViewId` → View Component | Stage 内的一个 Tab。绑定到一个 Instance，可拖拽分屏、切换布局模式 |
| 面板 | **Panel** | `LeftSidebar` / `RightSidebar` / 底部抽屉 / 悬浮窗 | 外围配置区域。位置由插件声明：左/右/底部/悬浮/长按菜单 |
| 插件 | **Plugin** | `extensions/` 目录 | 定义：① Stage 里的显示组件（View）；② 专属配置面板列表（Panels） |
| 实例 | **Instance** | `InstanceData` (`src/instance-manager.ts`) | 一个运行中的进程。每个 Scene 背后有一个 Instance |
| 终端 | **Terminal** | `ShellAdapter` + `TerminalView` | 运行 bash/pwsh 的交互式命令行。插件的一种，最通用的内置插件 |
| 工作区 | **Workspace** | 目录路径 | Instance 绑定的工作目录 |

## 二、用户视角 ↔ 代码映射

```
用户看到           → 代码在哪里
─────────────────────────────────────
浏览器页面         → next.js 渲染 app/page.tsx
Stage 主显示区     → <main> 元素（page.tsx ~行 1000+）
Scene Tab 切换     → InstanceTabBar 组件（click 触发 activateInstance）
面板（侧栏）       → LeftSidebar / RightSidebar 组件
右键菜单           → ContextMenu 组件（handleCtx 函数生成条目）
用户输入           → enqueueInput() → 队列 → sendStdin() → 进程 stdin
用户看到输出       → shell.output 给 ShellTerminal / instance.block 给聊天
页面底部状态栏     → StatusBar 组件
手机侧栏（抽屉）   → MobileSidebar 组件
```

## 三、相关文件

架构拓扑、节点关系和访问方式统一维护在 [architecture.md](./architecture.md)，避免术语表和架构文档重复漂移。

| 文件 | 说明 |
|------|------|
| `extensions/types.ts` | 核心类型定义（Adapter/Instance/Panel/Scene） |
| `extensions/registry.ts` | 适配器注册表 |
| `app/console/main/view-registry.ts` | adapterId → view 组件映射 |
| `app/console/main/adapter-view.tsx` | 根据 viewId 渲染对应的 View |
| `app/console/sidebar/left-sidebar.tsx` | 左侧面板 |
| `app/console/sidebar/right-sidebar.tsx` | 右侧面板 |
| `app/console/sidebar/mobile-sidebar.tsx` | 移动端侧栏 |
| `src/instance-manager.ts` | 实例管理器 |
| `extensions/shell/index.ts` | Shell 适配器实现 |
| `extensions/claude-code/` | Claude Code 适配器 |

## Component Ownership / 组件所有权命名

For the full ownership and slot policy, see
[component-ownership-and-slots.md](./component-ownership-and-slots.md).

| 中文名 | English name | Short name | Code / policy mapping |
|---|---|---|---|
| 系统内核 | System Kernel | Kernel | `InstanceManager`, `PermissionModel`, `ExtensionLoader`, `ExtensionHost`, transport, workbench state |
| 宿主外壳 | Host Chrome | Chrome | `ConsoleHeader`, `StatusBar`, command palette shell, context menu shell, settings shell |
| 工作台表面 | Workbench Surface | Surface | `WorkbenchLayout`, `MainSlot`, sidebars, bottom pane, floating/popup placement |
| 共享系统组件 | Shared System UI | Shared UI | File tree, process list, terminal widget, markdown renderer, UI primitives |
| 插件自有组件 | Plugin-Owned UI | Plugin UI | Adapter/plugin views and panels such as `TerminalView`, `ClaudeChatView`, `TaskPanel` |
| 插槽 | Slot | Slot | Public host placement area such as `header.right`, `statusBar.left`, `sidebar.right`, `main`, `bottom` |
| 贡献点 | Contribution Point | Contribution | Manifest/API declarations for views, panels, menus, commands, keybindings, chrome items |
| 主视图外壳策略 | View Chrome Policy | Chrome Policy | `ViewMeta.chrome`, e.g. header/status bar/command palette/shortcut availability |
| 放置能力 | Placement Capability | Placement | Allowed placements such as `main`, `left`, `right`, `bottom`, `floating`, `popout` |
| 客户端 | Client | Client | One connected UI session, such as a desktop browser tab or a mobile browser |
| 设备类型 | Device Type | Device | Coarse client class: `desktop`, `tablet`, or `mobile` |
| 客户端能力 | Client Capability | Capability | Available UI/input features such as keyboard, touch, dragDrop, popover, contextMenu |
| 布局配置档 | Layout Profile | Layout Profile | Per-device layout behavior, e.g. desktop split panes vs mobile sheets |
| 在线状态 | Presence | Presence | Which clients are connected and what each client is focused on |
| 响应式契约 | Responsive Contract | Responsive Contract | Plugin declaration of desktop/tablet/mobile support and fallback behavior |
# Current Layout Vocabulary

> 2026-05-11 note: the current authoritative layout vocabulary is: Dock System, Dock Area, Dock Panel, Panel Frame, Panel Body, Transient Surface, Focus Scope, Dock Profile, and Action Surface. A tab's UI focus comes from `PaneTab.instanceId`; `activeInstanceId` is only a management selection and must not be described as the active UI focus.

| Chinese | English | Definition |
|---|---|---|
| 停靠系统 | Dock System | Host-owned stable layout system for persistent tool areas. |
| 停靠区 | Dock Area | Stable regions such as `left`, `right`, `bottom`, `floating`. |
| 停靠面板 | Dock Panel | One tool panel inside a dock area. |
| 面板框架 | Panel Frame | Host wrapper for title/icon/collapse/drag/actions/resize. |
| 面板内容 | Panel Body | Core/plugin content rendered inside the frame. |
| 临时表面 | Transient Surface | Modal, popover, context menu, command palette, picker, tooltip. Closes on focus change by default. |
| 焦点作用域 | Focus Scope | Current active tab/view/instance context used by `when` conditions. |
| 停靠配置档 | Dock Profile | Per-focus memory for panel order/collapse/size/visibility. |
| 动作表面 | Action Surface | Header/status/context menu/command palette/quick actions/keybinding surfaces. |
