# SessionNode v2 — 设置页与插件管理页设计

> 设置页 IA、插件管理全生命周期 UI、全部通过 App Registry API 和 Core Protocol 调用
> UI 不自己执行任何安装/清理操作，只调服务端 API 或 Core API

---

## 一、Settings IA（信息架构）✅ 已实现

实际 Settings 面板按以下顺序渲染（通过 Slot Registry 排序 + 硬编码顺序）：

```
Settings Panel
├── Connection                    # 连接配置（系统级，非折叠）
│   ├── Core 连接状态            status dot + 标签
│   ├── Core 端口输入            9090 (默认)
│   ├── Connect 按钮             应用端口并重连
│   └── Scan for Core            端口扫描工具 (GET /api/core/discover)
│
├── About                         # 关于（默认折叠）
│   ├── UI 版本                  v0.6.x
│   ├── Go Core 状态             连接状态 + 标签
│   └── Core 端口                 当前连接端口
│
├── Plugin Settings               # 插件配置（动态，由 slotRegistry 驱动）
│   ├── terminal                  # 从 plugin.yaml 读取配置 schema
│   │   ├── defaultShell         string
│   │   ├── fontSize             integer
│   │   └── cursorBlink          boolean
│   ├── mesh
│   │   ├── autoReconnect        boolean
│   │   └── heartbeatInterval    integer
│   └── ...                       # 其他插件的配置项
│
├── Core Settings                 # Core 配置（通过 WebSocket core.call('config.list')）
│   ├── 搜索/过滤
│   ├── ConfigField 编辑
│   ├── 修改标记 + 批量保存
│   └── Reset 单键
│
└── Updates                       # 更新管理
    ├── 当前版本 (GET /api/core/version)
    └── 检查更新 (core.call('update.check'))
```

> **与原设计的差异**：原设计按 General → Plugins → Nodes → Logs → Admin → Updates → About 排列。
> 实际移除了 Nodes/Logs/Admin 区域；Plugin Settings 位于中间而非独立页面；
> Core Settings 直接展示 Core 配置键值；About 放在连接面板之后。

### 当前代码复用

`app/console/shell/settings-panel.tsx` 已经实现了：
- Schema 驱动的配置编辑（ConfigField 组件）
- User/Workspace 两级 scope（通过 Core `config.set`）
- 搜索/过滤
- 修改标记 + 批量保存
- Core Settings 区域（`config.list` / `config.set` / `config.reset`）
- Updates 区域

**复用建议**：保留现有 SettingsPanel 的 UI 结构，区分 Core Config 和 Plugin Config。

---

## 二、配置编辑 — ConfigField 复用

SettingsPanel 中的 `ConfigField` 组件可直接复用：

```
UI 设计（来自现有 settings-panel.tsx）:
  - Boolean: checkbox
  - Integer/Number: number input + min/max
  - String: text input
  - String enum: dropdown + enumDescriptions
  - Secret string: password input
  - Array/Object: JSON 展示

状态设计（来自现有 settings-panel.tsx）:
  - configs: CoreConfigEntry[]（Core 配置列表）
  - userValues: Record<string, unknown>（user scope）
  - workspaceValues: Record<string, unknown>（workspace scope）
  - dirtyMap: Map<string, unknown>（未保存修改）
  - validationErrors: Record<string, string[]>

Core API 调用（通过 WebSocket）:
  - core.call('config.list')                    → 获取 Core 配置列表
  - core.call('config.set', { key, value })     → 设置配置值
  - core.call('config.reset', { key })          → 重置单键
  - core.call('plugin.config.get', { pluginId })→ 获取插件配置
  - core.call('plugin.config.set', { pluginId, key, value }) → 设置插件配置
```

---

## 三、Plugin Manager — 插件列表页 ✅ 已实现

### 信息架构

```
Plugin Manager
├── 插件列表（通过 GET /api/apps/list 加载）
│   ├── 系统插件（type: system）
│   │   ├── 可禁用（非灰色）
│   │   ├── 显示状态 + 版本
│   │   └── 不可卸载
│   └── 功能插件（type: plugin）
│       ├── 插件名 / ID / 版本
│       ├── 状态标签（enabled / disabled）
│       ├── 启用/禁用 toggle（PUT /api/apps/[appId]/state）
│       ├── 点击 → Plugin Detail 页
│       └── 排序/过滤
│
└── 插件操作
    ├── 启动时自动 sync（syncAllPlugins 在 mount 时调用）
    ├── 启用/禁用即时热重载（unregister + register 贡献）
    └── Slot Registry 自动清理（unfill on disable）
```

