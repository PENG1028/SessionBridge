# Component Ownership and Slots

> Last updated: 2026-05-11
> Purpose: define which UI/runtime pieces belong to the system host, which belong to plugins, and which extension points should be used before changing code.

> 2026-05-11 clarification: the authoritative model is now **Dock System + Action Surface + Transient Surface + Focus Scope + Dock Profile**. Older wording that treats sidebars as view-owned slots, says sidebars should auto-hide on view changes, or treats `activeInstanceId` as UI focus is obsolete.

> Future capability guardrail: before adding broad plugin/runtime capabilities (CLI, task providers, deployment providers, service/webhook runtime, monitoring, InfraCore/platform control), check [`extension-capability-benchmarks.md`](extension-capability-benchmarks.md). That document is a north-star case library, not a current implementation commitment.

## 0. Current Decision Summary

| Chinese | English | Meaning |
|---|---|---|
| 工作台外壳贡献 | Workbench Chrome Contribution | Lightweight host-rendered items contributed into header, status bar, and key hint surfaces. |
| 顶栏插槽 | Header Slot | Public host placement area in `ConsoleHeader`. |
| 状态栏插槽 | Status Bar Slot | Public host placement area in `StatusBar`. |
| 快捷键提示浮层 | Key Hint Overlay | Contextual shortcut hint surface, normally bottom-right on desktop. |
| 停靠系统 | Dock System | Host-owned stable layout system for persistent tool areas. |
| 停靠区 | Dock Area | Stable regions: `left`, `right`, `bottom`, `floating`. First-class areas should stay constrained; do not add arbitrary areas without a product reason. |
| 停靠面板 | Dock Panel | A tool panel inside a dock area, such as Files, Instances, Tasks, Logs, System, or Terminal Log. |
| 面板框架 | Panel Frame | Host-owned wrapper around a panel: title, icon, collapse, drag handle, resize handle, and actions. |
| 面板内容 | Panel Body | Core/plugin-owned content rendered inside the frame. |
| 临时表面 | Transient Surface | UI that normally closes on focus changes: modal, popover, context menu, command palette, picker, tooltip. |
| 焦点作用域 | Focus Scope | Current active tab/view/instance context. It drives `when` conditions. |
| 停靠配置档 | Dock Profile | Per-focus or per-view memory for panel order, collapse, visibility, and size. |
| 动作表面 | Action Surface | Places where actions render: header, status bar, command palette, context menu, quick actions, keybindings. |

Rules:

1. Dock areas do **not** close just because focus changes.
2. Dock panels may appear/disappear according to `when` and focus context.
3. Dock profile should remember panel order/collapse/size per focus scope, initially view-scoped.
4. Transient surfaces close on focus change by default unless explicitly marked persistent.
5. Plugins may suggest layout through declarations; users customize; host enforces final placement.
6. On mobile, dock areas are mapped by the host: `left -> drawer`, `right -> sheet`, `bottom -> sheet`, `floating -> fullscreen` unless a contribution opts out or requests a supported override.

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

Additional Phase 4J chrome terms:

| Chinese name | English name | Short name | Meaning |
|---|---|---|---|
| 工作台外壳贡献 | Workbench Chrome Contribution | Chrome Contribution | Manifest/API item rendered by host chrome, not by plugin-owned React. |
| 外壳动作 | Chrome Action | Chrome Action | Header/status/key-hint item that may invoke a command. |
| 焦点条件 | Focus When Context | When Context | Active pane/tab/view/instance data used by `when` expressions. |
| 交互条件 | Interaction Context | Interaction Context | Additional UI state such as selection, hovered surface, or active input mode. Future extension of `whenContext`. |
| 宿主统一渲染 | Host-rendered UI | Host-rendered | Host controls visual density, placement, responsive behavior, and fallback rendering. |
| 插件声明 | Manifest Contribution | Manifest | Plugin-owned declarative metadata consumed by host registries. |

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

### 2.2.1 Workbench Chrome Contributions (Phase 4J target)

Workbench Chrome Contributions are lightweight, host-rendered items contributed by manifests or host/core registries. They are not Dock Panels, not main Views, and not plugin-owned arbitrary React components.

Target surfaces:

| Surface | Chinese | Purpose | Renderer owner |
|---|---|---|---|
| `header` | 顶栏 | Lightweight buttons, text items, badges, and command launchers near the top chrome | Host |
| `statusBar` | 状态栏 | Small persistent state text/badges and optional command launchers near the bottom chrome | Host |
| `keyHints` | 快捷键提示浮层 | Contextual shortcut hints, normally bottom-right on desktop | Host |
| `contextControls` | 自适应上下文控制项 | Unified model covering hints, buttons, toggles, menus, progress, approval, and jump (Phase 4J-b) | Host |

Boundary rules:

1. Plugins declare structure only: `id`, `title`, `text`, `label`, `icon`, `keys`, `command`, `side`, `group`, `order`, `when`, `priority`, `mobile`, `kind`, and `placement`.
2. Plugins do not directly inject React into `ConsoleHeader`, `StatusBar`, or the key hint overlay in Phase 4J.
3. Host owns icon mapping, visual style, layout density, truncation, responsive fallback, conflict handling, and disabled states.
4. Complex UI should be opened through a command into a modal, popover, panel, or future custom renderer. It should not be embedded directly in chrome items.
5. `when` should be explicit whenever possible. Missing `when` means global visibility, but implementations should warn in development for plugin-owned global chrome items.
6. Header/status/key-hint/context-control contributions must follow pane focus via `whenContext`; they must not fall back to global `activeInstanceId`.
7. Host/core items win on `id` conflict. Plugin items with conflicting IDs should be skipped or warned.
8. Unknown icons use host fallback icons. Unknown commands should warn and render disabled or no-op, depending on the surface.
9. Mobile may hide or collapse chrome items even when desktop would show them.

Phase 4J-b upgraded the model: `contextControls` is now the primary contribution type, replacing `keyHints`. Legacy `keyHints` are converted to `contextControls` with `kind: "hint"` and `placement: "bottom-right"`. The `KeyHintOverlay` component uses `getBottomRightContextControls()` as its data source and only renders bottom-right eligible controls (`placement: "bottom-right"`, `placement: "auto"`, or unset + `kind: "hint"`). Hints render as kbd+label, other kinds render as capsules.

Supported `kind` values: `hint`, `button`, `toggle`, `menu`, `progress`, `approval`, `jump`.

Supported `placement` values: `bottom-left`, `bottom-right`, `header-right`, `status-left`, `status-right`, `auto`.

Current manifest shape:

```json
{
  "contributes": {
    "chrome": {
      "header": [
        {
          "id": "terminal.clear",
          "title": "Clear",
          "icon": "eraser",
          "side": "right",
          "order": 20,
          "when": "view == \"terminal\"",
          "command": "terminal.clear"
        }
      ],
      "statusBar": [
        {
          "id": "terminal.connection",
          "text": "Terminal",
          "side": "left",
          "order": 10,
          "when": "view == \"terminal\""
        }
      ],
      "contextControls": [
        {
          "id": "terminal.stop",
          "kind": "hint",
          "label": "Stop",
          "keys": "Esc",
          "placement": "bottom-right",
          "priority": 90,
          "when": "view == \"terminal\" && isRunning",
          "command": "terminal.stop"
        }
      ]
    }
  }
}
```

Status:

- Dock panels already use `contributes.views` and `when`-based filtering.
- Header, status bar, context controls all have manifest contribution implementations.
- Legacy `keyHints` compatibility preserved through automatic conversion to `contextControls`.
- Existing settings, dashboard, connection status, disconnect banner, and project switcher remain host/core-owned.
- Existing shortcut hint UI migrated to `contextControls` behind the `kind: "hint"` model.

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

Rule: plugins declare preferred and allowed placements; users and host layout decide the actual placement. Plugins must not directly mutate global layout or force a dock area to exist.

Current dock-area policy:

| Dock Area | Chinese | Desktop behavior | Mobile fallback | Notes |
|---|---|---|---|---|
| `left` | 左停靠区 | Fixed/overlay navigation and project panels | Drawer | Files, instances, navigation-like panels |
| `right` | 右停靠区 | Fixed/overlay context and inspector panels | Bottom sheet | Tasks, properties, context, logs |
| `bottom` | 底部停靠区 | Resizable bottom dock | Bottom sheet | Output, terminal, timeline, problems |
| `floating` | 浮动停靠区 | Host-managed floating panel/window | Fullscreen modal/sheet | Inspector, preview, monitor |

Freedom boundary:

```text
Plugin suggests preferredArea/defaultSize/allowedAreas.
User customizes order/collapse/size and eventually area.
Host enforces supported areas, responsive fallback, permissions, and focus rules.
```

Do not implement arbitrary plugin-controlled sidebars, plugin-owned dock systems, or view-owned global layout transitions. If a plugin needs temporary UI, it should use a Transient Surface rather than creating its own dock.

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

### 2.4.1 Shared UI Availability

Shared UI must declare where it works. A component being available on desktop does not automatically mean it is comfortable or safe on mobile.

