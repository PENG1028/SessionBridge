# SessionNode v2 — Slot Registry 设计文档

> 纯 TypeScript 的插槽/填充协调层，替换零散的 ad-hoc registry，提供孤儿检测和调试能力
> 无 React 依赖，无 DOM 依赖，可在 Node.js / Worker / Browser 任意 JS 环境运行

---

## 1. Overview — 为什么需要 Slot Registry

在 Slot Registry 出现之前，App UI 中有多套零散的"注册表"：settings section 靠硬编码、plugin 配置靠手动拼接、缺少"谁声明了扩展点、谁填充了内容"的统一视图。

具体痛点：

1. **Ad-hoc 注册** — 每个模块自己维护一个 `Map<string, ReactElement>`，没有统一的生命周期管理。
2. **没有孤儿检测** — 如果 A 插件填充了一个不存在的 slot，没有任何警告。bug 靠肉眼发现。
3. **没有 unfilled slot 检测** — 声明的扩展点如果没有被填充，系统静默跳过，缺乏可见性。
4. **调试困难** — 无法在运行时查看当前所有声明、填充、孤儿状态。

Slot Registry 解决这些问题的方式：

- **声明 (Declaration)** — 系统组件（如 SettingsPanel）声明一个 slot：`settings.section.plugin-config`
- **填充 (Filling)** — 插件（如 claude-code）提供内容，填充到该 slot
- **孤儿检测** — 填充时如果目标 slot 不存在，自动归入 orphans 列表并 emit warning
- **unfilled 检测** — 可以查询哪些声明还没有被填充
- **开发者工具** — SlotDevTools 组件在 dev mode 下显示完整状态

### 设计原则

```text
Slot Registry = 发布-订阅的简化版
                 ≠ React state management
                 ≠ 组件通信总线
                 = 纯数据协调层（Map + Array）
```

组件从 SlotRegistry 读取数据后，自己管理渲染逻辑。Registry 不负责触发 re-render。

---

## 2. Core Concepts — Declaration vs Filling vs Orphan

### 2.1 SlotDeclaration

Slot 声明表示"这里有一个扩展点，其他插件可以往这里放东西"。

```typescript
interface SlotDeclaration {
  slotId: string;           // 全局唯一 slot ID，如 "settings.section.plugin-config"
  title: string;            // 人类可读的标题
  description?: string;     // 可选的说明
  declaredBy: string;       // 声明者，如 "settings-panel"
  expectedType?: string;    // 可选类型提示
}
```

谁声明谁负责定义 slotId 的命名空间。例如 SettingsPanel 声明所有 `settings.section.*` slot。

### 2.2 SlotFilling

填充表示"我有内容要放到某个 slot 里"。

```typescript
interface SlotFilling {
  slotId: string;           // 目标 slot
  fillingId: string;        // 在该 slot 内唯一，如 "terminal.config"
  pluginId: string;         // 提供者
  content: unknown;         // 数据（opaque，registry 不关心内容）
  order?: number;           // 显示顺序（升序，越小的越前）
}
```

填充由 plugin-sync 在 enable 插件时自动提交。清理时通过 `unfill(pluginId)` 批量移除。

### 2.3 Orphan（孤儿填充）

Orphan 是"填充了一个不存在的 slot"的记录。可能的原因：

- 声明 slot 的模块还未加载（时序问题）
- 声明 slot 的模块已被移除或改名
- 填充时打错了 slotId

SlotRegistry 在 `fill()` 时自动检测 orphan 并 emit `console.warn`：

```
[slot-registry] Plugin "claude-code" filled unknown slot "settings.section.plugin-config" —
target component may not be installed.
```

### 2.4 Unfilled Slot（未填充的声明）

声明了但没有收到任何填充的 slot。可能的原因：

- 还没有对应的插件提供填充
- 填充的插件未启用
- 填充的插件有 bug，没有正常调用 `fill()`

---

## 3. API Reference

所有方法见 `lib/slot-registry/slot-registry.ts`。

