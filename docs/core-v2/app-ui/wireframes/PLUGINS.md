# SessionNode v2 — Plugins 线框图

---

## Purpose

插件管理：列表、详情、环境检查、安装、权限、文件、缓存、配置、日志。

---

## Entry

- 侧边栏导航「Plugins」
- Settings → Plugins
- Dashboard 插件卡片

---

## Desktop Wireframe — Plugin List

```
┌──────────────────────────────────────────────────────────────────┐
│  Plugins                                    [Check All] [Refresh]│
│                                                                   │
│  [Search...                  ] [All ▾] [Enabled ▾] [Type ▾]      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [icon] claude-code   v1.0.0    ● enabled   feature       │    │
│  │  AI-assisted development in terminal                     │    │
│  │  [Detail] [Disable]                                       │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [icon] shell        v1.0.0    ● enabled   feature       │    │
│  │  Terminal session management                              │    │
│  │  [Detail] [Disable]                                       │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [icon] file-explorer v1.0.0    ● enabled   feature       │    │
│  │  File system explorer                                     │    │
│  │  [Detail] [Disable]                                       │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [icon] system-ui    v2.0.0    ● enabled   builtin       │    │
│  │  SessionNode built-in management UI                       │    │
│  │  [Detail]                         [builtin — always on]  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 4 plugins]                                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Plugin Detail

```
┌──────────────────────────────────────────────────────────────────┐
│  < Plugin Manager          claude-code v1.0.0    ● Enabled       │
│                                                                   │
│  [Tabs: Overview | Environment | Permissions | Files | Cache     │
│         | Settings | Logs | History]                              │
│                                                                   │
│  ┌─── Overview Tab (selected) ─────────────────────────────┐    │
│  │                                                          │    │
│  │  ID:           claude-code                               │    │
│  │  Version:      1.0.0                                     │    │
│  │  Author:       sessionnode                               │    │
│  │  Status:       ● enabled                                 │    │
│  │  Description:  AI-assisted development in terminal       │    │
│  │                                                          │    │
│  │  ── Declared Capabilities ──                             │    │
│  │  process:  spawn, kill, stdin, stdout, resize, status   │    │
│  │  fs:       list, read, write, stat                       │    │
│  │  env:      info, checkBinary, path, home, cwd           │    │
│  │  config:   get, set                                      │    │
│  │  logs:     tail, query                                   │    │
│  │  notify:   send, requestApproval                         │    │
│  │                                                          │    │
│  │  ── Required Binaries ──                                 │    │
│  │  ✓ claude  v0.21.0  (>= 0.20.0)                         │    │
│  │  ✓ git     v2.39.0  (>= 2.0.0)                          │    │
│  │                                                          │    │
│  │  ── Contributes ──                                       │    │
│  │  Views:  1  (claude-code.chat)                           │    │
│  │  Panels: 1  (claude-code.panel)                          │    │
│  │  Commands: 4  (start, history, status, resume)          │    │
│  │  Menus: 1  (claude-code.context)                        │    │
│  │                                                          │    │
│  │  [Disable]  [Repair]  [Uninstall]                        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─── Environment Tab ──────────────────────────────────────┐    │
│  │  [Run Check Again]                                       │    │
│  │                                                          │    │
│  │  ✓ claude     v0.21.0                   >= 0.20.0        │    │
│  │  ✓ git        v2.39.0                   >= 2.0.0         │    │
│  │  — docker     not installed             optional         │    │
│  │  ✗ node       v18.0.0                   >= 20.0.0       │    │
│  │              ↑ Required version not met                   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─── Permissions Tab ───────────────────────────────────────┐   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  claude.binary    Allow [▾]   process.spawn        │  │   │
│  │  │  "允许启动 claude 二进制"                          │  │   │
│  │  ├─────────────────────────────────────────────────────┤  │   │
│  │  │  workspace.read   Allow [▾]   fs.list, fs.read     │  │   │
│  │  │  "读写工作目录文件"      Path: /repo/**             │  │   │
│  │  ├─────────────────────────────────────────────────────┤  │   │
│  │  │  claude.config   Ask [▾]      fs.read, env.home    │  │   │
│  │  │  "读取 ~/.claude 配置"                             │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  Actions: Allow All / Deny All / Reset                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─── Files Tab ─────────────────────────────────────────────┐   │
│  │  Path                        Type          Size           │   │
│  │  ~/.sessionnode/plugins/     config        —              │   │
│  │    claude-code/config.yaml                                │   │
│  │  ~/.sessionnode/plugins/     data          —              │   │
│  │    claude-code/data/                                      │   │
│  │  ~/.sessionnode/logs/        logs          1.2MB          │   │
│  │    plugin-claude-code-*.log                               │   │
│  │                                                          │   │
│  │  ── Access History ──                                    │   │
│  │  10:30  sess_abc  read  config.yaml                     │   │
│  │  10:15  sess_def  write  cache/tmp.dat                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─── Cache Tab ─────────────────────────────────────────────┐   │
│  │  Key                     Size     Created     Last Access  │   │
│  │  models/sonnet-4.bin    1.2GB   2026-05-18  2026-05-19    │   │
│  │  tmp/build-cache/        45MB   2026-05-17  2026-05-18    │   │
│  │                                                          │   │
│  │  [Clear Selected] [Clear Plan]  Will free: ~1.3GB       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─── History Tab ───────────────────────────────────────────┐   │
│  │  [Timeline]                                               │   │
│  │  2026-05-19 10:30  Update  v1.0.0 → v1.1.0  ✓ Success   │   │
│  │  2026-05-18 15:20  Install v1.0.0           ✓ Success   │   │
│  │  2026-05-17 09:00  Install v1.0.0-rc        ✗ Failed    │   │
│  │                    → binary claude not found             │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Install Plan & Progress

### Install Plan Modal

```
┌──────────────────────────────────────────────────────────────┐
│  Install Plan: claude-code                       [Close X]   │
│                                                               │
│  ┌─ Step 1/4 ───────────────────────────────────────────┐    │
│  │  Check environment                        ✓ Done      │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌─ Step 2/4 ───────────────────────────────────────────┐    │
│  │  Download claude-cli v0.21.0 (150MB)          Pending │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌─ Step 3/4 ───────────────────────────────────────────┐    │
│  │  Install binary to ~/.sessionnode/bin/        Pending │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌─ Step 4/4 ───────────────────────────────────────────┐    │
│  │  Verify installation                          Pending │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ⚠ Risks:                                                     │
│  · Will download ~150MB from github.com                       │
│  · Will install binary to ~/.sessionnode/bin/                 │
│  · Will modify PATH in ~/.bashrc                              │
│                                                               │
│  Estimated time: ~30s                                         │
│                                                               │
│                     [Cancel]  [Execute Install]                │
└──────────────────────────────────────────────────────────────┘
```

### Install Progress

```
┌──────────────────────────────────────────────────────────────┐
│  Installing claude-code                            [Close X]  │
│                                                               │
│  ┌─ Step 2/4 ──────── 45% ───────────────────────────────┐   │
│  │  Downloading claude-cli v0.21.0                         │   │
│  │  ████████████████░░░░░░░░░░  45%  68MB / 150MB         │   │
│  │  5.2 MB/s · ~15s remaining                             │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ Log ─────────────────────────────────────────────────┐    │
│  │  ✓ Environment check passed                           │    │
│  │  → Downloading claude-cli from github.com/...         │    │
│  │  → Writing to /tmp/claude-cli-v0.21.0.tar.gz          │    │
│  │  → Extracting to ~/.sessionnode/bin/claude            │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                               │
│              [Cancel Installation]                             │
└──────────────────────────────────────────────────────────────┘
```

---

## Mobile Wireframe — Plugin List

```
┌──────────────────────┐
│  Plugins     [Refresh]│
├──────────────────────┤
│                       │
│  claude-code          │
│  ● enabled  v1.0.0   │
│  >                     │
│                       │
│  shell                │
│  ● enabled  v1.0.0   │
│  >                     │
│                       │
│  file-explorer        │
│  ● enabled  v1.0.0   │
│  >                     │
│                       │
│  system-ui            │
│  ● enabled  builtin  │
│  >                     │
│                       │
├──────────────────────┤
│ [...]  [●Plugins] [...]│
└──────────────────────┘
```

## Mobile Wireframe — Plugin Detail (mobile.fullscreen)

```
┌──────────────────────┐
│  < claude-code    ●  │
├──────────────────────┤
│                       │
│  [Overview] [Env]     │
│  [Perms] [Files]      │
│  [Cache] [Settings]   │
│  [Logs] [History]     │
│                       │
│  ── Selected Tab ──  │
│                       │
│  (tab content)        │
│                       │
│  [Disable] [Repair]   │
│                       │
└──────────────────────┘
```

---

## States

- **loading**: 列表 skeleton
- **empty**: "没有安装任何插件"
- **ready**: 正常列表 + 详情
- **partial**: 部分 tab 数据加载失败
- **error**: "无法加载插件列表" + 重试
- **permission denied**: "无权限管理插件"

### 插件专有状态

| 插件状态 | 列表标记 | 操作 |
|---------|---------|------|
| enabled | ● 绿色 | 禁用 |
| disabled | ○ 灰色 | 启用 |
| error | ✗ 红色 | 修复 + 查看日志 |
| installing | ◌ 蓝色 + 进度 | 不可操作 |
| missing dependency | ⚠ 黄色 | 修复 + 查看详情 |

---

## Components

| 组件 | 用途 |
|------|------|
| PluginList | 插件列表 |
| PluginListItem | 单行（含状态指示器 + 操作按钮） |
| PluginDetailPage | 完整详情页（含 tab 导航） |
| PluginDetailHeader | 详情页顶部（标题 + 状态 + 操作） |
| PluginOverviewPanel | Overview tab |
| PluginEnvironmentPanel | Environment tab |
| PluginInstallPlanPanel | 安装计划展示 |
| PluginInstallProgressPanel | 安装进度 |
| PluginInstallHistoryPanel | 安装历史 |
| PluginFilesTable | 插件文件表 |
| PluginCacheTable | 插件缓存表 |
| PluginArtifactsTable | 下载工件表 |
| PluginConfigForm | 插件配置表单 |
| PluginPermissionPanel | 权限管理 |
| EmptyState | 空列表 |
| ErrorState | 加载失败 |
| PlanSummary | Plan 摘要组件 |

---

## Core API

| API | 用途 |
|-----|------|
| plugin.list | 插件列表 |
| plugin.status { pluginId } | 插件状态 |
| plugin.check { pluginId } | 环境检查 |
| plugin.enable { pluginId } | 启用 |
| plugin.disable { pluginId } | 禁用 |
| plugin.install.plan { pluginId } | 安装计划 |
| plugin.install.execute { planId } | 执行安装 |
| plugin.files.list { pluginId } | 文件位置 |
| plugin.cache.list { pluginId } | 缓存列表 |
| plugin.cache.clear.plan { pluginId } | 清理计划 |
| plugin.cache.clear.execute { planId } | 执行清理 |
| plugin.permissions.list { pluginId } | 权限列表 |
| plugin.permissions.grant { ... } | 授予权限 |
| plugin.permissions.revoke { ... } | 撤销权限 |
| plugin.config.get / config.set | 配置读写 |
| plugin.history { pluginId } | 安装历史 |
| logs.query { source: "plugin", pluginId } | 插件日志 |
| WebSocket: task.event | 安装任务进度 |

---

## Plugin Contribution

- 插件不能在 Plugin Manager 列表页贡献内容
- 插件详情页的 Files/Cache 等 tab 可以通过 manifest 声明 `contributes.web.panels`，使用 host-rendered 组件或 custom-react 组件填入 plugin.detail 子 surface
- 插件配置通过 `contributes.configuration` 声明 schema，由 Settings 页统一渲染

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| 插件列表 | Core | 每次加载获取 |
| 插件状态 | Core | 实时 WebSocket 推送 |
| 环境检查结果 | Core | 检查后缓存，可重新触发 |
| 安装计划 | Core | Plan 有时效性 |
| 安装进度 | Core | WebSocket task.event 推送 |
| 权限状态 | Core | 持久化到 config.yaml |
| 文件/缓存数据 | Core | 每次查看从 Core 获取 |
| 选中插件 ID | UI | React state |
| 当前 tab | UI | React state（可 localStorage 偏好） |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| 插件列表加载失败 | 显示 [ERROR] + 重试 |
| 环境检查失败 | tab 内显示失败 + 单项重试 |
| 安装 Plan 过期 | 提示 "Plan 已过期，请重新生成" |
| 安装执行失败 | 进度面板变红 + 显示失败步骤详情 |
| 缓存清理部分失败 | 显示 "已清理 N 项，M 项失败" |
| 权限授予失败 | 单项错误标记 + 错误消息 |
| 插件不存在（已卸载） | 自动刷新列表，关闭详情 |
| Core API 返回 PERMISSION_DENIED | 显示 "无权限执行此操作" |
