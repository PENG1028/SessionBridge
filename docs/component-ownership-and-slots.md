# Component Ownership and Slots

> Last updated: 2026-05-09
> Purpose: define which UI/runtime pieces belong to the system host, which belong to plugins, and which extension points should be used before changing code.

## 1. Naming

| 中文名 | English name | Short name | Meaning |
|---|---|---|---|
| 系统内核 | System Kernel | Kernel | Minimal runtime that loads plugins, enforces permissions, routes messages, and owns layout state. |
| 宿主外壳 | Host Chrome | Chrome | Global UI frame around plugin content, such as header, status bar, command palette shell, context menu shell, and disconnect banner. |
| 工作台表面 | Workbench Surface | Surface | Dockable/splittable/floating layout area where views and panels are placed. |
| 共享系统组件 | Shared System UI | Shared UI | Stable reusable UI building blocks provided by the host, such as file tree, process list, terminal widget, markdown renderer, and menu primitives. |
| 插件自有组件 | Plugin-Owned UI | Plugin UI | Components owned by one plugin/adapter, such as TerminalView, ClaudeChatView, TasksPanel, or custom extension panels. |
| 插槽 | Slot | Slot | A public placement area controlled by the host where plugins may contribute UI. |
| 贡献点 | Contribution Point | Contribution | Manifest/API declaration that adds views, panels, menus, commands, keybindings, or chrome items. |
| 视图 | View | View | Main workbench content registered through `registerView()` or extension manifest contributions. |
| 面板 | Panel | Panel | Sidebar/bottom/floating tool area registered through panel contributions. |
| 主视图外壳策略 | View Chrome Policy | Chrome Policy | Per-view metadata deciding whether host header/status bar/shortcuts/command palette are available. |
| 放置能力 | Placement Capability | Placement | Where a view/panel may live: main, left, right, bottom, floating, or popout. |

## 2. Ownership Layers

### 2.1 System Kernel

System Kernel is the part plugins must not patch or fork. Plugins interact with it only through capabilities, registries, or host APIs.

| 中文名 | English name | Current code | Plugin can use directly | Plugin can move/display | Plugin can modify internals | Extension path |
|---|---|---|---:|---:|---:|---|
| 实例管理器 | Instance Manager | `src/instance-manager.ts` | No | No | No | Host API/capability only |
| 权限模型 | Permission Model | `adapters/agent-core/permissions.ts` | No | No | No | Capability checks |
| 插件加载器 | Extension Loader | `adapters/agent-core/extension-loader.ts` | No | No | No | Manifest + activation |
| 插件宿主 | Extension Host | `adapters/agent-core/extension-host*.ts` | No | No | No | Extension protocol |
| 会话提供者接口 | Session Provider Interface | `adapters/types.ts` | Implement only | No | No | Adapter implements `getSessionProvider()` |
| 工作台状态机 | Workbench State | `app/console/stage/workbench-state.ts` | No | Indirect | No | Open/move view requests |
| 传输协议 | Transport Protocol | `src/relay-server.ts`, `adapters/agent-core/relay-connection.ts` | No | No | No | Protocol messages only |

Rule: if breaking this layer breaks plugin loading, permissions, routing, or layout identity, it is Kernel.

### 2.2 Host Chrome

Host Chrome is owned by the host. Plugins should not import and mutate chrome components directly. They may contribute items into public slots.

| 中文名 | English name | Current code | Current state | Desired extension model |
|---|---|---|---|---|
| 顶部栏 | Header Bar | `app/console/shell/console-header.tsx` | Too global | `header.left`, `header.center`, `header.right`, controlled by active view chrome policy |
| 底部状态栏 | Status Bar | `app/console/shell/status-bar.tsx` | Partly meta-controlled | `statusBar.left`, `statusBar.right`, controlled by active view chrome policy |
| 命令面板容器 | Command Palette Shell | `app/console/shell/command-palette.tsx` | Global overlay | Host shell + plugin command contributions |
| 右键菜单容器 | Context Menu Shell | `app/console/shell/context-menu.tsx` | Global hook with hard branches | Host shell + `contributes.menus` / context menu contributions |
| 设置容器 | Settings Shell | `app/console/shell/settings-panel.tsx` | Global overlay | Host shell + settings section contributions |
| 断线提示 | Disconnect Banner | `app/page.tsx` | Host-owned | Remains host-owned |