| 方法 | 签名 | 说明 |
|------|------|------|
| `declare` | `(decl: SlotDeclaration): void` | 注册一个 slot 声明。如果 slotId 已存在，emit warning 并忽略新声明 |
| `undeclare` | `(slotId: string): void` | 移除声明及其所有填充。同时清理指向该 slot 的 orphan。silent 无操作如果不存在 |
| `fill` | `(filling: SlotFilling): void` | 提交填充。如果目标 slot 已声明 → 存入该 slot 的 fillings 列表。如果目标 slot 未声明 → 归入 orphans + console.warn |
| `unfill` | `(pluginId: string): void` | 移除指定 plugin 的所有填充（所有 slot + orphans）。用于插件 disable 时清理 |
| `getDeclaration` | `(slotId: string): SlotDeclaration \| undefined` | 查询单个声明 |
| `getDeclarations` | `(): SlotDeclaration[]` | 获取所有声明（浅拷贝） |
| `getFillings` | `(slotId: string): SlotFilling[]` | 获取某个 slot 的所有填充，按 order 升序排列 |
| `getUnfilledSlots` | `(): SlotDeclaration[]` | 查询声明了但无填充的 slot |
| `getOrphans` | `(): SlotFilling[]` | 查询填充了但无声明的 orphan |
| `getAll` | `(): { declarations, fillings, orphans }` | 返回完整快照。fillings 是 `Map<string, SlotFilling[]>` |

### 内部数据结构

```typescript
class SlotRegistry {
  private _declarations = new Map<string, SlotDeclaration>();  // slotId → decl
  private _fillings    = new Map<string, Map<string, SlotFilling>>();  // slotId → fillingId → filling
  private _orphans: SlotFilling[] = [];  // 孤儿列表
}
```

### Singleton

```typescript
import { slotRegistry } from '../../../lib/slot-registry';
// 或
import { SlotRegistry } from '../../../lib/slot-registry';
const myInstance = new SlotRegistry();  // 需要隔离测试时
```

应用级 singleton `slotRegistry` 在模块加载时创建，全局唯一实例。

---

## 4. Usage Patterns

### 4.1 系统组件声明 Slot（Module Init 阶段）

SettingsPanel 在模块初始化时声明所有 settings section slot：

```typescript
// app/console/shell/settings-panel.tsx

let _slotsRegistered = false;
function ensureSlotsRegistered(): void {
  if (_slotsRegistered) return;
  _slotsRegistered = true;

  slotRegistry.declare({
    slotId: 'settings.section.plugin-config',
    title: 'Plugin Settings',
    description: 'Configuration from installed plugins',
    declaredBy: 'settings-panel',
  });
  slotRegistry.declare({
    slotId: 'settings.section.system.connection',
    title: 'Connection',
    description: 'Core connection configuration',
    declaredBy: 'settings-panel',
  });
  // ...
}
```

关键点：

- 使用 `_slotsRegistered` guard 防止重复声明（`declare()` 本身也有 dedup，但 module-level guard 更清晰）
- 在 SettingsPanel 组件的 `ensureSlotsRegistered()` 中调用，确保在首次渲染前注册
- 声明者和 slot 命名一致（`settings.section.*` 统一由 `settings-panel` 管理）

### 4.2 插件填充 Slot（Enable 时自动提交）

plugin-sync 在启用插件时，如果插件有 `configuration` 贡献，自动填充 `settings.section.plugin-config`：

```typescript
// app/lib/app-registry/plugin-sync.ts

if (ui.configuration) {
  slotRegistry.fill({
    slotId: 'settings.section.plugin-config',
    fillingId: `${appId}.config`,
    pluginId: appId,
    content: {
      pluginId: appId,
      pluginName: manifest.name || appId,
      title: ui.configuration.title,
      properties: ui.configuration.properties,
    },
    order: configOrder(manifest.type),  // system: 10, 其他: 20
  });
}
```

关键点：

- `fillingId` 用 `${appId}.config` 避免冲突
- `order` 控制显示顺序：system 插件排前面（10），用户插件排后面（20）
- `content` 是 opaque data，由消费方（SettingsPanel）自行解析

### 4.3 组件读取 Fillings 进行渲染

SettingsPanel 的 `PluginSettingsSection` 组件从 slot registry 读取填充数据：

```typescript
function PluginSettingsSection() {
  const fillings = slotRegistry.getFillings('settings.section.plugin-config');

  // 如果没有填充，不渲染
  if (fillings.length === 0) return null;

  return (
    <div>
      <div>PLUGIN SETTINGS</div>
      {fillings.map((filling) => {
        const content = filling.content as {
          pluginId: string;
          pluginName: string;
          title?: string;
          properties: Record<string, unknown>;
        };
        return (
          <PluginSettingsGroup
            key={content.pluginId}
            pluginId={content.pluginId}
            pluginName={content.pluginName}
            properties={content.properties}
          />
        );
      })}
    </div>
  );
}
```

