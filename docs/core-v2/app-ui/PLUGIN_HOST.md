# SessionNode v2 — Plugin Host 设计

> System UI 中的 Plugin Host 负责加载 Feature Plugin 的 Web 贡献
> 配套文档：SYSTEM_UI_PLUGIN.md、UX_SURFACES.md、SURFACE_MODEL.md

---

## PluginHost 职责

```
PluginHost
  ├── 加载和管理 Feature Plugin 的 Web contribution
  │   ├── views（React 组件）
  │   ├── panels（侧边栏/底部面板）
  │   ├── commands（命令注册）
  │   └── menus（上下文菜单）
  ├── 自动注入 Core Client + SurfaceRenderContext
  ├── 注册 system-ui 内置组件
  ├── 管理组件生命周期（挂载/卸载）
  └── 为 CLI 贡献提供 metadata（不执行 CLI 命令）
```

### PluginHost 不做什么

```
✗ 不拥有 Core 状态
✗ 不执行插件能力（只展示 UI）
✗ 不绕过权限校验
✗ 不给插件伪造 pluginId 的能力
✗ 不运行 CLI 命令
```

---

## 目录结构建议

```
app/console/plugin-host/
├── index.ts                      # 导出
├── plugin-host.tsx               # PluginHost 主组件（Provider）
├── plugin-host-context.tsx       # 上下文（coreClient + pluginId + sessionId）
├── plugin-registry.ts            # 插件元数据注册表（从 Core 广播同步）
├── contribution-loader.ts        # 加载插件 Web entry（dynamic import）
├── surface-registry.ts           # SurfaceRegistry（统一注册表，替代 view-registry + panel-registry）
├── component-registry.ts         # 内置组件注册 + 插件组件映射
├── core-client.ts                # Core Client 封装（HTTP + WebSocket）
└── permissions.ts                # 前端权限检查（展示层面）
```

### 文件职责

| 文件 | 职责 | 迁移来源 |
|------|------|---------|
| `plugin-host.tsx` | Provider 组件，包裹 System UI 应用根节点。负责从 Core 同步插件列表、初始化 SurfaceRegistry | 新建 |
| `plugin-host-context.tsx` | 提供 `usePluginHost()` hook，返回 `{ coreClient, pluginId, sessionId, nodeId }` | 新建 |
| `plugin-registry.ts` | 插件元数据注册表。从 Core 的 `plugin.registered` 事件同步。存 `{ pluginId, manifest, status }` | 新建 |
| `contribution-loader.ts` | 动态加载插件的 Web entry（React 组件）。支持 builtin/custom/iframe 三种模式 | 新建 |
| `surface-registry.ts` | Surface 统一注册表。替代 view-registry + panel-registry | 从 view-registry.ts / panel-registry.ts 迁移 |
| `component-registry.ts` | 组件映射：`{ pluginId, viewId → React Component }`。system-ui 内置组件 + feature plugin 组件 | 从 register-panel-components.ts 迁移 |
| `core-client.ts` | Core API 封装。统一 HTTP + WebSocket 调用 | 从 ws-client / useWS 迁移 |
| `permissions.ts` | 前端展示层面的权限检查（不影响 Core 端校验） | 新建 |

---

## 组件加载流程

### PluginHost 启动

```
1. System UI 启动
2. PluginHost 初始化：
   a. 注册 system-ui 内置组件到 componentRegistry
   b. 创建 SurfaceRegistry（空）
   c. 初始化 CoreClient（连接 Core）

3. Core WebSocket 连接建立
4. Core 推送 welcome：
   { plugins: [{ id: "shell", version: "1.0", web: { views: [...], panels: [...] } }, ...] }

5. PluginHost 处理每个插件：
   a. 读取 web.views → 注册到 surfaceRegistry
      - componentType === "builtin" → 从 componentRegistry 获取组件
      - componentType === "custom" → 动态 import entry 路径
   b. 读取 web.panels → 注册到 surfaceRegistry（side = surfaceType）
   c. 读取 web.commands → 注册到 commandRegistry
   d. 读取 web.menus → 注册到 contextMenuRegistry

6. 组件就绪 → SurfaceRenderer 可以渲染
```

### custom 组件加载

