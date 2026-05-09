# SessionBridge — 插件系统设计

> 最后更新: 2026-05-08
> 版本: v0.7 (设计稿)

---

## 一、核心哲学

### 1.1 系统内核只做一件事：管理插件

SessionBridge 不是"带插件的控制台"。SessionBridge 是一个**插件容器**，它自己几乎不提供任何 UI。

```
当前 (v0.6):      控制台 + 插件点缀
目标 (v0.7+):     插件容器 + 系统插件提供默认功能
```

### 1.2 什么是系统

**系统内核**是加载插件所需的最小基础设施，没有它插件跑不起来。凡是可以由插件实现的，都不属于系统：

| 属于系统内核 | 不属于系统（插件实现） |
|-------------|----------------------|
| 插件加载器（scan + activate + deactivate） | Chat / Terminal / 任何视图 |
| Workbench（插槽容器 + 布局引擎） | 文件树、任务面板、侧边栏任何内容 |
| WebSocket 连接管理 → relay | 连接状态指示器 |
| 消息总线（插件 ↔ relay, 插件 ↔ 插件） | 通知推送、历史记录 |
| 安全/权限引擎 | System Status |
| 插件仓库管理（安装/卸载/更新） | 设置页面、快捷键绑定 |
| 权限 UI（审批准许/拒绝弹窗） | 主题/外观配置 |
| 窗口/布局管理（多窗口、布局持久化） | — |

系统内核定义为：

```
system-kernel/
├── extension-loader.ts      # 扫描 manifest + 加载激活
├── extension-points.ts      # 注册点管理
├── workbench/               # 布局引擎（核心）
│   ├── workbench.ts         # 编排所有插槽
│   ├── layout-engine.ts     # 拖拽/拆分/浮动布局算法
│   ├── layout-store.ts      # 布局持久化（身份瓶）
│   ├── slot-host.tsx        # 插槽容器组件
│   └── transitions.ts       # 插槽动画编排
├── slots/                   # 预定义插槽定义
│   ├── main-editor.ts       # 中央编辑区（多 Tab Group + 拆分）
│   ├── sidebar-left.ts      # 左侧边栏（可折叠/可拖宽）
│   ├── sidebar-right.ts     # 右侧边栏（可折叠/可拖宽）
│   ├── panel-bottom.ts      # 底部面板（终端/输出等）
│   ├── header.ts            # 顶部栏
│   ├── status-bar.ts        # 底部状态栏
│   └── modal.ts             # 模态层
├── message-bus.ts           # 跨插件消息通道
├── permission-engine.ts     # 权限评估 + 弹窗管理
├── connection-manager.ts    # WebSocket → relay
└── repository-manager.ts    # 插件仓库
```

### 1.3 什么是插件

插件是一个**自包含的能力单元**。它声明：
- 它需要什么能力（权限）
- 它提供什么视图（占用哪个插槽）
- 它有什么依赖（二进制工具、运行时版本）
- 它有什么配置（设置项 schema）

一个插件可以很小（"只显示一个状态灯"），也可以很大（"完整的 Claude Code 集成"）。

---

## 二、Workbench：布局引擎

### 2.1 设计目标

达到 VS Code Workbench 级别的布局灵活度。核心能力：

```
拖拽（Drag & Drop）
├── Tab 可以在同一个插槽内拖拽重排顺序
├── Tab 可以拖到另一个插槽（如从右侧边栏拖到底部面板）
├── Tab 可以从插槽拖出成为独立窗口（浮动面板）
└── 外观拖拽时显示 drop indicator

拆分（Split）
├── 中央编辑区支持垂直/水平拆分为多个 Tab Group（VS Code 分屏编辑）
├── 每个 Tab Group 独立管理自己的 Tab 堆栈
├── 侧边栏支持上下分栏（两个独立面板堆叠）
└── 底部面板支持分栏

浮动（Float / Popout）
├── 任何 Tab 可以弹出为独立窗口（多显示器场景）
├── 浮动窗口拥有完整的布局独立性
├── 浮动窗口的布局同样持久化
└── 浮动窗口关闭时自动 merge 回原插槽

折叠（Collapse）
├── 侧边栏可折叠为图标条（VS Code 的 "Hide sidebar" / 紧凑模式）
├── 底部面板可折叠为状态栏中的一行
└── 折叠状态下拖拽依然可用
```

### 2.2 插槽定义