关键点：

- 读取时做类型断言（`filling.content as ...`），因为是调用方自己定义的契约
- `getFillings()` 返回按 order 排序的数组
- 组件管理自己的 re-render — SlotRegistry 不提供订阅机制

### 4.4 插件 Disable / Uninstall 时清理

```typescript
// app/lib/app-registry/plugin-sync.ts
// unregisterApp() 中：

slotRegistry.unfill(appId);
```

`unfill(pluginId)` 清除该 plugin 在所有 slot 中的填充，包括 orphans。

```typescript
// 对应 lifecycle
pluginManager.on('appDisabled', (appId) => {
  slotRegistry.unfill(appId);
});
```

---

## 5. Orphan Detection — 孤儿检测机制

### 工作原理

当 `fill()` 被调用时，SlotRegistry 检查 `_declarations` Map 中是否存在目标 slotId：

```
存在   → 存入 _fillings[slotId]（正常路径）
不存在 → 存入 _orphans[] + console.warn（孤儿路径）
```

### 触发场景

1. **时序问题** — 插件在声明模块之前加载并填充。通常是暂时的，声明加载后 orphan 自动清除（`fill()` 中如果发现 slot 已声明，会从 orphans 移除对应条目）

2. **真正的孤儿** — 声明模块不存在或已被移除。此时 orphan 会一直存在。

3. **拼写错误** — `fill({ slotId: 'settings.section.plugin-confgi' })`（typo），永远不会匹配任何声明。

### Warning 输出格式

```
[slot-registry] Plugin "claude-code" filled unknown slot "settings.section.plugin-confgi" —
target component may not be installed.
```

- 前缀 `[slot-registry]` 统一 namespace
- 包含 `pluginId` 用于定位来源
- 包含 `slotId` 用于调试
- 提示可能的原因而不是 bare error

### 自动去孤儿化

如果某个 filling 之前是 orphan（因为声明还没到），后来声明注册后再次调用 `fill()`，SlotRegistry 会自动将该 filling 从 orphans 列表移除：

```typescript
// slot-registry.ts fill() — 去孤儿化
if (this._declarations.has(filling.slotId)) {
  // slot 已存在，存入正常列表
  // ...
  // 并从 orphans 移除
  this._orphans = this._orphans.filter(
    (o) => !(o.slotId === filling.slotId && o.fillingId === filling.fillingId)
  );
}
```

但注意：这个去孤儿化只发生在再次调用 `fill()` 的时候，不是自动的"声明注册时扫描 orphans"。如果先 fill 后 declare，orphan 不会自动消失。需要遵守"先 declare 后 fill"的顺序，或者在开发时用 SlotDevTools 检查。

---

## 6. Developer Tools — SlotDevTools

SlotDevTools 是内置于 Settings 面板底部的调试组件，仅在 `NODE_ENV === 'development'` 时显示。

### 打开方式

1. 打开 Settings 面板
2. 滚动到底部
3. 点击 **Slot Registry DevTools** 展开

### 四个分区

| 分区 | 内容 | 颜色标识 |
|------|------|---------|
| **Declarations** | 所有已注册的 slot 声明 | 灰色 `text-gray-400` |
| **Fillings** | 每个 slot 下的所有填充，按 slotId 分组 | 绿色 `text-emerald-400` |
| **Unfilled Slots** | 声明了但没有填充的 slot | 黄色 `text-amber-400` |
| **Orphaned Fillings** | 填充了但没有声明的 filling | 红色 `text-red-400` |

### 功能

- **Refresh 按钮** — 手动刷新 registry 快照（因为 registry 是纯数据，没有 React 绑定）
- **计数 badge** — 每个分区标题右侧显示当前数量
- **展开/折叠** — 点击分区标题
- **hover tooltip** — 长 ID 显示完整字符串

### 典型调试场景

1. 安装新的 plugin 后发现配置项没出现 → 打开 SlotDevTools 检查 Fillings 中是否有该 plugin 的填充
2. 某个 section 空白的 → 检查 Unfilled Slots，看是否有声明但无填充
3. 意外的 UI 重复 → 检查 Fillings 是否有重复的 fillingId
4. 功能完全不出现 → 检查 Orphans，看是否填充了不存在的 slot

