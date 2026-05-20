# SessionNode v2 — Plugin UI Contract

> 定义插件如何与 System UI 集成。所有插件通过 `sb-extension.json` manifest 声明 UI 贡献，System UI 根据 manifest 渲染。

---

## 1. 贡献类型总览

| 类型 | surface | 渲染方式 | 说明 |
|------|---------|---------|------|
| `custom-react` view | 插件声明的 view surface | iframe / 同域 React | 插件自渲染完整 view |
| `custom-react` panel | 插件声明的 panel surface | iframe / 同域 React | 插件自渲染面板 |
| `host-rendered` component | 插件声明的 surface | System UI 渲染 | 插件只提供数据，UI 由 host 渲染 |
| settings section | settings.page | ConfigSchemaForm | 插件声明配置 schema |
| command | 全局 | CommandPalette / 快捷键 | 注册命令 |
| menu | 全局 | 菜单栏 / 右键菜单 | 注册菜单项 |
| status item | StatusBar | system-ui.StatusBar | 状态栏图标/文本 |
| approval request | notification.center | system-ui.ApprovalRequestModal | 审核请求 UI |
| notification | notification.center | system-ui.NotificationCenter | 系统通知 |

---

## 2. Manifest 声明

### 2.1 Host-Rendered View 声明

插件声明一个由 System UI 渲染的 host-rendered view，只需要提供 componentId 和绑定数据：

```jsonc
// sb-extension.json — host-rendered 示例
// 适合管理类 UI：System UI 内置组件渲染，插件只声明 componentId
{
  "id": "node-monitor",
  "version": "1.0.0",
  "contributes": {
    "panels": {
      "main.editor.bottom": [
        {
          "id": "node-monitor.health",
          "type": "host-rendered",
          "componentId": "NodeHealthPanel",   // System UI 内置组件
          "title": "Node Health",
          "icon": "activity"
        }
      ]
    },
    "configuration": {
      "properties": {
        "node-monitor.refreshInterval": {
          "type": "number",
          "default": 30,
          "description": "Health check interval (seconds)"
        },
        "node-monitor.alertThreshold": {
          "type": "number",
          "default": 80,
          "description": "CPU alert threshold (%)"
        }
      }
    },
    "commands": [
      {
        "id": "node-monitor.open",
        "title": "Open Node Monitor",
        "shortcut": "Ctrl+Shift+M"
      }
    ]
  }
}
```

### 2.2 Custom-React View 声明

插件提供自己的 React 组件（同域或 iframe）：

```jsonc
// sb-extension.json — custom-react 示例
// 适合复杂业务 UI：插件提供自己的 React 组件
{
  "id": "claude-code",
  "version": "1.0.0",
  "contributes": {
    "views": {
      "main.editor": [
        {
          "id": "claude-code.chat",
          "type": "custom-react",
          "title": "Chat",
          "entry": "./views/ClaudeChatView.tsx",
          "sandbox": "same-origin"   // 或 "iframe"
        }
      ]
    },
    "panels": {
      "main.editor.bottom": [
        {
          "id": "claude-code.panel",
          "type": "custom-react",
          "title": "Claude Code",
          "entry": "./panels/ClaudeCodePanel.tsx",
          "sandbox": "same-origin"
        }
      ]
    },
    "configuration": {
      "properties": {
        "claude-code.model": {
          "type": "string",
          "default": "sonnet-4-7",
          "description": "Claude model to use"
        },
        "claude-code.temperature": {
          "type": "number",
          "default": 0.7,
          "description": "Model temperature"
        }
      }
    },
    "commands": [
      {
        "id": "claude-code.start",
        "title": "Start Claude Code Session",
        "shortcut": "Ctrl+Shift+C"
      }
    ],
    "menus": {
      "global.context": [
        {
          "command": "claude-code.start",
          "group": "ai"
        }
      ]
    },
    "status": [
      {
        "id": "claude-code.status",
        "label": "Claude Code",
        "icon": "bot",
        "onClick": { "command": "claude-code.start" }
      }
    ]
  }
}
```

### 2.3 Settings 声明

插件配置通过 `contributes.configuration` 声明 JSON Schema：