```
┌──────────────────────────────────────────────────────────────────┐
│  Header Slot                                                     │
│  高度固定，不参与拆分/浮动                                        │
│  内容：插件贡献的按钮 + 系统连接指示器                             │
├──────────┬───────────────────────────────────────┬────────────────┤
│          │                                       │                │
│ Sidebar  │      Main Editor Slot                 │   Sidebar      │
│ Left     │                                       │   Right        │
│ Slot     │   ┌──────────────┬──────────────┐    │   Slot         │
│          │   │ Tab Group 1  │ Tab Group 2  │    │                │
│ 可折叠    │   │              │              │    │   可折叠        │
│ 可拖宽    │   │              │              │    │   可拖宽       │
│ 可上下    │   ├──────────────┴──────────────┤    │   可上下       │
│ 分栏      │   │         Tab Group 3         │    │   分栏         │
│          │   └─────────────────────────────┘    │                │
├──────────┴───────────────────────────────────────┴────────────────┤
│  Panel Bottom Slot（可折叠，浮动）                                  │
│  ┌─────────────┬──────────────┬──────────────┐                    │
│  │ Terminal    │  Problems    │  Output       │                    │
│  └─────────────┴──────────────┴──────────────┘                    │
├──────────────────────────────────────────────────────────────────┤
│  Status Bar Slot                                                  │
│  高度固定，插件贡献状态项（文字/图标/交互按钮）                      │
└──────────────────────────────────────────────────────────────────┘
```

### 2.3 插槽的可组合性

插槽本身是**递归**的。每个插槽内部可以包含任意嵌套的子插槽：

```typescript
interface SlotDefinition {
  id: string;                    // "main-editor" | "sidebar-left" | ...
  type: 'fixed' | 'dockable' | 'floatable';
  
  // 插槽的占位策略
  strategy: 'tabbed'            // Tab 堆叠（默认）
           | 'split'            // 分屏（垂直/水平分割）
           | 'stacked'          // 上下堆叠（底部面板场景）
           | 'single';          // 单视图（header/status 等固定区域）

  // 是否允许拖拽进出
  allowDragIn: boolean;
  allowDragOut: boolean;

  // 是否支持拆分为子插槽
  splittable: boolean;
  splitDirection?: 'horizontal' | 'vertical';

  // 可折叠策略
  collapsible: boolean;
  collapsedSize?: number;        // 折叠后的像素宽度/高度
  collapseBehavior?: 'icon-bar' | 'minimize' | 'overlay';

  // 动画
  transition?: 'fade' | 'slide' | 'instant';

  // 默认插件占位（空插槽时显示的提示）
  emptyPlaceholder?: string;
}
```

### 2.4 布局持久化（身份瓶）

整个布局状态序列化为 JSON，按**身份/工作区**保存：

```typescript
interface LayoutSnapshot {
  version: number;
  nodeId: string;                // 机器身份
  workspace?: string;            // 项目/工作区路径

  slots: {
    'main-editor': SlotState;
    'sidebar-left': SlotState;
    'sidebar-right': SlotState;
    'panel-bottom': SlotState;
  };

  // 每个窗口中打开的插件视图
  windows: {
    [windowId: string]: {        // 主窗口 + 浮动窗口
      bounds: { x, y, width, height };
      slots: Record<string, SlotState>;
    };
  };

  // 全局状态
  global: {
    activePluginId: string;      // 当前活跃的主视图插件
    activeSidebarTab: string;    // 侧边栏中当前选中的面板
    sidebarHidden: boolean;      // 侧边栏是否折叠
    panelHidden: boolean;        // 底部面板是否折叠
  };
}

interface SlotState {
  groups: TabGroup[];            // 拆分后的 Tab Group

  // 对于不可拆分的插槽，groups 只有一个元素
}

interface TabGroup {
  tabs: TabState[];
  activeTab: string;             // 当前选中的 Tab ID
  size?: number;                 // 在拆分中的比例（百分比或像素）
}

interface TabState {
  pluginId: string;              // 所属插件
  viewId: string;                // 视图 ID
  pinned?: boolean;
  dirty?: boolean;               // 有未保存状态，关闭时确认
}
```

布局文件存储位置：
- 默认：`~/.sessionbridge/layout.json`
- 按项目：`~/.sessionbridge/layouts/<project-hash>.json`
- 切换方式：系统内置插件 `sessionbridge.settings` 提供布局管理 UI

### 2.5 插槽渲染系统

插槽不直接渲染子组件。每个插槽是一个**容器**，它从当前布局状态中读取应该渲染哪些 Tab，然后渲染：

