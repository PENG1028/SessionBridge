# SessionNode v2 — 插件生命周期

> 从发现到卸载的全流程：discover → register → check → install → enable → disable → uninstall
> 配套文档：[PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md) | [PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md) | [PLUGIN_SECURITY_MODEL.md](./PLUGIN_SECURITY_MODEL.md)

---

## 完整生命周期

```
Manifest 发现 (discover)
    │
    ▼
注册 (register) ──→ invalid（Manifest 验证失败）
    │
    ▼
环境检测 (check)
    │
    ├── 依赖缺失 ──→ 提示安装
    │
    ▼
安装 (install)
    │   Plan Before Apply
    │   安装前快照 → 执行 → 安装后快照 → 副作用登记
    │
    ▼
权限申请 (grant)
    │
    ├── 用户授权 ──→ Plugin Grant 创建
    │
    ▼
启用 (enable)
    │
    ▼
运行中
    │
    ├── 禁用 (disable) ──→ 重新启用
    │
    ├── 卸载 (uninstall) ──→ 清理资源
    │
    └── 更新 (update) ──→ 新版本 install
```

---

## 状态机

```
                     ┌──────────────┐
                     │  discovered   │  Manifest 被发现
                     └──────┬───────┘
                            │ Register
                     ┌──────▼───────┐
              ┌──────│  registered   │
              │      └──────┬───────┘
              │             │ check
              │      ┌──────▼───────┐
              │      │   checking    │
              │      └──────┬───────┘
              │             │
              │     ┌───────┴────────┐
              │     ▼                ▼
              │  ok              missing_dep
              │     │                │
              │     ▼                ▼
              │  needs_grant     needs_install
              │     │                │
              │     │     install    │
              │     │    ┌───────────┘
              │     │    ▼
              │     │  installing ────→ failed
              │     │    │
              │     │    ▼
              │     │  installed
              │     │    │
              │     ▼    ▼
              │  needs_grant（再次检查）
              │     │
              │     ▼
              │  granting
              │     │
              └──┐  │  grant
                 │  ▼
              ┌──┴───────┐
              │  enabled  │  ← 运行中
              └──┬───┬───┘
                 │   │
          disable│   └──→ disabled ──→ enable
                 │          │
              uninstall     │
                 │          │ uninstall
                 ▼          ▼
            uninstalling  uninstalling
                 │          │
                 ▼          ▼
             uninstalled  uninstalled
```

### 状态定义

| 状态 | 含义 | 是否持久化 |
|------|------|-----------|
| `discovered` | Manifest 文件已发现 | 否 |
| `registered` | 已通过验证并注册 | 是 |
| `checking` | 正在环境检测 | 否 |
| `ok` | 依赖全部满足 | 是 |
| `missing_dep` | 依赖缺失 | 是 |
| `needs_install` | 需要安装 | 是 |
| `needs_grant` | 需要用户授权 | 是 |
| `installing` | 正在安装 | 否 |
| `installed` | 安装完成 | 是 |
| `failed` | 安装/检测失败 | 是 |
| `granting` | 等待用户授权 | 否 |
| `enabled` | 启用（运行中） | 是 |
| `disabled` | 禁用 | 是 |
| `uninstalling` | 正在卸载 | 否 |
| `uninstalled` | 已卸载 | 是（历史记录） |

---

## 流程详解

### 1. 发现 (Discover)

Core 启动时通过 `PluginRegistry` 扫描插件目录：

```
扫描路径（按优先级）:
  - ~/.sessionnode/plugins/*/plugin.yaml     — 配置默认目录
  - 配置 pluginDirs 中声明的路径              — 用户自定义目录
  - 环境变量 SESSIONNODE_PLUGIN_DIRS          — 命令行覆盖

扫描行为:
  - 遍历每个 pluginDirs 下的子目录
  - 每个子目录查找 plugin.yaml（优先）或 plugin.json
  - YAML 用内置解析器（无外部依赖），JSON 用标准 encoding/json
  - 首先注册的目录有优先级（目录顺序优先）

结果:
  - 找到有效 manifest → 注册（进入验证流程）
  - manifest 格式错误 → 记录 error 到列表，不崩溃，不注册
  - 子目录无 manifest 文件 → 跳过
  - 目录不存在 → 跳过
```

**Go 实现**：`internal/pluginmanifest/registry.go` — `PluginRegistry`

```go
reg := pluginmanifest.NewPluginRegistry(
    cfg.Plugin.PluginDirs,      // []string{"~/.sessionnode/plugins", ...}
    cfg.Plugin.DisabledPlugins, // []string{"plugin-to-disable"}
)
```

### 2. 注册 (Register)

Core 验证 Manifest 后注册到 Registry：

- 验证 Manifest 格式（参见 [PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md) 校验规则）
- 检查 pluginId 是否已注册（冲突 → 优先保留率先发现的版本，不报错）
- 检测跨插件冲突（同名 CLI command / permission / view → 记录 conflict 日志）
- 注册到 `registry.json`
- 广播 `plugin.registered` 事件

**验证容错**：格式错误的 manifest 不会导致 Core 崩溃。插件出现在列表中但标记 error 状态，`LoadManifest` 返回错误。同一目录下的其他正常插件不受影响。

