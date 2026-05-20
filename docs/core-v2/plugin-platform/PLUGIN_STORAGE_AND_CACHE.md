# SessionNode v2 — 插件存储与缓存管理

> 插件文件声明、缓存登记、安装侧写记录、清理策略
> 配套文档：[PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md) | [PLUGIN_LIFECYCLE.md](./PLUGIN_LIFECYCLE.md)

---

## 核心原则

```
所有通过 Core fs/process API 的操作都在 Core 记录范围内。
插件声明的位置 + Core 执行时发现的位置 = Core 知道的所有位置。

Core 发起或批准的安装/检测/修复流程，Core 必须记录所有可发现的副作用。
插件不能绕过 Core 自己操作文件系统。
```

---

## 存储类型

插件可以声明和管理以下类型的存储：

| 类型 | 示例 | 可清理 | 说明 |
|------|------|--------|------|
| `history` | `~/.claude/history.jsonl` | 通常不可 | 用户数据，需要保留 |
| `config` | `~/.sessionnode/plugins/{id}/config.yaml` | 不可 | 插件配置 |
| `state` | `~/.sessionnode/plugins/{id}/state.json` | 不可 | 运行时状态 |
| `cache` | `~/.sessionnode/plugins/{id}/cache/` | 可清理 | 缓存数据，可重建 |
| `log` | `~/.sessionnode/logs/plugin-{id}-*.log` | 可清理 | 运行时日志 |
| `artifact` | `~/.sessionnode/downloads/inst_*/` | 可清理 | 安装/下载工件 |
| `download` | `~/.sessionnode/downloads/` | 可清理 | 安装包/installer |
| `workspace-context` | `${workspace}/.claude/` | 可清理 | 工作区上下文 |
| `external` | 插件自定义的外部路径 | 按声明 | 非 Core 管理的路径 |

---

## Manifest 文件声明

### 声明格式

```yaml
core:
  files:
    - id: claude-global-history
      type: history
      path: "~/.claude/history.jsonl"
      description: "Claude Code global session history"
      visibility: system        # system | settings | workspace | user
      clearable: false
      defaultPanel: claude-code.history

    - id: claude-settings
      type: config
      path: "~/.claude/settings.json"
      visibility: settings
      clearable: false
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 文件 ID，插件内唯一 |
| `type` | string | 是 | history / config / state / cache / log / workspace-context / artifact / external |
| `path` | string | 是 | 文件路径，支持变量 `${workspace}` `${plugin.dir}` 等 |
| `description` | string | 否 | 人类可读描述 |
| `visibility` | string | 否 | system（用户不需要直接操作）/ settings（设置页显示）/ workspace（工作区上下文）/ user（用户添加）|
| `clearable` | bool | 否 | 默认 false |

---

## 缓存管理

### 缓存声明

```yaml
core:
  caches:
    - id: claude-plugin-cache
      paths:                                    # 支持多个散落位置
        - "~/.sessionnode/plugins/claude-code/cache"
      description: "SessionNode Claude plugin metadata cache"
      clearable: true
      clearMode: delete-path                    # delete-path | plugin-action | package-manager-command | manual-only
      risk: low                                 # low | medium | high
      owner: plugin                             # plugin | dependency | package-manager | shared
```

### 缓存散落处理

缓存可能散落在多个位置，`paths` 数组支持多路径登记：

| 路径 | Owner | ClearMode | 风险 |
|------|-------|-----------|------|
| `~/.sessionnode/plugins/claude-code/cache` | plugin | delete-path | low |
| `~/.claude`（部分目录） | plugin | plugin-action | medium |
| npm cache | shared | package-manager-command | high |
| `${workspace}/.sessionnode-cache/claude-code` | plugin | delete-path | low |

### 清理流程

**Plan Before Apply — 所有清理操作必须先计划再执行：**

```
1. 用户/插件请求清理 cacheId
2. Core 生成清理计划：
   {
     cacheId: "claude-plugin-cache",
     paths: ["~/.sessionnode/plugins/claude-code/cache"],
     estimatedSize: "12.5 MB",
     estimatedEntries: 42,
     mode: "core",
     risk: "low",
     requiresApproval: true
   }