```tsx
// 伪代码 — 每个插槽的工作方式
function MainEditorSlot() {
  const layout = useLayoutStore();     // 当前布局状态
  const slotState = layout.slots['main-editor'];

  return (
    <SplitContainer direction={slotState.direction}>
      {slotState.groups.map(group => (
        <TabGroup
          key={group.id}
          tabs={group.tabs}
          activeTab={group.activeTab}
          onSelect={tab => activateView(tab.pluginId, tab.viewId)}
          onClose={tab => closeView(tab.pluginId, tab.viewId)}
          onDragEnd={handleDrop}
        >
          {group.activeTab && (
            <ViewSlotContent pluginId={group.activeTab.pluginId}
                             viewId={group.activeTab.viewId} />
          )}
        </TabGroup>
      ))}
    </SplitContainer>
  );
}
```

### 2.6 视图生命周期 + 动画编排

切换 Tab 或拖拽改变布局时，系统自动编排：

```
触发切换
  │
  ├─ 1. freezeView(oldPluginId)           ← 旧视图冻结
  │      └─ 侧边栏开始淡出（200ms）
  │
  ├─ 2. updateLayoutStore(newState)       ← 更新布局状态
  │
  ├─ 3. transitionSlots()                 ← 插槽动画
  │      ├─ 侧边栏动画完成
  │      ├─ 主视图过渡（300ms fade/slide）
  │      └─ 新侧边栏开始淡入（200ms）
  │
  └─ 4. activateView(newPluginId)         ← 新视图激活
         └─ 侧边栏淡入完成
```

所有过渡由 `transitions.ts` 编排，插件不需要关心。插件的视图只收到 `activateView` / `deactivateView` 通知。

---

## 三、插件 Manifest

### 3.1 字段定义

```typescript
interface ExtensionManifest {
  // ── 身份 ──
  id: string;                     // "claude-code", "file-explorer", "system-status"
  displayName: string;            // "Claude Code", "文件浏览器", "系统状态"
  version: string;                // "1.2.0"
  description?: string;

  // ── 入口 ──
  main: string;                   // "index.ts" 或 "dist/index.js"

  // ── 平台兼容性 ──
  engines: {
    sessionbridge: string;        // "^0.7.0"
  };
  platform?: ('win32' | 'darwin' | 'linux' | 'android' | 'ios')[];

  // ── 分类 ──
  category: ExtensionCategory;

  // ── 贡献点 ──
  contributes?: {
    // 视图贡献（指向哪个插槽）
    views?: ViewContribution[];

    // 菜单项
    menus?: MenuContribution[];

    // 命令（可通过消息总线调用）
    commands?: CommandDefinition[];

    // 设置项
    configuration?: ConfigurationDefinition[];

    // 权限声明
    permissions?: PermissionDeclaration[];
  };

  // ── 依赖检测 ──
  dependencies?: DependencyDeclaration[];
}
```

### 3.2 分类体系

```typescript
type ExtensionCategory =
  // 系统插件（内置，通常不可卸载）
  | { type: 'system'; group: 'core' }

  // 适配器
  | { type: 'adapter'; protocol: 'claude-code' | 'shell' | 'custom' }

  // 视图工具
  | { type: 'tool'; area: 'files' | 'process' | 'network' | 'terminal' }

  // 信息展示
  | { type: 'dashboard'; metric: 'system' | 'network' | 'custom' }

  // 自动化/脚本
  | { type: 'automation'; trigger: string }

  // 主题/外观
  | { type: 'theme' }

  // 其他
  | { type: 'other'; tags: string[] };
```

UI 中 Tab 栏按分类自动分组，支持折叠：

```
[适配器 ▼]          [工具 ▼]          [仪表盘]      [+]
├─ Claude Code     ├─ 文件浏览器      ├─ System Status
├─ Shell           ├─ 进程管理器      └─ 网络监控
└─ SSH             └─ 网络监控
```

### 3.3 视图贡献

插件声明它要占用哪个插槽：

