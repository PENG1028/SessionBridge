# SessionNode v2 — Plugin UI Boundaries

> 明确不同渲染方式（custom-react / host-rendered / iframe / system component reuse）的使用边界和决策标准。以 ClaudeCode 为完整示例说明复杂插件如何接入。

---

## 1. 渲染方式总览

| 方式 | 渲染者 | 代码归属 | 信任等级 | 适用场景 |
|------|--------|---------|---------|---------|
| custom-react (same-origin) | 插件自身 React 组件 | 插件包内 | 高 | 复杂业务 UI：聊天视图、终端、文件管理器 |
| custom-react (iframe) | 插件在 iframe sandbox 内 | 插件包内 | 低 | 不可信插件 UI、外部管理面 |
| host-rendered | System UI | system-ui 内置 | 最高 | 管理类 UI：配置表单、权限面板、缓存表格 |
| system component reuse | 插件引用 system-ui.* 组件 | system-ui 内置 | 最高 | 插件内局部 UI：搜索框、空状态、加载骨架 |

---

## 2. 决策树：用哪种渲染方式？

```
开始:

这个 UI 是插件的核心业务功能吗？
├── 是 → 插件应该自己实现 → custom-react
│   ├── 插件是可信的吗（同团队同仓库）？ → same-origin
│   └── 插件来自第三方吗？ → iframe sandbox
│
└── 否 → 这是通用的管理/配置 UI 吗？
    ├── 是 → host-rendered（System UI 提供组件）
    │   ├── 配置表单 → PluginConfigForm (host-rendered)
    │   ├── 权限列表 → PluginPermissionPanel (host-rendered)
    │   ├── 缓存表格 → PluginCacheTable (host-rendered)
    │   ├── 文件列表 → PluginFilesTable (host-rendered)
    │   └── 安装历史 → PluginInstallHistoryPanel (host-rendered)
    │
    └── 否 → 插件可以复用 system-ui.* 组件
        ├── 需要搜索框？ → system-ui.SearchBox
        ├── 需要空状态？ → system-ui.EmptyState
        ├── 需要错误提示？ → system-ui.ErrorState
        ├── 需要加载态？ → system-ui.LoadingState
        └── 需要数据表格？ → system-ui.DataTable
```

---

## 3. 分类标准

### 3.1 什么算"核心业务 UI" → 必须 custom-react

满足以下任意一条即为核心业务 UI：

1. 有复杂交互状态（输入框、拖拽、实时更新、无限滚动）
2. 需要渲染插件特有的数据格式（如 claude-code 的 stream-json、thinking 块、tool_use）
3. 需要实时双向通信（streaming output、心跳、打字指示器）
4. UI 复杂度高（嵌套组件、自定义样式、动画）
5. 插件的核心用户 facing 功能

**典型例子：**

| 插件 | 核心业务 UI | 理由 |
|------|-----------|------|
| claude-code | ClaudeChatView 消息列表 + 输入框 + 工具展示 | 复杂交互、stream-json 解析、用户 facing |
| shell | TerminalView 终端模拟器 | xterm.js、ANSI、实时 I/O |
| file-explorer | ExplorerView 文件树 + 编辑器 | 拖拽、树形结构、自定义渲染 |

### 3.2 什么算"管理/配置 UI" → 使用 host-rendered

满足以下任意一条即为管理/配置 UI：

1. 展示插件元数据（版本、依赖、状态）
2. 展示/编辑配置（key-value、JSON Schema 表单）
3. 展示权限授予状态（allow/deny/ask 切换）
4. 展示文件路径、缓存条目、安装历史
5. 任何不需要自定义渲染逻辑、仅需数据展示的操作

**典型 host-rendered 组件：**

| 组件 | 用途 | 数据来源 |
|------|------|---------|
| PluginConfigForm | 插件配置编辑 | plugin.config.get/set + config.schema |
| PluginPermissionPanel | 权限查看/修改 | plugin.permissions.list/grant/revoke |
| PluginCacheTable | 缓存条目列表 + 清理 | plugin.cache.list/clear |
| PluginFilesTable | 文件位置 + 访问历史 | plugin.files.list |
| PluginInstallHistoryPanel | 安装/更新历史 | plugin.history |
| PluginInstallPlanPanel | 安装计划展示 | plugin.install.plan |

### 3.3 什么可以复用的 system-ui 组件

见 COMPONENT_CATALOG.md 中 "Reusable by plugin: 是" 的组件。

---

## 4. ClaudeCode 完整边界示例