### App Registry API 映射

| UI 操作 | API | 说明 |
|---------|-----|------|
| 加载插件列表 | `GET /api/apps/list` | 服务端扫描 `plugins/*/plugin.yaml`，不依赖 Core |
| 读取启用状态 | `GET /api/apps/[appId]/state` | 读取 `.sessionbridge/app-state.json` |
| 启用/禁用 | `PUT /api/apps/[appId]/state` | 设置 `{ enabled: boolean }` |
| 同步贡献 | `syncAllPlugins()` | 遍历所有已启用 app，调用 `registerAppContributions()` |
| 插件配置读取 | `core.call('plugin.config.get', { pluginId })` | 通过 WebSocket 调用 Core |

> **与原设计的差异**：原设计使用 `plugin.list` / `plugin.enable` / `plugin.disable` 等 Core
> plugin.* 能力。实际完全改用 App Registry API（REST + 文件系统），只有配置读写仍走 WebSocket
> Core 调用（`plugin.config.get` / `plugin.config.set`）。

### Failure States

| 状态 | UI 表现 |
|------|--------|
| loading | skeleton 列表 |
| error | "无法加载插件列表" + 错误详情 + 重试 |
| empty | "未安装任何插件" + 安装引导 |
| enable 失败 | 插件卡片显示错误标记 + 错误消息 |
| disable 失败 | 同上 |

---

## 四、Plugin Detail — 详情页 ✅ 已实现（5 个 Tab）

### 页面结构

```
Plugin Detail（顶部）
├── 标题区：插件图标 + 名称 + 版本 + 状态 badge
├── 操作按钮：启用/禁用、卸载
│
└── Tab 导航（实际 5 个，非原设计的 8 个）
    ├── Permissions   ← 权限列表（summary bar + 模式图标 + hover tooltips）  ✅
    ├── Capabilities  ← 按 permission group 分组展示所有 capabilities       ✅
    ├── Dependencies  ← 环境检查结果（DependencyPanel）                     ⚠️ 部分实现
    ├── Installed     ← 已安装软件跟踪（二进制路径/版本/校验）                ✅ 新增
    └── Config        ← 插件配置项（Core API driven）                       ✅
```

> **与原设计的差异**：原设计列了 8 个 tab（Overview, Environment, Permissions, Files, Cache,
> Settings, Logs, History）。实际只实现了 5 个，删除了 Overview、Files、Cache、Logs、History
> tab。依赖检查（Environment）被重命名为 Dependencies。Settings 重命名为 Config。
> 新增了 Capabilities 和 Installed tabs。

### Core API 映射

| Tab | API | 说明 |
|-----|-----|------|
| Permissions | `plugin.permissions.list { pluginId }` | 权限声明 + 授权状态 |
| Permissions | `plugin.permissions.grant { pluginId, permissionId }` | 授予权限（待实现） |
| Permissions | `plugin.permissions.revoke { pluginId, permissionId }` | 撤销权限（待实现） |
| Capabilities | `GET /api/apps/list` → 从 manifest 提取 | 读取 plugin.yaml 声明的 capabilities |
| Dependencies | `plugin.check { pluginId }` | 环境检查 |
| Installed | `GET /api/apps/[appId]/installed` | 已安装软件记录 |
| Installed | `PUT /api/apps/[appId]/installed` | 记录安装/验证结果 |
| Config | `plugin.config.schema { pluginId }` | 配置 schema |
| Config | `plugin.config.get { pluginId }` | 当前配置值 |
| Config | `plugin.config.set { pluginId, key, value }` | 保存配置 |

### Tab 详情

**Permissions tab**
- 组件：`PluginPermissionPanel`
- 显示所有 permission 条目，每个包含 ID、描述、capabilities 列表、grant 状态
- 权限模式徽标：`allow` → `success` 绿色、`ask` → `warning` 黄色、`deny` → `danger` 红色
- Summary bar：显示 N 个 permission groups，M 个 capabilities 总数
- 模式图标依赖：`ShieldCheck`（allow）、`ShieldX`（deny）、`ShieldAlert`（ask）
- Hover tooltip 显示详细说明