| Component type | 中文名 | Desktop | Tablet | Mobile | Default host fallback |
|---|---|---:|---:|---:|---|
| `DockPanelFrame` | 停靠面板框架 | Yes | Yes | Yes | Render as sheet/accordion if fixed sidebars are unavailable |
| `ResourceTree` | 资源树 | Yes | Yes | Limited | Render compact tree or searchable list |
| `RuntimeList` | 运行时列表 | Yes | Yes | Yes | Render as full-width list inside mobile sheet |
| `LogViewer` | 日志查看器 | Yes | Yes | Limited | Disable dense columns; prefer wrapped text |
| `DataTable` | 数据表 | Yes | Limited | Limited | Render cards/list rows if width is too small |
| `TerminalWidget` | 终端控件 | Yes | Limited | Limited | Provide touch toolbar for Esc/Ctrl/Cmd/paste/resize |
| `CommandPalette` | 命令面板 | Yes | Yes | Limited | Render as fullscreen command sheet |
| `ContextMenu` | 右键菜单 | Yes | Limited | No native right-click | Render as long-press or action sheet |
| `FloatingWindow` | 浮动窗口 | Yes | No | No | Render as modal/sheet or disable placement |

Rules:

1. Shared UI exports must include a support level: `supported`, `limited`, or `unsupported` per platform.
2. `limited` means the host may adapt the presentation while preserving the action contract.
3. `unsupported` means the host must hide the contribution or show an explicit unsupported state.
4. Plugins should not implement their own desktop/mobile fork unless the shared component API cannot express the desired behavior.

Suggested metadata shape:

```ts
type PlatformKind = 'desktop' | 'tablet' | 'mobile';

type ComponentSupport = 'supported' | 'limited' | 'unsupported';

interface SharedComponentMeta {
  id: string;
  displayName: string;
  support: Record<PlatformKind, ComponentSupport>;
  fallback?: 'hide' | 'sheet' | 'list' | 'readonly' | 'unsupported-message';
}
```

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

### 2.6 Device and Client API

SessionBridge is expected to run from desktop browsers, tablets, phones, and future native shells. The host must expose device/client capabilities so plugins can make intentional choices instead of guessing from CSS or user-agent strings.

| 中文名 | English name | Meaning | Example |
|---|---|---|---|
| 客户端 | Client | One connected UI session | A Chrome tab on PC, Safari on iPhone |
| 设备类型 | Device Type | Coarse device class | `desktop`, `tablet`, `mobile` |
| 客户端能力 | Client Capability | Input/layout features available to this client | `keyboard`, `touch`, `dragDrop`, `popover` |
| 布局配置档 | Layout Profile | Per-device layout shape | desktop split panes vs mobile sheets |
| 在线状态 | Presence | Which clients are connected and what they focus | PC observing terminal, phone controlling instance |

Target client context:

```ts
interface ClientContext {
  clientId: string;
  deviceType: 'desktop' | 'tablet' | 'mobile';
  viewport: { width: number; height: number; density?: number };
  input: {
    keyboard: boolean;
    touch: boolean;
    pointer: 'mouse' | 'touch' | 'pen' | 'unknown';
    modifierKeys: boolean;
  };
  ui: {
    dragDrop: boolean;
    splitPane: boolean;
    floatingWindow: boolean;
    popover: boolean;
    contextMenu: 'right-click' | 'long-press' | 'action-sheet' | 'none';
    sidebars: 'fixed' | 'overlay' | 'hidden';
  };
}
```

Default ownership rules:

1. `Instance`, `Session`, and extension manifests are shared resources.
2. `Layout`, `activePane`, open mobile sheets, sidebar visibility, and command palette state are per-client by default.
3. `ViewTab` state is per-client unless a future sync API explicitly marks it shared.
4. `activeInstanceId` must not be treated as a single global UI focus in multi-client scenarios. Prefer pane/tab-bound `instanceId` and client-local focus.
5. A phone opening the same relay must not unexpectedly rearrange the desktop layout.

Dock/mobile ownership rules:

1. Dock Profile is per-client by default.
2. Desktop may show fixed dock areas; tablet/mobile should map dock areas to host-controlled drawers/sheets/fullscreen presentations.
3. Plugins may declare `mobile.placement = auto | drawer | sheet | fullscreen | hidden`, but host may override unsafe choices.
4. A plugin declaring mobile support does not get permission to bypass host layout. It only means its Panel Body can render acceptably inside the host's chosen mobile container.
5. Transient surfaces close on focus change by default on all devices.

### 2.7 Plugin Responsive Contract

Plugins should be able to declare whether their views, panels, menus, actions, and shared UI usage are supported on desktop/tablet/mobile. If a plugin does not declare anything, the host applies safe defaults.

Suggested manifest extension:

```json
{
  "contributes": {
    "views": {
      "sidebar-right": [
        {
          "id": "my.stats",
          "title": "Stats",
          "component": "DataTable",
          "platforms": {
            "desktop": "supported",
            "tablet": "limited",
            "mobile": "limited"
          },
          "fallback": "list"
        }
      ]
    },
    "menus": [
      {
        "id": "my.menu.inspect",
        "menu": "workbench/context",
        "title": "Inspect",
        "command": "my.inspect",
        "platforms": {
          "desktop": "supported",
          "mobile": "action-sheet"
        }
      }
    ]
  }
}
```

