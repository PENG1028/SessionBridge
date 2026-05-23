# SessionNode v2 — 设置页与插件管理页设计

> 设置页 IA、插件管理全生命周期 UI、全部通过 Core Protocol 调用
> UI 不自己执行任何安装/清理操作，只调 Core API

---

## 一、Settings IA（信息架构）

```
Settings
├── General                      # 通用设置
│   ├── Core 监听地址            host.listen
│   ├── Core 日志级别            host.logLevel
│   ├── Core 数据目录            host.dataDir
│   ├── 自动更新                 host.autoUpdate
│   └── 语言/主题                host.theme
│
├── Plugins                      # 插件设置（插件配置项，按插件分组）
│   ├── claude-code              # 展开后显示该插件的配置项
│   │   ├── theme                plugin.claude-code.theme
│   │   ├── model                plugin.claude-code.model
│   │   └── ...
│   ├── shell
│   │   ├── defaultShell         plugin.shell.defaultShell
│   │   └── ...
│   └── ...
│
├── Nodes                        # 节点设置
│   ├── 节点发现                 node.discovery
│   ├── 自动重连                 node.autoReconnect
│   └── 可信节点                 node.trustedPeers
│
├── Logs                         # 日志设置
│   ├── 日志保留天数             logs.retentionDays
│   ├── 日志级别                 logs.level
│   └── 审计日志保留             audit.retentionDays
│
├── Admin                        # 管理设置（高危）
│   ├── 远程访问密码             auth.adminPassword
│   ├── 认证开关                 auth.enabled
│   ├── 活跃 sessions            auth.sessions
│   └── Service Token            auth.serviceTokens
│
├── Updates                      # 更新管理
│   ├── 当前版本
│   ├── 检查更新
│   ├── 更新日志
│   └── 重启服务器
│
└── About                        # 关于
    ├── 版本号
    ├── 许可证
    └── 系统信息
```

### 当前代码复用

`app/console/shell/settings-panel.tsx` 已经实现了：
- Schema 驱动的配置编辑（ConfigField 组件）
- User/Workspace 两级 scope
- 搜索/过滤
- 修改标记 + 批量保存
- Admin auth 区域
- Updates 区域

**复用建议**：保留现有 SettingsPanel 的 UI 结构，将 API 调用从 REST 改为 Core Client。

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
  - configs: ConfigContribution[]（schema）
  - userValues: Record<string, unknown>（user scope）
  - workspaceValues: Record<string, unknown>（workspace scope）
  - dirtyMap: Map<string, unknown>（未保存修改）
  - validationErrors: Record<string, string[]>

需要修改:
  - fetch('/api/configuration/schema') → coreClient.request('config.schema')
  - fetch('/api/configuration/values?scope=...') → coreClient.request('config.get', { scope })
  - fetch('/api/configuration/values', { method: 'PATCH', ... }) → coreClient.request('config.set', { scope, key, value })
  - fetch('/api/auth/check') → coreClient.request('auth.check')
  - fetch('/api/auth/toggle') → coreClient.request('auth.toggle')
  - fetch('/api/check-update') → coreClient.request('update.check')
  - fetch('/api/do-update') → coreClient.request('update.execute')
```

---

## 三、Plugin Manager — 插件列表页

### 信息架构

```
Plugin Manager
├── 已安装插件列表
│   ├── 内置插件（system-ui, system-monitor）
│   │   ├── 不可禁用 → 灰色禁用按钮
│   │   ├── 不显示安装/卸载操作
│   │   └── 只显示 status + 版本
│   └── 功能插件（claude-code, shell, file-explorer）
│       ├── 插件名 / ID / 版本
│       ├── 状态标签（enabled / disabled / error）
│       ├── 启用/禁用 toggle
│       ├── 点击 → Plugin Detail 页
│       └── 排序/过滤
│
└── 插件操作
    ├── 安装新插件
    ├── 批量启用/禁用
    └── 检测变更（reconcile）
```

### Core API 映射

| UI 操作 | Core API | 权限 |
|---------|----------|------|
| 加载插件列表 | `plugin.list` | plugin.read |
| 启用插件 | `plugin.enable { pluginId }` | plugin.enable |
| 禁用插件 | `plugin.disable { pluginId }` | plugin.disable |
| 重新加载插件 | `plugin.reload { pluginId }` | plugin.enable |

### Failure States

| 状态 | UI 表现 |
|------|--------|
| loading | skeleton 列表 |
| error | "无法加载插件列表" + 错误详情 + 重试 |
| empty | "未安装任何插件" + 安装引导 |
| enable 失败 | 插件卡片显示错误标记 + 错误消息 |
| disable 失败 | 同上 |

---

## 四、Plugin Detail — 详情页

### 页面结构

```
Plugin Detail（顶部）
├── 标题区：插件图标 + 名称 + 版本 + 状态 badge
├── 操作按钮：启用/禁用、修复、卸载
│
└── Tab 导航
    ├── Overview      ← manifest、描述、capabilities
    ├── Environment   ← 环境检测结果
    ├── Permissions   ← 权限列表 + 授予/撤销
    ├── Files         ← 文件位置 + 访问历史
    ├── Cache         ← 缓存条目 + 清理
    ├── Settings      ← 插件配置项
    ├── Logs          ← 插件日志
    └── History       ← 安装历史