**Capabilities tab**
- 从 manifest `core.permissions` 读取
- 按 permission group 分组展示
- 每个 capability 显示为 badge
- 来源：`GET /api/apps/list` 返回的 `capabilities` 数组

**Dependencies tab** ⚠️ 部分实现
- 组件：`DependencyPanel`（由 `app/console/plugin-host/launchability.ts` 驱动）
- 调用 `core.call('plugin.check', { pluginId })` 获取环境检查结果
- 显示 binary 检查结果（found / not found、版本、路径）
- 可选依赖标记 `(optional)`
- 安装引导链接（installHint）

**Installed tab** ✅ 新增
- 组件：`InstalledSoftwarePanel`
- 显示每个已安装记录的：binary、version、path、installedAt
- 每个记录有 `verify` 按钮（rerun `env.which` → `PUT /api/apps/[appId]/installed` 更新）
- `stale` 标记（binary 不再存在时标记）
- API：`GET/PUT /api/apps/[appId]/installed`

**Config tab**
- 组件：`PluginConfigForm`
- 调用 `plugin.config.get` / `plugin.config.schema` 获取配置
- 显示所有属性（key、type、当前值）
- Save 按钮 → `plugin.config.set` 逐键保存
- 保存结果反馈（Saved / 错误消息）

---

## 五、Environment Check — 环境检测 ⚠️ 部分实现

```
UX:
  - 在 Dependencies tab 中显示环境检查结果
  - 调用 Core `plugin.check` 获取结果
  - 显示结果列表：
    ✓ claude v0.21.0（满足 >= 0.20.0）
    ✓ git v2.39.0（满足 >= 2.0.0）
    ✗ docker（未安装，可选依赖）— 显示 "未安装（可选）"
  - 重新检查按钮（需要 reload plugin）

Core 调用：
  core.call('plugin.check', { pluginId: "claude-code" })
  → Response: {
      checks: [
        { type: "binary", name: "claude", required: ">= 0.20.0", current: "0.21.0", met: true },
        { type: "binary", name: "docker", required: "", current: null, met: false, optional: true }
      ],
      timestamp: 1712345678000
    }

UI 不做的事：
  ✗ UI 不自己跑 which/binary 检查
  ✗ UI 不自己解析版本号
  ✗ UI 不自己判断是否满足
```

> **状态说明**：已实现 `DependencyPanel` 组件，通过 `plugin.check` Core 调用获取环境检查结果。
> 但 `installHint` 引导、"manual install" 链接等功能尚待完善。

---

## 六、Install Plan — 安装计划 📋 设计阶段

```
UX — Plan 步骤:
  Step 1 / 4: 检查依赖环境        ✓ 完成
  Step 2 / 4: 下载安装包           → 进行中 (45%)
  Step 3 / 4: 安装依赖             ⏳ 等待
  Step 4 / 4: 验证安装             ⏳ 等待

  风险提示：
    ⚠ 将安装 claude CLI（~150MB）
    ⚠ 需要 sudo 权限
    ⚠ 将修改 PATH 环境变量

  [取消]  [执行安装]

Plan → Execute 流程：
  用户点"执行安装" → Core 创建 Task → WebSocket 推送进度

Core 调用（设计）：
  1. plugin.install.plan { pluginId }
     → Response: { planId, steps, risks, estimatedTime }

  2. plugin.install.execute { planId }
     → Response: { taskId }

  3. WebSocket: task.event {
      taskId, status: "running", progress: 45,
      message: "Downloading claude-cli v0.21.0..."
    }

UI 不做的事：
  ✗ UI 不自己跑 npm install
  ✗ UI 不自己下载文件
  ✗ UI 不自己判断"是否已安装"
  ✗ UI 不自己管理依赖
```

> **状态说明**：此功能尚未实现。目前通过 Dependencies tab 让用户手动安装缺失依赖，
> 安装计划/执行流程待 Core API 完善后实现。

---

## 七、Install Execute — 安装执行 📋 设计阶段