Policy:

1. Missing `platforms` means `desktop: supported`, `tablet: limited`, `mobile: limited`.
2. If a contribution uses only shared system components, the host may automatically adapt it to the current platform.
3. If a contribution declares `mobile: unsupported`, the host hides it on mobile and may show an explanatory placeholder if the user opens it directly.
4. If a plugin declares all platforms supported but uses a component that is unsupported on the current platform, the component support rule wins.
5. Plugins should declare required input features when needed, for example `requires: ["keyboard", "dragDrop"]`.
6. Host-provided fallbacks must preserve commands/actions where possible even if visual placement changes.

## 3. Current Ownership Audit

| Current object | 中文名 | Current state | Desired ownership | Phase 4D action |
|---|---|---|---|---|
| `ConsoleHeader` | 顶部栏 | Global hard-rendered | Host Chrome + chrome policy + future slots | Make header density/visibility meta-driven |
| Runtime policy/mode badges | 运行策略徽标 | Header infers globally | Status/header contribution or full-header-only host item | Hide outside full chrome |
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

## 4. Dock Panel Ownership (Phase 4I‑c)

> Last updated: 2026-05-11

Dock panels are classified by ownership scope. The `when` condition in panel registration determines visibility relative to focus context.

### 4.1 Host/System Persistent Panels

Always visible regardless of focus. These represent core workspace infrastructure:

| Panel ID | Side | When | Reason |
|----------|------|------|--------|
| `files` | left | (none) | Workspace file tree — cross-view utility |
| `instances` | left | (none) | Runtime/instance management — cross-view utility |

### 4.2 Claude‑Scoped Panels

Only visible when focus is on a Claude‑Chat view (`view == "claude-chat"`):

| Panel ID | Side | When | Notes |
|----------|------|------|-------|
| `quick-actions` | left | `view == "claude-chat"` | Claude‑specific quick commands |
| `session-actions` | right | `view == "claude-chat"` | Session-level actions |
| `snapshots` | right | `view == "claude-chat"` | Snapshot management |
| `files-context` | right | `view == "claude-chat"` | File context for current session |
| `tasks` | right | `view == "claude-chat"` | Task tracking — declared in claude-code manifest |
| `logs` | right | `view == "claude-chat"` | Claude session logs — declared in claude-code manifest |
| `terminal` | right | `view == "claude-chat"` | Claude quick terminal — declared in claude-code manifest |

### 4.3 Shell‑Scoped Panels

Only visible when focus is on a terminal view (`view == "terminal"`):

| Panel ID | Side | When | Notes |
|----------|------|------|-------|
| `terminal-log` | right | `view == "terminal"` | Raw terminal output log |
| `processes` | right | `view == "terminal"` | Process list — declared in shell manifest |

### 4.4 System/Dashboard‑Scoped Panels

| Panel ID | Side | When | Notes |
|----------|------|------|-------|
| `system` | right | `view == "dashboard"` | System info panel — declared in system-info manifest |

### 4.5 Ownership Rules

1. **Dock areas stay stable** — left and right dock areas do not close on focus change.
2. **Panel visibility follows `when`** — panels not matching the current focus context are filtered out by `getPanels()`.
3. **Dock Profile restores order/collapse/size per view** — panel layout memory is scoped by `dockProfileKey` (`view:<viewType>`).
4. **Extension panels require component override** — manifests declare structure (id, title, icon, when); core provides the React component via `registerPanelComponent()`. Panels without a registered component are skipped with a dev console warning.
5. **Dynamic React panel loading** remains future work — external plugins cannot currently ship their own panel components.
6. **Core panels always win** — `syncExtensionPanels()` skips IDs already registered by core, preventing manifest declarations from overwriting built-in panels.

### 4.6 Chrome Contributions (Phase 4J)

Chrome contributions (`contributes.chrome`) let manifests declare lightweight items in the host chrome: header buttons, status bar text, context controls (hints, buttons, toggles, menus, progress, approval, jump), and legacy key hints. Unlike panels, chrome items are declarative only — plugins provide text/icon/command metadata, and the host renders them with uniform styling.

| Chrome area | Host rendering | Plugin supplies | When filtering |
|---|---|---|---|
| `header` | `ConsoleHeader` right area | `text`, `icon`, `title`, `command` | Yes |
| `statusBar` | `StatusBar` left/right | `text`, `icon`, `command` | Yes |
| `keyHints` | `KeyHintOverlay` bottom-right | `keys`, `label`, `command` | Yes |
| `contextControls` | `KeyHintOverlay` bottom-right | `kind`, `label`, `keys`, `icon`, `command`, `placement`, `priority` | Yes |

Rules:

1. Plugins **cannot inject React components** into chrome areas. Only host-rendered declarative items.
2. Each item has an `id`, optional `when`, optional `command` for click action.
3. Items are sorted by `side` (left before right), then `group`, then `order`. Context controls sort by `placement` → `priority` (desc) → `order`.
4. Unknown `command` IDs produce a dev console warning but do not block loading.
5. Context controls are limited to 6 items in the overlay, hidden on mobile (`hidden md:flex`).
6. ASK/THINK-related chrome items are out of scope for Phase 4J.
7. `contextControls` is the primary model (Phase 4J-b). Legacy `keyHints` are automatically converted to `contextControls` with `kind: "hint"`, `placement: "bottom-right"`.

### 4.7 Status Summary

| Feature | Status | Since | Notes |
|---|---|---|---|
| Dock Panel `when` filtering | Done | 4I | Per view/focus |
| Dock Profile persistence | Done | 4I | Order/collapse per view |
| Extension panel component override | Done | 4I | Manifest + core component |
| Chrome header contributions | Implemented | 4J | Host-rendered, no React injection |
| Chrome statusBar contributions | Implemented | 4J | Host-rendered, left/right sides |
| Chrome keyHints | Legacy compat | 4J | Auto-converted to contextControls (kind: hint) |
| Chrome contextControls | Implemented | 4J-b | Unified model: hint, button, toggle, menu, progress, approval, jump |
| Dynamic React chrome items | Not implemented | — | Future |
| Mobile chrome collapse strategy | Partial | 4J | Context controls hidden; header/statusBar unchanged |

## 5. Context Menu Ownership

The context menu uses a **Host-owned three-layer model** (Phase 4K). The host owns rendering, positioning, clamping, keyboard navigation, mobile fallback, and command dispatch. Plugins and components own local intent.

### 5.1 Three Sources

| Source | When to use | How it registers |
|---|---|---|
| **Manifest contributes.menus** | Stable surfaces only: `workbench/context`, `terminal/context`, `chat/context`, `tab/context`, `instance/context`, `file/context`, `panel/context` | Declared in `sb-extension.json`, synced via `syncContextMenus()` |
| **Action registry with `contextMenu` surface** | Host-owned actions that appear on multiple surfaces | `registerAction()` with `surfaces: ['contextMenu']` |
| **Component localItems** | Dynamic runtime data: row right-click, tree node, chart point, message block | Passed as `localItems` in `ContextMenuRequest` at call time |

Sources are merged in priority order (localItems > manifest > action registry), deduplicated by `id`, filtered by `when`-condition, and sorted by `group` → `order` → `title`.

### 5.2 Chain Resolution

When a component calls `openContextMenu(request)`, it provides a `chain` — an ordered list of menu targets from most specific to most generic:

```
["message/context", "chat/context", "view/context", "workbench/context"]
```

The registry walks the chain and collects manifest menus matching each target. This allows a chat message to pick up message-specific menus, chat-level menus, view-global menus, and workbench-global menus in the correct order.

### 5.3 Nested Menus

`ContextMenuItemSpec` supports `children` for submenus. The `ContextMenu` renderer recursively renders submenus on hover, positioned to the right with viewport clamping. Items with children do not execute a command on click.

### 5.4 Command Dispatch

Clicking a menu item follows this chain:

1. If item has `children` → open submenu, do not execute command.
2. If `command` is set → look up `getAction(command)`, run with merged `{ ...actionRunCtx, target, args }`.
3. Fallback → `sendCommand(command, { ...args, target })`.
4. Unknown command → `console.warn`.
5. Disabled items do not execute.

### 5.5 Current State

| Layer | State | Code |
|---|---|---|
| Types (`ContextMenuTarget`, `ContextMenuRequest`, `ContextMenuItemSpec`) | Done | `app/console/menus/context-menu-types.ts` |
| Frontend registry (3-source merge, chain, dispatch) | Done | `app/console/menus/context-menu-registry.ts` |
| Renderer with nested submenu support | Done | `app/console/shell/context-menu.tsx` |
| Host hook (`openContextMenu`, `handleWorkbenchContextMenu`) | Done | `app/console/hooks/use-context-menu.ts` |
| Manifest contributes.menus with menu targets | Done | Server `extension-points.ts` + manifests |
| Host context menu actions | Done | `register-core-actions.tsx` |
| Tab context menu | Legacy inline | `page.tsx#handleContextTab` — uses `openContextMenu` with `localItems` |
| Instance list context menu | TODO | Future `instance/context` |
| File tree / message / block context menus | TODO | Future `file/context`, `message/context` |

### 5.6 Recommended Menu Targets