```jsonc
{
  "contributes": {
    "configuration": {
      "title": "Claude Code",
      "properties": {
        "claude-code.model": {
          "type": "string",
          "default": "sonnet-4-7",
          "enum": ["sonnet-4-7", "haiku-4-5", "opus-4-7"],
          "description": "选择 Claude 模型"
        },
        "claude-code.temperature": {
          "type": "number",
          "default": 0.7,
          "minimum": 0,
          "maximum": 1,
          "description": "模型温度 (0-1)"
        },
        "claude-code.maxTokens": {
          "type": "integer",
          "default": 4096,
          "minimum": 1,
          "maximum": 128000,
          "description": "最大输出 token 数"
        },
        "claude-code.systemPrompt": {
          "type": "string",
          "default": "",
          "description": "自定义 system prompt"
        },
        "claude-code.enableStreaming": {
          "type": "boolean",
          "default": true,
          "description": "启用流式输出"
        }
      }
    }
  }
}
```

---

## 3. PluginComponentProps

所有插件 view/panel 组件收到的 props：

```typescript
// 插件 view/panel 接收的 props
interface PluginComponentProps {
  // Core Client — 唯一的 Core 通信通道
  core: CoreClient;

  // Surface 上下文
  surface: {
    type: SurfaceType;           // "main.editor" | "plugin.detail" | ...
    container: HTMLElement;      // 渲染容器
    viewId: string;              // 当前 view/panel id
  };

  // Session 上下文（如适用）
  session?: {
    id: string;
    kind: string;
    status: SessionStatus;
  };

  // 插件上下文
  plugin: {
    id: string;
    version: string;
  };

  // 节点上下文（如适用）
  node?: {
    id: string;
    name: string;
  };

  // URL hash params（插件路由用）
  hash?: Record<string, string>;
}

// CoreClient — 唯一 Core 通信通道
interface CoreClient {
  // API 调用
  call<T>(method: string, params?: any): Promise<T>;

  // 事件订阅
  on(event: string, handler: (data: any) => void): () => void;

  // 一次性事件
  once(event: string, handler: (data: any) => void): void;

  // 断开连接
  disconnect(): void;

  // 插件 ID（注入，不可伪造）
  readonly pluginId: string;
}
```

---

## 4. CoreClient 访问规则

```
核心规则:

1. CoreClient 在 Plugin Host 中创建，注入到插件组件
2. pluginId 由 Core 注入，插件不可修改
3. CoreClient.call() 自动附加 pluginId 做权限校验
4. CoreClient 只允许调用插件权限 grant 覆盖范围内的 Core API
5. 插件不能创建额外的 WebSocket/HTTP 连接到 Core（必须走 CoreClient）
6. CoreClient.on() 只接收该插件相关的事件
7. disconnect() 在插件卸载时自动调用

权限范围模型:

  插件默认只能访问 plugin-owned 资源（自己的 manifest、配置、状态）。
  经过用户授权后，可以访问跨资源能力：

  CoreClient.call("session.list")
    → Core 收到请求 + pluginId
    → 校验: plugin "claude-code" 是否有 session.read 权限?
    → 根据 manifest capabilities + 用户 grant 判断
    → 允许 / 拒绝

  典型跨资源授权场景:
  - session.create / session.list → 创建和管理自己的会话
  - stream.subscribe → 读取会话输出流
  - fs.read / fs.write → 读写工作区文件（路径约束）
  - node.info → 读取当前节点信息
  - config.get → 读取自己的插件配置
  - approval.* → 发起和响应审批
  - process.spawn → 执行子进程

禁止行为:

  ❌ 创建新的 WebSocket/HTTP 连接到 Core（必须走 CoreClient）
  ❌ 通过 fetch/XMLHttpRequest 直接调用 Core REST API
  ❌ 修改 CoreClient.pluginId
  ❌ 修改 PluginHost 分配容器之外的 DOM（含 System UI shell、其他插件容器）
  ❌ 修改全局 registry（command、menu、panel 注册表）
```

---

## 5. Host-Rendered 组件数据绑定

Host-rendered 意味着插件只声明 componentId，不提供实现。System UI 内置了对应的 React 组件：