```
执行时 UI 状态:
  - 进度条（百分比）
  - 实时日志流（每行标记 ✓ ✗ → ⏳）
  - 当前步骤高亮
  - 取消按钮（如果支持）

完成 UI 状态:
  ✓ 安装成功
    - 安装耗时
    - 安装文件位置
    - "打开插件详情" 按钮

  ✗ 安装失败
    - 失败步骤 + 错误消息
    - "查看完整日志" 按钮
    - "重试" 按钮
    - "手动安装说明" 链接

  ⚠ 部分成功
    - 成功项 / 失败项 分开显示
    - 建议操作
```

> **状态说明**：全部未实现，依赖 Install Plan 完成。

---

## 八、Install History — 安装历史 ⚠️ 部分实现

```
UX:
  时间线视图（从最新到最旧）:

  [2026-05-19 10:30] 更新 v1.0.0 → v1.1.0   ✓ 成功
    详情: 更新了 2 个依赖，耗时 45s

  [2026-05-18 15:20] 安装 v1.0.0              ✓ 成功
    详情: 安装了 3 个依赖，耗时 2m 30s

  [2026-05-17 09:00] 安装 v1.0.0-rc           ✗ 失败
    详情: binary claude 未满足 >= 0.20.0
    [查看日志]

Core 调用:
  plugin.history { pluginId, limit: 50 }
  → Response: {
      history: [
        { timestamp, action: "install" | "update" | "repair",
          fromVersion, toVersion, status: "success" | "failed",
          details, logPath, duration }
      ]
    }
```

> **状态说明**：`PluginInstallHistoryPanel` 组件已实现并注册到 host component registry，
> 但 Go Core 返回 `not_implemented` 状态，UI 显示"History tracking not available in Phase 1"。
> 实际 API `plugin.history` 尚未在 Core 侧实现。

---

## 九、Files / Cache / Artifacts — 文件/缓存/工件 📋 设计阶段

### Files Tab

```
├── 注册的文件位置
│   ├── config: ~/.sessionnode/plugins/claude-code/config.yaml
│   │   └── [复制路径] [在资源管理器中打开]
│   ├── data: ~/.sessionnode/plugins/claude-code/data/
│   │   └── [复制路径] [在资源管理器中打开]
│   └── logs: ~/.sessionnode/plugins/claude-code/logs/
│       └── [复制路径] [在资源管理器中打开]
│
└── 文件访问历史（access-history.jsonl）
    ├── 2026-05-19 10:30: session sess_abc → 读取 config.yaml
    ├── 2026-05-19 10:15: session sess_def → 写入 cache/tmp.dat
    └── ...
```

### Cache Tab

```
├── 缓存条目列表
│   ├── models/claude-sonnet-4.bin   1.2GB  2026-05-18
│   │   └── [查看详情]
│   ├── tmp/build-cache/             45MB   2026-05-17
│   │   └── [查看详情]
│   └── ...
│
└── 操作
    ├── [清理全部缓存]
    ├── [清理选中的缓存]
    └── [生成清理计划] → 显示: "将释放 1.3GB 空间" → [确认清理]

Core 调用（设计）:
  plugin.cache.list { pluginId }
  → Response: { entries: [{ key, path, size, created, lastAccess }, ...] }

  plugin.cache.clear.plan { pluginId, entryKeys?: [...] }
  → Response: { planId, freedSpace, entries: [{ key, size }] }

  plugin.cache.clear.execute { planId }
  → Response: { taskId } (异步)
```

### Artifacts Tab

```
├── 下载工件列表
│   ├── claude-cli-v0.21.0-linux-x64.tar.gz  150MB  2026-05-18 10:30
│   │   └── [删除]
│   ├── claude-cli-v0.20.0-linux-x64.tar.gz  145MB  2026-05-17 15:00
│   │   └── [删除]
│   └── ...

Core 调用（设计）:
  plugin.artifacts.list { pluginId }
  → Response: { artifacts: [{ name, size, downloadedAt, sourceUrl }, ...] }

  plugin.artifacts.delete { artifactName }
  → Response: { success: true }
```

> **状态说明**：Files/Cache/Artifacts 均为设计阶段，未实现 UI。组件 `PluginFilesTable` 和
> `PluginCacheTable` 已注册到 host component registry 但不会在实际 Tab 导航中展示
>（Tab 导航只包含 5 个已实现的 tab）。

---

## 十、Permissions — 权限管理 ✅ 已实现

### PermissionPanel（已实现）

