# SessionNode v2 — Surface 模型迁移设计

> 从当前 MainSlot / SidebarSlot / panel-registry / view-registry 到 Surface 模型
> 基于 UX_SURFACES.md 的设计规范，补充迁移路径和实现细节

---

## 当前模型（现状）

```
page.tsx
  ├── 初始化 relay 连接
  ├── 同步 adapter views/panels/commands/menus 到各 registry
  ├── 创建 WorkbenchProvider（巨型上下文）
  ├── render:
  │   ├── LeftSidebar
  │   │   └── panel-registry getPanels('left')
  │   │       └── DockPanelFrame + panel component
  │   ├── MainLayout
  │   │   └── WorkbenchLayout
  │   │       └── LayoutNodeRenderer
  │   │           └── PaneView
  │   │               ├── PaneTabBar（tabs from WorkbenchState）
  │   │               └── MainSlot（viewId + instanceId）
  │   │                   └── view-registry → component
  │   ├── RightSidebar
  │   │   └── panel-registry getPanels('right')
  │   └── BottomDock（if state.bottom）
  │       └── PaneView（bottom）
  │
  ├── 注册命令（command-registry）
  ├── 注册操作（action-registry）
  ├── 同步上下文菜单（context-menu-registry）
  └── plugin panel 同步（panel-registry syncPluginPanels，旧称 syncExtensionPanels）
```

### 当前模型的问题

1. **view-registry 和 panel-registry 是两套独立的注册表**，但语义上都在做"注册一个 React 组件用于渲染"。
2. **MainSlot 只传 viewId + instanceId**，没有上下文传递。组件自己从 WorkbenchContext 获取数据。
3. **SidebarSlot 只传 open + children**，不关心 children 是谁。
4. **page.tsx 负责太多**：连接、注册、同步、渲染全部混在一起。
5. **instanceId 是核心绑定**，但新模型中应该用 sessionId。

---

## 目标模型

```
App Entry
  ├── CoreClientProvider（连接管理 + Core API 封装）
  ├── SurfaceProvider（surface 状态 + 布局）
  └── render:
      ├── SurfaceRenderer (type: "header.left")
      │   └── registered components for this surface
      ├── SurfaceRenderer (type: "sidebar.left")
      │   └── registered panels for this surface
      ├── SurfaceRenderer (type: "main.editor")
      │   └── LayoutNodeRenderer
      │       └── SurfaceRenderer (type: "main.editor", context: { sessionId, viewId })
      │           └── componentRegistry.resolve(context) → React component
      ├── SurfaceRenderer (type: "sidebar.right")
      ├── SurfaceRenderer (type: "panel.bottom")
      ├── SurfaceRenderer (type: "commandPalette")
      └── SurfaceRenderer (type: "notification.center")
```

### 关键变化

```
旧: MainSlot({ viewId, instanceId })
新: SurfaceRenderer({ context: SurfaceRenderContext })

旧: SidebarSlot({ open, children })
新: SurfaceRenderer({ context: { type: "sidebar.left" } })

旧: viewRegistry.get("claude-code.chat") → ClaudeChatView
新: componentRegistry.resolve({ pluginId: "claude-code", viewId: "claude-code.chat" })

旧: panelRegistry.getPanels("left", whenCtx)
新: surfaceRegistry.getContributions("sidebar.left", filter)
```

---

## SurfaceRenderContext — 统一注入

```typescript
// 核心类型 — 每个 surface 渲染时都携带此 context
interface SurfaceRenderContext {
  id: string;                  // Surface 实例唯一 ID
  type: SurfaceType;           // 类型（详见下方 SurfaceType）
  pluginId?: string;           // 贡献此 surface 的插件 ID
  viewId?: string;             // 插件声明的视图 ID
  panelId?: string;            // 面板 ID（如果是面板）
  tabId?: string;              // UI tab ID（纯前端）
  sessionId?: string;          // 关联的 Core session（如果有）
  nodeId?: string;             // 关联的 Core node（如果有）
  workspaceId?: string;        // workspace 路径
  params?: Record<string, unknown>;  // 插件自定义参数
}
```

