# SessionNode Plugin Management

> 插件管理操作：API 设计、CLI 命令、UI 展示要求、数据流示例
>
> **本文档聚焦管理操作**，不重复定义 manifest/生命周期/存储/安全。
> 插件声明 → [PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md)
> 生命周期 → [PLUGIN_LIFECYCLE.md](./PLUGIN_LIFECYCLE.md)
> 存储缓存 → [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md)
> 安全模型 → [PLUGIN_SECURITY_MODEL.md](./PLUGIN_SECURITY_MODEL.md)

---

## 一、核心原则

### 插件管理是 Core 系统能力

```
Core 负责:                           TS/Web 负责 (状态参见下表):
  插件列表                              展示列表/详情/配置 UI
  启用/禁用                             调用 enable/disable API
  环境/依赖检测                          渲染检测结果 + Install 按钮
  安装计划生成                          展示安装计划
  安装执行                              调用 install API
  安装历史                              展示历史记录
  权限校验与存储                          渲染权限管理 UI (PermissionPanel)
  配置管理                              渲染配置表单 (PluginConfigForm)
  文件操作记录 (规划中)                    渲染文件面板 (规划中)
  缓存清理执行 (规划中)                    渲染缓存面板 (规划中)
  健康状态                              展示状态指示
```

```
UI/CLI 不直接判断插件是否可用。
UI/CLI 调用 Core 的 plugin.* API (或通过 Next.js API Routes 中转)。
Web 设置页只是 Core 的控制面。
CLI 也是 Core 的控制面，和 Web 调同一套能力。
```

#### 当前实现状态

| 功能 | 状态 |
|------|------|
| 展示插件列表 | ✅ AppManager 列表页 (`GET /api/apps/list`) |
| 启用/禁用 | ✅ AppManager toggle (`setEnabled()`) |
| 环境检测 | ✅ DependencyPanel + `useDependencyCheck()` |
| 渲染安装引导 | ⚠️ 部分 (DependencyPanel 有 Install 按钮，无正式 InstallPlan 展示) |
| 渲染权限管理 UI | ✅ PermissionPanel (Allow/Ask/Deny 三级循环切换) |
| 渲染文件/缓存面板 | ❌ 未实现 |
| 渲染配置编辑 | ✅ PluginConfigForm + PluginSettingsGroup |
| 插件业务页面 (PluginDetail) | ✅ 5 tabs: Permissions / Capabilities / Dependencies / Installed / Config |
| 安装追踪 | ✅ InstalledSoftwarePanel + `GET/PUT /api/apps/[appId]/installed` |
| Capabilities 展示 | ✅ PluginDetail Capabilities tab |
| Slot Registry DevTools | ✅ SlotDevTools (development mode only) |

### 分界

```
Plugin Management = Core 系统能力
Plugin Experience = TS 表达层能力

Core 知道插件的声明、状态、权限、文件、缓存、安装历史。
Core 不理解插件的业务含义。
插件自己决定业务文件如何展示、清理、切换和使用。
```

---

## 二、插件状态模型（Go 实现参考）

### PluginDefinition

插件声明，来自 `plugin.yaml`。安装后持久化到 registry。

```go
type PluginDefinition struct {
    ID      string `json:"id"`
    Title   string `json:"title"`
    Version string `json:"version"`
    Kind    string `json:"kind"` // "web" | "cli" | "web+cli" | "headless"

    Description string `json:"description,omitempty"`
    Author      string `json:"author,omitempty"`
    Homepage    string `json:"homepage,omitempty"`

    Requires struct {
        Capabilities []string           `json:"capabilities"`
        Dependencies []PluginDependency `json:"dependencies"`
    } `json:"requires"`

    Permissions []PluginPermissionDecl `json:"permissions"`
    Files       []PluginFileDecl       `json:"files,omitempty"`
    Caches      []PluginCacheDecl      `json:"caches,omitempty"`

    Web *WebManifest `json:"web,omitempty"`
    CLI *CLIManifest `json:"cli,omitempty"`
}
```

### PluginInstallation

插件在某个 node 上的安装状态。