---

## 7. Current Slots — 当前已注册的 Slot

| slotId | 声明者 | 填充者 | 说明 |
|--------|--------|--------|------|
| `settings.section.system.connection` | `settings-panel` | — | Core 连接配置（Core 地址、端口） |
| `settings.section.system.about` | `settings-panel` | — | 版本信息 |
| `settings.section.plugin-config` | `settings-panel` | 各插件（claude-code, shell 等）| 插件配置项（有 `configuration` 的插件自动填充） |
| `settings.section.core` | `settings-panel` | — | Go Core 配置值（config.list）|
| `settings.section.updates` | `settings-panel` | — | 更新管理 |

当前所有 slot 均由 `settings-panel` 声明，在 `ensureSlotsRegistered()` 中完成注册。

由 plugin-sync `registerAppContributions()` 在插件启用时自动填充 `settings.section.plugin-config`。

注意：`settings.section.system.connection`、`settings.section.system.about`、`settings.section.core`、`settings.section.updates` 目前无填充 — 它们是系统内置 section，由 SettingsPanel 直接渲染，不是 slot-driven 的。如果需要第三方扩展这些 section，可以开放给插件填充。

---

## 8. Comparison to Other Patterns — Slot Registry 与其他注册表的关系

### ActionRegistry

```text
ActionRegistry: surfaceId → action 的映射，用于 UI 事件响应
               App UI 组件通过 dispatch(action) 触发
               面向 "命令/操作" 的分发

SlotRegistry:   slotId → fillings 的映射，用于 UI 内容插槽
               组件主动读取 registry 获取数据
               面向 "扩展点/插槽" 的协调
```

ActionRegistry 关心的是"用户操作了什么 → 谁处理"。SlotRegistry 关心的是"谁预留了扩展点 → 谁来填充"。

### ContributionRegistry

```text
ContributionRegistry: 收集插件的 manifest 贡献
                      注册 views/panels/commands/menus 的声明数据
                      面向 "声明阶段" 的聚合

SlotRegistry:         运行时填充协调
                      填充的实际数据（config schema、面板内容）
                      面向 "运行时" 的数据交换
```

ContributionRegistry 做"登记"（把 manifest 解析成 registry 可消费的结构），SlotRegistry 做"插槽"（组件提供 slot，插件提供 filling）。两者互补：plugin-sync 先通过 ContributionRegistry 注册 manifest，再通过 SlotRegistry 填充配置 section。

### ChromeRegistry (Status Bar Items)

```text
ChromeRegistry: 管理状态栏项（图标、文字）
                特定的 surface（status bar）
                有内置的 React 绑定和渲染

SlotRegistry:   通用的 slot/filling 模式
                不绑定任何 surface 或 UI 框架
                纯数据层
```

ChromeRegistry 是一个特化的注册表（绑定 status bar 渲染），SlotRegistry 是泛化的协调层。如果未来有其他 surface 需要扩展点模式，可能会基于 SlotRegistry 而不是创建新的特化注册表。

### ViewRegistry (Editor Views)

```text
ViewRegistry:  viewId → React component 的映射
               与 MainSlot / WorkbenchState 紧密绑定
               有明确的"活动 tab"概念

SlotRegistry:  没有"活性"概念
               不关心哪个 filling 是"活动的"
               只做 slot→fillings 的多对多映射
```

ViewRegistry 管理"哪个视图在哪个 tab 中打开"，有状态和生命周期。SlotRegistry 管理"有哪些内容可以插入某个扩展点"，是无状态的纯数据查询。

### 总结对比

| 特性 | SlotRegistry | ActionRegistry | ContributionRegistry | ChromeRegistry | ViewRegistry |
|------|-------------|---------------|-------------------|---------------|-------------|
| 数据结构 | slotId → fillings[] | surfaceId → handler | manifestId → contributions | side+order → item | viewId → component |
| 数据方向 | 声明→填充 | dispatch→handle | plugin→host | register→render | register→resolve |
| React 依赖 | 无 | 无 | 无 | 有（渲染） | 有（渲染） |
| 孤儿检测 | 有 | 无 | 无 | 无 | 无 |
| 通用性 | 通用协调层 | 通用操作分发 | 仅用于 plugin manifest | status bar 专用 | view/tab 专用 |
| 生命周期 | declare/fill/unfill/undeclare | register/unregister | registerManifest/unregisterManifest | register/unregister | registerView/unregisterView |