```typescript
interface ViewContribution {
  // 目标插槽
  targetSlot: 'main-editor' | 'sidebar-left' | 'sidebar-right'
              | 'panel-bottom' | 'header' | 'status-bar';

  // 视图定义
  view: ViewDefinition;

  // 插槽特定配置
  slotOptions?: {
    // 侧边栏/底部面板：默认放置在哪个位置
    defaultIndex?: number;
    // 底部面板：默认高度
    defaultSize?: number;
    // 侧边栏：是否默认显示
    defaultVisible?: boolean;
  };
}

interface ViewDefinition {
  id: string;                     // "claude-code.chat"（跨插件唯一）
  title: string;                  // "Claude Code"
  icon?: string;

  type: 'component' | 'iframe' | 'markdown';
  component: string;              // React 组件名

  /** 这个视图需要哪些侧边栏面板在它激活时显示 */
  sidebars?: {
    left?: string[];              // 视图激活时左侧显示哪些插件面板
    right?: string[];
    bottom?: string[];
  };

  pinned?: boolean;               // 无法关闭的 Tab
  badge?: 'notification' | 'count' | 'dot';
}

// 侧边栏/底部面板视图，还要额外声明：
interface PanelViewDefinition extends ViewDefinition {
  type: 'component';
  component: string;

  /** 面板没有自己的侧边栏需求（它本身就是侧边栏内容） */
  // 没有 sidebars 字段

  /** 面板的显示策略 */
  badgeType?: 'notification' | 'count' | 'dot';

  /** 面板在折叠状态下是否显示为图标条 */
  compactView?: {
    icon: string;
    tooltip: string;
    badge?: boolean;
  };
}
```

### 3.4 示例：System Status 插件

```json
{
  "id": "sessionbridge.system-status",
  "displayName": "System Status",
  "category": { "type": "dashboard", "metric": "system" },
  "contributes": {
    "views": [
      {
        "targetSlot": "main-editor",
        "view": {
          "id": "system-status.main",
          "title": "System Status",
          "icon": "Activity",
          "type": "component",
          "component": "SystemStatusView",
          "pinned": false,
          // 没有 sidebars → 主视图全屏，两侧自动隐藏
        }
      }
    ],
    "commands": [
      {
        "id": "system-status.open",
        "title": "Open System Status",
        "handler": "openDashboard"
      }
    ],
    "menus": [
      {
        "command": "system-status.open",
        "when": "activeView != system-status.main"
      }
    ]
  }
}
```

切换到 System Status 时，workbench 检测到该视图没有 `sidebars` 声明 → 自动折叠两侧边栏和底部面板，主视图全屏。

### 3.5 示例：Claude Code 插件

```json
{
  "id": "sessionbridge.chat",
  "displayName": "Claude Code",
  "category": { "type": "adapter", "protocol": "claude-code" },
  "contributes": {
    "views": [
      {
        "targetSlot": "main-editor",
        "view": {
          "id": "chat.main",
          "title": "Claude Code",
          "icon": "Sparkles",
          "type": "component",
          "component": "ChatView",
          "sidebars": {
            "left": ["file-explorer.panel", "instances.panel"],
            "right": ["tasks.panel", "snapshots.panel", "file-context.panel"],
            "bottom": []
          }
        }
      }
    ],
    "permissions": [
      { "permission": "kernel.files.read", "reason": "读取项目文件", "required": true },
      { "permission": "kernel.files.write", "reason": "编辑项目文件", "required": true },
      { "permission": "kernel.shell.access", "reason": "执行命令", "required": true }
    ],
    "dependencies": [
      { "type": "binary", "name": "claude", "version": ">=0.4.0", "autoInstall": true }
    ]
  }
}
```

### 3.6 权限声明

```typescript
interface PermissionDeclaration {
  permission: string;             // "kernel.files.read" | "kernel.files.write"
                                 // | "kernel.process.spawn" | "kernel.shell.access"
                                 // | "kernel.network.connect" | "kernel.network.listen"
                                 // | "kernel.clipboard" | "kernel.notifications"
                                 // | "kernel.device.camera" | "kernel.device.microphone"
                                 // | "kernel.plugin.install" | "kernel.ui.toast"
  reason: string;                 // 为什么需要，向用户展示
  required: boolean;              // true=必须 false=可选（降级运行）
}
```

运行时权限被关闭时，系统自动：
- 该插件的 Tab 显示黄色警告角标
- 涉及该权限的功能自动隐藏或报"权限不足"
- 不会 crash

### 3.7 依赖声明

```typescript
interface DependencyDeclaration {
  type: 'binary' | 'npm' | 'system' | 'plugin';
  name: string;                   // "claude"
  version?: string;               // ">=0.4.0"
  installHint?: string;           // "npm install -g @anthropic-ai/claude-code"
  autoInstall?: boolean;          // true → 系统尝试自动安装
}
```