```typescript
// System UI 内置的 host-rendered 组件注册表
const HOST_COMPONENTS: Record<string, React.ComponentType<HostComponentProps>> = {
  // 在 system-ui 中注册，适用于管理类 UI
  // 注意：复杂业务 UI（如 ClaudeChatView）应使用 custom-react
  "PluginCacheTable": PluginCacheTable,
  "PluginPermissionPanel": PluginPermissionPanel,
  "PluginConfigForm": PluginConfigForm,
  // ...
};

// Host-rendered 组件收到的 props
interface HostComponentProps {
  // Core Client（与 custom-react 相同接口）
  core: CoreClient;

  // View/Panel 配置信息
  config: {
    viewId: string;
    title: string;
    icon?: string;
  };

  // 渲染容器信息
  container: {
    surface: SurfaceType;
    element: HTMLElement;
    width: number;
    height: number;
  };

  // 其他上下文
  session?: SessionContext;
  node?: NodeContext;
}
```

### 数据流

```
Plugin Manifest (componentId: "PluginPermissionPanel")
  → Plugin Host 读取 manifest
  → 查找 HOST_COMPONENTS["PluginPermissionPanel"]
  → 找到 PluginPermissionPanel 组件
  → 创建 CoreClient 实例
  → 将 CoreClient + config 注入组件
  → 渲染 PluginPermissionPanel

数据路径:
  插件 Manifest → CoreClient → Core Protocol → Core
  Host Component ← CoreClient ← Core Protocol ← Core
```

---

## 6. 插件复用 System UI 组件

插件可以复用以下 System UI 组件：

| 组件 | 使用场景 |
|------|---------|
| system-ui.SearchBox | 插件内部搜索 |
| system-ui.FilterBar | 插件内部过滤 |
| system-ui.EmptyState | 插件空状态 |
| system-ui.ErrorState | 插件错误状态 |
| system-ui.LoadingState | 插件加载态 |
| system-ui.PermissionDenied | 插件权限提示 |
| system-ui.Badge | 插件标签 |
| system-ui.PageHeader | 插件页面标题 |
| system-ui.ConfirmDialog | 插件确认弹窗 |
| system-ui.DataTable | 插件数据表格 |
| system-ui.HealthCard | 插件统计卡片 |
| system-ui.TabBar | 插件 tab 导航 |
| system-ui.PanelContainer | 插件侧边面板 |
| system-ui.SessionStatusBadge | 插件内 session 状态 |
| system-ui.RiskBadge | 插件风险标记 |
| system-ui.SettingsSection | 插件设置分组 |
| system-ui.ConfigField | 插件配置项 |
| system-ui.SecretField | 插件密钥字段 |
| system-ui.EventTimeline | 插件事件时间线 |
| system-ui.LogSearchBox | 插件日志搜索 |

---

## 7. 插件禁用/卸载时的 UI 行为

| 操作 | UI 表现 |
|------|---------|
| 禁用插件 | 所有 view/panel 卸载 → 显示 "插件已禁用" 占位 |
| 启用插件 | View/Panel 重新加载 → 恢复之前状态 |
| 卸载插件 | 所有贡献完全移除 → 不可恢复 |
| 插件崩溃 | ErrorBoundary 捕获 → view 显示 "插件崩溃" → 其他 view 不受影响 |
| 插件更新 | 旧 view 保留直到新版本加载完成 → 平滑过渡 |

---

## 8. 示例：ClaudeCode 插件 UI 集成