---

## 9. Best Practices

### 9.1 Slot ID 命名规范

使用点分隔的命名空间，避免冲突：

```
<domain>.<section>.<specific>
settings.section.plugin-config
status-bar.left.plugin-icons
toolbar.right.actions
panel.bottom.monitor
```

- 第一段是领域（settings, status-bar, toolbar, panel）
- 第二段是位置或分类（section, left, right, bottom）
- 第三段是具体标识（plugin-config, plugin-icons, actions, monitor）

### 9.2 尽早声明 Slot

Slot 声明应发生在模块加载阶段。使用 module-level guard 确保只声明一次：

```typescript
let _slotsRegistered = false;
function ensureSlotsRegistered(): void {
  if (_slotsRegistered) return;
  _slotsRegistered = true;
  slotRegistry.declare({ ... });
}
```

声明的代码应放在组件文件顶部或独立的 `slot-declarations.ts` 文件中。

### 9.3 启用时填充，禁用时清理

```typescript
// ✅ 正确模式
function onPluginEnabled(appId, manifest) {
  slotRegistry.fill({ ... });
  // 其他注册...
}

function onPluginDisabled(appId) {
  slotRegistry.unfill(appId);
  // 其他清理...
}
```

```typescript
// ❌ 错误模式 — pluginId 参数缺失，会留下孤儿
function onPluginDisabled(/* 缺少 appId */) {
  // 忘记调用 slotRegistry.unfill()
}
```

### 9.4 开发时检查 Orphans

在开发环境启动后，打开 Settings → Slot DevTools 检查：

- Orphans 应为 0。如果有，说明有填充指向了不存在的 slot
- Unfilled Slots 视设计而定。有些 slot 设计为有填充才显示，有些 slot 设计为总是显示（即使无填充也要展示默认 UI）

### 9.5 填充顺序控制

使用 `order` 字段控制显示顺序，不要依赖 Map 的插入顺序：

```typescript
// 系统插件排前面
order: manifest.type === 'system' ? 10 : 20
```

`getFillings()` 返回的数组已按 order 升序排列。如果两个 filling 有相同 order，目前按 findingId 的插入顺序（Map 保留插入顺序）。

### 9.6 不要将 SlotRegistry 用作状态管理

```typescript
// ✅ 正确 — SlotRegistry 只做协调，渲染由组件管理
function MyComponent() {
  const fillings = slotRegistry.getFillings('my.slot');
  return <div>{fillings.map(f => <SubComponent key={f.fillingId} />)}</div>;
}

// ❌ 错误 — 试图让 SlotRegistry 管理 React 状态
// SlotRegistry 没有 setState/setFillings，也不触发 re-render
// 需要响应式更新时，组件自己管理状态 + useEffect + slotRegistry 读取
```

### 9.7 Slot Registry vs Surface Model

Slot Registry 不等于 Surface Model。两者的关系：

- **Surface Model** 定义布局结构（sidebar left/main editor/status bar）
- **Slot Registry** 定义内容插入点（settings section/status bar items/toolbar actions）

Surface 可以消费 Slot Registry 的数据。例如：StatusBar surface 从 ChromeRegistry 读取 items，ChromeRegistry 内部可以基于 SlotRegistry 实现扩展。但目前 SlotRegistry 主要用于 settings section。

---

## 附录 A: 文件位置

| 文件 | 路径 |
|------|------|
| 类型定义 | `lib/slot-registry/slot-types.ts` |
| Registry 实现 | `lib/slot-registry/slot-registry.ts` |
| 导出入口 | `lib/slot-registry/index.ts` |
| 声明 + 消费 | `app/console/shell/settings-panel.tsx` |
| 填充逻辑 | `app/lib/app-registry/plugin-sync.ts` |
| 开发者工具 | `app/console/settings/slot-devtools.tsx` |

## 附录 B: 添加新的 Slot

1. 在适当的组件中调用 `slotRegistry.declare()`（使用 guard 防重复）
2. 在 plugin-sync 或对应的填充者中调用 `slotRegistry.fill()`
3. 在消费组件中调用 `slotRegistry.getFillings()` 读取并渲染
4. 在 disable 时调用 `slotRegistry.unfill(pluginId)` 清理