`autoInstall: true` 时，检测缺失后弹出确认：

```
┌─ 检测到依赖缺失 ─────────────────────┐
│                                       │
│ 插件 "Claude Code" 需要 claude CLI    │
│ 是否尝试自动安装？                     │
│                                       │
│  npm install -g @anthropic-ai/        │
│  claude-code                          │
│                                       │
│     [稍后再说]     [开始安装]          │
└───────────────────────────────────────┘
```

---

## 四、插件生命周期

### 4.1 状态机

```
installed ──▶ activating ──▶ activated ◀── deactivated
                  │               │
                  └──▶ failed     └──▶ crashed ──▶ restarting ──▶ activated
```

### 4.2 激活流程

1. **scan** — 扫描目录，收集 manifests
2. **resolve** — 检查 engines/platform 兼容性
3. **check dependencies** — 检测二进制/运行时，缺失则提示
4. **load** — `import()` 插件入口模块
5. **grant permissions** — 检查授权，未授权则弹出请求
6. **activate** — 调用 `activate(context)` → 注册 views/commands/menus
7. **layout** — workbench 根据注册的 views 创建 Tab 并放置到对应插槽

### 4.3 视图生命周期

视图插入插槽后，workbench 控制其可见性：

```typescript
interface ViewLifecycle {
  onActivate(): void;       // Tab 被选中，视图可见
  onDeactivate(): void;     // Tab 被切走，视图不可见
  onDestroy(): void;        // Tab 被关闭/插件卸载
  onResize(width, height): void;  // 容器大小变化
  onDragStart?(): void;     // 开始拖拽
  onDragEnd?(accepted: boolean): void;  // 拖拽结束
}
```

### 4.4 无插件场景

没有任何插件时，workbench 中所有插槽显示默认空状态：

```
┌──────────────────────────────────────────────┐
│  ✅ 已连接 relay                              │
├──────────┬───────────────────────────────────┤
│  (空)     │                                   │
│           │   没有可用的插件                    │
│           │   ┌─────────────────────┐         │
│           │   │ 扫描插件目录 / 安装   │         │
│           │   └─────────────────────┘         │
│           │                                   │
│           │   将插件放入                      │
│           │   ~/.sessionbridge/extensions/     │
├──────────┴───────────────────────────────────┤
│                                               │
└───────────────────────────────────────────────┘
```

---

## 五、权限模型

### 5.1 权限层级

```typescript
type Permission =
  | 'kernel.files.read'
  | 'kernel.files.write'
  | 'kernel.process.spawn'
  | 'kernel.process.manage'
  | 'kernel.network.connect'
  | 'kernel.network.listen'
  | 'kernel.shell.access'
  | 'kernel.clipboard'
  | 'kernel.notifications'
  | 'kernel.device.camera'
  | 'kernel.device.microphone'
  | 'kernel.device.location'
  | 'kernel.plugin.install'
  | 'kernel.ui.toast';
```

### 5.2 安装时的权限审查

```
┌─ 安装插件 "Claude Code" ────────────────────┐
│                                              │
│  Claude Code 需要以下权限：                   │
│                                              │
│  ☑ files.read    读取文件           必需     │
│  ☑ files.write   写入文件           必需     │
│  ☑ shell.access  执行 Shell 命令    必需     │
│  ☐ network.connect 网络连接         可选     │
│                                              │
│  如果拒绝"必需"权限，插件将无法运行。         │
│  可在设置中随时更改权限。                     │
│                                              │
│        [取消]              [确认安装]         │
└──────────────────────────────────────────────┘
```

### 5.3 运行时变更传播

用户关闭某项权限后：

1. `permission-engine` 发布 `permission.changed` 事件
2. 受影响的插件收到通知
3. 插件自行降级（隐藏功能 / 显示提示 / 完全停用）
4. 如果停用，Tab 上显示禁用角标

---

## 六、插件通信

### 6.1 消息总线

```typescript
interface MessageBus {
  // 点对点
  send(target: string, type: string, body: unknown): void;

  // 广播
  broadcast(type: string, body: unknown): void;

  // 监听
  on(type: string, handler: MessageHandler): Disposable;

  // 请求-响应
  request(target: string, type: string, body: unknown): Promise<unknown>;

  // 通过 relay 发送到远端
  sendToRelay(type: string, body: unknown): void;
}
```

### 6.2 通信示例