```
权限列表（PluginPermissionPanel）:
  ┌─────────────────────────────────────────────────┐
  │  claude.binary                              ask  │
  │  允许启动 claude 二进制                          │
  │  [process.spawn]                                │
  │  grant: not set                                 │
  ├─────────────────────────────────────────────────┤
  │  workspace.read                             allow │
  │  读取工作目录文件                                │
  │  [fs.list] [fs.read]                            │
  │  grant: allow                                   │
  ├─────────────────────────────────────────────────┤
  │  claude.config.read                          deny │
  │  读取 ~/.claude 配置                            │
  │  [fs.read] [env.home]                           │
  │  grant: deny                                    │
  └─────────────────────────────────────────────────┘

UI 特性:
  - 每个权限显示: id, description, capabilities(badge), default mode, grant state
  - 权限模式徽标颜色: allow=success(green), ask=warning(amber), deny=warning(red)
  - Summary bar: "N permission groups, M capabilities total"
  - 模式图标: ShieldCheck(allow), ShieldX(deny), ShieldAlert(ask)
  - Hover tooltip 显示详细描述
```

### Core API 调用

```
component PluginPermissionPanel:
  core.call('plugin.permissions.list', { pluginId })
  → Response: { permissions: [{ id, label, description, capabilities,
      constraints, default, grant? }] }

后续实现（当前 UI 未调用的写操作）:
  core.call('plugin.permissions.grant', { pluginId, permissionId, mode })
  → Response: { success: true }

  core.call('plugin.permissions.revoke', { pluginId, permissionId })
  → Response: { success: true }
```

> **与原设计的差异**：原设计 mockup 显示较大表格和"已授权/待定"状态格。实际实现使用了 Card
> 布局 + Badge 徽标，更紧凑。写操作（grant/revoke）UI 尚未接入，但 PermissionPanel 渲染
> grant 状态。

### 权限弹窗（首次安装）📋 设计阶段

```
┌─────────────────────────────────────────────┐
│  插件 "claude-code" 需要以下权限:             │
│                                              │
│  ☑ 允许启动 claude 二进制                    │
│     process.spawn                            │
│                                              │
│  ☑ 读取工作目录文件                          │
│     fs.list, fs.read                         │
│     路径约束: /home/user/project/**          │
│                                              │
│  ☐ 读取 ~/.claude 配置                      │
│     fs.read, env.home                        │
│                                              │
│  [☑ 记住我的选择]                           │
│                                              │
│          [拒绝全部]     [确认授权]            │
└─────────────────────────────────────────────┘
```

> **状态说明**：首次安装权限弹窗尚未实现。当前权限授予通过 `PUT /api/apps/[appId]/state`
> 写入 `grants` 字段。

---

## 十一、Config Schema — 配置项注册 ✅ 已实现

插件通过 manifest 声明配置项 schema，**路径为 `adapters.system-ui.configuration`**（非 `contributes.configuration`）：

```yaml
# plugins/terminal/plugin.yaml
adapters:
  system-ui:
    configuration:
      title: "Terminal"
      properties:
        defaultShell:
          type: string
          default: "powershell"
          description: "Default shell to spawn"
        fontSize:
          type: integer
          default: 13
          minimum: 8
          maximum: 52
          description: "Terminal font size (px)"
        cursorBlink:
          type: boolean
          default: false
          description: "Enable cursor blinking"
```

```yaml
# plugins/mesh/plugin.yaml
adapters:
  system-ui:
    configuration:
      title: "Mesh"
      properties:
        autoReconnect:
          type: boolean
          default: true
          description: "Auto-reconnect to relay on disconnect"
        heartbeatInterval:
          type: integer
          default: 30
          minimum: 5
          maximum: 300
          description: "Heartbeat interval (seconds)"
```

实际使用的 API（通过 Core WebSocket）：

```
core.call('plugin.config.get', { pluginId })
  → { config: { defaultShell: "powershell", fontSize: 13, ... } }

core.call('plugin.config.schema', { pluginId })
  → { schema: { title: "Terminal", properties: { ... } } }

core.call('plugin.config.set', { pluginId, key: "fontSize", value: 14 })
  → { success: true }
```

