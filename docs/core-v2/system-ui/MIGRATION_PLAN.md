# SessionNode v2 — System UI 迁移计划

> 从当前 app/（旧 sessionBridge 模型）到 System UI Plugin 的分阶段迁移方案
> 共 6 个 Phase（Phase 0–5），可并行执行

---

## Phase 0: 文档和命名对齐

**目标**：统一概念命名，不修改功能。新代码用新概念，旧代码逐步替换。

| 操作 | 旧命名 | 新命名 | 涉及文件 |
|------|--------|--------|---------|
| 概念对齐 | `instanceId` | `sessionId` | 所有文件 |
| 概念对齐 | `adapterId` | `pluginId` | view-registry.ts, action-types.ts, context-menu-registry.ts |
| 概念对齐 | `surfaceId` / `_surfaceId` | 删除 | workbench-state.ts |
| 概念对齐 | `adapter` | `plugin` | 所有文件 |
| 概念对齐 | `extension` | `plugin` 或 `feature-plugin` | panel-registry.ts |
| Surface 定义 | — | 新增 `SurfaceType`, `SurfaceRenderContext` 类型 | 新建 types |
| localStorage | 存 session 真相 | 只存 UI 偏好 | workbench-state.ts |

### 修改范围

- `types/` — 新增 SurfaceType / SurfaceRenderContext 类型定义
- `view-registry.ts` — 新增 `pluginId` 兼容字段
- `workbench-state.ts` — `instanceId` → `sessionId`（逐步替换）
- 所有引用 `instanceId` 的文件 — 增加 `sessionId` 兼容属性

### 风险

- 低。不修改功能，只增加兼容层和别名
- `instanceId` 到 `sessionId` 的替换可能导致命名冲突

### 验收标准

```
[ ] SurfaceType 定义完成
[ ] SurfaceRenderContext 类型定义完成
[ ] instanceId → sessionId 兼容层就位（运行时 debug 警告）
[ ] adapterId → pluginId 兼容层就位
[ ] localStorage 只存储 UI 偏好确认（code review）
[ ] npx tsc --noEmit 通过
```

### 推荐测试

- 类型编译检查
- localStorage 读写单元测试
- 运行时 debug 警告检查

---

## Phase 1: Core Client Facade

**目标**：统一所有 Core API 调用走 Core Client，不再直接拼 REST API。

### 改造内容

| 当前方式 | 改造后 |
|---------|--------|
| `fetch('/api/configuration/schema')` | `coreClient.request('config.schema')` |
| `fetch('/api/configuration/values', { method: 'PATCH', ... })` | `coreClient.request('config.set', { ... })` |
| `WebSocket.send({ type: "action.request", ... })` | `coreClient.request('fs.list', { ... })` |
| `useWorkbench().sendCommand(...)` | `coreClient.request('stream.write', { ... })` |
| `useWorkbench().createInstance(...)` | `coreClient.request('process.spawn', { ... })` |
| `useWorkbench().wsUrl` | `coreClient.getConnection()` |

### 文件范围

- 新建 `app/console/plugin-host/core-client.ts`
- 新建 `app/console/plugin-host/core-client-context.tsx`
- 修改 `settings-panel.tsx` — 改为 Core Client 调用
- 修改 `extension-panels.tsx` — 改为 Core Client 调用
- 修改 `terminal-view.tsx` — 改为 Core Client 调用
- 修改 `claude-chat-view.tsx` — 改为 Core Client 调用

### 风险

- 中。Core Client 需要封装现有的 WebSocket + HTTP 两种通信方式
- 需要确保 Core Client 的 error handling 覆盖所有已有场景
- 现有代码可能同时使用 fetch 和 WebSocket，Core Client 需统一

### 验收标准

```
[ ] CoreClient 支持 action.request（HTTP）
[ ] CoreClient 支持 stream.subscribe（WebSocket）
[ ] CoreClient 支持 config.get/set（HTTP）
[ ] 所有 settings-panel API 调用改为 Core Client
[ ] settings-panel 的 admin auth / update 区域改为 Core Client
[ ] extension-panels 的 SystemPanel 改为 Core Client
[ ] 向后兼容：旧的 fetch 可以直接调用，但新代码必须用 Core Client
[ ] npx tsc --noEmit 通过
```

### 推荐测试

- Core Client 单元测试（模拟 HTTP + WebSocket）
- settings-panel 集成测试（配置读写）
- extension-panels 集成测试（系统信息）

---

## Phase 2: SurfaceRenderContext

**目标**：MainSlot / SidebarSlot 改为 SurfaceRenderer，注入 SurfaceRenderContext。

