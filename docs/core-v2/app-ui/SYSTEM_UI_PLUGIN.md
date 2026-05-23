# SessionNode v2 — System UI Plugin 设计

> 将当前大 UI 定义为内置 system-ui plugin
> 配套文档：ARCHITECTURE.md、CORE_PROTOCOL.md、PERMISSIONS.md、UX_SURFACES.md

---

## 目录

1. [定义](#一定义)
2. [Manifest 声明](#二manifest-声明)
3. [职责边界](#三职责边界)
4. [Core Owns vs System UI Owns](#四core-owns-vs-system-ui-owns)
5. [System UI 的 Core API 调用](#五system-ui-的-core-api-调用)
6. [System UI 的内置页面](#六system-ui-的内置页面)
7. [权限模型](#七权限模型)
8. [与 Feature Plugin 的通信](#八与-feature-plugin-的通信)
9. [防回退规则](#九防回退规则)

---

## 一、定义

### System UI Plugin 是什么

System UI Plugin（以下称 system-ui）是 SessionNode Go Core 的内置控制面。它不是一个"普通前端"，而是一个**拥有最高 UI 权限但仍然走 Core Protocol 的 system plugin**。

```
┌──────────────────────────────────────────────────────────┐
│                    System UI Plugin                        │
│  React SPA                                                 │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Dashboard · Nodes · Sessions · Logs · Settings       │ │
│  │ Plugin Manager · Permission Grant UI · Cache Manager │ │
│  │ Layout Engine · Tab/View Projection                  │ │
│  └──────────────────────────────────────────────────────┘ │
│          │ 都通过 Core API                                │
│          ▼                                                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Core Client (TS)                          │ │
│  │  HTTP + WebSocket 与 Go Core 通信                      │ │
│  │  Subject: "web" Actor                                  │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
         │ HTTP / WebSocket
         ▼
┌──────────────────────────────────────────────────────────┐
│                    Go Core                                 │
│  Dispatcher → Permission Check → Route → Execute → Audit  │
│  完全不知道 HTTP 请求来自 system-ui 还是 feature plugin    │
└──────────────────────────────────────────────────────────┘
```

### 与 Feature Plugin 的关键区别

| 维度 | System UI | Feature Plugin |
|------|-----------|----------------|
| 来源 | 内置，随 Core 发布 | 单独分发，可卸载 |
| 启用 | 默认启用，不可禁用 | 可启用/禁用 |
| 权限 | 高，管理级 | 受限，按 manifest 声明 |
| 职责 | 管理 Core 能力 | 提供产品功能 |
| Core 感知 | 知道 Core 的所有能力 | 知道 manifest 声明的能力 |
| 用户绕过 | 可替代（第三方控制面） | 不可替代 |

### System UI 不可替代

用户可以开发替代控制面（例如纯 CLI 管理），但 system-ui 是 Core 的默认控制面，永远不会被当成"可选插件"。

即使没有加载任何 feature plugin，system-ui 仍然可用：
- 显示节点状态
- 允许配置
- 查看日志
- 管理插件

---

## 二、Manifest 声明

system-ui 的 manifest 不放在文件系统中，而是 Core 启动时硬编码内置注册。

```yaml
id: system-ui
title: SessionNode System UI
version: "2.0.0"
kind: system
builtin: true
enabled: true

description: |
  SessionNode built-in management UI.
  Provides dashboard, node management, session management,
  plugin management, log viewer, settings, and permission grant UI.

# system-ui 不声明对自身的管理权限
# 它的权限由 Core 启动时授予，不可撤销
permissions:
  # 只读管理权限 — 无需确认
  core:
    - node.read
    - session.read
    - session.list
    - plugin.read
    - plugin.list
    - config.read
    - logs.read
    - logs.tail
    - logs.query
    - stream.subscribe
    - stream.replay

  # 写操作权限 — 需走 Core Protocol + audit
  privileged:
    - config.write
    - plugin.enable
    - plugin.disable
    - plugin.install.plan
    - plugin.install.execute
    - plugin.repair
    - plugin.permissions.grant
    - plugin.permissions.revoke
    - plugin.cache.clear
    - plugin.files.register
    - session.stop
    - cache.clear
    - node.disconnect

contributes:
  views:
    - id: system-ui.dashboard
      label: "Dashboard"
      icon: dashboard
      component: builtin
      defaultSlot: main.editor

    - id: system-ui.nodes
      label: "Nodes"
      icon: server
      component: builtin
      defaultSlot: main.editor

    - id: system-ui.sessions
      label: "Sessions"
      icon: terminal
      component: builtin
      defaultSlot: main.editor

    - id: system-ui.logs
      label: "Logs"
      icon: file-text
      component: builtin
      defaultSlot: main.editor

    - id: system-ui.settings
      label: "Settings"
      icon: settings
      component: builtin
      defaultSlot: main.editor
      children:
        - system-ui.settings.general
        - system-ui.settings.plugins
        - system-ui.settings.plugins.detail
        - system-ui.settings.nodes
        - system-ui.settings.logs
        - system-ui.settings.about

    - id: system-ui.plugin-manager
      label: "Plugins"
      icon: puzzle
      component: builtin
      defaultSlot: main.editor

  panels:
    - id: system-ui.node-network
      label: "Node Network"
      slot: sidebar.right
      component: builtin

    - id: system-ui.session-list
      label: "Active Sessions"
      slot: panel.bottom
      component: builtin

    - id: system-ui.log-stream
      label: "Log Stream"
      slot: panel.bottom
      component: builtin

    - id: system-ui.plugin-status
      label: "Plugin Status"
      slot: sidebar.right
      component: builtin

  commands:
    - id: system-ui.dashboard.open
      label: "Open Dashboard"
      action: system-ui.navigate
      params:
        view: system-ui.dashboard

    - id: system-ui.settings.open
      label: "Open Settings"
      shortcut: "Ctrl+,"
      action: system-ui.navigate
      params:
        view: system-ui.settings

    - id: system-ui.pluginManager.open
      label: "Open Plugin Manager"
      action: system-ui.navigate
      params:
        view: system-ui.plugin-manager

    - id: system-ui.commandPalette.open
      label: "Command Palette"
      shortcut: "Ctrl+Shift+P"
      action: system-ui.commandPalette.toggle

    - id: system-ui.session.stop
      label: "Stop Session"
      action: session.stop

  menus:
    - id: system-ui.node.context
      label: "Node"
      items:
        - label: "Disconnect"
          action: system-ui.node.disconnect
        - label: "Copy Node ID"
          action: system-ui.node.copyId

    - id: system-ui.session.context
      label: "Session"
      items:
        - label: "Stop"
          action: system-ui.session.stop
        - label: "Copy Session ID"
          action: system-ui.session.copyId
        - label: "View Logs"
          action: system-ui.logs.open
          params:
            source: session
```

### Manifest 字段说明

| 字段 | 值 | 说明 |
|------|-----|------|
| `kind` | `system` | 标识为系统插件，不可禁用 |
| `builtin` | `true` | Core 启动时硬编码注册 |
| `permissions.core` | 只读权限 | 用户无法拒绝（否则 UI 不工作） |
| `permissions.privileged` | 写权限 | 由 Core 自动授予，但 audit 记录 |
| `contributes` | 视图/面板/命令/菜单 | 与 feature plugin 相同的贡献点 |

---

## 三、职责边界

### System UI 负责

```
1. 布局管理
   - 主工作区布局（main.editor）
   - 侧边栏布局（sidebar.left / sidebar.right）
   - 面板布局（panel.bottom）
   - 各 surface 的尺寸和折叠状态

2. 面板系统
   - 面板顺序
   - 面板可见性
   - 面板标签

3. Tab 管理
   - 活动 tab（纯 UI 状态，不持久化到 Core）
   - Tab 顺序
   - Tab 关闭/恢复（仅 UI 会话期间）

4. 节点管理 UI
   - 节点列表（数据来自 Core）
   - 节点详情（数据来自 Core）
   - 节点连接管理

5. Session 管理 UI
   - Session 列表（数据来自 Core）
   - Session 监控（数据来自 Core）

6. 日志查看 UI
   - Core 日志
   - Audit 日志
   - Session 日志

7. 设置页
   - 通用设置
   - 插件管理（列表+详情+权限+文件+缓存）
   - 节点设置
   - 日志设置

8. 命令面板
   - 注册命令搜索
   - 快捷键绑定

9. 通知中心
   - 通知展示
   - Approval 请求展示
   - 审批响应

10. 权限管理 UI
    - 插件权限展示
    - 权限授予/撤销界面
    - 权限询问弹窗

11. Plugin Host
    - 加载插件 Web 贡献
    - 渲染插件视图/面板
    - 管理插件的 lifecycle（挂载/卸载）
```

### System UI 不负责

```
1. 不拥有 Core 状态
   - 不持久化 session 列表
   - 不持久化节点拓扑
   - 不持久化配置
   - 不持久化"插件已安装"

2. 不绕过 Core 权限
   - 即使是 system-ui，也必须走 Core Protocol
   - 即使是 system-ui，也会被 audit 记录
   - 不提供"管理员后门"直接调 Core 内部

3. 不实现插件业务逻辑
   - 不解析 ClaudeCode 的 stream-json
   - 不实现文件树的文件读写
   - 不实现终端模拟器

4. 不替代 feature plugin 的 UI
   - Feature plugin 的页面在自己的目录下
   - System UI 只提供系统级页面
   - Plugin 页面通过 Plugin Host 渲染
```

---

## 四、Core Owns vs System UI Owns

### Core Owns（事实来源）

```
│ 实体                    │ 存储位置                                │ 生命周期       │
│─────────────────────────│────────────────────────────────────────│────────────────│
│ node identity           │ ~/.sessionnode/config.yaml             │ 持久化         │
│ node topology           │ Core 内存 + node.db                    │ 运行期间       │
│ session                 │ ~/.sessionnode/sessions/sess_xxx/      │ session 持续   │
│ stream                  │ Core 内存 + sessions/sess_xxx/         │ stream 持续    │
│ session event log       │ sessions/sess_xxx/events.jsonl         │ session 持续   │
│ plugin registry         │ ~/.sessionnode/plugins/registry.json   │ 持久化         │
│ plugin installed        │ ~/.sessionnode/plugins/installed.json  │ 持久化         │
│ plugin permissions      │ ~/.sessionnode/plugins/{id}/permissions.json │ 持久化    │
│ plugin config           │ ~/.sessionnode/plugins/{id}/config.yaml│ 持久化         │
│ plugin files registry   │ ~/.sessionnode/plugins/{id}/files/     │ 持久化         │
│ plugin cache registry   │ ~/.sessionnode/plugins/{id}/cache/     │ 持久化         │
│ plugin install history  │ ~/.sessionnode/plugins/{id}/install/   │ 持久化         │
│ plugin install logs     │ ~/.sessionnode/plugins/{id}/install/   │ 持久化         │
│ plugin file access hist │ ~/.sessionnode/plugins/{id}/files/access-history.jsonl │ 持久化 │
│ plugin env checks       │ ~/.sessionnode/plugins/{id}/env-checks/│ 持久化         │
│ core config             │ ~/.sessionnode/config.yaml             │ 持久化         │
│ core logs               │ ~/.sessionnode/logs/                   │ 按大小轮转     │
│ audit logs              │ ~/.sessionnode/logs/audit-*.log        │ 长期保留       │
│ permission grants       │ ~/.sessionnode/config.yaml             │ 持久化         │
│ approval requests       │ Core 内存 + 超时                       │ 请求持续期间   │
│ download artifacts      │ ~/.sessionnode/downloads/              │ 可清理         │
```

### System UI Owns（UI 偏好）

```
│ 实体                    │ 存储位置               │ 生命周期          │ 说明                         │
│─────────────────────────│───────────────────────│───────────────────│──────────────────────────────│
│ 面板布局（尺寸/顺序）   │ localStorage          │ 浏览器持久化       │ 不参与多浏览器同步           │
│ 折叠的面板              │ localStorage          │ 浏览器持久化       │ 只影响当前浏览器              │
│ 活动 tabId              │ React state           │ UI 会话期间        │ 刷新后丢失，由 session 重建  │
│ 选中的 nodeId           │ React state           │ UI 会话期间        │ 默认恢复上次或第一个          │
│ 选中的 sessionId        │ React state           │ UI 会话期间        │ 默认从 session list 重建     │
│ 视图偏好（主题/字体）   │ localStorage           │ 浏览器持久化       │ 可导出/导入                   │
│ 临时表单状态            │ React state           │ 组件生命周期       │ 提交后清除                    │
│ 展开/折叠的树节点       │ localStorage          │ 浏览器持久化       │ UX 便利                       │
│ 最近使用的路径          │ localStorage          │ 浏览器持久化       │ 仅保存路径字符串             │
```

### Core 返回 -> System UI 展示

```typescript
// Core 返回 session list
const response = await coreClient.request("session.list");
// { sessions: [{ sessionId, kind, status, pluginId, ... }] }

// System UI 渲染为 tab
response.sessions.forEach(session => {
  // 创建一个 UI tab 投影
  tabs.push({
    tabId: generateTabId(),   // 仅前端
    sessionId: session.sessionId,
    label: `${session.kind} - ${session.sessionId}`,
    status: session.status,
  });
});

// 用户关闭 tab —— 只销毁 UI tab，不停止 session
closeTab(tabId);

// 用户停止 session —— 调 Core API，Core 停止 session
coreClient.request("session.stop", { sessionId });
```

### 禁止

- System UI 不把 tab 列表保存到 localStorage
- System UI 不自己维护"session 状态缓存"
- System UI 刷新后通过 `session.list` 重建 tab，不读 localStorage
- System UI 不创建"轻量 session" — 所有 session 都在 Core 创建

---

## 五、System UI 的 Core API 调用

### 调用方式

System UI 与 feature plugin 调 Core API 的方式完全一致。

```typescript
// HTTP 调用
const response = await coreClient.request("plugin.list");
// → { plugins: [...] }

// WebSocket 订阅
const unsub = coreClient.subscribe("session.event", (event) => {
  // 实时 session 事件
});
```

### 请求示例

```json
{
  "type": "action.request",
  "requestId": "req_abc",
  "pluginId": "system-ui",
  "capability": "session.list",
  "targetNodeId": "",
  "payload": {},
  "timestamp": 1712345678000
}
```

### 区别

| 维度 | System UI | Feature Plugin |
|------|-----------|----------------|
| `pluginId` | `"system-ui"` | `"claude-code"` |
| 权限范围 | 全部管理权限 | 按 manifest 声明 |
| audit 记录 | 仍然记录 | 仍然记录 |
| 请求频率 | 高（轮询状态） | 低（按用户操作） |

### 性能考量

System UI 可能频繁调用 Core API（例如轮询 session 状态、节点健康检查）。Core 应该：

1. 支持 WebSocket 推送替代轮询 — session list 变更时主动推送
2. 支持批量查询 — 一次请求获取所有需要的数据
3. 对 system-ui 不特殊对待 — 限流逻辑一致，但 system-ui 的调用影响面大，Core 稳定是第一位

---

## 六、System UI 的内置页面

### Dashboard

```
目标: 节点概览、系统状态
数据源: Core API (node.list, node.health, session.list, plugin.list)
权限: core 只读
Surface: main.editor
状态:
  - empty: 节点首次启动，显示初始化引导
  - loading: 轮询状态中
  - ready: 显示卡片：节点/会话/插件数量、CPU/内存、最近事件
  - error: 显示错误 + 重新加载按钮
```

### Nodes 管理

```
目标: 查看和管理所有节点
数据源: Core API (node.list, node.info)
权限: node.read (查看) + node.disconnect (管理)
Surface: main.editor
操作:
  - 查看节点列表（name, id, status, role, lastSeen）
  - 点击节点查看详情（env, version, uptime, plugins, sessions）
  - 断开节点连接
  - 复制节点 ID
```

### Sessions 管理

```
目标: 查看和管理所有 session
数据源: Core API (session.list, session.get)
权限: session.read (查看) + session.stop (管理)
Surface: main.editor
操作:
  - 查看 session 列表（id, kind, pluginId, nodeId, status, uptime）
  - 点击 session 查看详情 + event replay
  - 停止 session
  - 复制 session ID
```

### Logs 查看

```
目标: 查看 Core/audit/session 日志
数据源: Core API (logs.tail, logs.query, logs.session)
权限: logs.read
Surface: main.editor
功能:
  - 切换日志源: core / audit / session
  - 按级别过滤: info / warn / error
  - 时间范围筛选
  - 关键词搜索
  - 实时 tail
  - 日志详情（展开查看完整 JSON）
```

### Settings

```
目标: 管理 Core 和插件配置
数据源: Core API (config.get, config.set, plugin.*)
权限: config.read (查看) + config.write + plugin.* (管理)
Surface: main.editor（子页面）
子页面:
  - General: Core 基础设置（listen addr, log level, data dir）
  - Plugins: 插件管理总览（列表 + 详情 + 权限 + 文件 + 缓存）
  - Nodes: 节点配置
  - Logs: 日志保留策略
  - About: 版本信息
```

### Plugin Manager

```
目标: 管理插件全生命周期
数据源: Core API (plugin.*)
权限: plugin.read + plugin.install.plan + plugin.install.execute + plugin.permissions.*
Surface: main.editor
功能:
  - 插件列表（id, title, status, enabled, version）
  - 插件详情（manifest, environment, permissions, files, caches）
  - 启用/禁用
  - 环境检测
  - 安装/卸载/修复
  - 权限授予/撤销
  - 缓存查看/清理
  - 文件位置查看
  - 安装历史查看
  - 安装日志查看
```

### Permission Grant UI

```
目标: 插件权限管理
数据源: Core API (plugin.permissions.*)
权限: plugin.permissions.grant + plugin.permissions.revoke
Surface: plugin.detail 子页面 / 弹窗
功能:
  - 首次安装后展示权限申请
  - 展示每个权限的 manifest 声明（capability, description, constraints）
  - Allow / Deny / Ask 三种模式
  - 按路径约束细化
  - 权限概览：哪些已授权、哪些待定、哪些被拒
```

---

## 七、权限模型

### System UI 的权限特性

1. **自动授予** — Core 启动时自动授予 system-ui 所有 `permissions.core` 和 `permissions.privileged`
2. **不可撤销** — 用户不能在 UI 中撤销 system-ui 的权限（否则 UI 无法工作）
3. **仍走 audit** — 即使自动授予，system-ui 的每次能力调用仍然写入 audit log
4. **仍走 Core Protocol** — system-ui 不绕过任何权限校验流程，只是 grant 预先存在

### System UI 不能做的事

即使 system-ui 权限高，以下操作仍然被禁止：

- 直接访问 Core 内部状态（不通过 Dispatcher）
- 绕过 Target Node 权限校验（远程操作在目标节点校验）
- 修改 Core 代码逻辑（UI 是插件，不是 Core 的一部分）
- 代表其他插件做操作（system-ui 的 pluginId 永远是 `"system-ui"`）

### 与 Feature Plugin 的权限对比

```yaml
# system-ui — 自动授予，不可撤销
permissions:
  core:
    - node.read          # 自动允许
    - session.read       # 自动允许
    - config.read        # 自动允许
  privileged:
    - plugin.install.plan     # 自动允许，但 audit
    - plugin.install.execute  # 自动允许，但 audit
    - config.write       # 自动允许，但 audit

# feature plugin — 必须用户授权，可撤销
permissions:
  core:
    - fs.read            # 需要用户点击"允许"
    - process.spawn      # 需要用户点击"允许"
```

---

## 八、与 Feature Plugin 的通信

### 间接通信

System UI 和 feature plugin 不直接通信。它们都通过 Core Protocol 与 Core 交互。

```
Feature Plugin               System UI
     │                            │
     │  notify.request             │  notify.approval.request
     ▼                            ▼
┌─────────────────────────────────────┐
│              Go Core                 │
│  为 system-ui 和 feature plugin      │
│  提供统一的通信通道                   │
└─────────────────────────────────────┘
```

### 通信模式

| 模式 | Core 角色 | 示例 |
|------|----------|------|
| 状态查询 → 展示 | Core 返回数据 | system-ui 查 session list 展示 |
| 事件 → 推送 | Core 主动推送 | session.event → system-ui 更新 UI |
| 审批请求 → 推送 | Core 转发 | feature plugin 发起 notify.request → system-ui 展示审批弹窗 |
| 审批响应 → 回调 | Core 转发 | 用户在 system-ui 点"允许" → Core 通知 feature plugin |
| 配置变更 → 推送 | Core 主动推送 | config 被修改 → system-ui 更新设置页 |

### 插件页面嵌入

System UI 的 Plugin Host 加载 feature plugin 的 Web 贡献：

```
System UI
  └── Plugin Host
        ├── 加载 plugin.yaml 中声明的 views
        ├── 根据 surface 分配渲染位置
        └── 传入 SurfaceRenderContext
              ├── pluginId
              ├── viewId
              ├── sessionId (如果有)
              └── params
```

Plugin Host 不关心插件页面内部实现——它只是给插件页面一个渲染位置和 Core API access。

---

## 九、防回退规则

### 禁止事项

| # | 规则 | 后果 |
|---|------|------|
| 1 | **禁止 system-ui 绕过 Core Protocol** | 即使是 system-ui，也必须通过 `action.request` 调用 Core API |
| 2 | **禁止 system-ui 直接访问 Core 内部状态** | 不能 import Core 的 Go 类型，不能调 Core 的非 Dispatcher 方法 |
| 3 | **禁止 system-ui 在 localStorage 保存 sync 事实** | localStorage 只存 UI 偏好，不存 session 列表、节点拓扑 |
| 4 | **禁止 system-ui 替其他插件做决定** | system-ui 不能代表 claude-code 接受/拒绝权限请求 |
| 5 | **禁止 system-ui 缓存 Core 返回的状态** | Core 返回的 session list 只用于当前渲染，不缓存用于下次启动 |
| 6 | **禁止 system-ui 创建"自己的 session"** | 所有 session 都在 Core 创建，system-ui 只是查看和管理 |
| 7 | **禁止 system-ui 绕过权限校验** | system-ui 的调用仍然在 Dispatcher 中校验，虽然 grant 自动存在 |
| 8 | **禁止 system-ui 实现插件业务逻辑** | system-ui 不解析 stream-json，不实现终端，不管理文件 |
| 9 | **禁止 system-ui 依赖 feature plugin** | Core + system-ui 独立可用，不依赖任何 feature plugin |

### 设计检查清单

```
[ ] system-ui 的每个 API 调用都走了 Core Protocol？
[ ] system-ui 的 UI 状态存储区分了 localStorage 和 Core？
[ ] system-ui 刷新后通过 Core API 重建，而不是读 localStorage？
[ ] system-ui 没有缓存 Core 的返回用于下次启动？
[ ] system-ui 没有实现 feature plugin 专有逻辑？
[ ] system-ui 的调用都写入了 audit log？
[ ] system-ui 没有直接调 Core Go 内部函数？
[ ] system-ui 不依赖任何 feature plugin 才能工作？
```

---

## 附录：System UI 作为控制面的隐喻

```
System UI = Core 的仪表盘+控制台

Core = 发动机
  你不知道发动机内部每个齿轮怎么转，但你能看到
  - 转速表 (session list)
  - 油压表 (node health)
  - 故障灯 (error logs)
  - 里程表 (audit log)

System UI = 仪表盘
  仪表盘不驱动车轮，但它让你理解和管理发动机
  - 切换驾驶模式 (config)
  - 添加配件 (plugin)
  - 查看保养记录 (install history)

Feature Plugin = 车载功能
  - 导航 (ClaudeCode)
  - 空调 (Terminal)
  - 音响 (File Explorer)

仪表盘能让这些功能工作，但仪表盘本身不实现导航算法。
```

---

## 附录 C：与 Plugin Platform 文档的交叉引用

### 核心边界

System UI **消费** feature plugin 的 adapter 声明，但不定义它们：

| Plugin Platform 文档 | System UI 的关注点 |
|---------------------|-------------------|
| [PLUGIN_ADAPTERS.md](../plugin-platform/PLUGIN_ADAPTERS.md#systemui-adapter) | `adapters.systemUi` 是 feature plugin 向 System UI 声明视图/面板/配置/命令的入口 |
| [PLUGIN_MANIFEST_SPEC.md](../plugin-platform/PLUGIN_MANIFEST_SPEC.md#adapters-section-optional) | Feature plugin 的 manifest 格式，System UI 通过 Plugin Host 解析 `adapters.systemUi` |
| [PLUGIN_CORE_API_CONTRACT.md](../plugin-platform/PLUGIN_CORE_API_CONTRACT.md) | System UI 和 feature plugin 调同一套 Core Capability API，pluginId 注入机制一致 |
| [PLUGIN_LIFECYCLE.md](../plugin-platform/PLUGIN_LIFECYCLE.md) | Feature plugin 的生命周期不由 System UI 管理，但 System UI 需要展示和驱动 |
| [PLUGIN_SECURITY_MODEL.md](../plugin-platform/PLUGIN_SECURITY_MODEL.md) | System UI 是三层权限模型中的 Actor 一端，pluginId="system-ui" 不可伪造 |

### System UI 不做什么

```
1. 不定义插件核心协议（manifest、capability、permission schema）
2. 不管理插件生命周期（安装/卸载由 Core 执行）
3. 不执行插件权限校验（由 Core Dispatcher 执行）
4. 不使用 adapter.cli / adapter.daemon / adapter.webhook（这些是 CLI/后端的契约）
```