> **与原设计的差异**：
> 1. YAML 路径：原设计写 `contributes.configuration`，实际为 `adapters.system-ui.configuration`
> 2. 键名格式：原设计用点号路径如 `plugin.claude-code.theme`，实际直接用属性名如 `defaultShell`
> 3. 读取方式：原设计走 `config.get` 全局 API，实际走 `plugin.config.get` 按插件隔离

---

## 十二、Slot Registry — 插槽注册系统 ✅ 已实现（新增章节）

### 概念

Slot Registry 是一个纯 TypeScript 数据层（无 React，无 DOM），用于管理插件的扩展点声明和填充。

### 文件位置

- `lib/slot-registry/slot-registry.ts` — `SlotRegistry` 类 + 单例 `slotRegistry`
- `lib/slot-registry/slot-types.ts` — `SlotDeclaration` 和 `SlotFilling` 类型

### 核心 API

| 方法 | 用途 |
|------|------|
| `declare(decl)` | 注册一个插槽声明（谁声明了什么扩展点） |
| `undeclare(slotId)` | 移除声明及其所有填充 |
| `fill(filling)` | 填充一个插槽（目标未知时进入 orphan 列表） |
| `unfill(pluginId)` | 移除某插件所有填充（禁用时调用） |
| `getFillings(slotId)` | 获取某插槽的所有填充（按 order 排序） |
| `getUnfilledSlots()` | 获取没有填充的插槽 |
| `getOrphans()` | 获取填充了未声明插槽的记录（+ console.warn） |
| `getAll()` | 快照整个注册表状态 |

### 插槽声明

Settings Panel 在首次渲染时声明以下插槽：

```
settings.section.system.connection  (declaredBy: settings-panel)
settings.section.system.about       (declaredBy: settings-panel)
settings.section.plugin-config      (declaredBy: settings-panel)
settings.section.core               (declaredBy: settings-panel)
settings.section.updates            (declaredBy: settings-panel)
```

### 插槽填充

当插件 sync 时，`plugin-sync.ts` 读取 `adapters.system-ui.configuration` 并调用：

```typescript
slotRegistry.fill({
  slotId: 'settings.section.plugin-config',  // 目标插槽
  fillingId: 'terminal.config',              // 填充 ID
  pluginId: 'terminal',                      // 来源插件
  content: { pluginId, pluginName, title, properties },
  order: type === 'system' ? 10 : 20,       // 系统插件优先
});
```

### Orphan 检测

- 当插件填充了一个尚未声明的插槽 → 进入 orphan 列表 + `console.warn`
- 当插槽后来被声明 → orphan 自动迁移到正常填充
- 当插槽被移除 → 相关填充自动清理

### 生命周期

| 事件 | 操作 |
|------|------|
| 插件启用 | `syncAllPlugins()` → `fill()` |
| 插件禁用 | `unregisterApp()` → `unfill(pluginId)` |
| 插槽声明者卸载 | `undeclare(slotId)` |
| 重新同步 | 全部 `unfill` → 重新 `fill` |

### Developer Tools

`SlotDevTools` 组件（仅在 `NODE_ENV=development` 时显示）：

- 文件：`app/console/settings/slot-devtools.tsx`
- 展示 4 个可折叠区域：
  - **Declarations** — 所有已注册插槽声明（ID + 声明者）
  - **Fillings** — 按插槽分组的填充列表（ID + 插件 + order）
  - **Unfilled Slots** — 没有填充的插槽（amber 标记）
  - **Orphaned Fillings** — 孤儿填充（red 标记 + 警告说明）
- 刷新按钮重新读取 registry 快照

---

## 十三、Install Tracking — 安装跟踪 ✅ 已实现（新增章节）

### 概述

每个插件的已安装软件通过服务端持久化 JSON 文件跟踪。不依赖 Core，完全由 App Registry API 管理。

### API

```
GET  /api/apps/[appId]/installed  → 获取已安装软件列表
PUT  /api/apps/[appId]/installed  → 记录或更新已安装软件
```

### 数据结构

```typescript
interface InstalledSoftwareEntry {
  id: string;          // 随机 hex ID
  checkId: string;     // 依赖检查标识（对应 plugin.yaml 的 environment.checks[].id）
  name: string;        // 软件名
  binary: string;      // 二进制名
  version: string;     // 版本
  path: string;        // 安装路径
  installedAt: number; // 时间戳
  sizeBytes?: number;  // 大小
  stale?: boolean;     // 验证时发现 binary 不存在
}
```

