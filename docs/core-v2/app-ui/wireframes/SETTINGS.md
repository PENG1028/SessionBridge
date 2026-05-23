# SessionNode v2 — Settings 线框图

---

## Purpose

设置页面外壳 + 各分类设置项。Core 配置、节点配置、插件配置、访问控制、通用偏好。

---

## Entry

- 侧边栏导航「Settings」
- Dashboard 右上角齿轮图标
- 快捷键 `Ctrl+,`

---

## Desktop Wireframe — Settings Shell

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│                                                                   │
│  ┌──────────────┬────────────────────────────────────────────┐  │
│  │  General      │  ┌─ Content Area ───────────────────────┐ │  │
│  │  Core         │  │                                       │ │  │
│  │  Node         │  │  (selected category's content)        │ │  │
│  │  Plugins      │  │                                       │ │  │
│  │  Access Ctrl  │  │                                       │ │  │
│  │               │  │                                       │ │  │
│  │               │  │                                       │ │  │
│  │               │  └───────────────────────────────────────┘ │  │
│  └──────────────┴────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — General Settings

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│                                                                   │
│  ┌──────────────┬────────────────────────────────────────────┐  │
│  │  General      │  General                                   │  │
│  │  Core         │                                            │  │
│  │  Node         │  ── Appearance ──                          │  │
│  │  Plugins      │  Theme:        [System ▾] [Dark] [Light]  │  │
│  │  Access Ctrl  │  Language:     [English ▾]                 │  │
│  │               │  Font Size:    [12 ▾]                      │  │
│  │               │                                            │  │
│  │               │  ── Display ──                             │  │
│  │               │  Sidebar:     [x] Show sidebar             │  │
│  │               │  Bottom Panel: [x] Show bottom panel       │  │
│  │               │  Compact Mode: [ ] Enable compact mode     │  │
│  │               │                                            │  │
│  │               │  ── Notifications ──                       │  │
│  │               │  [x] Show desktop notifications            │  │
│  │               │  [x] Play sound on session events          │  │
│  │               │  [ ] Notify on plugin errors               │  │
│  │               │                                            │  │
│  │               │                          [Reset] [Save]    │  │
│  │               └────────────────────────────────────────────┘  │
│  └──────────────┴────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Core Settings

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│                                                                   │
│  ┌──────────────┬────────────────────────────────────────────┐  │
│  │  General      │  Core Configuration                        │  │
│  │  Core     ←   │                                            │  │
│  │  Node         │  ┌──────────────────────────────────────┐  │  │
│  │  Plugins      │  │  [WARNING] 修改可能影响系统稳定性     │  │  │
│  │  Access Ctrl  │  └──────────────────────────────────────┘  │  │
│  │               │                                            │  │
│  │               │  host.name         [node-main        ]     │  │
│  │               │  host.port         [8080             ]     │  │
│  │               │  host.bind         [0.0.0.0          ]     │  │
│  │               │  log.level         [info ▾           ]     │  │
│  │               │  log.maxSize       [100MB            ]     │  │
│  │               │  log.maxFiles      [10               ]     │  │
│  │               │  session.timeout   [30m              ]     │  │
│  │               │  session.maxMemory [512MB            ]     │  │
│  │               │                                            │  │
│  │               │  ── Advanced ──                            │  │
│  │               │  relay.timeout     [30s              ]     │  │
│  │               │  relay.retry       [3                ]     │  │
│  │               │  crypto.enabled    [x] Enable encryption  │  │
│  │               │  crypto.key        [━━━━━━━━━━━━━] [Edit] │  │
│  │               │                                            │  │
│  │               │                          [Reset] [Save]    │  │
│  │               └────────────────────────────────────────────┘  │
│  └──────────────┴────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Node Settings

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│                                                                   │
│  ┌──────────────┬────────────────────────────────────────────┐  │
│  │  General      │  Node Configuration                        │  │
│  │  Core         │                                            │  │
│  │  Node     ←   │  ┌─ node-main (relay) ──────────────────┐ │  │
│  │  Plugins      │  │  Address:  192.168.1.10:8080          │ │  │
│  │  Access Ctrl  │  │  Labels:   [region=us-east] [+Add]    │ │  │
│  │               │  │  [Disconnect] [Remove]                 │ │  │
│  │               │  └───────────────────────────────────────┘ │  │
│  │               │                                            │  │
│  │               │  ┌─ node-vps (leaf) ─────────────────────┐ │  │
│  │               │  │  Address:  203.0.113.5:8080            │ │  │
│  │               │  │  Labels:   [region=us-west] [+Add]    │ │  │
│  │               │  │  [Disconnect] [Remove]                 │ │  │
│  │               │  └───────────────────────────────────────┘ │  │
│  │               │                                            │  │
│  │               │  [+ Add Node]                              │  │
│  │               │                                            │  │
│  │               │              [Reset] [Save]                 │  │
│  │               └────────────────────────────────────────────┘  │
│  └──────────────┴────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Plugin Settings

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│                                                                   │
│  ┌──────────────┬────────────────────────────────────────────┐  │
│  │  General      │  Plugin Settings                           │  │
│  │  Core         │                                            │  │
│  │  Node         │  ┌──────────────────────────────────────┐  │  │
│  │  Plugins  ←   │  │  Plugin: claude-code                  │  │  │
│  │  Access Ctrl  │  │                                        │  │  │
│  │               │  │  claude.model     [sonnet-4-7 ▾]      │  │  │
│  │               │  │  claude.temperature [0.7      ▾]      │  │  │
│  │               │  │  claude.maxTokens  [4096     ▾]      │  │  │
│  │               │  │  claude.systemPrompt [Edit...   ]     │  │  │
│  │               │  │                    [Reset to Default] │  │  │
│  │               │  └──────────────────────────────────────┘  │  │
│  │               │                                            │  │
│  │               │  ┌──────────────────────────────────────┐  │  │
│  │               │  │  Plugin: shell                        │  │  │
│  │               │  │                                        │  │  │
│  │               │  │  shell.defaultShell [bash ▾]          │  │  │
│  │               │  │  shell.defaultCwd   [~          ]     │  │  │
│  │               │  └──────────────────────────────────────┘  │  │
│  │               │                                            │  │
│  │               │  Plugin selector: [All Plugins ▾]          │  │
│  │               └────────────────────────────────────────────┘  │
│  └──────────────┴────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Access Control Settings

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│                                                                   │
│  ┌──────────────┬────────────────────────────────────────────┐  │
│  │  General      │  Access Control                            │  │
│  │  Core         │                                            │  │
│  │  Node         │  ── Authentication ──                      │  │
│  │  Plugins      │  Auth Mode:  [Token ▾]                     │  │
│  │  Access Ctrl  │  Token:      [━━━━━━━━━━━━━━━━━━] [Regen] │  │
│  │               │  Token Hint: [my-dev-token           ]    │  │
│  │               │                                            │  │
│  │               │  ── Session Approval ──                    │  │
│  │               │  [x] Require approval for new sessions     │  │
│  │               │  [ ] Require approval for all operations   │  │
│  │               │  Approval Timeout: [60s ▾]                 │  │
│  │               │                                            │  │
│  │               │  ── Rate Limiting ──                       │  │
│  │               │  Max Sessions:  [10 ▾] per [node ▾]       │  │
│  │               │  Max Connections: [100 ▾]                  │  │
│  │               │                                            │  │
│  │               │                          [Reset] [Save]    │  │
│  │               └────────────────────────────────────────────┘  │
│  └──────────────┴────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop — Config Schema Form (plugin-defined settings)

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  claude-code 配置                              [Plugin]  │    │
│  │                                                           │    │
│  │  ── Basic ──                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │ model          string    [sonnet-4-7        ▾]      │ │    │
│  │  │ temperature    number    [━━━━━━━●━━━━━━━]  0.7     │ │    │
│  │  │ maxTokens      integer   [4096              ]       │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  │                                                           │    │
│  │  ── Advanced ──                                          │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │ systemPrompt  string    [━━━━━━━━━━━━━━━━━━━] [Edit]│ │    │
│  │  │                                                        │ │    │
│  │  │ [x] Enable streaming output                            │ │    │
│  │  │ [ ] Enable verbose logging                             │ │    │
│  │  │                                                        │ │    │
│  │  │ [Reset to Default]                                     │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  │                                                           │    │
│  │  Schema source: plugin claude-code manifest                │    │
│  │                                          [Cancel] [Save]  │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop — Secret Field

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  crypto.key                                                │    │
│  │                                                           │    │
│  │  ┌━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┐  │    │
│  │  ┃  ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●  │  │    │
│  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │    │
│  │                                                           │    │
│  │  [Show] [Copy] [Regenerate] [Clear]                       │    │
│  │                                                           │    │
│  │  Last changed: 2026-05-18 14:30                           │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Mobile Wireframe

```
┌──────────────────────┐
│  Settings     [←]     │
├──────────────────────┤
│                       │
│  > General            │
│  > Core               │
│  > Node               │
│  > Plugins            │
│  > Access Control     │
│                       │
├──────────────────────┤
│ [Home] [...] [Settings]│
└──────────────────────┘

点击进入子页:

┌──────────────────────┐
│  General      [←]    │
├──────────────────────┤
│                       │
│  Theme                │
│  [System ▾]          │
│                       │
│  Language             │
│  [English ▾]         │
│                       │
│  Font Size            │
│  [12 ▾]              │
│                       │
│  ── Display ──       │
│  [x] Show sidebar     │
│  [x] Show bottom panel│
│                       │
│  ── Notifications ── │
│  [x] Desktop notif.   │
│                       │
│  [Reset]  [Save]      │
└──────────────────────┘
```

---

## States

- **loading**: 侧边栏 skeleton + 内容区 skeleton
- **ready**: 侧边栏 + 选中分类内容
- **error**: "无法加载设置" + 重试（不影响已显示的分类）
- **permission denied**: "无权限修改设置"（只读模式）
- **conflict**: 底部弹出 "设置已被其他设备修改，请刷新" + [Reload] 按钮
- **validation error**: 字段标红 + 错误提示

---

## Components

| 组件 | 用途 |
|------|------|
| SettingsShell | 左导航 + 右内容区布局 |
| SettingsNav | 左侧分类导航（General / Core / Node / Plugins / Access Control） |
| SettingsSection | 设置分组容器（带标题和描述） |
| ConfigField | 单行配置项（label + input + description） |
| ConfigSchemaForm | 根据 JSON Schema 自动渲染的表单 |
| SecretField | 加密字段（mask + show + copy + regenerate） |
| SaveResetBar | 底部 Save / Reset 操作栏 |
| UnsavedBadge | 未保存修改标记 |

---

## Core API

| API | 用途 |
|-----|------|
| config.get { key } | 获取配置项 |
| config.set { key, value } | 设置配置项 |
| config.list { namespace } | 列出命名空间下所有配置 |
| config.schema { pluginId } | 获取配置 JSON Schema |
| config.reset { key } | 重置配置到默认值 |
| node.list | 节点列表（Node 设置页） |
| node.update { nodeId, labels } | 更新节点标签 |
| plugin.list | 插件列表（Plugin 设置页） |

---

## Plugin Contribution

- 插件通过 `contributes.configuration` 声明 JSON Schema
- Settings 页面自动根据 Schema 渲染 ConfigSchemaForm
- 插件配置 key 必须 namespace 化（`pluginId.keyName`）
- 插件不能修改 Shell 布局或其他分类
- 每个插件在 Plugin 设置页有自己的配置区块

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| 当前分类 | UI | React state，可 localStorage 记住上次分类 |
| 表单编辑态 | UI | React state，提交后才写入 Core |
| 表单校验状态 | UI | 前端校验 + Core 返回校验错误 |
| 配置值 | Core | 每次加载从 Core 获取 |
| 配置 Schema | Core | 插件 manifest + Core 合并 |
| 未保存修改 | UI | Dirty flag，离开时提示 |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| 保存失败 | Save 按钮变红 + 错误消息 + 保留编辑内容 |
| 配置冲突（多设备） | 底部横幅 + 提示刷新 |
| 校验失败 | 字段标红 + 行内错误消息 |
| 网络断开 | [OFFLINE] 横幅 + 按钮禁用 |
| 权限不足 | 所有写操作禁用 + 锁图标 + tooltip "只读" |
| Schema 加载失败 | 该插件区块显示 "无法加载配置项" + 重试 |