```go
type PluginInstallation struct {
    PluginID     string `json:"pluginId"`
    NodeID       string `json:"nodeId"`
    Status       string `json:"status"`
    // installed | not_installed | missing_dependency | failed | needs_permission | needs_config
    Enabled      bool   `json:"enabled"`
    Version      string `json:"version"`
    InstalledAt  *int64 `json:"installedAt,omitempty"`
    UpdatedAt    *int64 `json:"updatedAt,omitempty"`
    Error        string `json:"error,omitempty"`
}
```

完整状态机定义参见 [PLUGIN_LIFECYCLE.md](./PLUGIN_LIFECYCLE.md#状态机)。

### PluginEnvironment

插件依赖检测结果。

```go
type PluginEnvironment struct {
    PluginID     string                  `json:"pluginId"`
    NodeID       string                  `json:"nodeId"`
    CheckedAt    int64                   `json:"checkedAt"`
    Status       string                  `json:"status"`
    // ok | missing | partial | error
    Dependencies []DependencyCheckResult `json:"dependencies"`
}

type DependencyCheckResult struct {
    ID       string `json:"id"`
    Type     string `json:"type"`     // "binary" | "npm" | "file" | "env"
    Name     string `json:"name"`
    Found    bool   `json:"found"`
    Version  string `json:"version,omitempty"`
    Required string `json:"required,omitempty"`
    Path     string `json:"path,omitempty"`
    Error    string `json:"error,omitempty"`
    Optional bool   `json:"optional,omitempty"`
}
```

### PluginPermissionGrant

用户实际授予插件的权限。

```go
type PluginPermissionGrant struct {
    PluginID     string                 `json:"pluginId"`
    NodeID       string                 `json:"nodeId"`
    Capability   string                 `json:"capability"`
    Mode         string                 `json:"mode"`     // "allow" | "deny" | "ask"
    Constraints  *PermissionConstraints `json:"constraints,omitempty"`
    GrantedAt    int64                  `json:"grantedAt"`
    GrantedBy    string                 `json:"grantedBy"`
    ExpiresAt    *int64                 `json:"expiresAt,omitempty"`
}

type PermissionConstraints struct {
    Allow []string `json:"allow,omitempty"`
    Deny  []string `json:"deny,omitempty"`
    Keys  []string `json:"keys,omitempty"`    // config key patterns
}
```

### PluginInstallHistory

每次安装/升级/修复/卸载的记录。

```go
type PluginInstallHistory struct {
    InstallID    string `json:"installId"`
    PluginID     string `json:"pluginId"`
    NodeID       string `json:"nodeId"`
    Action       string `json:"action"`
    // "install" | "upgrade" | "repair" | "uninstall" | "uninstall_dependency"
    DependencyID string `json:"dependencyId,omitempty"`
    Method       string `json:"method,omitempty"`
    Command      string `json:"command,omitempty"`
    Status       string `json:"status"`
    // "pending" | "running" | "success" | "failed" | "cancelled"
    StartedAt    int64  `json:"startedAt"`
    FinishedAt   *int64 `json:"finishedAt,omitempty"`
    StdoutLog    string `json:"stdoutLog,omitempty"`
    StderrLog    string `json:"stderrLog,omitempty"`
    Result       string `json:"result,omitempty"`
    Actor        string `json:"actor"`
    ApprovalID   string `json:"approvalId,omitempty"`
    Error        string `json:"error,omitempty"`
}
```

### 副作用记录类型

参见 [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md#安装侧写记录) 的 DeclaredLocation / PlannedArtifact / DiscoveredSideEffect 定义。

---

## 三、Manifest 文件与缓存声明

> 完整 manifest 格式参见 [PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md)
> 文件/缓存声明细节参见 [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md)

以下仅记录 PLUGIN_MANIFEST_SPEC.md 中未覆盖的 **运行时行为**：

### 文件字段说明

```yaml
files:
  - id:          # 唯一标识，插件内不重复
    type:         # history | config | state | cache | log | workspace-context | artifact | external
    path:         # 文件路径，支持 ${workspace} 等变量
    description:  # 人类可读的描述
    visibility:   # system | settings | workspace | user
    clearable:    # 是否可以清理
    defaultPanel: # UI hint，建议在哪个面板展示
```

### 运行时动态登记

插件可以在运行时注册 manifest 中没有的文件位置（`plugin.files.register`）：

```json
{
  "type": "action.request",
  "requestId": "req_200",
  "pluginId": "claude-code",
  "capability": "plugin.files.register",
  "payload": {
    "id": "claude-session-temp-20260519",
    "fileType": "artifact",
    "path": "${workspace}/.claude/sessions/temp_20260519",
    "description": "Temporary session output",
    "visibility": "workspace",
    "clearable": true
  }
}
```

Core 记录后纳入文件注册表。

---

## 四、文件操作记录系统

> 完整定义参见 [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md#安装侧写记录)

### 记录范围

只要插件通过 Core 的 fs API 访问文件/缓存/配置，Core 必须有记录：

| API | 记录内容 |
|-----|---------|
| `fs.read` | pluginId, nodeId, path, action=read, timestamp |
| `fs.write` | pluginId, nodeId, path, action=write, timestamp |
| `fs.delete` | pluginId, nodeId, path, action=delete, timestamp |
| `fs.list` | pluginId, nodeId, path, action=list, timestamp |
| `plugin.files.register` | pluginId, nodeId, path, fileType, source=runtime |
| `plugin.cache.clear` | pluginId, nodeId, path, action=delete, cacheID |

### 记录格式

```json
// ~/.sessionnode/plugins/claude-code/files/access-history.jsonl
{"pluginId":"claude-code","nodeId":"node_abc","path":"~/.claude/settings.json","action":"read","timestamp":1712345678000,"requestId":"req_123","allowed":true}
```

### 什么不记录

- 通过 `stream.*` 传输的数据不记录（那是 session payload）
- 通过 `config.get` 读取配置不按 path 记录（但按 key 记录 audit）

---

## 五、缓存清理设计

> 完整缓存管理参见 [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md#缓存管理)

### 两种清理方式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `core` | Core 直接 `fs.delete` | 普通目录/文件缓存 |
| `plugin` | Core 调用插件定义的清理 action | 需要业务逻辑的清理 |

### 清理计划

```json
{
  "cacheId": "claude-plugin-cache",
  "path": "~/.sessionnode/plugins/claude-code/cache",
  "estimatedSize": "12.5 MB",
  "estimatedEntries": 42,
  "mode": "core",
  "risk": "low",
  "requiresApproval": true,
  "postAction": "Plugin will recreate cache on next use"
}
```

### 清理后的重建

是否可重建由插件定义。Core 只负责执行或协调清理、记录结果、重新扫描大小。

---

## 六、安装流程与历史

> 完整安装生命周期参见 [PLUGIN_LIFECYCLE.md](./PLUGIN_LIFECYCLE.md#4-安装-install)

### 安装生命周期

```
1. plugin.check → Core 检测所有依赖 → 返回 PluginEnvironment
2. plugin.install.plan → Core 生成安装计划 → 返回 InstallPlan
3. 用户确认（notify.request / notify.respond）
4. plugin.install.execute → Core 执行安装命令 → 返回结果
5. plugin.check（重新检测）→ Core 再次检测 → 更新 PluginEnvironment
6. 完成 / 失败
```

### InstallPlan

```json
{
  "installId": "inst_20260519_001",
  "pluginId": "claude-code",
  "nodeId": "node_abc",
  "steps": [
    {
      "dependencyId": "claude-cli",
      "method": "npm",
      "command": "npm install -g @anthropic-ai/claude-code",
      "risk": "medium",
      "requiresApproval": true,
      "estimatedDuration": "30s",
      "notes": "Will install claude CLI globally via npm"
    }
  ],
  "totalRisk": "medium",
  "requiresApproval": true
}
```

### 安装历史查询

```bash
node plugin history claude-code
# inst_20260519_001  install    claude-cli  2026-05-19T10:00:00  success  30s
```

```bash
node plugin logs claude-code --install inst_20260519_001
# 输出安装时的 stdout/stderr
```

---

## 七、插件发现与注册配置

### Go Core 生产接线

Core 启动时通过 `PluginRegistry` 发现并加载插件：

```
main.go 接线流程:
  1. 加载 config → 读取 PluginConfig.PluginDirs + DisabledPlugins
  2. 初始化 PluginRegistry:
     pluginmanifest.NewPluginRegistry(dirs, disabled)
  3. PluginRegistry 扫描所有目录:
     - 遍历每个 pluginDirs 下的子目录
     - 每个子目录查找 plugin.yaml / plugin.json
     - 加载、解析、Validate
     - 跨插件冲突检测（DetectConflicts）
  4. 注册到 executor.Deps.Manifests:
     execDeps.Manifests = manifestReg
  5. 构建 capability map 供权限检查器:
     caps := manifestReg.CapabilityMap()
     permCaps = merge(caps, hardcodedFallback)
     permChecker = NewChecker(NewMapRegistry(permCaps), NewAllowAllPolicy(permCaps))
  6. 构建 dispatcher.PluginRegistry:
     从 manifestReg.ListPlugins() 生成 dispatcher.PluginEntry 列表
```

### 配置项

```go
// go-core/internal/config/config.go
type PluginConfig struct {
    PluginDirs      []string   `json:"pluginDirs,omitempty"`      // 插件扫描目录
    DisabledPlugins []string   `json:"disabledPlugins,omitempty"` // 禁用 ID 列表
    Permissions     map[string]map[string]PermissionGrant         // 权限配置
}
```

默认 `PluginDirs` 为 `["~/.sessionnode/plugins"]`，可通过 `SESSIONNODE_PLUGIN_DIRS` 环境变量覆盖。

### 发现行为总结

| 场景 | 行为 |
|------|------|
| 目录不存在 | 跳过，不报错 |
| 子目录无 plugin.yaml/json | 跳过 |
| YAML/JSON 解析错误 | 标记 error，不崩溃，LoadManifest 返回错误 |
| manifest 验证失败 | 记录 validation errors，插件在列表中但 error 状态 |
| 重复 pluginId（多目录） | 先发现的版本优先 |
| 禁用插件 | 加载 manifest 但 enabled=false，不出现在 capability map |
| 跨插件 ID 冲突 | DetectConflicts 报告到日志 |

---

## 八、落盘目录结构

> 完整目录结构及文件说明参见 [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md#目录结构)

```
~/.sessionnode/
├── config.yaml           # 全局配置（含 plugin grants）
├── node.db               # 节点持久化数据
├── downloads/            # Core 统一下载目录
├── plugins/              # 插件数据目录
│   ├── registry.json     # 所有已注册插件定义
│   ├── installed.json    # 所有插件的安装状态
│   └── {id}/             # 各插件数据
├── logs/                 # Core 及插件日志
└── sessions/             # Session 数据
```

### 文件说明

| 文件 | 用途 | 谁写 |
|------|------|------|
| `registry.json` | 所有注册插件的定义 | Core 启动时扫描写入 |
| `installed.json` | 所有插件的安装状态 | Core 安装/启用/禁用时写入 |
| `plugins/{id}/state.json` | 插件运行时状态 | Core 操作插件时写入 |
| `plugins/{id}/permissions.json` | 插件权限 | Core grant/revoke 写入 |
| `plugins/{id}/files/access-history.jsonl` | 文件操作审计 | Core fs API 写入 |
| `plugins/{id}/install/*/` | 安装记录 | Core install 写入 |
| `plugins/{id}/history.jsonl` | 统一历史 | Core 写所有操作 |
| `plugins/{id}/env-checks/` | 环境检测 | Core plugin.check 写入 |

---

## 九、API 设计

### 消息类型

```
===== 插件管理 =====
plugin.list                  — 列出所有插件
plugin.get                   — 获取插件详情
plugin.enable                — 启用插件
plugin.disable               — 禁用插件

plugin.check                 — 环境检测
plugin.install.plan          — 生成安装计划
plugin.install.execute       — 执行安装
plugin.repair                — 修复安装
plugin.uninstall             — 卸载
plugin.history               — 安装历史
plugin.install.logs          — 安装日志

plugin.files.list            — 文件列表
plugin.files.register        — 注册文件位置
plugin.files.access          — 文件访问历史

plugin.cache.list            — 缓存列表
plugin.cache.info            — 缓存详情
plugin.cache.clear           — 清理缓存（Plan Before Apply）
plugin.cache.history         — 清理历史

plugin.permissions.get       — 权限列表
plugin.permissions.grant     — 授权
plugin.permissions.revoke    — 撤销

plugin.config.get            — 读取插件配置
plugin.config.set            — 写入插件配置

===== 内部使用 =====
plugin.files.record          — 记录文件访问（由 fs API 内部调用）
```

### HTTP API

```http
# 插件列表
GET /api/plugins
→ { plugins: [{ pluginId, title, version, status, enabled }] }

# 插件详情
GET /api/plugins/:pluginId
→ { plugin: PluginDefinition, installation: PluginInstallation, environment: PluginEnvironment? }

# 启用/禁用
POST /api/plugins/:pluginId/enable
POST /api/plugins/:pluginId/disable

# 环境检测
POST /api/plugins/:pluginId/check
Body: { nodeId?: string }
→ { environment: PluginEnvironment }

# 安装计划
POST /api/plugins/:pluginId/install/plan
Body: { nodeId?: string }
→ { plan: InstallPlan }

# 执行安装
POST /api/plugins/:pluginId/install/execute
Body: { installId: string }
→ { installId, status: "running" }

# 修复
POST /api/plugins/:pluginId/repair

# 安装历史
GET /api/plugins/:pluginId/history
→ { history: [PluginInstallHistory] }

# 安装日志
GET /api/plugins/:pluginId/install/:installId/logs
→ { stdout: "...", stderr: "..." }

# 文件列表
GET /api/plugins/:pluginId/files
→ { files: [PluginFileEntry], caches: [PluginCacheEntry] }

# 注册文件位置
POST /api/plugins/:pluginId/files/register
Body: { id, fileType, path, description, visibility, clearable }

# 缓存列表
GET /api/plugins/:pluginId/cache

# 清理缓存
POST /api/plugins/:pluginId/cache/clear
Body: { cacheId: string, mode: "core"|"plugin", action?: string }
→ 先返回清理计划，确认后执行

# 权限管理
GET  /api/plugins/:pluginId/permissions
POST /api/plugins/:pluginId/permissions/grant
Body: { capability, mode, constraints?, expiresAt? }
POST /api/plugins/:pluginId/permissions/revoke
Body: { capability }

# 插件配置
GET  /api/plugins/:pluginId/config
POST /api/plugins/:pluginId/config
Body: { key, value }
```

### CLI

```bash
# 列表
node plugin list
node plugin list --json

# 详情
node plugin show claude-code

# 环境检测
node plugin check claude-code
node plugin check claude-code --target vps

# 安装
node plugin install claude-code
node plugin install claude-code --target vps
node plugin install claude-code --dry-run

# 修复
node plugin repair claude-code

# 历史
node plugin history claude-code
node plugin logs claude-code --install inst_20260519_001

# 文件
node plugin files claude-code
node plugin files claude-code --target vps

# 缓存
node plugin cache claude-code
node plugin cache clear claude-code --entry claude-plugin-cache

# 权限
node plugin permissions claude-code
node plugin grant claude-code fs.read
node plugin revoke claude-code fs.read

# 配置
node plugin config get claude-code
node plugin config set claude-code defaultModel sonnet
```

---

## 十、权限设计（管理操作）

> 完整三层权限模型参见 [PLUGIN_SECURITY_MODEL.md](./PLUGIN_SECURITY_MODEL.md)

### Plugin Management 操作权限

管理插件本身的能力也需要权限：

| 权限 | 危险等级 | 说明 |
|------|---------|------|
| `plugin.list` | low | 查看插件列表 |
| `plugin.get` | low | 查看插件详情 |
| `plugin.enable` | medium | 启用插件 |
| `plugin.disable` | medium | 禁用插件 |
| `plugin.check` | low | 环境检测 |
| `plugin.install` | high | 安装依赖（执行命令） |
| `plugin.repair` | high | 修复安装 |
| `plugin.files.readRegistry` | low | 查看文件注册表 |
| `plugin.files.register` | medium | 注册文件位置 |
| `plugin.cache.list` | low | 查看缓存列表 |
| `plugin.cache.clear` | high | 清理缓存（删除文件） |
| `plugin.permissions.grant` | high | 授权权限 |
| `plugin.permissions.revoke` | high | 撤销权限 |

### 远程节点权限

```bash
node plugin check claude-code --target vps
```

流程：

```
1. CLI → 本机 Core
2. 本机 Core 校验 actor 有 plugin.check 权限
3. 本机 Core 路由到 vps
4. vps Core 收到 plugin.check 请求
5. vps Core 校验：请求方（本机 node）有权限在 vps 上执行 plugin.check
6. vps Core 执行检测
7. 结果原路返回
```

远程执行时，权限在目标节点上校验。relay 不绕过。

---

## 十一、Web UI 展示要求

### Settings / Plugins 页面

Settings 面板为右侧 Drawer 布局，不采用左侧嵌套树。

```
Settings (Drawer 布局)
├── ═══ UI SETTINGS (always available) ═══
├── Connection                         ← ConnectionSection: 端口配置 / 扫描 / 重连
├── About                              ← AboutSection: 版本信息
├── ═══ CORE SETTINGS (Core connected) ═══
├── Plugin Settings                    ← PluginSettingsGroup × N，slot registry 驱动
├── Core Settings                      ← config.list 搜索/编辑
├── Updates                            ← update.status / update.check
├── ═══ DEVTOOLS (development only) ═══
├── Slot Registry DevTools             ← SlotDevTools 调试面板
```

App 管理为独立页面 (AppManager)，通过 Sidebar "Apps" 入口进入：

```
Plugins / Apps (独立页面 — AppManager / PluginDetail)
├── [App 列表]                         ← GET /api/apps/list
│   ├── App 1 (点击 → PluginDetail)
│   │   ├── Tabs:
│   │   │   ├── Permissions Tab        ← PermissionPanel
│   │   │   │   ├── 分组标题 (perm.id + default mode)
│   │   │   │   ├── Description
│   │   │   │   └── 各行 capability + mode 切换 (Allow/Ask/Deny)
│   │   │   ├── Capabilities Tab       ← 按 permission 分组展示所有 capabilities + default mode
│   │   │   ├── Dependencies Tab       ← DependencyPanel
│   │   │   │   ├── Check 按钮
│   │   │   │   ├── 各依赖行 (found/missing + Install 按钮)
│   │   │   │   └── 安装完成后自动记录到 Installed
│   │   │   ├── Installed Tab          ← InstalledSoftwarePanel
│   │   │   │   ├── 已记录二进制列表 (binary / version / path / installedAt)
│   │   │   │   ├── Verify 按钮 (重新检测 -> 更新 stale 标记)
│   │   │   │   └── stale 标记 (二进制已移除或路径失效)
│   │   │   └── Config Tab             ← PluginConfigForm (从 Core 读取 schema)
│   │   └── 工具栏: Enable/Disable toggle
│   ├── App 2
│   └── ...
```

### Slot Registry DevTools

Settings 面板底部在 development 模式下显示 **Slot Registry DevTools**：

```
Slot Registry DevTools
├── Declarations                       ← 所有 slot 声明 (slotId + declaredBy)
├── Fillings                           ← 所有 slot 填充 (slotId → fillingId + pluginId)
├── Unfilled Slots                     ← 已声明但无填充的 slot
└── Orphaned Fillings                  ← 指向未声明 slot 的填充（警告）
```

数据源：`lib/slot-registry/slot-registry.ts` 中的 `SlotRegistry` 单例。

### 安装追踪

每次通过 DependencyPanel Install 按钮成功安装后自动记录：

- 调用 `env.which` 检测二进制路径和版本
- 写入 `PUT /api/apps/[appId]/installed`
- InstalledSoftwarePanel 展示，每行含 Verify 按钮重新检测
- 检测失败标记为 stale (黄色警告)

数据结构：
```typescript
interface InstalledSoftwareEntry {
  id: string;
  checkId: string;
  name: string;
  binary: string;
  version: string;
  path: string;
  installedAt: number;  // timestamp
  stale?: boolean;       // binary no longer found
}
```

### 安装结果展示

不能只显示"安装成功"。必须显示：

| 内容 | 数据来源 |
|------|---------|
| 安装了哪些依赖 | DependencyGraph |
| 下载了什么 | InstallArtifactRegistry |
| 写入了哪些位置 | InstallSideEffect → Declared + Planned + Discovered |
| 哪些是插件私有文件 | owner=plugin |
| 哪些是共享依赖 | owner=shared |
| 哪些是缓存 | fileType=cache |
| 哪些可安全清理 | clearable=true + risk=low |
| 哪些需要手动处理 | clearMode=manual-only |
| 安装历史 | PluginInstallHistory |
| 清理历史 | cleanup-history.jsonl |

### CLI 管理命令

```bash
# 查看安装产物
node plugin artifacts claude-code
node plugin artifacts claude-code --install inst_001

# 缓存管理
node plugin cache claude-code
node plugin cache claude-code --category cache
node plugin cache claude-code --category shared

# 清理计划
node plugin cleanup-plan claude-code

# 安装历史详情
node plugin history claude-code --verbose
node plugin history claude-code --install inst_001 --side-effects
```

---

## 十二、数据流示例

> **实现说明：** 以下示例使用假设的 `GET /api/plugins` 等 REST 端点示意流程。
> 实际实现中 App UI 通过以下 Next.js API Routes 与 Core 交互：
>
> | 用途 | 实际端点 | 说明 |
> |------|---------|------|
> | 列表 | `GET /api/apps/list` | 直接扫描 `plugins/*/plugin.yaml`，不依赖 Core |
> | 详情 | `GET /api/apps/[appId]` | 读取单个 `plugin.yaml` |
> | 启用/禁用 | `PUT /api/apps/[appId]/state` | SDK `setEnabled()` 封装 |
> | 依赖检测 | `POST /api/apps/[appId]/check` (或 SDK `useDependencyCheck()`) | 通过 Core WebSocket |
> | 安装执行 | `POST /api/apps/[appId]/install` | 通过 Core `process.spawn` |
> | 安装追踪 | `GET/PUT /api/apps/[appId]/installed` | 读写 InstalledSoftwareEntry |
>
> 基于 WebSocket 的 `plugin.*` Core API 仍保留，供 CLI 和高级场景使用。
> Web UI 通过 SDK 层 (`loadApps()` / `getManifest()` / `setEnabled()` / `setGrant()`) 统一封装调用。

### 场景：用户安装 ClaudeCode

```
时间线:
1.  用户打开 Web → Settings → Plugins
2.  页面调 GET /api/plugins
    → Core 返回 [{ id: "claude-code", status: "not_installed" }, ...]

3.  用户点 "Install"
4.  页面调 POST /api/plugins/claude-code/check
    → Core 在本地执行 "claude --version"
    → Core 返回 { dependencies: [{ id: "claude-cli", found: false }] }

5.  页面显示 "Missing: claude CLI"

6.  用户点 "Install"
7.  页面调 POST /api/plugins/claude-code/install/plan
    → Core 生成 plan
    → Core 返回 { installId, steps: [...], requiresApproval: true }

8.  页面显示安装计划 + "确认安装？" 对话框

9.  用户点确认
10. 页面调 POST /api/plugins/claude-code/install/execute
    → Core 开始安装
    → Core 通过 WebSocket 推送 stream.chunk（实时 stdout）

11. 安装完成
12. Core 自动调 plugin.check
13. Core 更新 installed.json
14. Core 检测到需要授权权限

15. 页面显示 "ClaudeCode 需要以下权限："
    - process.spawn: claude
    - fs.read: ~/.claude, ${workspace}
    - ...

16. 用户点 "Accept All"
17. 页面调 POST /api/plugins/claude-code/permissions/grant { ... }

18. Core 写 permissions.json
19. Core 更新 installed.json: { status: "installed", enabled: true }

20. 页面刷新 → ClaudeCode 显示 "Running"
```

### Core 层面的调用链路

```
HTTP/WS/CLI 请求
  │
  ▼
Dispatcher.Dispatch(&CapabilityRequest{
    PluginID:     "claude-code",
    Capability:   "plugin.install.execute",
    TargetNodeID: "",
    Payload:      { installId: "inst_..." },
    Actor:        { Type: "web", ID: "browser_abc" },
})
  │
  ├── 1. Authenticate actor
  ├── 2. Resolve plugin "claude-code"
  ├── 3. Check plugin enabled
  ├── 4. Check permission: actor has "plugin.install"
  ├── 5. Target node: local
  ├── 6. Execute:
  │       ├── Read install plan from disk
  │       ├── Spawn process: "npm install -g @anthropic-ai/claude-code"
  │       ├── Write stdout/stderr → install/inst_.../
  │       ├── Push stream.chunk via WebSocket
  │       ├── Wait for exit
  │       └── Write result → result.json
  ├── 7. Write audit log
  ├── 8. Write plugin history
  └── 9. Return response
```

---

## 十三、Registry / PATH / shell profile

### 原则

如果安装流程改了系统环境，Core 必须记录。

### Windows

- `PATH` 变更
- registry key
- installed application entry
- shim exe/cmd location

### macOS / Linux

- `PATH` 变更
- shell profile 变更（`.bashrc`、`.zshrc`、`.profile`）
- symlink
- package manager prefix

### 记录分类

这些记录属于 `InstallSideEffect`，`fileType: "env"` 或 `fileType: "registry"`，**不一定属于 cache**。

### 禁止规则

未经用户确认，Core 不得修改 PATH / registry / shell profile。任何系统环境修改必须显式展示在 plan 中，用户确认后执行。

---

## 十四、防回退规则

> 本文档只列出管理操作相关规则。完整规则分布在各专题文档中。

| # | 规则 | 验证方式 |
|---|------|---------|
| 1 | **禁止 UI 自己判断插件是否安装** | UI 必须调 `plugin.check`，不能本地存"已安装" |
| 2 | **禁止 Web 和 CLI 各维护一套插件配置** | CLI 和 Web 都调 `config.get/set`，以 Core 存储为准 |
| 3 | **禁止 relay 转发时绕过目标 node 权限** | 远程操作时权限在目标 node 校验 |
| 4 | **禁止没有 permission check 的 plugin management 操作** | `plugin.install`、`plugin.cache.clear`、`plugin.permissions.grant` 等必须有权限校验 |
| 5 | **禁止 Core 理解插件业务** | Core 管理插件声明和调用过的资源，不理解业务含义 |
| 6 | **禁止 install plan 没有用户确认就执行** | 任何命令执行前必须展示 plan |
| 7 | **禁止安装流程只记录 success/fail 不记录产物** | 每次 install 必须记录 Declared / Planned / Discovered |
| 8 | **禁止 Core 下载 installer 但不记录下载目录** | 所有下载必须进入统一下载目录并记录 metadata |
| 9 | **禁止未经用户确认修改 PATH/registry/shell profile** | 系统环境变更必须显式展示在 plan 中 |
| 10 | **禁止插件作者声明 clearable=true 就无条件删除** | Core 仍需权限校验 + 风险评估 + 用户确认 |

---

## 十五、依赖安装链与共享依赖

### 依赖链

参见 [PLUGIN_LIFECYCLE.md](./PLUGIN_LIFECYCLE.md#4-安装-install) 的安装流程。
参见 [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md#共享依赖保护) 的引用计数保护。

### 依赖链记录示例

```json
{
  "installId": "inst_001",
  "pluginId": "claude-code",
  "nodeId": "node_local",
  "dependencyGraph": [
    {
      "dependencyId": "nodejs",
      "reason": "required_for_npm",
      "status": "installed",
      "artifacts": [
        "C:/Program Files/nodejs/node.exe",
        "C:/Users/ZHP/AppData/Roaming/npm-cache"
      ]
    },
    {
      "dependencyId": "claude-cli",
      "reason": "required_by_plugin",
      "status": "installed",
      "artifacts": [
        "C:/Users/ZHP/AppData/Roaming/npm/claude.cmd"
      ]
    }
  ]
}
```

### 引用计数

```json
{
  "path": "C:/Program Files/nodejs/node.exe",
  "owner": "shared",
  "refCount": 2,
  "refBy": ["claude-code", "another-plugin"],
  "dangerous": true
}
```

引用计数更新时机：
- 增加：插件安装时检测到共享依赖，upgrade 时确认仍在使用
- 减少：插件卸载时检查引用是否可减少（禁用时引用计数暂时保留）
- 清理检查：refCount > 0 → 拒绝清理（或高风险提示）

---

## 十六、安装前后快照与下载位置

> 完整定义参见 [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md#安装前后快照)

### 快照内容

Core 在执行安装计划前后做 best-effort snapshot，至少记录：
- `PATH` 环境变量
- known package manager prefixes
- known cache dirs
- manifest declared locations
- binary resolution result（`where` / `which` claude, node, npm）

### 统一下载目录

```
~/.sessionnode/downloads/
  inst_001/
    node-vxx.msi
    checksums.json
    metadata.json
```

下载记录必须包含：url, filename, checksum, size, downloadedAt, usedBy installId, cleanupPolicy。