```
Manifest 声明:

  ├── views: [claude-code.chat (custom-react, entry: ./ClaudeChatView.tsx)]
  ├── panels: [claude-code.panel (custom-react, entry: ./ClaudeCodePanel.tsx)]
  ├── commands: [start, history, status, resume]
  ├── menus: [claude-code.context (右键菜单)]
  ├── status: [claude-code.status (状态栏图标)]
  ├── configuration: [model, temperature, maxTokens, systemPrompt, ...]
  ├── notifications:
  │   ├── claude-code.approval-request
  │   └── claude-code.session-complete
  └── approval.actions:
      ├── process.spawn
      ├── fs.write (敏感路径)
      └── network.connect

组件映射:

  ClaudeChatView:
    - Type: custom-react (sandbox: same-origin)
    - Surface: main.editor
    - 接收 CoreClient → session.create / session.list / stream.subscribe / stream.write
    - 插件自渲染完整聊天 UI：消息列表、工具调用展示、输入框、对话管理

  ClaudeCodePanel:
    - Type: custom-react (sandbox: same-origin)
    - Surface: main.editor.bottom
    - 接收 CoreClient → session.status / stream.tail
    - 插件自渲染底部面板：session 状态 + 最近输出

  配置:
    - Settings → Plugins → claude-code
    - 自动渲染 ConfigSchemaForm（host-rendered，System UI 提供）
    - Key 全部 namespace 化: claude-code.*

  权限/缓存/文件:
    - Plugin Detail → Permissions / Cache / Files tab
    - 使用 system-ui.PluginPermissionPanel / PluginCacheTable / PluginFilesTable（host-rendered）
    - 插件通过 manifest 声明配置 schema，UI 由 System UI 渲染

  审批:
    - 当 claude-code 执行 process.spawn(rm -rf /data)
    - Core 检测到高风险操作
    - 发送 approval.request 到 notification.center
    - 用户批准/拒绝 → Core 执行/取消
```

---

## 9. 插件 UI 安全约束

```
1. 同域 custom-react 组件
   - 共享 DOM，直接渲染
   - 可操作 PluginHost 分配的容器内的 DOM
   - 可访问 window、document 等全局 API
   - 信任等级：高（需审核）

2. iframe custom-react 组件
   - iframe sandbox 隔离
   - 通过 postMessage 与 host 通信
   - 只能操作 iframe 内的 DOM
   - 访问受限全局 API
   - 信任等级：低

3. host-rendered 组件
   - 由 System UI 实现，插件只声明 componentId
   - 插件无自定义 UI 代码
   - 信任等级：最高

4. 所有插件类型共享约束:
   - 不可创建额外 WebSocket/HTTP 连接到 Core（必须走 CoreClient）
   - 不可访问其他插件的 CoreClient
   - 不可修改 manifest 声明的权限
   - 不可注册同 ID 的命令/菜单/快捷键
   - 不可操作 PluginHost 分配容器之外的 DOM
     （包括 System UI shell、其他插件容器、全局 registry）
```

---

## 10. Surface 生命周期

```
View/Panel 生命周期:

  MOUNT:
    Plugin Host 读取 manifest
    → 解析 surface 映射
    → 创建 CoreClient
    → 加载组件 (custom-react 或 host-rendered)
    → 注入 props
    → 渲染到 surface

  UPDATE:
    收到新 props（session 切换、节点切换等）
    → 重新注入
    → 组件应处理 props 变化

  UNMOUNT:
    用户切换页面
    → 组件 unmount
    → CoreClient.disconnect()
    → 清理事件监听
    → 释放资源

  插件禁用:
    → 所有该插件的 view/panel unmount
    → 所有 CoreClient 断开
    → 显示占位

  插件卸载:
    → 同上 + 从 registry 移除 manifest
    → 不可恢复
```

---

## 11. 错误处理约定

```
插件 UI 错误处理层级:

  1. 组件内部错误（render 异常）
     → ErrorBoundary 捕获
     → 显示 "插件 [name] 遇到问题"
     → 仅影响该 view/panel

  2. CoreClient 连接错误
     → 自动重连（指数退避）
     → 组件收到 onConnectionStatusChange
     → 显示 "连接中..." 或 [OFFLINE]

  3. API 调用错误
     → call() 返回 rejected promise
     → 组件自行处理错误 UI
     → CoreClient 不自动重试

  4. 权限错误 (PERMISSION_DENIED)
     → CoreClient 返回 PERMISSION_DENIED 错误码
     → 组件显示 system-ui.PermissionDenied
     → 不可重试（除非权限被重新授予）

  5. 无效的 manifest
     → Plugin Host 拒绝加载
     → 插件列表显示 "manifest 无效" 错误
     → 不创建任何 surface
```