### 改造内容

| 当前方式 | 改造后 |
|---------|--------|
| `MainSlot({ viewId, instanceId })` | `SurfaceRenderer({ context: SurfaceRenderContext })` |
| `SidebarSlot({ open, children })` | `SidebarSurface({ type })` |
| `viewRegistry.get(viewId)` 查组件 | `surfaceRegistry.resolve(context)` |
| `panelRegistry.getPanels('left')` | `surfaceRegistry.getContributions('sidebar.left')` |

### 文件范围

- 新建 `app/console/plugin-host/surface-registry.ts`
- 新建 `app/console/plugin-host/surface-renderer.tsx`
- 新建 `app/console/plugin-host/surface-context.tsx`（useSurfaceContext hook）
- 新建或迁移 `app/console/plugin-host/sidebar-surface.tsx`
- 修改 `workbench-layout.tsx` — 使用 SurfaceRenderer
- 修改 `left-sidebar.tsx` / `right-sidebar.tsx` — 使用 sidear surface
- 修改 `pane-view.tsx` — 使用 SurfaceRenderer

### 迁移状态说明

迁移期间，新旧两套系统可以共存：

```typescript
// 兼容层 — SurfaceRenderer 内部回退到旧 MainSlot
function SurfaceRenderer({ context }: { context: SurfaceRenderContext }) {
  // 如果旧系统仍在使用，回退
  if (useLegacyMode && context.viewId) {
    const entry = getViewEntry(context.viewId);
    if (entry) {
      return <MainSlot viewId={context.viewId} instanceId={context.sessionId} />;
    }
  }
  // 新路径
  return <NewSurfaceRenderer context={context} />;
}
```

### 风险

- 中。Surface 替换涉及布局系统核心改动
- 需要保持向后兼容（两套系统并行）
- SurfaceRenderContext 需要覆盖所有现有 MainSlot/SidebarSlot 的使用场景

### 验收标准

```
[ ] SurfaceRegistry 定义完成（register / getContributions / resolve）
[ ] SurfaceRenderer 实现（渲染 + 上下文注入）
[ ] SurfaceRenderContext 注入 sessionId + nodeId + pluginId
[ ] view-registry 改为 surfaceRegistry 注册
[ ] panel-registry 改为 surfaceRegistry 注册
[ ] 旧 MainSlot / SidebarSlot 通过兼容层运行
[ ] Tab → sessionId 映射由 surface 管理，不从 localStorage 恢复
[ ] npx tsc --noEmit 通过
```

### 推荐测试

- SurfaceRegistry 单元测试
- SurfaceRenderer 渲染测试（各种 SurfaceType）
- 兼容层测试（确认旧组件仍然工作）
- 手动测试：打开/关闭/刷新页面

---

## Phase 3: PluginHost

**目标**：PluginHost 负责加载 Feature Plugin 的 Web 贡献，管理组件生命周期。

### 改造内容

| 当前方式 | 改造后 |
|---------|--------|
| `register-panel-components.ts` 模块加载时注册 | `PluginHost.init()` 时注册 system-ui 内置组件 |
| `syncExtensionPanels()` 手动同步 | PluginHost 自动从 Core `plugin.registered` 事件同步 |
| view/panel/command/menu 各自独立同步 | PluginHost 统一处理 contributes |
| 插件组件直接 import | PluginHost 通过 contribution-loader 动态加载 |

### 文件范围

- 新建 `app/console/plugin-host/plugin-host.tsx`
- 新建 `app/console/plugin-host/plugin-host-context.tsx`
- 新建 `app/console/plugin-host/plugin-registry.ts`
- 新建 `app/console/plugin-host/contribution-loader.ts`
- 新建 `app/console/plugin-host/component-registry.ts`
- 迁移 `register-panel-components.ts` → componentRegistry.registerBuiltin()
- 修改 `page.tsx` — 移除同步逻辑，改为 PluginHost 驱动

### ClaudeChatView / TerminalView 迁移

这两个视图需要在 Phase 3 迁移为 Feature Plugin：

| 视图 | 新目录 | 关键改动 |
|------|--------|---------|
| ClaudeChatView | `plugins/claude-code/web/ClaudeChatView.tsx` | 不再依赖 workbench-context，改为通过 PluginHost 获取 Core Client + SurfaceRenderContext |
| TerminalView | `plugins/shell/web/TerminalView.tsx` | 不再调用 `createInstance/bindCurrentTabInstance`，改为 Core Client 调 `process.spawn` |

### 风险

