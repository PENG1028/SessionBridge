# SessionNode v2 — UX Surface / Slot 系统设计

> Surface = 插件贡献点 + 上下文 + 权限后的 Core 数据入口
> Companion docs: APP_UI_PLUGIN.md, APP_UI_FEATURES.md, SESSION_AND_STREAM.md.
> Older "System UI" terms in this file are historical and mean App UI.

---

## 目录

1. [概念升级](#一概念升级)
2. [Surface 类型总表](#二surface-类型总表)
3. [SurfaceRenderContext](#三surfacerendercontext)
4. [Plugin Surface 贡献](#四plugin-surface-贡献)
5. [Surface 与 Session 投影](#五surface-与-session-投影)
6. [Slot 升级路径](#六slot-升级路径)
7. [移动端 Surface 适配](#七移动端-surface-适配)
8. [内置组件 vs 自定义组件](#八内置组件-vs-自定义组件)
9. [当前 UI 迁移方案](#九当前-ui-迁移方案)
10. [防回退规则](#十防回退规则)

---

## 一、概念升级

### 当前 Slot 模型

当前 UI 的 slot 系统本质是布局容器：

```
Slot = 布局容器
  → MainSlot       = 主编辑器区域
  → SidebarSlot    = 侧边栏
  → PanelSlot      = 面板区域

特点：
  - 只关心"放哪里"
  - 不关心"放什么"
  - 没有上下文传递
  - 组件自己知道要什么数据
```

### 新版 Surface 模型

```
Surface = 插件贡献点 + 上下文 + 权限后的 Core 数据入口
  → Surface 是 Slot 的升级
  → 除了"放哪里"，还携带：
    - 当前 sessionId（如果有）
    - 当前 nodeId（如果有）
    - 插件 ID
    - 视图 ID
    - 其他参数

Slot = Where (位置)
Surface = Where + What + Context (位置 + 内容 + 上下文)
```

### 为什么需要 Surface

```
旧模式：
  MainSlot 渲染时不知道自己关联哪个 session
  → 组件自己去 Core 查 session list
  → 组件自己维护"当前 session"状态
  → 多个组件可能维护不同的"当前 session"

新模式：
  SurfaceRenderContext 直接携带 sessionId
  → 组件不需要自己去查
  → 同一个 surface 切换 session → context 更新 → 组件重新渲染
  → 所有组件看到同一个"当前 session"
```

---

## 二、Surface 类型总表

### Surface 定义

```typescript
type SurfaceType =
  // 主工作区
  | "main.editor"           // 主编辑器区域（核心工作区）
  | "main.editor.split"     // 分屏编辑器

  // 侧边栏
  | "sidebar.left"          // 左侧边栏
  | "sidebar.right"         // 右侧边栏

  // 面板
  | "panel.bottom"          // 底部面板
  | "panel.bottom.terminal" // 底部终端面板（快捷方式）

  // 顶栏
  | "header.left"           // 顶栏左侧（菜单按钮、导航）
  | "header.center"         // 顶栏中间（tab 标签）
  | "header.right"          // 顶栏右侧（按钮、状态）

  // 状态栏
  | "statusBar.left"        // 状态栏左侧
  | "statusBar.right"       // 状态栏右侧

  // 命令
  | "commandPalette"        // 命令面板（弹窗/覆盖层）

  // 菜单
  | "contextMenu"           // 右键菜单
  | "menubar"               // 菜单栏（桌面端）

  // 设置
  | "settings.page"         // 设置页面
  | "settings.page.general" // 通用设置页面
  | "settings.page.plugins" // 插件设置页面

  // 插件详情
  | "plugin.detail"         // 插件详情页
  | "plugin.detail.permissions" // 插件权限页
  | "plugin.detail.files"   // 插件文件页
  | "plugin.detail.cache"   // 插件缓存页

  // 移动端
  | "mobile.sheet"          // 移动端底部弹出
  | "mobile.fullscreen"     // 移动端全屏

  // 通知
  | "notification.center"   // 通知中心
  | "notification.toast"    // Toast 通知

  // 弹窗
  | "dialog"                // 通用弹窗
  | "dialog.approval"       // 审批弹窗
```

### Surface 属性表

| Surface | 单例 | 可拖拽 | 可打开/关闭 | 可调整大小 | 上下文依赖 |
|---------|------|--------|------------|-----------|-----------|
| main.editor | 否（可分屏） | - | 是 | 是 | sessionId |
| sidebar.left | 是 | 是 | 是 | 是 | nodeId |
| sidebar.right | 是 | 是 | 是 | 是 | pluginId |
| panel.bottom | 是 | 是 | 是 | 是 | sessionId |
| header.* | 是 | 否 | 否 | 否 | 无 |
| statusBar.* | 是 | 否 | 否 | 否 | 无 |
| commandPalette | 是 | 否 | 是（弹窗） | 否 | 无 |
| contextMenu | 否 | 否 | 是（弹窗） | 否 | 右键目标 |
| settings.page | 否（嵌套） | 否 | 是 | 否 | 设置 section |
| plugin.detail | 否（嵌套） | 否 | 是 | 否 | pluginId |
| mobile.sheet | 是 | 否 | 是 | 否（固定） | 可变 |
| mobile.fullscreen | 是 | 否 | 是 | 否（全屏） | 可变 |
| notification.center | 是 | 否 | 是（弹窗） | 否 | 无 |

---

## 三、SurfaceRenderContext

### 核心类型

```typescript
type SurfaceRenderContext = {
  /** Surface 唯一标识 */
  id: string;

  /** Surface 类型 */
  type: SurfaceType;

  /** 贡献此视图的插件 ID */
  pluginId: string;

  /** 插件声明的视图 ID */
  viewId?: string;

  /** 面板 ID（如果是面板） */
  panelId?: string;

  /** UI tab ID（纯前端） */
  tabId?: string;

  /** 关联的 Core session（如果有） */
  sessionId?: string;

  /** 关联的 Core node（如果有） */
  nodeId?: string;

  /** workspace 路径（如果有） */
  workspaceId?: string;

  /** 插件自定义参数 */
  params?: Record<string, unknown>;
}
```

### SurfaceRenderContext 示例

```typescript
// main.editor 渲染 ClaudeChatView
const context: SurfaceRenderContext = {
  id: "main.editor.001",
  type: "main.editor",
  pluginId: "claude-code",
  viewId: "claude-code.chat",
  tabId: "tab_3bF9",
  sessionId: "sess_1Lg3",
  nodeId: "node_vps",
  workspaceId: "/repo",
  params: {
    model: "sonnet",
  },
};

// sidebar.right 渲染 Plugin Status 面板
const context: SurfaceRenderContext = {
  id: "sidebar.right.001",
  type: "sidebar.right",
  pluginId: "system-ui",
  viewId: "system-ui.plugin-status",
  panelId: "system-ui.plugin-status",
};

// settings.page 渲染 ClaudeCode 配置
const context: SurfaceRenderContext = {
  id: "settings.page.001",
  type: "settings.page",
  pluginId: "system-ui",
  viewId: "system-ui.settings.plugins.detail",
  params: {
    pluginId: "claude-code",
    section: "permissions",
  },
};
```

### 渲染器

```typescript
// 渲染器根据 context 找出应该渲染哪个组件
function SurfaceRenderer({ context }: { context: SurfaceRenderContext }) {
  const Component = componentRegistry.resolve(context);

  if (!Component) {
    return <MissingComponent surface={context} />;
  }

  return <Component surfaceContext={context} />;
}
```

---

## 四、Plugin Surface 贡献

### Manifest 中的表面贡献

```yaml
# plugins/claude-code/plugin.yaml
web:
  views:
    - id: claude-code.chat
      label: "Claude Chat"
      component: custom          # 自定义 React 组件
      entry: ClaudeChatView
      preferredSlot: main.editor
      allowedSlots:
        - main.editor
        - panel.bottom

    - id: claude-code.history
      label: "History"
      component: custom
      entry: HistoryView
      preferredSlot: panel.bottom
      allowedSlots:
        - panel.bottom
        - sidebar.right

  panels:
    - id: claude-code.panel
      label: "Claude"
      slot: sidebar.left          # 贡献给侧边栏
      component: custom
      entry: ClaudePanel

    - id: claude-code.sessions
      label: "Sessions"
      slot: panel.bottom
      component: custom
      entry: SessionListPanel

  commands:
    - id: claude-code.run
      label: "Run Claude Code"
      action: claude-code.start
      surface: commandPalette     # 命令面板中显示

  menus:
    - id: claude-code.context
      label: "Claude Code"
      surface: contextMenu        # 右键菜单
      items:
        - label: "Explain code"
          action: claude-code.explain
```

### preferredSlot 和 allowedSlots

```
preferredSlot = 插件建议的默认位置
allowedSlots  = 插件允许的所有位置（用户可拖拽）

规则：
  1. 插件第一次安装时，视图默认放在 preferredSlot
  2. 用户可拖拽到 allowedSlots 中的任意位置
  3. 不能拖拽到 allowedSlots 之外
  4. 用户拖拽偏好存 localStorage（非事实）

示例：
  ClaudeChatView：
    preferredSlot: main.editor
    allowedSlots: [main.editor, panel.bottom]
    → 默认在主编辑器打开
    → 用户可以拖到底部面板

  TerminalView：
    preferredSlot: panel.bottom
    allowedSlots: [panel.bottom, main.editor]
    → 默认在底部面板打开
    → 用户可以拖到主编辑器

  LogStream：
    preferredSlot: panel.bottom
    allowedSlots: [panel.bottom]
    → 只能待在底部面板
```

### Surface 贡献注册流程

```
1. 插件加载
   → Core 扫描 plugin.yaml
   → 读取 web.views, web.panels, web.commands, web.menus

2. Core 广播 plugin.registered 事件
   → 包含 plugin.yaml 中的 views/panels/commands/menus 声明

3. System UI Plugin Host 收到广播
   → 注册到 componentRegistry
   → componentRegistry 根据 viewId 绑定 React 组件
   → 绑定完成后，可被 SurfaceRenderer 渲染

4. 用户打开视图
   → System UI 创建 SurfaceRenderer
   → 传入 SurfaceRenderContext
   → 渲染对应组件
```

---

## 五、Surface 与 Session 投影

### Tab 是 Session 的投影

```
Core Session                     Surface (Tab)
─────────────────────────────────────────────────
sess_abc                         main.editor + ClaudeChatView
  kind: "process"                  context: { sessionId: "sess_abc", ... }
  pluginId: "claude-code"
  status: "running"

sess_def                         panel.bottom + TerminalView
  kind: "shell"                    context: { sessionId: "sess_def", ... }
  pluginId: "shell"
  status: "running"

（无对应 session）                settings.page
                                   context: { pluginId: "system-ui", ... }
```

### 从 Session 列表重建 Surface

```
刷新后的重建过程：

1. Core welcome → sessions: [{ sessionId, kind, pluginId, status }, ...]

2. System UI 遍历 sessions：
   each session → {
     // 决定 viewType
     if (session.pluginId === "claude-code") → viewType = "claude-code.chat"
     if (session.pluginId === "shell")        → viewType = "shell.terminal"

     // 创建 SurfaceRenderContext
     context = {
       id: `main.editor.${tabId}`,
       type: "main.editor",
       pluginId: session.pluginId,
       viewId: viewType,
       sessionId: session.sessionId,
     }

     // 创建 UI tab
     tabs.push({ context, label: session.kind })
   }

3. 渲染每个 tab → SurfaceRenderer

4. Tab 关闭 → 只销毁 Surface，session 保持运行
   关闭 → dispatchEvent("tab.closed", { sessionId })
   不发送 session.stop

5. 再次打开 → 创建新 Surface，绑定同一个 sessionId
   打开 → stream.subscribe { fromSeq: lastKnownSeq }
   恢复输出
```

### 多 Tab 投影同一 Session

```
两个浏览器同时投影 sess_abc：

Browser A (main.editor)      Browser B (panel.bottom)
  ClaudeChatView               ClaudeChatView
  context: {                    context: {
    sessionId: "sess_abc",        sessionId: "sess_abc",
    type: "main.editor",          type: "panel.bottom",
    viewId: "claude-code.chat",   viewId: "claude-code.chat",
  }                             }

两个 Surface 不同，但绑定同一 sessionId。
Core 看到的是两个 subscribers，不是两个 sessions。
```

---

## 六、Slot 升级路径

### 当前 Slot 系统

```
// 当前代码
viewRegistry:
  - id: "claude-code.chat"
    component: ClaudeChatView
    slot: "main"       // 简单的 slot 分配

panelRegistry:
  - id: "terminal"
    component: TerminalView
    slot: "bottom"     // 简单的 slot 分配
```

### 升级为 Surface

```
// 新版 Surface 系统

// Surface 配置
surfaceRegistry:
  - id: "main.editor"
    type: "main.editor"
    component: SurfaceRenderer
    accepts: "views"       // 接受 views
    multiple: true         // 支持多个
    dragTarget: true       // 可拖拽到其他多 surface

  - id: "sidebar.left"
    type: "sidebar.left"
    component: SurfaceRenderer
    accepts: "views" | "panels"
    multiple: true
    dragSource: true       // 可拖出

// SurfaceRenderer 配置
pluginSurfaceRegistry:
  "claude-code.chat": {
    pluginId: "claude-code",
    viewId: "claude-code.chat",
    componentType: "custom",     // custom (React 组件) | builtin (系统内置)
    entry: "ClaudeChatView",
    preferredSlot: "main.editor",
    allowedSlots: ["main.editor", "panel.bottom"],
    // 只有 custom 组件才需要 entry，builtin 用预注册的
  }
```

### 升级步骤

```
Step 1: 重构 viewRegistry → pluginSurfaceRegistry
  - 当前 viewRegistry 直接注册 React 组件
  - 改为 registry 存 metadata，组件通过 PluginHost 延迟加载

Step 2: 引入 SurfaceRenderContext
  - 当前 slot 渲染不传 sessionId/nodeId
  - 改为 SurfaceRenderer 注入 context

Step 3: Session 投影
  - 当前每个 tab 自己维护 session 绑定
  - 改为 surface 管理 session 绑定

Step 4: 拖拽到 allowedSlots
  - 当前不支持跨 slot 拖拽
  - 改为 surface 级别拖拽（在 allowedSlots 范围内）
```

---

## 七、移动端 Surface 适配

### 原则

```
移动端由 Host 决定适配方式，不由插件强控。
插件声明 preferredSlot 和 allowedSlots，但移动端可重新映射。
```

### 映射规则

```typescript
const mobileSurfaceMapping: Record<SurfaceType, SurfaceType> = {
  "main.editor":      "mobile.fullscreen",   // 主编辑器 → 全屏
  "sidebar.left":     "mobile.sheet",        // 侧边栏 → 弹出
  "sidebar.right":    "mobile.sheet",        // 侧边栏 → 弹出
  "panel.bottom":     "mobile.fullscreen",   // 面板 → 全屏（或 sheet）
  "commandPalette":   "mobile.fullscreen",   // 命令面板 → 全屏
  "contextMenu":      "mobile.sheet",        // 右键菜单 → 底部弹出
  "statusBar.*":      "header.right",        // 状态栏 → 顶栏
};
```

### 移动端渲染

```typescript
// 移动端 SurfaceRenderer 检查映射
function MobileSurfaceRenderer({ context }: { context: SurfaceRenderContext }) {
  const mappedType = mobileSurfaceMapping[context.type] || context.type;

  const mobileContext: SurfaceRenderContext = {
    ...context,
    type: mappedType,
    params: {
      ...context.params,
      mobile: true,
    },
  };

  return <SurfaceRenderer context={mobileContext} />;
}
```

### 移动端 UI 模式

```
mobile.sheet:
  - 从底部滑入
  - 半屏或自定义高度
  - 可拖动调整
  - 滑出即关闭

mobile.fullscreen:
  - 占满屏幕
  - 有返回按钮
  - 支持手势返回

移动端没有"侧边栏"和"面板"的概念
  → 所有 surface 映射到 sheet 或 fullscreen
  → 用户通过底部导航切换当前 surface
```

---

## 八、内置组件 vs 自定义组件

### 组件类型

```typescript
type ComponentType =
  | "builtin"    // System UI 内置组件，直接渲染
  | "custom"     // 插件自定义 React 组件，通过 PluginHost 加载
  | "iframe"     // 插件 iframe 隔离渲染（未来支持）
  | "native"     // 桌面端原生组件（未来支持）
```

### 内置组件

System UI 内置的组件，不需要插件额外加载：

```yaml
# system-ui plugin
views:
  - id: system-ui.dashboard
    component: builtin           # 系统内置

  - id: system-ui.nodes
    component: builtin

  - id: system-ui.logs
    component: builtin
    panes:
      - type: "log-table"       # 系统内置的日志表格组件
      - type: "log-detail"      # 系统内置的日志详情组件
```

### 自定义组件

插件业务页面，通过 PluginHost 加载：

```yaml
# claude-code plugin
views:
  - id: claude-code.chat
    component: custom            # 插件自定义
    entry: ClaudeChatView        # React 组件入口

  - id: claude-code.history
    component: custom
    entry: HistoryView
```

### 内置组件复用

```
某些缓存/文件类面板可以复用系统内置组件：

插件 manifest:
  文件: plugins/claude-code/files/access-history.jsonl
  defaultPanel: "system-ui.log-table"    ← 复用系统组件

  cache: plugins/claude-code/cache/registry.json
  defaultPanel: "system-ui.cache-panel"  ← 复用系统组件

这意味着：
  - 插件不需要为每个文件位置都写 React 组件
  - 系统提供内置的 log-table, cache-panel, file-tree 等组件
  - 插件只需要声明文件/缓存位置 + 指定默认展示组件
  - 系统内置组件从 Core API 获取数据
```

### 内置组件清单

| 组件 ID | 用途 | 数据源 |
|---------|------|--------|
| `system-ui.log-table` | 日志表格展示 | logs.* |
| `system-ui.log-detail` | 日志详情展开 | logs.* |
| `system-ui.cache-panel` | 缓存查看/清理 | plugin.cache.* |
| `system-ui.file-tree` | 文件树 | fs.* |
| `system-ui.file-properties` | 文件属性 | fs.stat |
| `system-ui.permission-list` | 权限列表 | plugin.permissions.* |
| `system-ui.history-timeline` | 安装历史时间线 | plugin.history |
| `system-ui.env-check-result` | 环境检测结果 | plugin.check |

---

## 九、当前 UI 迁移方案

### 当前结构

```typescript
// 当前注册表
viewRegistry.register("claude-code.chat", ClaudeChatView, { slot: "main" });
panelRegistry.register("terminal", TerminalView, { slot: "bottom" });
commandRegistry.register("host.settings.open", { handler: openSettings });
contextMenuRegistry.register("file", [...]);
chromeRegistry.register("sidebar.left", SidebarPanel);
```

### 迁移目标

```
viewRegistry
  → pluginSurfaceRegistry
  + SurfaceRenderer
  + SurfaceRenderContext

panelRegistry
  → pluginSurfaceRegistry（panels 部分）
  + 区分 view 和 panel 贡献

commandRegistry
  → 保留 commandRegistry
  + 增加 contributes.commands 解析

contextMenuRegistry
  → 保留 contextMenuRegistry
  + 增加 contributes.menus 解析

chromeRegistry
  → 分解到 surface 贡献
  + 内置 chrome 作为 system-ui 的内置贡献

MainSlot / SidebarSlot
  → SurfaceRenderer
  + 根据 SurfaceType 选择渲染位置
```

### 迁移步骤

```
Phase 1: 新增 Surface 定义
  - 定义 SurfaceType、SurfaceRenderContext
  - 创建 SurfaceRenderer 组件
  - 保持旧 slot 系统不动

Phase 2: 批量注册
  - 将所有 viewRegistry 注册改为 pluginSurfaceRegistry 注册
  - 将 slot 分配改为 preferredSlot
  - 插件 manifest 新增 web.* 声明

Phase 3: 上下文注入
  - SurfaceRenderer 自动注入 sessionId/nodeId
  - 组件从 context 获取数据，不再自己查

Phase 4: 拖拽和移动端
  - 跨 surface 拖拽（allowedSlots 约束）
  - 移动端映射

Phase 5: 删除旧 slot 系统
  - 确认 Surface 系统覆盖所有功能
  - 删除旧 viewRegistry/panelRegistry 的 slot 相关代码
```

---

## 十、防回退规则

| # | 规则 | 后果 |
|---|------|------|
| 1 | **禁止 surface 直接保存 Core 状态** | SurfaceRenderContext 的 sessionId 来自 Core，不持久化到 localStorage |
| 2 | **禁止 tabId 被用作 sessionId** | tabId 是纯 UI 标识，不参与后端任何协议 |
| 3 | **禁止关闭 surface 时自动 session.stop** | 关闭 tab 只是取消投影，不影响 session 生命周期 |
| 4 | **禁止 plugin surface 声明能跨出 allowedSlots** | 用户拖拽只能在 allowedSlots 范围内 |
| 5 | **禁止 surface 渲染依赖 plugin 特定逻辑** | SurfaceRenderer 不包含"如果是 claude-code 就怎么样的逻辑" |
| 6 | **禁止移动端和桌面端维护两套 surface 注册表** | 移动端只重新映射 SurfaceType，不重新注册插件视图 |
| 7 | **禁止 surface 渲染时绕过 Core 权限** | 即使 surface 有 sessionId，渲染组件仍然通过 Core API 获取数据 |
| 8 | **禁止 surface 渲染时直接读 localStorage 作为数据源** | Core 数据来自 Core API，UI 偏好来自 localStorage |