### SurfaceType 总表

```typescript
type SurfaceType =
  // 主工作区
  | "main.editor"
  | "main.editor.split"

  // 侧边栏
  | "sidebar.left"
  | "sidebar.right"

  // 面板
  | "panel.bottom"

  // 顶栏
  | "header.left"
  | "header.center"
  | "header.right"

  // 状态栏
  | "statusBar.left"
  | "statusBar.right"

  // 命令/菜单
  | "commandPalette"
  | "contextMenu"

  // 设置
  | "settings.page"

  // 插件详情
  | "plugin.detail"
  | "plugin.detail.permissions"
  | "plugin.detail.files"
  | "plugin.detail.cache"

  // 通知
  | "notification.center"
  | "notification.toast"

  // 弹窗
  | "dialog"
  | "dialog.approval"

  // 移动端
  | "mobile.sheet"
  | "mobile.fullscreen";
```

---

## SurfaceRegistry — 统一注册表

替代当前的 view-registry + panel-registry。所有 surface 贡献走同一套注册。

```typescript
interface SurfaceContribution {
  id: string;
  pluginId: string;
  surfaceType: SurfaceType | SurfaceType[];  // 一个视图可贡献到多个 surface
  componentType: "builtin" | "custom" | "iframe";
  component?: ComponentType<any>;      // builtin 组件直接注册
  entry?: string;                       // custom 组件入口路径
  title: string;
  description?: string;
  icon?: string;

  // 布局约束
  preferredSlot?: SurfaceType;
  allowedSlots?: SurfaceType[];
  order?: number;          // 在 surface 中的排序
  when?: string;           // when-condition

  // 其他
  singleton?: boolean;     // 是否只允许一个实例
  keepMounted?: boolean;   // 隐藏时是否保持挂载
}

class SurfaceRegistry {
  register(contribution: SurfaceContribution): void;
  unregister(id: string): void;
  getContributions(type: SurfaceType, filter?: WhenContext): SurfaceContribution[];
  resolve(context: SurfaceRenderContext): ComponentType | null;
}
```

### 来自现状的迁移关系

| 当前注册方式 | → 新的 SurfaceContribution |
|-------------|--------------------------|
| `viewRegistry.set("claude-code.chat", { component, meta })` | `{ id: "claude-code.chat", pluginId: "claude-code", surfaceType: "main.editor", componentType: "custom", entry: "ClaudeChatView" }` |
| `panelRegistry.set("logs", { side: "right", component, ... })` | `{ id: "logs", pluginId: "system-ui", surfaceType: "sidebar.right", componentType: "builtin", component: LogsPanel }` |
| `commandRegistry.set("host.settings.open", { handler })` | `{ id: "system-ui.settings.open", pluginId: "system-ui", surfaceType: "commandPalette", componentType: "builtin" }` + command-registry 单独保留 |
| `context-menu-registry syncContextMenus(data)` | `{ id: "claude-code.context", pluginId: "claude-code", surfaceType: "contextMenu", ... }` + context-menu-registry 单独保留 |

---

## 从 MainSlot 到 SurfaceRenderer 的迁移

### MainSlot 当前代码

```typescript
// 当前：app/console/workbench/slots/main-slot.tsx
function MainSlot({ viewId, instanceId, _surfaceId }) {
  const entry = getViewEntry(viewId);
  const Component = entry.component;
  return <Component instanceId={instanceId} _surfaceId={_surfaceId} />;
}
```

### SurfaceRenderer 目标

