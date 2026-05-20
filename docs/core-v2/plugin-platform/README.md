# SessionNode v2 — 插件平台文档

> 插件是 Core 的能力单元。一个插件一个定义，可声明多个 adapter（UI / CLI / 后台 / Webhook）。
> Core 负责插件注册、权限、生命周期、资源登记；System UI 和 CLI 只是 adapter。

---

## 插件架构原则

```
Plugin Manifest (唯一)
  ├── core section (必选)     → 能力声明、权限声明、资源声明、环境检查、安装计划
  ├── adapters.systemUi (可选) → 官方 System UI 如何消费
  ├── adapters.cli (可选)      → CLI 命令如何注册
  ├── adapters.daemon (可选)    → 后台守护进程如何启动
  └── adapters.webhook (可选)  → 外部 HTTP 入口如何声明
```

### 核心边界

| 层 | 职责 | 不做什么 |
|----|------|---------|
| **Go Core** | 管理内核：路由、权限、session/stream、审计、插件安装、缓存、历史、能力调用 | 不拥有 UI 状态，不理解插件业务含义 |
| **plugin-platform** | 定义插件契约：manifest、能力、权限、生命周期、存储、安全 | 不定义 UI 渲染，不定义 CLI 执行细节 |
| **System UI** | 消费 `adapters.systemUi`：渲染视图/面板/配置/菜单 | 不定义插件核心协议，不执行 CLI 命令 |
| **CLI** | 消费 `adapters.cli`：注册命令、执行 Core capability，详见 [cli/](../cli/) | 不定义插件核心协议，不拥有独立状态 |
| **External Client** | 直接调 Core API，无插件生命周期 | 没有 manifest，不能调 Plugin Management API |

### 阅读顺序

1. **[PLUGIN_DEFINITION.md](./PLUGIN_DEFINITION.md)** — 什么是插件，插件 vs External Client，一个插件多 adapter
2. **[PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md)** — Manifest 完整格式、字段、校验规则
3. **[PLUGIN_CORE_API_CONTRACT.md](./PLUGIN_CORE_API_CONTRACT.md)** — 插件如何调 Core，capability 命名、节点路由、危险能力
4. **[PLUGIN_ADAPTERS.md](./PLUGIN_ADAPTERS.md)** — systemUi / cli / daemon / webhook adapter 声明方式（CLI 详细规则见 [cli/](../cli/)）
5. **[PLUGIN_LIFECYCLE.md](./PLUGIN_LIFECYCLE.md)** — 插件的发现→注册→安装→启用→禁用→卸载全流程
6. **[PLUGIN_STORAGE_AND_CACHE.md](./PLUGIN_STORAGE_AND_CACHE.md)** — 文件、缓存、历史、下载位置登记与管理
7. **[PLUGIN_SECURITY_MODEL.md](./PLUGIN_SECURITY_MODEL.md)** — 权限模型、pluginId 防伪造、危险能力审批、审计
8. **[PLUGIN_MANAGEMENT.md](./PLUGIN_MANAGEMENT.md)** — 插件管理 API、依赖管理、UI 展示要求
9. **[CHECKLIST.md](./CHECKLIST.md)** — 验证/审查清单

### 插件作者最短路径

```
1. 写 PLUGIN_MANIFEST_SPEC.md 定义 core section（能力、权限、文件、缓存、环境检查）
2. 按需添加 adapter（systemUi / cli / daemon / webhook）
3. 用 core capabilities 实现业务逻辑
4. 测试 manifest 校验、权限校验、安装流程
5. 验证插件在 local 和 VPS 上都能正常工作
```

### 文档维护规则

- Manifest 格式以 PLUGIN_MANIFEST_SPEC.md 为准，其他文档引用不重复定义
- 权限模型以 PLUGIN_SECURITY_MODEL.md 为准
- Adapter 声明以 PLUGIN_ADAPTERS.md 为准
- 所有修改必须更新 CHECKLIST.md 对应条目