| Target | Chain usage | Purpose |
|---|---|---|
| `workbench/context` | `['workbench/context']` | Right-click on main workbench area |
| `view/context` | `['view/context', 'workbench/context']` | Right-click on any view surface |
| `terminal/context` | `['terminal/context', 'view/context', 'workbench/context']` | Right-click on terminal area |
| `chat/context` | `['chat/context', 'view/context', 'workbench/context']` | Right-click on chat area |
| `tab/context` | `['tab/context', 'view/context', 'workbench/context']` | Right-click on pane tabs |
| `instance/context` | `['instance/context', 'workbench/context']` | Right-click on instance list items |
| `file/context` | `['file/context', 'view/context', 'workbench/context']` | Right-click on file tree entries |
| `panel/context` | `['panel/context', 'workbench/context']` | Right-click on panel headers |
| `message/context` | `['message/context', 'chat/context', 'view/context', 'workbench/context']` | Right-click on chat messages |
| `selection/context` | `['selection/context', 'view/context', 'workbench/context']` | Right-click on selected content |

### 5.7 Manifest Menu Shape

```json
{
  "contributes": {
    "menus": [
      {
        "id": "shell.menu.clear",
        "menu": "terminal/context",
        "title": "Clear",
        "command": "shell.clear",
        "group": "edit",
        "order": 10,
        "when": "view == \"terminal\""
      }
    ]
  }
}
```

- `menu` defaults to `"workbench/context"` when omitted (backward compatible).
- Only suitable for stable surfaces. For dynamic runtime data, use component `localItems` via `openContextMenu()`.

### 5.8 Design Rules

1. **Host owns menu shell.** No plugin may render its own context menu overlay.
2. **Plugins own local intent.** Components call `openContextMenu()` with a `ContextMenuRequest`.
3. **Manifest menus only for stable surfaces.** Do not put row-level or node-level menus in manifest.
4. **Shared UI components may expose a `getContextMenu` resolver prop.** Future: FileTree, List, DataTable.
5. **Command dispatch must be unified.** Always action registry first, `sendCommand` fallback.
6. **Nested menus must not crash.** Renderer handles arbitrary depth; mobile drill-down is future work.

## 6. Placement and Drag Rules

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

## 7. Open Target Model (Phase 4F)

### 7.1 Core Concept: View ≠ Instance

Pre-Phase 4F, "opening a view" implicitly created a runtime instance (e.g. opening Terminal → `shell.spawn`, opening Claude Chat → `POST /api/instances`). Phase 4F separates these concepts:

| Concept | 中文名 | Description | Example |
|---|---|---|---|
| View Tab | 视图标签 | A UI surface in a pane/tab, may or may not have a runtime instance bound | `PaneTab` with `viewType: 'terminal'` |
| Runtime Instance | 运行时实例 | A server-side process that executes commands or runs an AI agent | `InstanceData` in `InstanceManager` |
| Binding | 绑定 | Assigning an instanceId to a tab so the view can communicate with the runtime | `SET_TAB_VIEW` with `instanceId` |

### 7.2 `ViewMeta.openMode`

Each view declares how it relates to runtime instances via `openMode` in `view-registry.ts`:

| Mode | Meaning | Example views |
|---|---|---|
| `singleton` | Static UI, no instance needed. Default. | Dashboard, Settings, Logs |
| `instance-bound` | Requires a runtime instance to function | Terminal, Claude Chat |
| `session-bound` | (Future) Binds to a session rather than a process | — |
| `node-bound` | (Future) Binds to a workspace node | — |
| `runtime-create` | (Future) Creating this view should prompt for a new instance | — |

### 7.3 Rules

1. **Opening a view never auto-creates an instance.** `handleRequestView` in page.tsx only sets `viewType`/`title` on the tab — no `createInstance()` call.

2. **`instance-bound` views without `instanceId`** must render an attach/create empty state instead of their runtime UI.

   - `TerminalView` → shows "Create New Terminal" button + attach hint
   - `ClaudeChatView` → shows "Create New Runtime" button + attach hint

3. **`ShellTerminal` must not create runtime implicitly.** It receives an `instanceId` and sends `shell.spawn { instanceId }` only when one is provided. An empty/undefined `instanceId` never triggers shell creation.

4. **`POST /api/instances` requires explicit `adapterId`.** Returns 400 if missing. No silent fallback to `getDefaultAdapterId()`.

5. **Every `createInstance()` call must include an explicit `adapterId`.** No call site may pass `undefined` and rely on a server-side fallback.

6. **Kill button is always visible** for all instances (not only on hover). Active instances require `window.confirm()` before killing.

### 7.4 Instance → Tab Binding

When a user clicks "Create New Terminal/Runtime" in an empty view:

1. View calls `workbench.createInstance(dir, label, adapterId)` (from `WorkbenchContext`)
2. Server creates the instance via `POST /api/instances` with explicit `adapterId`
3. View calls `workbench.bindCurrentTabInstance(instanceId)` which dispatches `SET_TAB_VIEW` to attach the instance to the current tab
4. Pane re-renders, view receives `instanceId` prop, renders runtime component (ShellTerminal etc.)

### 7.5 File Manifest

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

