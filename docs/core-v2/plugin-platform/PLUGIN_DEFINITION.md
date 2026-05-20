# SessionNode v2 — 插件定义

> 什么是插件，插件与 External Client 的区别，一个插件多个 adapter 的概念

---

## 什么是插件

插件是满足以下所有条件的软件单元：

1. **有 Manifest** — 声明式定义文件（plugin.yaml），包含 core section 和可选的 adapter 声明
2. **通过 Core Registry 注册** — Plugind 全局唯一，Core 验证后录入注册表
3. **声明需要哪些 Core Capability** — 插件只能调用 manifest 中声明的能力
4. **经过用户授权后才能运行** — Manifest 声明不等于自动授权，用户必须 Grant
5. **有完整生命周期** — discover → register → check → install → enable → disable → uninstall
6. **可以贡献多个 adapter** — 一个插件可同时提供 UI、CLI、后台适配器

### 插件的本质

插件是 **Core 能识别的能力单元**，不是 UI 组件，也不是单纯的 CLI 命令集合。

```
插件 = Manifest 声明 + Core 注册 + 权限 Grant + 生命周期管理 + adapter 适配

插件不做什么:
  - 插件不是 Next.js 页面（页面是 System UI 的职责）
  - 插件不是 CLI 命令集合（CLI 命令只是 adapter 之一）
  - 插件不是后台脚本（daemon adapter 可以声明后台任务）
```

---

## 插件与 External Client 的区别

| 维度 | 插件 | External Client |
|------|------|----------------|
| Manifest | 必须有 | 没有 |
| Core Registry 注册 | 必须 | 不需要 |
| 生命周期 | 完整（安装→启用→禁用→卸载） | 无 |
| Permission Grant | 必须经过用户授权 | 使用 Service Token |
| PluginId | 来自 Manifest，唯一且不可伪造 | 无 pluginId |
| Plugin Management API | 可用（管理自身） | 不可用 |
| UI/CLI adapter | 可选贡献 | 无 |
| 资源归属 | Core 记录插件资源（文件、缓存、历史） | 不记录 |
| 典型场景 | Claude Code、Terminal、File Browser | CI 脚本、k8s operator |

### External Client 的限制

External Client 直接调用 Core API，没有 pluginId，Core 用 Service Token 的 label 记录其操作。

```
External Client 可以做:
  ✓ 调用 Capability API（/api/actions）
  ✓ 使用 Service Token 认证
  ✓ 执行已授权的能力

External Client 不能做:
  ✗ 调用 Plugin Management API
  ✗ 拥有插件资源归属（文件、缓存、历史不被 Core 跟踪）
  ✗ 声明 UI/CLI adapter
  ✗ 使用插件生命周期能力
  ✗ 伪造 pluginId
```

---

## 一个插件，多个 adapter

核心设计原则：**一个插件只有一个 manifest，但可以声明多个 adapter**。

```
Plugin Manifest (plugin.yaml)
  ├── core section (必选)
  │   ├── id, version, capabilities, permissions
  │   ├── resources (files, caches)
  │   ├── environment checks
  │   └── install plan
  │
  ├── adapters.systemUi (可选)
  │   ├── views, panels, settings
  │   ├── commands, menus
  │   └── status items
  │
  ├── adapters.cli (可选)
  │   ├── command definitions
  │   ├── args/options schema
  │   └── output format
  │
  ├── adapters.daemon (可选)
  │   ├── background tasks
  │   ├── start conditions
  │   └── health checks
  │
  └── adapters.webhook (可选)
      ├── HTTP endpoints
      ├── request/response schema
      └── auth method
```

### Adapter 原则

- **core section 是必选的**，其他 adapter 都是可选的
- **所有 adapter 只能调用 core section 中声明/授权的能力**
- adapter 不定义插件核心逻辑，只定义如何适配不同前端
- 插件作者面向 Core 声明能力、权限、资源、缓存、环境检查、安装流程
- 同时可选择适配官方 System UI、CLI 或其他平台

### 示例：Claude Code

```
claude-code 插件只有一个 manifest:
  ─ core section: 声明 session.create, process.spawn, stream.*, fs.*, env.*, plugin.cache.* 等能力
  ─ adapters.systemUi: ClaudeChatView (custom-react)、ClaudeCodePanel、配置表单、权限面板
  ─ adapters.cli: claude, claude-history, claude-check 命令
  ─ adapters.daemon: 后台环境检测、模型缓存维护
```

---

## PluginId 规则

```
PluginId:
  - 来自 Manifest 中的 id 字段
  - 全小写 + 连字符 (kebab-case)，长度 3–64 字符
  - 全局唯一，Core Registry 中不能重复
  - 不可伪造：Core 验证 pluginId 来自已注册 Manifest

使用场景:
  - Manifest 声明
  - 权限 Grant 的 key
  - 配置命名空间 (plugins.{id}.*)
  - 日志文件名 (plugin-{id}-YYYY-MM-DD.log)
  - 数据目录 (~/.sessionnode/plugins/{id}/)

禁止:
  - 插件 A 不能以插件 B 的 pluginId 调用 Core API
  - 未注册的 pluginId 被 Dispatcher 拒绝
  - External Client 不使用 pluginId
```

---

## 为什么需要这些机制

| 机制 | 原因 |
|------|------|
| 插件注册 | Core 必须知道有哪些插件，验证 manifest 合法性 |
| 权限声明 + Grant | 用户知道插件能做什么，控制授权范围 |
| 审计日志 | 所有能力调用可追溯 |
| 资源归属 | Core 记录插件创建了哪些文件、缓存，支持清理和迁移 |
| 环境检查 | 安装前检测依赖，避免运行时失败 |
| 安装计划 | Plan Before Apply，用户知情同意 |