```typescript
// 目标：system-ui/surface/surface-renderer.tsx
function SurfaceRenderer({ context }: { context: SurfaceRenderContext }) {
  const Component = surfaceRegistry.resolve(context);

  if (!Component) {
    return <MissingSurfaceWarning context={context} />;
  }

  // 自动注入 context — 组件通过 useSurfaceContext() 获取
  return (
    <SurfaceContextProvider value={context}>
      <Component />
    </SurfaceContextProvider>
  );
}

// 组件可以在任何 surface 中获取上下文
function useSurfaceContext(): SurfaceRenderContext {
  return useContext(SurfaceRenderContext);
}

// 组件不需要再：
//   const { instanceId } = props;
//   const { wsUrl, token } = useWorkbench();
// 而是：
//   const { sessionId, nodeId, pluginId } = useSurfaceContext();
//   const coreClient = useCoreClient();
```

---

## 从 SidebarSlot 到 sidebar surface 的迁移

### SidebarSlot 当前代码

```typescript
// 当前：app/console/workbench/slots/sidebar-slot.tsx
function SidebarSlot({ open, children }) {
  return <div className={open ? '' : 'w-0'}>{open ? children : null}</div>;
}
```

### 目标

```typescript
// 目标：system-ui/surface/sidebar-surface.tsx
function SidebarSurface({ type }: { type: 'sidebar.left' | 'sidebar.right' }) {
  const [open, setOpen] = useState(true);
  const contributions = surfaceRegistry.getContributions(type);

  return (
    <ResizableContainer onResize={saveWidth}>
      {contributions.map(c => (
        <DockPanelFrame key={c.id} title={c.title}>
          <SurfaceRenderer context={{
            type,
            pluginId: c.pluginId,
            panelId: c.id,
          }} />
        </DockPanelFrame>
      ))}
    </ResizableContainer>
  );
}
```

---

## Tab 与 Session 的关系（核心设计决策）

### 当前模型（问题所在）

```
workbench-state.ts:
  PaneTab {
    id: tabId,          ✓ 纯 UI
    viewType: string,   ✓ 视图类型
    instanceId: string,  ✗ 旧概念（既是 sessionId 又是 UI 状态）
    _surfaceId: string,  ✗ 废弃
  }

  localStorage 持久化:
    saveLayoutsToStorage(instanceStates, persistentTabs)
    loadLayoutsFromStorage()
  → tab 列表被持久化，刷新后从 localStorage 恢复
  → 但 session 可能已经结束，导致"幽灵 tab"
```

### 目标模型

```
Core Session (事实来源)          UI Tab (投影)
─────────────────────            ────────────
sessionId: "sess_abc"            tabId: "tab_001"
kind: "shell"                    viewType: "shell.terminal"
pluginId: "shell"                title: "Terminal"
status: "running"                sessionId: "sess_abc"
                                 surfaceType: "main.editor"

Tab 是 Session 的投影：
  1. 页面加载 → session.list → 每个 session 创建 tab
  2. 用户关闭 tab → 只删除前端 tab，session 保持运行
  3. 用户重新打开 → 从 session.list 重建 tab + 绑定 sessionId
  4. session 停止 → Core 推送 session.stopped → UI 标记 tab 为 "stopped"
```

### Tab 重建流程（刷新后）

```
1. WebSocket 连接 → welcome { sessions: [...] }

2. session.list → sessions[]

3. 遍历 sessions:
   sessions.map(session => ({
     tabId: generateTabId(),
     sessionId: session.sessionId,
     viewType: resolveViewType(session.pluginId, session.kind),
     // pluginId → "shell" → viewType "shell.terminal"
     // pluginId → "claude-code" → viewType "claude-code.chat"
   }))

4. 渲染 tab → SurfaceRenderer({ context: { sessionId, viewType, ... } })

5. localStorage 只恢复：
   - 之前打开的 surface 类型布局（分屏、尺寸）
   - 但不包含 sessionId 绑定
   - 不包含"之前有 3 个 tab"的信息
```

### resolveViewType — 插件声明映射

```typescript
// Plugin manifest 中声明 view type 映射
// plugins/shell/plugin.yaml:
//   web:
//     sessions:
//       - kind: "shell"
//         view: "shell.terminal"
//         defaultTitle: "Terminal"

function resolveViewType(pluginId: string, kind: string): string {
  // 从 plugin registry 的 session→view 映射中查找
  return surfaceRegistry.getSessionView(pluginId, kind) || "unknown";
}
```