```
System Status 插件:                File Explorer 插件:
  │                                    │
  │  broadcast("system.metrics", ...)  │
  │──────────────────────────────────▶│
  │                                    │
  │     send("system-status",          │
  │  ◀───────────────────────────────  │
  │     "navigate", { path })          │
  │                                    │
```

---

## 七、系统插件

### 7.1 系统插件 vs 普通插件

```
系统插件：                       第三方插件：
├── 随核心发布                   ├── 从仓库安装
├── 不可卸载（可禁用）           ├── 可安装/卸载
├── 权限自动授予                 ├── 安装时用户审核
├── 使用内部 API                 ├── 只使用公开 API
└── 可以依赖                     └── 只能依赖其他公开插件
```

### 7.2 初始系统插件清单

| 插件 ID | 功能 | 分类 | 贡献 |
|---------|------|------|------|
| `sessionbridge.chat` | Claude Code Chat 视图 | adapter | main-editor（带 sidebars） |
| `sessionbridge.terminal` | 终端视图 | adapter | main-editor |
| `sessionbridge.system-status` | System Status | dashboard | main-editor（无 sidebars → 全屏） |
| `sessionbridge.settings` | 设置 | system | main-editor |
| `sessionbridge.file-explorer` | 文件树 | tool | sidebar-left |
| `sessionbridge.tasks` | 任务面板 | tool | sidebar-right |
| `sessionbridge.snapshots` | 快照管理 | tool | sidebar-right |
| `sessionbridge.instance-manager` | 实例列表 | tool | sidebar-left |
| `sessionbridge.notifications` | 通知 | system | header（按钮） + sidebar-right |

---

## 八、实现路径

### Phase 1: Workbench 内核（v0.7a）

目标：实现布局引擎 + 插槽容器。

- `workbench.ts` + `layout-engine.ts` — 布局状态管理 + 拖拽算法
- `slot-host.tsx` — 插槽容器组件
- `layout-store.ts` — 布局持久化（身份瓶）
- `tab-group.tsx` — 可拖拽 Tab 组
- `transitions.ts` — 插槽过渡动画
- 将所有现有 UI 包裹在 workbench 中，所有视图全是系统插件的概念验证

### Phase 2: System Status → 插件（v0.7b）

目标：用插件系统验证概念。

- 将 DashboardView 重构为 `sessionbridge.system-status` 插件
- 无 sidebars → 全屏显示，验证侧边栏自动隐藏
- 验证 Tab 切换 + 侧边栏显隐动画

### Phase 3: Adapter 迁移（v0.7c）

目标：将 Chat/Terminal 从硬编码改为插件。

- `sessionbridge.chat` 插件（从 ClaudeChatView 迁移）
- `sessionbridge.terminal` 插件（从 TerminalView 迁移）
- 侧边栏关联：Chat → 左右两侧；Terminal → 右侧日志

### Phase 4: 侧边栏插件化（v0.7d）

目标：所有侧边栏面板由插件贡献。

- 文件树、实例列表、任务面板、快照、文件上下文 → 各自独立插件
- 验证"多个插件共享同一个侧边栏插槽"的场景

### Phase 5: 拖拽 + 拆分 + 浮动（v0.7e）

目标：VS Code 级别的布局自由。

- Tab 跨插槽拖拽
- 中央编辑区拆分（分屏）
- 浮动弹出独立窗口
- 布局持久化完整实现

### Phase 6: 插件仓库（v0.8）

目标：支持从远程仓库安装/更新插件。

- manifest `repository` 字段
- `repository-manager.ts`
- 插件市场 UI（搜索/安装/更新/卸载）
- 自动依赖检测 + 可选自动安装

---

## 九、未解决的问题

1. **插件 API 版本化** — 公开 API 如何保证向后兼容？semver 足够吗？
2. **插件安全沙箱** — 进程级隔离 vs 信任模型？
3. **离线安装** — 无网络环境如何安装插件？.sbx 包格式？
4. **插件市场** — 官方注册中心 vs 仅 Git URL / 本地路径？
5. **性能** — 100 个插件同时激活对启动时间和内存的影响？
6. **干净卸载** — 插件卸载能否完整清除所有状态？
7. **跨插件 Tab 嵌套** — 插件 A 能否嵌入插件 B 的视图？
---

## Related ownership document

Before changing host chrome, workbench layout, shared UI, or plugin-owned views,
consult [component-ownership-and-slots.md](./component-ownership-and-slots.md).
That document defines the Chinese/English names, ownership layers, slot boundaries,
and the Phase 4D/4E split for Host Chrome pluginization.