```

### Core API 映射

| Tab | Core API | 说明 |
|-----|----------|------|
| Overview | `plugin.status { pluginId }` | 状态 + manifest 快照 |
| Environment | `plugin.check { pluginId }` | 环境检查 |
| Permissions | `plugin.permissions.list { pluginId }` | 权限声明 + 授权状态 |
| Permissions | `plugin.permissions.grant { ... }` | 授予权限 |
| Permissions | `plugin.permissions.revoke { ... }` | 撤销权限 |
| Files | `plugin.files.list { pluginId }` | 文件位置注册 |
| Files | `plugin.files.accessHistory { pluginId }` | 文件访问历史 |
| Cache | `plugin.cache.list { pluginId }` | 缓存条目 |
| Cache | `plugin.cache.clear.plan { pluginId }` | 生成清理计划 |
| Cache | `plugin.cache.clear.execute { planId }` | 执行清理 |
| Settings | `config.get { key: "plugin.xxx.*" }` | 插件配置项 |
| Settings | `config.set { key, value }` | 修改配置 |
| Logs | `logs.query { source: "plugin", pluginId }` | 插件日志 |
| History | `plugin.history { pluginId }` | 安装/更新历史 |

### Surface 分配

```
plugin.detail          → main.editor（类设置页）
plugin.detail.permissions → plugin.detail（tab 切换）
plugin.detail.files    → plugin.detail（tab 切换）
plugin.detail.cache    → plugin.detail（tab 切换）
```

---

## 五、Environment Check — 环境检测

```
UX:
  - 点击"检查环境"按钮
  - 显示结果列表：
    ✓ claude v0.21.0（满足 >= 0.20.0）
    ✓ git v2.39.0（满足 >= 2.0.0）
    ✗ docker（未安装，可选依赖）— 显示 "未安装（可选）"
  - 重新检查按钮
  - 检查时间戳

Core 调用：
  action.request {
    capability: "plugin.check",
    payload: { pluginId: "claude-code" }
  }
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

---

## 六、Install Plan — 安装计划

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

Core 调用：
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

---

## 七、Install Execute — 安装执行

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

---

## 八、Install History — 安装历史

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

---

## 九、Files / Cache / Artifacts — 文件/缓存/工件

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

Core 调用:
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
│
└── [清理所有工件]

Core 调用:
  plugin.artifacts.list { pluginId }
  → Response: { artifacts: [{ name, size, downloadedAt, sourceUrl }, ...] }

  plugin.artifacts.delete { artifactName }
  → Response: { success: true }
```

---

## 十、Permissions — 权限管理

```
权限列表:
  ┌─────────────────────────────────────────────────┐
  │  claude.binary                                   │
  │  允许启动 claude 二进制                          │
  │  关联 capabilities: process.spawn               │
  │  状态: ✓ 已授权         [撤销]                   │
  ├─────────────────────────────────────────────────┤
  │  workspace.read                                  │
  │  读取工作目录文件                                │
  │  关联 capabilities: fs.list, fs.read            │
  │  约束: allow: /home/user/project/**             │
  │  状态: ✓ 已授权         [撤销]                   │
  ├─────────────────────────────────────────────────┤
  │  claude.config.read                              │
  │  读取 ~/.claude 配置                            │
  │  关联 capabilities: fs.read, env.home           │
  │  状态: ⏳ 待定        [授权] [拒绝]              │
  └─────────────────────────────────────────────────┘

Core 调用:
  plugin.permissions.list { pluginId }
  → Response: { permissions: [{ id, label, description, capabilities,
      constraints, status: "granted" | "denied" | "pending" }] }

  plugin.permissions.grant { pluginId, permissionId }
  → Response: { success: true }

  plugin.permissions.revoke { pluginId, permissionId }
  → Response: { success: true }
```

### 权限弹窗（首次安装）

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

---

## 十一、Config Schema — 配置项注册

插件通过 manifest 声明配置项 schema：

```yaml
# plugins/claude-code/plugin.yaml
contributes:
  configuration:
    title: "Claude Code"
    properties:
      plugin.claude-code.theme:
        type: string
        default: "dark"
        enum: ["dark", "light"]
        description: "UI theme"
      plugin.claude-code.model:
        type: string
        default: "sonnet"
        description: "AI model to use"
      plugin.claude-code.maxTokens:
        type: integer
        default: 4096
        minimum: 1024
        maximum: 65536
        description: "Max tokens per response"
```

UI 通过 Core API 读取和写入：

```
config.get { key: "plugin.claude-code.theme" }
config.set { key: "plugin.claude-code.theme", value: "light" }
```

---

## 十二、Logs — 插件日志查看

```
UX:
  - 源切换: Core / Audit / Session（默认显示当前插件日志）
  - 自动过滤 pluginId 为当前插件
  - 级别过滤: info / warn / error
  - 实时 tail
  - 点击展开完整 JSON

Core 调用:
  logs.query { source: "plugin", pluginId: "claude-code", level: "error", limit: 100 }
  → Response: { lines: [{ ts, level, msg, pluginId, ... }] }
```

---

## 十三、Failure States 汇总

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