- 高。PluginHost 是架构级改动
- ClaudeChatView 和 TerminalView 紧密耦合 workbench-context，拆解风险高
- 动态加载可能引入加载失败、竞争条件等问题

### 验收标准

```
[ ] PluginHost 启动时自动注册 system-ui 内置组件
[ ] PluginHost 从 Core welcome 消息同步插件 contribution
[ ] componentRegistry 支持 builtin + custom 两种组件类型
[ ] contribution-loader 支持动态加载 custom 组件
[ ] ClaudeChatView 迁移为 feature plugin（不再依赖 workbench-context）
[ ] TerminalView 迁移为 feature plugin（不再调用 createInstance/bindCurrentTab）
[ ] pluginId 不可伪造（Core 端认证优先）
[ ] npx tsc --noEmit 通过
```

### 推荐测试

- PluginHost 启动流程测试
- contribution-loader 加载成功/失败测试
- 自动化测试：ClaudeChatView 作为 feature plugin 独立渲染
- 自动化测试：TerminalView 作为 feature plugin 独立渲染

---

## Phase 4: Settings / Plugin Manager

**目标**：设置页和插件管理页接 Core Protocol，不再直接调 REST API。

### 改造内容

| 当前方式 | 改造后 |
|---------|--------|
| `fetch('/api/configuration/...')` | `coreClient.request('config.*')` |
| `fetch('/api/auth/...')` | `coreClient.request('auth.*')` |
| `fetch('/api/check-update')` | `coreClient.request('update.check')` |
| 无 Plugin Manager | 新增 `system-ui/views/plugin-manager.tsx` |
| 无 Plugin Detail | 新增 `system-ui/views/plugin-detail.tsx` |
| 无 Permission Grant UI | 新增 `system-ui/views/permission-dialog.tsx` |

### 新增功能

| 功能 | 文件 | 优先级 |
|------|------|--------|
| Plugin Manager 列表页 | `system-ui/views/plugin-manager.tsx` | P1 |
| Plugin Detail 页 | `system-ui/views/plugin-detail.tsx` | P2 |
| Environment Check tab | `system-ui/views/plugin-detail/environment-tab.tsx` | P2 |
| Install Plan/Execute tab | `system-ui/views/plugin-detail/install-tab.tsx` | P2 |
| Files/Cache tab | `system-ui/views/plugin-detail/files-tab.tsx` | P2 |
| Permission Grant tab | `system-ui/views/plugin-detail/permissions-tab.tsx` | P1 |
| Permission Grant dialog | `system-ui/views/permission-dialog.tsx` | P1 |

### 风险

- 中。Settings Panel 已有大量代码可复用，迁移 Core API 调用即可
- Plugin Manager 是全新功能，需等 Core 端的 `plugin.*` API 就绪
- Permission Grant UI 依赖 `plugin.permissions.*` API 就绪

### 验收标准

```
[ ] SettingsPanel 所有 API 调用改为 Core Client
[ ] Plugin Manager 列表页实现
[ ] Plugin Detail 页实现（至少 Overview + Permissions tab）
[ ] Permission Grant tab 实现
[ ] 以上功能走 Core Protocol，不直接调 REST
[ ] 安装 Plan → Execute 流程通过 Core Task 反馈进度
[ ] npx tsc --noEmit 通过
```

### 推荐测试

- SettingsPanel 集成测试（配置读写）
- Plugin Manager 集成测试（列表 + 启用/禁用）
- Plugin Detail 测试（环境检查、权限管理）
- 权限授予/撤销流程测试

---

## Phase 5: 清理旧模型

**目标**：删除所有旧概念代码，只保留新模型。

### 删除清单

| 文件 | 删除原因 | 替代 |
|------|---------|------|
| `view-registry.ts` | 完全被 surface-registry 替代 | surfaceRegistry |
| `panel-registry.ts` | 完全被 surface-registry 替代 | surfaceRegistry |
| `MainSlot` / `SidebarSlot` | 被 SurfaceRenderer 替代 | SurfaceRenderer |
| `workbench-context.tsx` 中的 instance 管理部分 | 被 Core Client + Surface Context 替代 | coreClient |
| `workbench-state.ts` 中的 `instanceId`, `_surfaceId`, `_stale`, `_orphaned` | 旧概念 | sessionId |
| `workbench-state.ts` 中的 `saveLayoutsToStorage`/`loadLayoutsFromStorage` | 违反了"localStorage 不存 session 真相" | 删除 |
| `workbench-state.ts` 中的 `AppWorkbenchState.instanceStates` | instanceId 绑定 | AppWorkbenchState surfaceStates |
| `syncExtensionPanels` | 被 PluginHost contribution-loader 替代 | PluginHost |
| `syncLegacyRegistry` | 不再需要 | 删除 |
| `getAdapterViewId` / `setAdapterViewMap` | adapter 概念被 plugin 替代 | 删除 |
| `registerAdapterMeta` / `getAdapterMeta` | adapter 概念被 plugin 替代 | 由 manifest 提供 |
| `ChromePolicy` / `resolveChromePolicy` | chrome 策略由 surface 声明 | surface 声明 |
| adapter 驱动的 view-selector | 视图选择由 surface + plugin 驱动 | surface-selector |