```typescript
// contribution-loader.ts
const customComponentCache = new Map<string, ComponentType<any>>();

async function loadCustomComponent(pluginId: string, entry: string): Promise<ComponentType<any> | null> {
  const cacheKey = `${pluginId}:${entry}`;
  if (customComponentCache.has(cacheKey)) return customComponentCache.get(cacheKey)!;

  try {
    // entry 格式: "ClaudeChatView" → 插件编译后的模块路径
    const module = await import(`../../../plugins/${pluginId}/web/${entry}`);
    const Component = module.default || module[entry];

    if (!Component) {
      console.warn(`[PluginHost] Plugin ${pluginId} entry ${entry} has no default export`);
      return null;
    }

    // 注入 Core Client + SurfaceRenderContext
    const WrappedComponent = withPluginContext(Component, pluginId);
    customComponentCache.set(cacheKey, WrappedComponent);
    return WrappedComponent;
  } catch (err) {
    console.error(`[PluginHost] Failed to load ${pluginId}/${entry}:`, err);
    return null;
  }
}

// 自动注入 Wrapper
function withPluginContext(Component: ComponentType<any>, pluginId: string): ComponentType<any> {
  return function PluginContextWrapper(props: any) {
    const hostCtx = usePluginHost();
    const surfaceCtx = useSurfaceContext();

    // 校验 pluginId — 防止组件读到错误的 pluginId
    if (surfaceCtx.pluginId && surfaceCtx.pluginId !== pluginId) {
      console.warn(`[PluginHost] Context pluginId mismatch: expected ${pluginId}, got ${surfaceCtx.pluginId}`);
    }

    // 注入 hostContext（Core Client）和 surfaceContext（sessionId/nodeId）
    return <Component {...props} hostContext={hostCtx} surfaceContext={surfaceCtx} />;
  };
}
```

---

## 安全约束

### PluginId 不可伪造

```
PluginHost 在校验 pluginId 时遵守以下规则：

1. 所有插件组件接收的 pluginId 来自 Core（welcome 消息），不可由插件代码修改
2. withPluginContext 强制注入，插件 wrapper 无法覆盖
3. 如果插件尝试通过 SurfaceRenderContext 的 url/params 伪造 pluginId，Core 端权限校验时会拒绝

风险：插件组件内部可以调用 Core API 时传递任意 pluginId
缓解：Core 端在每次 action.request 时校验 pluginId 是否与 WebSocket 认证的 pluginId 一致
  → pluginId 由 WebSocket 连接的 token/actor 决定，不由请求 payload 决定
```

### 安全模型

```
System UI 的 Core Client:    pluginId = "system-ui"（由 Core 认证后填充）
Feature Plugin 的 Core Client: pluginId = "claude-code"（由 Plugin Host 注入）

Feature Plugin 组件无法：
  1. 以 system-ui 身份调 Core API（WebSocket 连接的 actor 不同）
  2. 读取其他插件的数据和配置（权限校验拒绝）
  3. 绕过权限校验（Core 端强制执行）
```

---

## host-rendered vs custom-react 两种渲染模式

### host-rendered（系统托管组件）

某些插件页面可以复用 System UI 内置组件，不需要插件自己写 React：

```yaml
# plugins/claude-code/plugin.yaml
web:
  views:
    - id: claude-code.install
      component: builtin        # 系统内置组件
      builtinId: system-ui.install-plan   # 复用安装向导组件
      params:
        pluginId: claude-code
        steps:
          - binary: claude
          - binary: git
```

适用场景：
- 插件文件列表 → `system-ui.file-tree`
- 缓存管理 → `system-ui.cache-panel`
- 安装历史 → `system-ui.history-timeline`
- 环境检查 → `system-ui.env-check-result`
- 权限管理 → `system-ui.permission-list`

### custom-react（插件自定义组件）

插件编写自己的 React 组件：

```yaml
web:
  views:
    - id: claude-code.chat
      component: custom
      entry: ClaudeChatView
```

适用场景：
- Claude Chat 消息渲染（需自定义解析 + 样式）
- Terminal（自定义 xterm.js 集成）
- 文件差异对比（自定义 diff 组件）

---

## 从现有代码迁移

### view-registry.ts