```
ClaudeCode Plugin 的 UI 由三部分组成:

┌──────────────────────────────────────────────────────────────────┐
│  custom-react (插件自渲染)                                        │
│                                                                   │
│  ClaudeChatView (main.editor)                                    │
│  ├── 消息列表（用户/助手交替）                                    │
│  ├── 工具调用展示（thinking → tool_use → tool_result）           │
│  ├── 输入框 + slash commands                                      │
│  ├── streaming output 实时渲染                                    │
│  └── 对话管理（历史、分支、恢复）                                 │
│                                                                   │
│  ClaudeCodePanel (main.editor.bottom)                            │
│  ├── 当前 session 状态指示                                        │
│  ├── 最近输出摘要                                                 │
│  └── 快速操作按钮（stop、resume）                                 │
│                                                                   │
├──────────────────────────────────────────────────────────────────┤
│  host-rendered (System UI 渲染)                                   │
│                                                                   │
│  Plugin Detail → Overview tab                                    │
│  ├── 版本、描述、capabilities（只读）                             │
│  ├── 所需二进制检查结果                                           │
│  └── contributes 清单                                             │
│                                                                   │
│  Plugin Detail → Settings tab                                    │
│  └── ConfigSchemaForm (model, temperature, maxTokens, ...)       │
│                                                                   │
│  Plugin Detail → Permissions tab                                 │
│  └── PluginPermissionPanel (process/fs/env 权限)                 │
│                                                                   │
│  Plugin Detail → Cache tab                                       │
│  └── PluginCacheTable (model cache, build cache)                 │
│                                                                   │
│  Plugin Detail → Files tab                                       │
│  └── PluginFilesTable (config/data/log paths)                    │
│                                                                   │
│  Plugin Detail → History tab                                     │
│  └── PluginInstallHistoryPanel (安装/更新记录)                   │
│                                                                   │
├──────────────────────────────────────────────────────────────────┤
│  system component reuse (插件内部引用 system-ui 组件)              │
│                                                                   │
│  ClaudeChatView 内部:                                            │
│  ├── system-ui.SearchBox（搜索对话历史）                          │
│  ├── system-ui.EmptyState（无消息时引导）                        │
│  ├── system-ui.ErrorState（API 调用失败提示）                    │
│  ├── system-ui.LoadingState（消息发送中骨架）                    │
│  ├── system-ui.ConfirmDialog（确认停止/删除对话）                │
│  └── system-ui.Badge（模型标签、状态标记）                       │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### ClaudeCode 的 manifest 声明

```jsonc
{
  "id": "claude-code",
  "version": "1.0.0",
  "contributes": {
    // custom-react: 核心业务 UI
    "views": {
      "main.editor": [{
        "id": "claude-code.chat",
        "type": "custom-react",
        "entry": "./views/ClaudeChatView.tsx",
        "sandbox": "same-origin"
      }]
    },
    "panels": {
      "main.editor.bottom": [{
        "id": "claude-code.panel",
        "type": "custom-react",
        "entry": "./panels/ClaudeCodePanel.tsx",
        "sandbox": "same-origin"
      }]
    },
    // host-rendered: 管理/配置 UI（无需插件提供组件）
    // System UI 自动渲染 PluginDetailPage 的 tab
    "configuration": {
      "properties": { /* ... */ }
    },
    // 其他贡献
    "commands": [ /* ... */ ],
    "menus": { /* ... */ },
    "status": [ /* ... */ ]
  }
}
```

---

## 5. 禁止的模式

| 模式 | 为什么禁止 | 替代方案 |
|------|-----------|---------|
| 在 custom-react 中实现配置表单 | 重复劳动，无法统一 ConfigSchemaForm | 使用 host-rendered PluginConfigForm |
| 在 host-rendered 中注入复杂业务逻辑 | host-rendered 是通用组件，不应耦合业务 | 改为 custom-react |
| 在 System UI 中硬编码插件 view | 违反"扩展不动基础设施"原则 | 插件通过 manifest 声明 |
| custom-react 组件操控 System UI shell | 安全隔离被打破，可影响其他插件 | 只操作分配容器内的 DOM |
| iframe 组件通过 postMessage 申请提权 | iframe 的信任等级就是低，不应绕过 | 走标准 CoreClient API |
| 在插件内重新实现 system-ui 已有组件 | 表现不一致、不可维护 | 复用 system-ui.* 组件 |

---

## 6. 边界校验清单

实现插件 UI 时逐项检查：

```
□ 1. 这是核心业务 UI 吗？
     → 如果是，使用 custom-react
     → 如果不是，→ 2

□ 2. 这是管理/配置 UI 吗？
     → 如果是，使用 host-rendered（System UI 组件）
     → 如果不是，→ 3

□ 3. 能复用 system-ui.* 组件吗？
     → 如果是，复用
     → 如果不是，用 custom-react

□ 4. custom-react 组件是否只操作了插件容器内的 DOM？
     → 不要触碰 System UI shell、StatusBar、其他插件容器

□ 5. 所有 API 调用是否都通过 CoreClient？
     → 不要创建额外的 WebSocket/HTTP 连接到 Core

□ 6. 是否声明了 manifest 而非硬编码？
     → View/Panel/Command/Menu/Config 都应在 manifest 中声明

□ 7. ClaudeCode 级别的复杂插件是否遵循了分层？
     → 聊天 UI → custom-react
     → 配置/权限/缓存/文件 → host-rendered
     → 内部 UI 组件 → system-ui 复用
```

---

## 7. Surface 分配规则

| 插件贡献类型 | 分配到的 Surface | 说明 |
|------------|----------------|------|
| view (custom-react) | 插件声明 `views` 指定 surface | 如 `main.editor` |
| view (host-rendered) | 插件声明 `views` 指定 surface | 如 `main.editor` |
| panel (custom-react) | 插件声明 `panels` 指定 surface | 如 `main.editor.bottom` |
| panel (host-rendered) | 插件声明 `panels` 指定 surface | 如 `main.editor.bottom` |
| plugin detail tab | 自动注册到 `plugin.detail` | system-ui.PluginDetailPage 统一管理 |
| configuration | 自动注册到 `settings.page` | system-ui.ConfigSchemaForm 统一渲染 |
| command | `commandPalette` | system-ui.CommandPalette 统一管理 |
| menu | 全局 context menu | system-ui.ContextMenu 合并器 |
| status | `statusBar` | system-ui.StatusBar 渲染 |

插件不能指定不存在的 surface，PluginHost 会自动过滤未知 surface。