### 文件重构

| 当前 | 重构后 |
|------|--------|
| `app/page.tsx`（~600 行，职责过重） | 拆分为 `system-ui/entry.tsx` + `system-ui/layout.tsx` |
| `workbench-context.tsx`（巨型上下文） | 拆分为 `core-client-context.tsx` + `surface-context.tsx` |
| `workbench-layout.tsx` | 保留布局逻辑，改用 SurfaceRenderer |
| `left-sidebar.tsx` / `right-sidebar.tsx` | 改用 SidebarSurface |

### 风险

- **极高**。这是破坏性改动，需要确保迁移期间没有遗留的未迁移代码
- 删除 `workbench-context.tsx` 中的 instance 管理部分可能导致 ClaudeChatView 和 TerminalView 出错（如果它们还没迁移为 feature plugin）
- localStorage 清理可能导致用户刷新后看到空页面

### 验收标准

```
[ ] view-registry.ts 删除
[ ] panel-registry.ts 删除
[ ] MainSlot / SidebarSlot 删除
[ ] workbench-context 拆分为 core-client-context + surface-context
[ ] AppWorkbenchState.instanceStates 删除
[ ] localStorage session 持久化删除
[ ] adapter 相关代码全部删除
[ ] ChromePolicy 删除
[ ] 所有旧概念兼容层删除
[ ] page.tsx 瘦身完成
[ ] npx tsc --noEmit 通过
[ ] 手动测试：页面加载、session 列表重建、面板布局
```

### 推荐测试

- 全量回归测试
- 浏览器刷新恢复测试
- 多 browser 同步测试
- 移动端 surface 映射测试
- localStorage 残留兼容性测试

---

## 整体时间线估计

| Phase | 内容 | 工作量估计 | Core API 依赖 | 可并行 |
|-------|------|-----------|-------------|--------|
| Phase 0 | 文档和命名对齐 | 1–2 天 | 无 | — （基础） |
| Phase 1 | Core Client Facade | 3–5 天 | 部分已就绪 | 可与 Phase 0 部分重叠 |
| Phase 2 | SurfaceRenderContext | 5–8 天 | 无（纯前端） | 不依赖 Phase 1 |
| Phase 3 | PluginHost | 8–12 天 | `plugin.registered` 事件 | 依赖 Phase 2 |
| Phase 4 | Settings / Plugin Manager | 5–8 天 | `plugin.*` API 就绪 | 依赖 Phase 1 |
| Phase 5 | 清理旧模型 | 3–5 天 | 所有 Core API 就绪 | 依赖 Phase 1–4 |

**总工作量估计**：25–40 天（5–8 周）

---

## 依赖关系图

```
Phase 0（命名对齐）
  │
  ├──→ Phase 1（Core Client）──→ Phase 4（Settings/Plugin Mgr）
  │
  └──→ Phase 2（Surface 模型）──→ Phase 3（PluginHost）──→ Phase 5（清理）
                                                                 │
                              Phase 4 的部分工作（Plugin Detail）也依赖 Phase 3
```

---

## 风险总结

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `instanceId` 到 `sessionId` 替换遗漏 | 运行时崩溃 | Phase 0 加 debug 警告，运行时监测 |
| Core Client 覆盖不全 | 部分功能仍直接调 REST | Phase 1 后 code review 所有 API 调用 |
| Surface 迁移破坏布局 | 页面空白/布局错乱 | Phase 2 兼容层 + 逐步替换 |
| ClaudeChatView 拆解失败 | 主要功能不可用 | Phase 3 保持向后兼容，先建新文件再删除旧文件 |
| Core 端 `plugin.*` API 未就绪 | Phase 4 阻塞 | Phase 4 先做 Settings（已有 Core API），Plugin Manager 等 Core API 就绪 |
| 删除旧模型后发现问题 | 功能退化 | Phase 5 放在最后，经过充分测试 + 回溯窗口 |