### 存储位置

`.sessionbridge/installed-apps.json` — 按 appId 分组：

```json
{
  "claude-code": [
    {
      "id": "a1b2c3d4e5f6",
      "checkId": "claude-binary",
      "name": "Claude CLI",
      "binary": "claude",
      "version": "0.21.0",
      "path": "/usr/local/bin/claude",
      "installedAt": 1712345678000,
      "stale": false
    }
  ]
}
```

### Verify 流程

1. 用户点击 Verify 按钮
2. 前端调用 `env.which(binary)`（通过 Core `env.check` 或服务端 API）
3. 如果找到 → `PUT /api/apps/[appId]/installed` 更新 version/path/installedAt
4. 如果未找到 → 标记 `stale: true`

### Integration

- `DependencyPanel` 在安装成功后调用 `PUT /api/apps/[appId]/installed`
- `InstalledSoftwarePanel` 展示所有记录，每条有 verify 按钮
- `PluginDetail` 的 Installed tab 直接链接到此面板

---

## 十四、Logs — 插件日志查看 📋 设计阶段

```
UX:
  - 源切换: Core / Audit / Session（默认显示当前插件日志）
  - 自动过滤 pluginId 为当前插件
  - 级别过滤: info / warn / error
  - 实时 tail
  - 点击展开完整 JSON

Core 调用（设计）:
  logs.query { source: "plugin", pluginId: "claude-code", level: "error", limit: 100 }
  → Response: { lines: [{ ts, level, msg, pluginId, ... }] }
```

> **状态说明**：全部未实现，不属于当前 PluginDetail 的 5 个 tab 之一。

---

## 十五、Failure States 汇总

| 场景 | UI 表现 |
|------|--------|
| Core 未连接 | 整个设置页/插件管理页显示 "Core 未连接"，操作按钮禁用 |
| 权限不足 | 操作按钮显示 "无权限"，hover 显示原因 |
| 加载中 | skeleton 或 spinner，不阻塞页面其他部分 |
| 空状态 | "未安装插件" + 引导 / "没有日志" / "没有缓存" |
| 操作失败（网络） | "操作失败" + 重试按钮 |
| 操作失败（Core 拒绝） | 显示 Core 返回的错误消息 |
| 部分失败（批量操作） | 成功项 + 失败项分开显示 |
| 并发冲突 | 显示 "配置已被其他操作修改，请刷新" |
| 超时 | "操作超时" + 查看日志链接 |
| 插件已卸载 | 自动刷新列表，插件条目消失 |
| Slot orphan 检测 | console.warn + SlotDevTools 红色面板 |

---

## 附件：实现状态总览

| 章节 | 功能 | 状态 | 关键文件 |
|------|------|------|---------|
| 一 | Settings IA | ✅ 已实现 | `app/console/shell/settings-panel.tsx` |
| 二 | ConfigField 复用 | ✅ 已实现 | `app/console/shell/settings-panel/shared.tsx` |
| 三 | Plugin Manager 列表 | ✅ 已实现 | `app/api/apps/list/route.ts`, `app/lib/app-registry/plugin-sync.ts` |
| 四 | Plugin Detail 页 | ✅ 已实现 | `app/console/plugin-host/host-component-registry.tsx` |
| 五 | Environment 检查 | ⚠️ 部分实现 | `app/console/plugin-host/launchability.ts` |
| 六 | Install Plan | 📋 设计阶段 | — |
| 七 | Install Execute | 📋 设计阶段 | — |
| 八 | Install History | ⚠️ 部分实现 | `host-component-registry.tsx` (UI 存在, Core 未实现) |
| 九 | Files/Cache/Artifacts | 📋 设计阶段 | — |
| 十 | Permissions | ✅ 已实现 | `host-component-registry.tsx` (PluginPermissionPanel) |
| 十一 | Config Schema | ✅ 已实现 | `lib/slot-registry/`, `app/lib/app-registry/plugin-sync.ts` |
| 十二 | Slot Registry | ✅ 已实现 | `lib/slot-registry/` |
| 十三 | Install Tracking | ✅ 已实现 | `app/api/apps/[appId]/installed/route.ts` |
| 十四 | Logs | 📋 设计阶段 | — |