3. 用户确认
4. Core 执行清理
5. 重新扫描，更新缓存信息
6. 写 audit log + 清理历史
```

### 两种清理模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `core` | Core 直接 `fs.delete` | 普通目录/文件缓存 |
| `plugin` | Core 调用插件定义的清理 action | 需要业务逻辑的清理 |

### 清理分类

| 分类 | 示例 | 清理方式 |
|------|------|---------|
| Cache | plugin cache 目录 | delete-path（安全） |
| Artifact | workspace session 输出 | delete-path（需确认） |
| Config | 插件配置 | 不可清理 |
| History | 历史记录 | 不可清理（或手动） |
| Shared Dependency | npm cache, node_modules | package-manager-command（高风险） |

---

## 安装侧写记录

Core 记录安装流程产生的所有可发现副作用。

### 三类记录

#### 1. DeclaredLocation — Manifest 声明位置

```json
{
  "source": "manifest",
  "pluginId": "claude-code",
  "path": "~/.claude/history.jsonl",
  "fileType": "history"
}
```

#### 2. PlannedArtifact — 安装计划预期产物

```json
{
  "source": "install-plan",
  "installId": "inst_001",
  "path": "~/.sessionnode/downloads/inst_001/node-vxx.msi",
  "fileType": "binary",
  "clearable": true,
  "removable": true
}
```

#### 3. DiscoveredSideEffect — 安装扫描发现

```json
{
  "source": "pre-post-diff",
  "installId": "inst_001",
  "path": "C:/Users/ZHP/AppData/Roaming/npm-cache",
  "fileType": "cache",
  "existedBefore": true,
  "clearable": true,
  "shared": true
}
```

### 安装前后快照

Core 在执行安装前后做 best-effort 快照：

```
安装前快照 (pre-snapshot.json):
  - PATH 环境变量
  - known binary resolution（where/which claude, node, npm）
  - known package manager prefixes
  - manifest declared locations

安装后快照 (post-snapshot.json):
  - 同上 + 新变化
  - Core 对比差异 → DiscoveredSideEffect
```

---

## 下载位置管理

### 统一下载目录

所有由 Core 下载的 installer/package/archive 必须进入：

```
~/.sessionnode/downloads/
  inst_001/
    node-vxx.msi
    checksums.json
    metadata.json
```

### 下载记录必须包含

| 字段 | 说明 |
|------|------|
| `url` | 下载来源 |
| `filename` | 本地文件名 |
| `checksum` | 校验和 |
| `size` | 文件大小 |
| `downloadedAt` | 下载时间戳 |
| `usedBy installId` | 被哪个安装使用 |
| `cleanupPolicy` | 安装完成后删除/保留 |

---

## 共享依赖保护

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

### 保护规则

- 共享依赖不能一键清理
- 清理前检查 refCount
- refCount > 0 → 拒绝清理（或高风险提示）
- 卸载插件时不删除 refCount > 0 的共享依赖

---

## 目录结构

```
~/.sessionnode/
├── config.yaml                     # 全局配置
├── node.db                         # 节点持久化数据
│
├── downloads/                      # Core 统一下载目录
│   └── inst_001/
│       ├── installer.exe
│       └── metadata.json
│
├── plugins/
│   ├── registry.json               # 所有已注册插件定义
│   ├── installed.json              # 所有插件的安装状态
│   │
│   ├── claude-code/
│   │   ├── state.json              # 运行时状态
│   │   ├── config.yaml             # 插件配置
│   │   ├── permissions.json        # 权限 Grant 列表
│   │   ├── files/
│   │   │   ├── manifest-files.json  # Manifest 声明的文件
│   │   │   ├── runtime-files.json   # 运行时注册文件
│   │   │   └── access-history.jsonl # 文件访问记录
│   │   ├── cache/
│   │   │   ├── registry.json        # 缓存条目
│   │   │   └── cleanup-history.jsonl
│   │   ├── env-checks/
│   │   │   ├── latest.json          # 最近检查结果
│   │   │   └── history.jsonl
│   │   ├── install/
│   │   │   └── inst_001/
│   │   │       ├── plan.json        # 安装计划
│   │   │       ├── stdout.log
│   │   │       ├── result.json
│   │   │       ├── side-effects.json
│   │   │       ├── pre-snapshot.json
│   │   │       └── post-snapshot.json
│   │   └── history.jsonl            # 统一操作历史
│   │
│   └── shell/                       # 其他插件同结构
│
├── logs/
│   ├── core-YYYY-MM-DD.log
│   ├── audit-YYYY-MM-DD.log
│   └── plugin-claude-code-YYYY-MM-DD.log
│
└── sessions/
    └── sess_xxx/
        ├── meta.json
        └── events.jsonl
```

---

## 防回退规则

| # | 规则 |
|---|------|
| 1 | 禁止插件绕过 Core 自己安装依赖 |
| 2 | 禁止插件绕过 Core 读写缓存（必须走 fs API） |
| 3 | 禁止缓存清理没有 plan |
| 4 | 禁止 install 没有 history |
| 5 | 禁止文件访问不记录 pluginId/nodeId/path/action |
| 6 | 禁止插件把缓存藏在 Core 不知道的位置 |
| 7 | 禁止删除 npm cache 等共享依赖不生成高风险 plan |
| 8 | 禁止 Core 下载 installer 不记录下载目录 |
| 9 | 禁止安装流程只记录 success/fail 不记录产物 |