Rule: a plugin may add a button/status/menu item to Host Chrome through a public slot, but it may not inject UI into another plugin's internal view.

### 2.3 Workbench Surface

Workbench Surface owns placement, drag/drop, split panes, floating windows, and layout persistence. Plugins provide content and placement declarations.

| 中文名 | English name | Current code | Plugin can use directly | Plugin controls content | Host controls placement |
|---|---|---|---:|---:|---:|
| 主编辑区 | Main Editor Area | `WorkbenchLayout`, `MainSlot` | No | Yes, via View | Yes |
| 左侧栏 | Left Sidebar | `LeftSidebar`, `panel-registry` | No | Yes, via Panel | Yes |
| 右侧栏 | Right Sidebar | `RightSidebar`, `panel-registry` | No | Yes, via Panel | Yes |
| 底部面板 | Bottom Panel | `WorkbenchState.bottom` | No | Future | Yes |
| 浮动窗口 | Floating Window | Planned | No | Future | Yes |
| 标签/拆分布局 | Tabs and Split Layout | `workbench-state.ts` | No | No | Yes |

Rule: plugins declare allowed placements; users and host layout decide the actual placement.

Suggested future manifest shape:

```json
{
  "contributes": {
    "views": [
      {
        "id": "terminal",
        "title": "Terminal",
        "allowedPlacements": ["main", "bottom", "right", "floating"],
        "defaultPlacement": "main"
      }
    ]
  }
}
```

### 2.4 Shared System UI

Shared System UI is reusable but must have a stable public API. Plugins may compose it, but should not fork, monkey-patch, or import unstable internals.

| 中文名 | English name | Candidate/current code | Plugin can use | Plugin can modify | Recommended access |
|---|---|---|---:|---:|---|
| 目录树 | File Tree | `FilesPanel` internals / future shared component | Yes, once exported | No | Stable `FileTree` component + file capability |
| 进程列表 | Process List | `ProcessesPanel` / process capability | Yes, once exported | No | Stable `ProcessList` component + process capability |
| 终端控件 | Terminal Widget | `app/shell-terminal.tsx` | Carefully | No | Stable `TerminalWidget`; prefer terminal-capable adapter |
| Markdown 渲染器 | Markdown Renderer | `app/console/main/markdown-renderer.tsx` | Yes, once exported | No | Stable renderer props or block renderer contribution |
| 基础菜单/按钮 | UI Primitives | Buttons, menu, tabs, cards | Yes | Compose only | Shared UI package/barrel export |
| 设置区块 | Settings Section | `SettingsPanel` future sections | Yes | No | Settings schema/section contribution |

Rule: shared components are a product surface. Export fewer, stable components first. Do not make every internal component public by default.

### 2.5 Plugin-Owned UI

Plugin-Owned UI is controlled by the plugin that registers it.

| 中文名 | English name | Current example | Owner | Other plugins can inject into it |
|---|---|---|---|---:|
| 终端主视图 | Terminal View | `adapters/shell/web-views.ts` + `TerminalView` | Shell plugin/adapter | No |
| Claude 聊天视图 | Claude Chat View | `adapters/claude-code/web-views.ts` + `ClaudeChatView` | Claude Code plugin/adapter | No |
| 任务面板 | Tasks Panel | `TaskPanel` registered by Claude web-views | Claude Code plugin/adapter | No |
| 插件面板 | Extension Panel | Manifest `contributes.views` panel entries | Owning plugin | No |
| 插件设置页 | Plugin Settings Section | Future settings contribution | Owning plugin | No |