---

## 多 browser 同步

```
Browser A 打开 sess_abc（main.editor）
Browser B 打开 sess_abc（panel.bottom）

两个 Surface 不同（type 不同、tabId 不同）
但 sessionId 相同（都绑定 sess_abc）

Core 看到：
  sess_abc 有 2 个 stream subscribers
  → 两个 subscriber 共享同一份 event stream
  → stream.chunk 同时发给 A 和 B

A 关闭 tab → 取消订阅 stream
B 仍然保持订阅

没有 "tab sync" 消息
``` 

---

## 移动端 Surface 映射

不需要两套 registry。移动端重映射 SurfaceType。

```
桌面端 surface          → 移动端映射
main.editor             → mobile.fullscreen
sidebar.left            → mobile.sheet
sidebar.right           → mobile.sheet
panel.bottom            → mobile.fullscreen（或 mobile.sheet）
commandPalette          → mobile.fullscreen
contextMenu             → mobile.sheet
settings.page           → mobile.fullscreen
notification.center     → mobile.sheet
```

移动端只改变 surface 的**渲染位置**，不改变**组件**本身。

```typescript
const MOBILE_SURFACE_MAP: Partial<Record<SurfaceType, SurfaceType>> = {
  "main.editor":   "mobile.fullscreen",
  "sidebar.left":  "mobile.sheet",
  "sidebar.right": "mobile.sheet",
  "panel.bottom":  "mobile.fullscreen",
};

function useMobileSurface(context: SurfaceRenderContext): SurfaceRenderContext {
  const isMobile = useIsMobile();
  if (!isMobile) return context;
  const mapped = MOBILE_SURFACE_MAP[context.type];
  if (!mapped) return context;
  return { ...context, type: mapped, params: { ...context.params, originalType: context.type } };
}
```

---

## localStorage 使用规范

### 允许存储（UI 偏好）

```
- 侧边栏宽度（sb-left-width, sb-right-width）
- 面板折叠状态
- 面板顺序（通过 DockProfile）
- 设置页搜索词/展开状态
- 最近使用的路径
- 主题选择
- 字体大小
- 移动端最后导航 tab
```

### 不允许存储（Core 真相）

```
- Session 列表                          → 必须从 Core 获取
- Tab → sessionId 映射                  → 刷新后从 session.list 重建
- 插件安装状态                          → 从 Core plugin.list 获取
- 节点配置                              → Core 持久化
- 权限授权记录                          → Core config.yaml
- 任何"是否安装了 X"的判断             → 从 Core 查
```

---

## Surface 模型的现有代码迁移步骤

```
Step 1: 定义 SurfaceType、SurfaceRenderContext、SurfaceRegistry 类型
         → 新增 docs + types
         → 不修改现有代码

Step 2: 创建 SurfaceRegistry 类
         → surface-registry.ts
         → 实现 register/getContributions/resolve
         → 保持 view-registry 和 panel-registry 仍在运行

Step 3: 创建 SurfaceRenderer 组件
         → surface-renderer.tsx
         → 实现 SurfaceContextProvider
         → 实现 useSurfaceContext() hook

Step 4: 迁移 view-registry 到 SurfaceRegistry
         → viewRegistry.register("x", { component, meta })
         → surfaceRegistry.register({ id: "x", pluginId, surfaceType, component })

Step 5: 迁移 panel-registry 到 SurfaceRegistry
         → panelRegistry.register({ id, side, component })
         → surfaceRegistry.register({ id, pluginId, surfaceType: `sidebar.${side}`, component })

Step 6: 替换 MainSlot → SurfaceRenderer
         → 传 SurfaceRenderContext 代替 instanceId

Step 7: 替换 SidebarSlot → SidebarSurface
         → 从 surfaceRegistry 获取贡献

Step 8: 清理旧 registry
         → 删除 view-registry.ts
         → 删除 panel-registry.ts
         → 删除 MainSlot / SidebarSlot 组件
```