**禁用列表**：通过 `disabledPlugins` 配置的插件被加载但标记为 disabled，不出现在 capability map 中，`plugin.enabled` 返回 false。

```go
// PluginRegistry 核心方法
reg := pluginmanifest.NewPluginRegistry(dirs, disabled)
m, err := reg.LoadManifest("plugin-id")     // 仅返回有效 manifest
list := reg.ListPlugins()                   // 返回所有插件（含 error/disabled）
enabled := reg.PluginEnabled("plugin-id")   // 检查是否启用
caps := reg.CapabilityMap()                 // 按 manifest 构建插件→capability 映射
```

### 3. 环境检测 (Check)

Core 在目标节点上执行环境检测：

```json
{
  "capability": "plugin.check",
  "targetNodeId": "node_vps",
  "payload": { "pluginId": "claude-code" }
}
```

检测内容包括：
- 检查 `runtime.check` 中声明的 binary/npm/file/env
- 运行 `dependencies.detect` 中定义的检测命令
- 解析版本号，比较 semver 约束

结果记录：

```json
{
  "pluginId": "claude-code",
  "nodeId": "node_vps",
  "checkedAt": 1712345678000,
  "status": "missing",          // ok | missing | partial | error
  "dependencies": [
    { "id": "claude-cli", "type": "binary", "name": "claude",
      "found": false, "required": true }
  ]
}
```

**local 和 VPS 分别执行，结果分别记录。**

### 4. 安装 (Install)

Plan Before Apply 模式：

#### 4.1 生成安装计划

```json
POST /api/plugins/claude-code/install/plan
→ {
    "installId": "inst_20260519_001",
    "steps": [
      { "dependencyId": "claude-cli", "method": "npm",
        "command": "npm install -g @anthropic-ai/claude-code",
        "risk": "medium", "requiresApproval": true }
    ],
    "totalRisk": "medium",
    "requiresApproval": true
  }
```

#### 4.2 执行安装

```json
POST /api/plugins/claude-code/install/execute { "installId": "inst_..." }
```

执行流程：

```
1. 校验 installId 存在、pending 状态
2. 状态 → running
3. 执行安装前快照（PATH、binary、env）
4. 执行安装命令
5. 实时输出 stdout/stderr
6. 执行安装后快照
7. 对比快照，生成 DiscoveredSideEffect
8. 登记 InstallArtifact
9. 完成或失败
10. 写 plugin history + audit log
```

### 5. 权限申请 (Grant)

安装完成后，检查是否需要权限授予：

- 读取 Manifest 中声明的 `core.permissions`
- 对比 config.yaml 中已有的 Grant
- 缺失的 Grant → 显示权限申请 UI
- 用户选择 allow/deny/ask → 写入 config.yaml

### 6. 启用/禁用 (Enable/Disable)

```
启用:
  - 更新 installed.json: enabled = true
  - 广播 plugin.enabled 事件
  - 启动 daemon adapter（如有）

禁用:
  - 更新 installed.json: enabled = false
  - 广播 plugin.disabled 事件
  - 停止 daemon 任务
  - UI 显示占位
```

### 7. 卸载 (Uninstall)

```
1. 检查是否有其他插件依赖共享资源（引用计数）
2. 生成卸载计划（将删除的文件列表）
3. 用户确认
4. 执行卸载
5. 标记为 uninstalled（保留历史）
```

### 8. 更新 (Update)

```
1. 加载新版本 Manifest
2. 对比新旧 capabilities/permissions/files/caches
3. 生成更新计划
4. 用户确认
5. 执行更新
6. 重新 check
```

---

## Desired / Actual State 模型

### 核心思想

```
Desired State = 用户期望的插件状态（在 config.yaml 中声明）
Actual State  = Core 检测到的实际状态（通过 check 和 reconcile）

Reconcile Loop:
  Core 定期或事件驱动 reconciliation：
    1. 读取 Desired State
    2. 检测 Actual State
    3. 对比差异
    4. 生成 Reconcile Plan
    5. 用户确认后执行
```

### Desired State 声明

```yaml
# ~/.sessionnode/config.yaml
plugins:
  desired:
    claude-code:
      state: enabled
      version: "1.0.0"
      permissions:
        fs.read: allow
        process.spawn: allow
```

### Reconcile 差异表

| Desired | Actual | 操作 |
|---------|--------|------|
| enabled | missing_dep | install → grant → enable |
| enabled | not_installed | install.plan → install.execute |
| enabled | disabled | enable |
| disabled | enabled | disable |
| uninstalled | enabled | disable → uninstall |

**Desired State 不直接触发操作，必须经过 Plan Before Apply + 权限校验。**

---

## 防回退规则

| # | 规则 |
|---|------|
| 1 | 禁止高危操作没有 Plan 直接执行 |
| 2 | 禁止安装没有 history 记录 |
| 3 | 禁止 install plan 没有用户确认就执行 |
| 4 | 禁止 environment check 只在 local 而不在 target node 执行 |
| 5 | 禁止 Desired State 变更直接绕过 Plan/权限 |
| 6 | 禁止安装流程只记录 success/fail 不记录产物 |
| 7 | 禁止同插件多个 Reconcile 并行执行 |