Rule: if another plugin wants UI visible while this view is active, it contributes to Host Chrome slots with a `when` clause. It does not modify the view internals.

Example:

```json
{
  "contributes": {
    "header": [
      {
        "id": "terminal.cwd",
        "slot": "header.right",
        "title": "Working Directory",
        "when": "view == terminal",
        "command": "terminal.pickCwd"
      }
    ]
  }
}
```

## 3. Current Ownership Audit

| Current object | 中文名 | Current state | Desired ownership | Phase 4D action |
|---|---|---|---|---|
| `ConsoleHeader` | 顶部栏 | Global hard-rendered | Host Chrome + chrome policy + future slots | Make header density/visibility meta-driven |
| Runtime badge `ASK/THINK` | 运行策略徽标 | Header infers globally | Claude/status contribution or full-header-only host item | Hide outside full chrome |
| `StatusBar` | 底部状态栏 | Global, partly meta-controlled | Host Chrome + status bar slots | Keep controlled by `ViewMeta.chrome.statusBar` |
| `CommandPalette` | 命令面板 | Global overlay | Host shell + command contributions | Disable by `ViewMeta.chrome.commandPalette` |
| `useKeyboardShortcuts` | 全局快捷键 | Global key capture | Host keybinding service + contributions | Disable by `ViewMeta.chrome.globalShortcuts` |
| `useContextMenu` | 右键菜单生成器 | Has terminal/structuredEvents branches | Host context menu contribution | Add TODO and document debt |
| `LeftSidebar` / `RightSidebar` | 左右侧栏 | Host containers with panels | Host Surface + panel contributions | Keep |
| `FilesPanel` | 文件面板 | Core panel | Built-in system plugin or shared component | Later |
| `InstancesPanel` | 实例面板 | Core panel | Built-in system plugin | Later |
| `QuickActionsPanel` | 快捷操作面板 | Core panel | Workspace/Claude contribution | Later |
| `TerminalLogPanel` | 终端日志面板 | Core panel | Debug/log contribution | Later |
| `DashboardView` | 仪表盘视图 | Core view | Built-in system-status plugin | Later |
| `SettingsPanel` | 设置面板 | Global overlay | Host shell + settings contributions | Later |
| `TerminalView` | 终端视图 | Adapter-owned view | Shell plugin-owned | Already aligned |
| `ClaudeChatView` | Claude 聊天视图 | Adapter-owned view | Claude plugin-owned | Already aligned |

## 4. Context Menu Ownership

The context menu is currently only half componentized:

| Layer | 中文名 | Current code | Current state | Target state |
|---|---|---|---|---|
| Context menu shell | 右键菜单外壳 | `app/console/shell/context-menu.tsx` | Componentized | Keep as host-owned rendering shell |
| Overlay placement | 覆盖层渲染 | `app/console/overlays/console-overlays.tsx` | Centralized | Keep as host-owned overlay placement |
| Menu contribution schema | 菜单贡献声明 | `MenuContribution`, `contributes.menus` | Exists, but lacks target menu ID | Add `menu` field such as `workbench/context`, `tab/context`, `instance/context` |
| Server aggregation | 菜单贡献聚合 | `extension-points.ts#getMenus()` | Exists | Filter by menu target + `when` |
| Workbench menu builder | 工作台菜单生成器 | `app/console/hooks/use-context-menu.ts` | Still hardcoded | Replace hardcoded branches with registry/contribution collection |
| Tab context menu | 标签页右键菜单 | `app/page.tsx#handleContextTab` | Inline in page | Move to same context menu registry with `tab/context` |
| Instance tab menu | 实例标签右键菜单 | `InstanceTabBar` | Reserved/empty | Future `instance/context` |

Current hardcoded debt in `use-context-menu.ts`:

| Hardcoded item/branch | 中文名 | Why it is debt | Target owner |
|---|---|---|---|
| `isTerminalView` inferred from `structuredEvents` | 终端视图判断 | View identity is inferred indirectly from capabilities | Use `when` context such as `view == terminal` or `activeAdapterId == shell` |
| `a.id !== 'shell' || isTerminalView` | shell adapter 过滤 | Core hook knows shell-specific behavior | Host/new-instance contribution or adapter capability policy |
| `Clear Terminal` | 清空终端 | Terminal-specific action is hardcoded globally | Shell plugin menu contribution |
| `Clear History` | 清空历史 | Chat/workspace action is hardcoded globally | Claude/workspace menu contribution |
| `Toggle Terminal` | 切换终端 | Workbench action is hardcoded in menu hook | Host workbench menu contribution |
| `Copy All` | 复制全部 | Chat transcript action is hardcoded globally | Claude/workspace menu contribution |

Target menu contribution shape:

```json
{
  "contributes": {
    "menus": [
      {
        "id": "shell.menu.clear",
        "menu": "workbench/context",
        "title": "Clear Terminal",
        "command": "shell.clear",
        "group": "edit",
        "when": "activeAdapterId == shell"
      }
    ]
  }
}
```

Recommended menu target names:

| Menu target | 中文名 | Purpose |
|---|---|---|
| `workbench/context` | 工作台右键菜单 | Right-click on the main workbench area |
| `tab/context` | 标签页右键菜单 | Right-click on pane/workbench tabs |
| `instance/context` | 实例右键菜单 | Right-click on instance tabs/list items |
| `panel/context` | 面板右键菜单 | Right-click on sidebar/bottom panels |
| `file/context` | 文件右键菜单 | Right-click on file tree entries |

Phase 4E should introduce a front-end `context-menu-registry.ts`:

- Host registers built-in menu items through the same API plugins use.
- Extension manifest menus are synced into the same registry.
- Menu builders request items by `menu` target and `WhenContext`.
- `ContextMenu` remains a dumb rendering shell.
- `useContextMenu` becomes a thin adapter from browser events to registry lookup.

## 5. Placement and Drag Rules

SessionBridge should follow a Photoshop/VS Code-like model:

| Concern | 中文名 | Owner | Rule |
|---|---|---|---|
| Dragging panels | 拖拽面板 | Host Workbench | Host implements drag/drop and persists layout. |
| Splitting panes | 拆分视图 | Host Workbench | Host owns split state and tab groups. |
| Floating windows | 浮动窗口 | Host Workbench | Host owns window lifecycle and restore. |
| Tool content | 工具内容 | Plugin | Plugin renders its own content. |
| Allowed placements | 允许放置位置 | Plugin declaration | Plugin declares allowed/default placements. |
| Final placement | 实际放置位置 | User + Host layout | User moves; host saves. |

Plugins should not implement their own dock/floating system. They should declare placement ability and let Workbench host them.

## 6. Open Target Model (Phase 4F)

### 6.1 Core Concept: View ≠ Instance

Pre-Phase 4F, "opening a view" implicitly created a runtime instance (e.g. opening Terminal → `shell.spawn`, opening Claude Chat → `POST /api/instances`). Phase 4F separates these concepts:

| Concept | 中文名 | Description | Example |
|---|---|---|---|
| View Tab | 视图标签 | A UI surface in a pane/tab, may or may not have a runtime instance bound | `PaneTab` with `viewType: 'terminal'` |
| Runtime Instance | 运行时实例 | A server-side process that executes commands or runs an AI agent | `InstanceData` in `InstanceManager` |
| Binding | 绑定 | Assigning an instanceId to a tab so the view can communicate with the runtime | `SET_TAB_VIEW` with `instanceId` |

### 6.2 `ViewMeta.openMode`

Each view declares how it relates to runtime instances via `openMode` in `view-registry.ts`:

| Mode | Meaning | Example views |
|---|---|---|
| `singleton` | Static UI, no instance needed. Default. | Dashboard, Settings, Logs |
| `instance-bound` | Requires a runtime instance to function | Terminal, Claude Chat |
| `session-bound` | (Future) Binds to a session rather than a process | — |
| `node-bound` | (Future) Binds to a workspace node | — |
| `runtime-create` | (Future) Creating this view should prompt for a new instance | — |

### 6.3 Rules

1. **Opening a view never auto-creates an instance.** `handleRequestView` in page.tsx only sets `viewType`/`title` on the tab — no `createInstance()` call.

2. **`instance-bound` views without `instanceId`** must render an attach/create empty state instead of their runtime UI.

   - `TerminalView` → shows "Create New Terminal" button + attach hint
   - `ClaudeChatView` → shows "Create New Runtime" button + attach hint

3. **`ShellTerminal` must not create runtime implicitly.** It receives an `instanceId` and sends `shell.spawn { instanceId }` only when one is provided. An empty/undefined `instanceId` never triggers shell creation.

4. **`POST /api/instances` requires explicit `adapterId`.** Returns 400 if missing. No silent fallback to `getDefaultAdapterId()`.

5. **Every `createInstance()` call must include an explicit `adapterId`.** No call site may pass `undefined` and rely on a server-side fallback.

6. **Kill button is always visible** for all instances (not only on hover). Active instances require `window.confirm()` before killing.

### 6.4 Instance → Tab Binding

When a user clicks "Create New Terminal/Runtime" in an empty view:

1. View calls `workbench.createInstance(dir, label, adapterId)` (from `WorkbenchContext`)
2. Server creates the instance via `POST /api/instances` with explicit `adapterId`
3. View calls `workbench.bindCurrentTabInstance(instanceId)` which dispatches `SET_TAB_VIEW` to attach the instance to the current tab
4. Pane re-renders, view receives `instanceId` prop, renders runtime component (ShellTerminal etc.)

### 6.5 File Manifest

| File | Change |
|---|---|
| `app/console/main/view-registry.ts` | Added `openMode` to `ViewMeta` |
| `adapters/shell/web-views.ts` | `openMode: 'instance-bound'` |
| `adapters/claude-code/web-views.ts` | `openMode: 'instance-bound'` |
| `app/console/main/terminal-view.tsx` | Empty state when no `instanceId` |
| `app/console/main/claude-chat-view.tsx` | Empty state when no `instanceId` |
| `app/shell-terminal.tsx` | Sends `shell.spawn` only with valid `instanceId` (no change needed — already conditional) |
| `app/console/workbench/workbench-context.tsx` | Added `createInstance`, `bindCurrentTabInstance` |
| `app/page.tsx` | `handleRequestView` no longer creates instances; `bindCurrentTabInstance` callback |
| `src/api-routes.ts` | POST `/api/instances` requires `adapterId` |
| `src/instance-manager.ts` | Internal-only fallback with TODO |
| `app/console/sidebar/instance-list.tsx` | Kill button always visible (opacity-30 base + hover/focus) |
| `app/console/panels/instances-panel.tsx` | Inline form with adapterId selector instead of `prompt()` |
| `app/console/sidebar/mobile-sidebar.tsx` | Removed implicit `onCreate` prop

## 6. Phase Guidance

### Phase 4D: Host Chrome Policy

Scope:

- Extend `ViewMeta.chrome`.
- Let Terminal view declare minimal header, hidden status bar, disabled command palette, disabled global shortcuts.
- Make `ConsoleHeader`, `StatusBar`, command palette, and global shortcuts respect active view chrome policy.
- Add TODO/documentation for context menu contribution debt.

Do not:

- Build marketplace/install CLI.
- Build full slot contribution system.
- Migrate all core panels.
- Rewrite Workbench drag/drop.

### Phase 4E: Host Slot Contributions

Future scope:

- `contributes.header`
- `contributes.statusBar`
- `contributes.contextMenu`
- `contributes.keybindings`
- Built-in system plugins for Files, Instances, Dashboard, Settings.
- Stable shared component export surface.