```
当前：
  viewRegistry.set("claude-code.chat", { component: ClaudeChatView, meta: { ... } })
  getViewEntry("claude-code.chat") → { component, meta }
  getAllViewEntries() → 所有视图

迁移到：
  surfaceRegistry.register({
    id: "claude-code.chat",
    pluginId: "claude-code",
    surfaceType: "main.editor",
    componentType: "custom",
    entry: "ClaudeChatView",
    title: "Claude Chat",
    ...
  })
  surfaceRegistry.resolve("claude-code.chat") → Component | null

删除：
  - adapterId 映射（getAdapterViewId, setAdapterViewMap）
  - adapterMeta（getAdapterMeta, registerAdapterMeta）
  - adapterCapabilities（syncAdapterCapabilitiesFromExtensionData）
  - ChromePolicy（resolveChromePolicy）
  - syncLegacyRegistry()
  - viewRegistry Record<string, ComponentType> 兼容层
```

### panel-registry.ts

```
当前：
  registerPanel({ id: "logs", side: "left", component: LogsPanel, ... })
  getPanels("left", whenCtx) → PanelRegistration[]

迁移到：
  surfaceRegistry.register({
    id: "logs",
    pluginId: "system-ui",
    surfaceType: "sidebar.left",
    componentType: "builtin",
    component: LogsPanel,
    title: "Logs",
    order: 100,
    when: "...",
  })
  surfaceRegistry.getContributions("sidebar.left") → SurfaceContribution[]

删除：
  - syncExtensionPanels() → move to PluginHost contribution-loader
  - extensionPanelIds → move to PluginHost
  - componentOverrides → move to contribution-loader
  - getPanelComponentOverride
  - registerPanelComponent → move to componentRegistry
```

### register-panel-components.ts

```
当前：
  registerPanelComponent('logs', LogsPanel);
  registerPanelComponent('terminal', TerminalPanel);

迁移到：
  // component-registry.ts
  componentRegistry.registerBuiltin('logs', LogsPanel, { pluginId: 'system-ui' });
  componentRegistry.registerBuiltin('terminal', TerminalPanel, { pluginId: 'system-ui' });

注册时机：
  从 module 加载时注册 → PluginHost 初始化时注册
```

### command-registry.ts

```
当前设计合理，不需要大改。

需要补充：
  - 支持 manifest 声明的 commands 自动注册
  - commands 的 surface/scope 字段（哪些 surface 显示此命令）
```

### action-registry.ts

```
当前设计合理。

需要调整：
  - ActionSurface 类型与 SurfaceType 对齐（或映射）
  - ActionRunContext 中 instanceId → sessionId
  - ActionRunContext 中 activeAdapterId → pluginId 或删除
  - 增加 pluginId 字段
```

### context-menu-registry.ts

```
当前设计合理（三源合并器模式）。

需要调整：
  - ContextMenuRequest 中 adapterId → pluginId
  - ContextMenuRequest 中 instanceId → sessionId
  - manifest 中的 menus 注册由 PluginHost 的 contribution-loader 驱动
```

---

## CLI Contribution Metadata

PluginHost 还负责展示 CLI 贡献的 metadata：

```typescript
// plugin-registry.ts 同时存储 CLI 命令信息
interface PluginCliCommands {
  pluginId: string;
  commands: Array<{
    name: string;
    description: string;
    args: string;
  }>;
}

// 展示在 Plugin Detail 页面的 CLI 信息区域
// PluginHost 只展示 metadata，不执行 CLI 命令
```

CLI 命令的执行由 CLI Host 负责，不在 System UI 范围内。

---

## 目录迁移建议

| 当前路径 | 新路径 |
|---------|--------|
| `app/console/main/view-registry.ts` | `app/console/plugin-host/surface-registry.ts`（部分） + 删除旧概念 |
| `app/console/panels/panel-registry.ts` | `app/console/plugin-host/surface-registry.ts`（部分）+ `app/console/plugin-host/contribution-loader.ts` |
| `app/console/panels/register-panel-components.ts` | `app/console/plugin-host/component-registry.ts` |
| `app/console/panels/extension-panels.tsx` | `app/console/plugin-host/builtin-components/` |
| `app/console/commands/command-registry.ts` | 保留（或移入 plugin-host/command-registry.ts） |
| `app/console/actions/action-registry.ts` | 保留（或移入 plugin-host/action-registry.ts） |
| `app/console/menus/context-menu-registry.ts` | 保留（或移入 plugin-host/context-menu-registry.ts） |

建议：以 `app/console/plugin-host/` 为 PluginHost 目录，逐步将各 registry 移入，保持向后兼容。