## 8. API Contract Gaps

The following APIs should be treated as first-class contracts before adding more large features. They prevent desktop/mobile behavior and plugin behavior from drifting apart.

| API | 中文名 | Why it matters | Suggested document |
|---|---|---|---|
| Client Device API | 客户端设备 API | Defines client identity, device type, input capabilities, viewport, presence | `docs/api/client-device-api.md` |
| Workbench State API | 工作台状态 API | Defines per-client layout, tab, pane, and instance binding semantics | `docs/api/workbench-state-api.md` |
| Action API | 动作 API | Unifies command palette, context menus, header buttons, panel actions, mobile action sheets | `docs/api/action-api.md` |
| Shared UI API | 共享组件 API | Defines stable host components and platform support | `docs/api/shared-ui-api.md` |
| Error/Diagnostics API | 错误诊断 API | Standardizes error codes and debugging boundaries | `docs/api/error-diagnostics-api.md` |

Priority:

1. Document `ClientContext` and per-client vs shared state before deeper mobile work.
2. Make all action surfaces consume one `Action` contract before expanding menus/keybindings.
3. Promote shared UI support metadata before exporting more components to plugins.

## 9. Phase Guidance

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

### Phase 4E: Action Surface Registry and Dock Profile

Scope:

- Introduce a single action contract for command palette, context menu, keybindings, quick actions, header items, and status bar items.
- Keep Settings, connection, project switcher, and disconnect banner host-owned; do not pretend they are plugins.
- Convert hardcoded quick actions/context menu/keyboard shortcuts into host-registered actions first.
- Add menu target names such as `workbench/context`, `tab/context`, `instance/context`, `panel/context`, and `file/context`. (Completed in Phase 4K)
- Add Dock Profile keys for panel order/collapse/size by Focus Scope. Start with view-scoped profiles; instance-scoped profiles can come later.
- Keep dock areas constrained to `left`, `right`, `bottom`, and `floating`.

Do not:

- Build plugin installation, marketplace, or multi-node plugin distribution.
- Add arbitrary plugin-controlled dock areas.
- Implement dynamic React web-view loading in this phase.
- Force all core UI to become plugins. Host/Core actions are allowed when they are truly host-owned.

### Phase 4H: API Contract Documentation

Scope:

- Create `docs/api/` as the stable API contract home.
- Move or summarize protocol details from design documents into API-shaped references.
- Add compatibility status to each API: `stable`, `experimental`, or `internal`.
- Add test matrix entries for browser, REST, WebSocket, and mobile/manual checks.

Do not:

- Rewrite protocol implementation while documenting it.
- Invent unsupported marketplace behavior as if it already exists.
- Treat design sketches as stable API without a status label.

### Phase 4J: Workbench Chrome Contributions

Scope:

- Add manifest/types support for `contributes.chrome.header`, `contributes.chrome.statusBar`, and `contributes.chrome.keyHints`.
- Validate chrome contribution arrays in the extension loader.
- Aggregate chrome contributions in extension points and expose them through the existing extension-points data flow.
- Add a client-side chrome registry that filters by pane-focus `whenContext`.
- Integrate lightweight host-rendered header items into `ConsoleHeader`.
- Integrate lightweight host-rendered status items into `StatusBar`.
- Add a `KeyHintOverlay` for contextual shortcut hints (initially `keyHints`, later upgraded to `contextControls`).
- Migrate simple existing shortcut hints into `contextControls` (Phase 4J-b primary model; `keyHints` is legacy).
- Keep settings, connection, project switcher, dashboard toggle, and disconnect banner host-owned unless a later phase deliberately migrates them.
- Define mobile fallback: key hints hidden or collapsed by default; header/status items may collapse or hide based on `mobile`.

#### Phase 4J-b: Adaptive Context Controls

Scope:

- Upgrade `keyHints` to a unified `contextControls` model supporting `kind: hint | button | toggle | menu | progress | approval | jump`.
- Add `ContextControlContribution` type and extend `ChromeContributions` with `contextControls`.
- Validate `contextControls` in extension loader (kind, placement, field type checks).
- Aggregate `contextControls` in extension-points, convert legacy `keyHints` with dedup.
- Update `chrome-registry.ts` with `getContextControls()` and `getContextControlHints()`.
- Upgrade `KeyHintOverlay` to use `getBottomRightContextControls()`, rendering only bottom-right eligible controls (hints as kbd+label, others as capsules).
- Migrate shell and claude-code manifests from `keyHints` to `contextControls`.
- Document `contextControls` as the primary model; `keyHints` is legacy compat.

Do not:

- Implement ASK/THINK behavior.
- Implement runtime provider / recommendation algorithm.
- Implement dynamic folding/collapse UI.
- Implement custom React renderer for chrome items.
- Implement free color/theme system.
- Implement full mobile strategy.

Do not:

- Implement dynamic React renderers for chrome items.
- Allow plugins to inject arbitrary React into header/status/key-hint surfaces.
- Build plugin installation, marketplace, or multi-node plugin distribution.
- Rewrite the terminal or Claude main views.
- Move complex dropdowns into chrome items. Use commands to open modals, popovers, or panels instead.

### Phase 4K: Context Menu + Action Ownership Cleanup

Scope:

- Extend `MenuContribution` type with `menu` (menu target) and `order` fields.
- Validate `menu` and `order` in extension loader menus validation.
- Add menu target filtering to `extension-points.ts#getMenus(menuTarget?, group?, ctx?)`.
- Create frontend `context-menu-registry.ts`: syncs manifest menus, queries by menu target + when, merges action registry items with 'contextMenu' surface, dispatches via action registry → sendCommand fallback.
- Register host-owned context menu actions (`host.killInstance`, `host.clearHistory`, `host.toggleTerminal`, `host.copyAll`) with 'contextMenu' surface in `register-core-actions.tsx`.
- Rewrite `use-context-menu.ts` to accept `menuTarget`, `whenCtx`, `actionRunCtx` — no hardcoded plugin IDs or adapter-specific logic.
- Wire `syncContextMenus()` into page.tsx extension sync useEffect.
- Update shell and claude-code manifests with `menu: "workbench/context"` on menu contributions.
- Document resolved debt and updated ownership model.

Do not:

- Migrate `handleContextTab` inline items (tab context menu) to registry — deferred until tab context menu design is finalized.
- Add new UI components or overlays.
- Change server-side extension manifest schema beyond the `menu`/`order` field additions.
- Modify `context-menu.tsx` rendering shell.
- Add business features or new menu items beyond the cleanup scope.

### Phase 4L: Unified Command Dispatch

Scope:

- Create `runWorkbenchCommand()` as the single entry point for all action surfaces: context menu, command palette, header chrome, status bar chrome, context controls, quick actions, keybindings.
- Dispatch chain: action registry → command registry → sendCommand fallback, with dev-mode warnings for unknown commands.
- Replace all surface-specific dispatch implementations with calls to `runWorkbenchCommand()`.
- Document the dispatch contract in `docs/api/action-api.md`.

Key design:

- **Action is capability, Surface is display location.** The same action (e.g., `shell.clear`) can appear in the context menu, command palette, header, and as a context control — all dispatch through `runWorkbenchCommand()`.
- **No surface may implement its own action-registry → fallback logic.** If a surface needs a command, it calls `runWorkbenchCommand({ command })`.

Do not:

- Add new actions or commands beyond what already exists.
- Refactor the action registry or command registry internals.
- Add new UI surfaces or components.
- Change the server-side manifest schema.
- Touch keybinding dispatch (future work).

### Phase 4M: Configuration System

Scope:

- Build a VS Code-style layered configuration system with three scopes: `default` (read-only), `user` (`~/.sessionbridge/settings.json`), and `workspace` (`<workspace>/.sessionbridge/settings.json`).
- Create a `ConfigurationRegistry` singleton that aggregates schemas from host and extensions, enforcing the namespace rule that extension keys must start with `${extensionId}.`.
- Create a `ConfigurationStore` singleton with atomic file writes (tmp + rename), value validation (type, enum, min/max), and layered resolution (workspace ?? user ?? default).
- Expose 5 REST API endpoints under `/api/configuration/` for schema queries, value reads, inspect, patch, and delete.
- Add a dynamic "Extensions" section to SettingsPanel that renders extension-contributed settings from schema, with search bar, scope toggle (User/Workspace), modified-only filter, dirty state tracking, Save All button, per-field reset, inline validation errors, loading/error/empty states.
- Update extension manifests (`sb-extension.json`) to use namespaced keys and declare `scope`.
- Document the namespace rule, scope field, and supported types in `docs/extension-authoring.md`.

Key design:

- **Host configs stay host-owned.** The existing `/api/config` endpoints and hardcoded SettingsPanel tabs (connections/server/external/notifications) remain unchanged. Only extension-contributed settings use the new dynamic UI.
- **Singleton pattern:** `configRegistry` and `configStore` are module-level singletons (like `appConfig` in `src/config.ts`), not passed through the dependency graph.
- **Validation at two layers:** extension-loader validates schema shape at load time; configStore validates values at write time.
- **Reserved scopes:** `node`, `device`, `instance`, `session` are reserved for future use and not implemented.

Do not:

- Replace the existing host config endpoints (`/api/config`, `/api/config/connections`).
- Implement multi-user config or per-machine config in this phase.
- Add real-time sync or config push for extension settings (that belongs to the existing relayConfig system).
- Implement settings diff/merge, settings JSON editor, or settings export/import.
- Add an undo stack for config changes.
- Build a config migration system for breaking changes.
