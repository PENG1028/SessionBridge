# UI 操作映射表

> 每个页面操作到底层调用路径的完整映射。
> 原则：页面是客户端，不包含业务逻辑——所有操作必须经过 API 或 WebSocket 协议。

---

## 一、页面初始化流程

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| page.tsx 挂载 | 打开页面 | WS connect | `hello` → `welcome` | wsClient, usePageStore | 建立 WS 连接，收到 crypto 握手参数 | admin-auth-gate.ts (auth 层) |
| page.tsx 挂载 | 无操作 (自动) | WS onmessage | `instance.list` | instances[], activeId | 展示已有实例列表 | - |
| page.tsx 挂载 | 无操作 (自动) | HTTP GET | `/api/info` | sessionId, cwd, projectName | 获取当前项目信息 | - |
| page.tsx 挂载 | 无操作 (自动) | HTTP GET | `/api/sessions/current` | historyState.messages | 恢复活动会话历史 | - |

---

## 二、认证流程

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| /setup | 首次远程访问 | HTTP GET | `/setup` → setupPageHtml | - | 显示"设置访问密钥"页面 | admin-auth-gate.ts |
| /setup | 填写密码并提交 | HTTP POST | `/api/auth/setup` | isTokenSet, authEnabled | token 持久化，重定向到 / | admin-auth-gate.ts |
| /login | 远程访问已设密码节点 | HTTP GET | `/login` → loginPageHtml | - | 显示登录页面 | admin-auth-gate.ts |
| /login | 输入密码登录 | HTTP POST | `/api/auth/login` | sb_session cookie | 设置 cookie，重定向到 / | admin-auth-gate.ts |
| localhost | 本地访问 | HTTP GET | `/` (自动 skip auth) | - | 直接进入应用 | admin-auth-gate.ts |
| 任意页面 | 登出 | HTTP POST | `/api/auth/logout` | cookie cleared | 清除会话 | - |

---

## 三、节点/实例管理

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| 左侧边栏 | 创建新实例 | HTTP POST | `/api/instances { dir, label, adapterId }` | instances[], workbenchTabs | WS 广播 instance.added | - |
| 左侧边栏 | 杀死实例 | HTTP DELETE | `/api/instances/{id}` | instances[] | WS 广播 instance.removed | - |
| 左侧边栏 | 点击实例激活 | WS send | `instance.command { name: 'switch-instance', instanceId }` | activeInstanceId | 切换到目标实例 | - |
| NodeBar | 进入节点工作台 | WS send | `workbench.subscribe { nodeId }` | activeNodeId, workbenchTabs | 显示该节点的 tabs | workbench sync (manual test) |
| NodeBar | 离开节点工作台 | WS send | `workbench.unsubscribe { nodeId }` | activeNodeId | 断开节点 tab 订阅 | - |
| NodeNetworkView | 查看 connection list | HTTP GET | `/api/connections` | savedConnections | 显示已保存连接列表 | - |
| NodeNetworkView | 添加上游连接 | HTTP POST | `/api/connections { id, url }` | savedConnections | 保存连接信息 | - |
| NodeNetworkView | 删除连接 | HTTP DELETE | `/api/connections/{id}` | savedConnections | 从列表移除 | - |
| NodeNetworkView | 连接上游 relay | HTTP POST | `/api/connect { relayUrl }` | relayStatus | 建立 agent→relay 连接 | - |
| NodeNetworkView | 断开上游 relay | HTTP POST | `/api/connect { disconnect: true }` | relayStatus | 断开 agent→relay 连接 | - |

---

## 四、终端操作

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| TerminalView 挂载 | 自动创建 shell | WS send (临时连接) | `shell.spawn { instanceId }` | terminalInstance | 创建 shell 实例 | shared-remote-terminal-session (协议级) |
| terminal 输入 | 键盘输入 | WS send | `shell.input { data, instanceId }` | - | 字符发送到 shell stdin | - |
| terminal 输出 | 自动接收 | WS onmessage | `shell.output { data }` | terminalBuffer | 显示终端输出 | - |
| terminal 退出 | 自动接收 | WS onmessage | `shell.exit { code }` | terminalStatus | 标记进程退出 | - |
| StatusBar | 切换目录 | WS send (临时连接) | `shell.input { data: 'cd /path\r' }` | - | 执行 cd 命令 | - |
| MobileExtraKeys | 发送特殊键 | WS send | `shell.input { data }` | - | 发送 Ctrl/Alt/Esc 等 | - |
| Ctrl+L | 清除终端 | 客户端 | setTerminalBuffer([]) | terminalBuffer | 清空终端显示 | - |
| ShellTerminal | 调整大小 | WS send | `shell.resize { cols, rows }` | - | 重新调整远程 PTY | - |

---

## 五、Workbench Tab 同步 (SharedSurface — 推荐)

SharedSurface 是 tab 同步的 source of truth。`workbench.tabs` 降级为向后兼容投影。
详见 [`docs/SHARED_SURFACE_REPLAY_MODEL.md`](SHARED_SURFACE_REPLAY_MODEL.md)。

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| 创建 terminal tab | 自动 | WS send | `surface.publish { nodeId, viewType, runtimeRef, replayPolicy }` | surface (relay 端) | 创建 shared surface + operation, 广播 surface.published | shared-surface-terminal-replay.test.mjs (31/31) |
| 进入节点 | 自动 | WS send | `surface.subscribeNode { nodeId }` | - | 收到 `surface.list` → `runtime.replay` (历史) → `runtime.output` (live) | shared-surface-terminal-replay.test.mjs |
| 远程设备创建 tab | 自动接收 | WS onmessage | `surface.published` → dispatch `UPSERT_TAB` | workbench state | 自动添加 tab 到当前 pane | shared-surface-ui-contract.test.mjs (48/48) |
| Late join 历史回放 | 自动接收 | WS onmessage | `runtime.replay { surfaceId, outputs[] }` | tab outputCache | xterm.js buffer 显示历史输出 | shared-surface-replay-cap.test.mjs (12/12) |
| Live output | 自动接收 | WS onmessage | `runtime.output { surfaceId, data }` | tab outputCache | 追加到 xterm.js buffer | shared-surface-terminal-replay.test.mjs |
| Terminal 输入 (shared) | 键盘输入 | WS send | `operation.input { operationId, data }` | - | 发送到关联 operation (而非 shell.input) | shared-surface-ui-contract.test.mjs |
| 关闭 shared tab | 自动 | WS send | `surface.close { surfaceId }` | surface (relay 端) | 广播 surface.closed 给订阅者 | shared-surface-ui-contract.test.mjs |

### 兼容路径: workbench.tabs (Legacy)

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| 创建/销毁 tab | 自动 | WS send | `workbench.tabs { nodeId, tabs }` | workbenchTabStore (relay 端) | 服务端存储 tabs 并广播 | workbench tab sync (manual test) |
| 进入节点 | 自动 | WS send | `workbench.subscribe { nodeId }` | - | 收到 `workbench.tabs` 回放 | - |
| 远程设备创建 tab | 自动接收 | WS onmessage | `workbench.tabs { nodeId, tabs }` | 本地 workbench state | 同步显示远程 tabs (无 runtime replay) | - |

---

## 六、连接/网络面板

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| ConnectionPanel | 查看状态 | HTTP GET | `/api/connect` | relayUrl, connected, status | 显示当前连接状态 | cli-api-parity.test.mjs (planned) |
| ConnectionPanel | 查看 relay info | HTTP GET | `/api/health` | instanceCount, memory | 显示 relay 健康状态 | - |
| ConnectionPanel | 查看 peers | WS onmessage | `peer.list` | peers[] | 显示网络拓扑 | - |

---

## 七、Settings Panel

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| Settings | 查看 auth 状态 | HTTP GET | `/api/auth/check` | authEnabled, tokenSet | 显示认证状态 | config-merge.test.ts |
| Settings | 开关认证 | HTTP POST | `/api/auth/toggle { enabled }` | authEnabled | 切换远程访问密码 | - |
| Settings | 设置/修改密码 | HTTP POST | `/api/auth/setup` 或 `/api/auth/change-password` | token | 密码更新，session 失效 | - |
| Settings | 查看活动会话 | HTTP GET | `/api/auth/sessions` | sessions[] | 显示登录设备列表 | - |
| Settings | 撤销会话 | HTTP DELETE | `/api/auth/sessions?id=...` | sessions[] | 强制设备登出 | - |
| Settings | 查看扩展配置 | HTTP GET | `/api/configuration/schema` + `/api/configuration/values` | configEntries | 显示可编辑配置项 | - |
| Settings | 修改配置值 | HTTP PATCH | `/api/configuration/values { scope, key, value }` | dirtyConfig | 保存单键配置 | - |
| Settings | 重置配置 | HTTP DELETE | `/api/configuration/values?scope=...&key=...` | - | 键恢复默认值 | - |
| Settings | 检查更新 | HTTP GET | `/api/check-update` (404 on relay) | updateStatus | 显示可用更新 | - |
| Settings | 执行更新 | HTTP POST | `/api/do-update` (SSE) | updateProgress | 流式更新日志 | - |
| Settings | 重启服务器 | HTTP POST | `/api/restart` | - | 服务进程重启 | - |
| Settings | 查看权限设置 | HTTP GET | `/api/permissions` | grants{} | 显示权限开关 | - |
| Settings | 修改权限 | HTTP POST | `/api/permissions { category, value }` | grants{} | 保存权限变更 | - |
| Settings | 查看通知设置 | HTTP GET | `/api/notifications` | scenarios[], settings{} | 显示通知开关 | - |
| Settings | 修改通知 | HTTP POST | `/api/notifications { scenarioId, value }` | notifications | 保存通知变更 | - |
| Settings | 查看服务日志 | HTTP GET | `/api/logs` | logs[] | 显示最近 50 条日志 | - |
| Settings | 查看扩展状态 | HTTP GET | `/api/extensions` | extensionInfo | 显示已加载扩展列表 | - |
| Settings | 重载扩展 (dev) | HTTP POST | `/api/extensions { action: 'reload' }` | - | 热重载扩展 | - |
| Dashboard | 自动刷新状态 | HTTP GET | `/api/status` | adapters[], uptime, pid | 显示运行时状态 (Dashboard HTML fallback) | - |

---

## 八、Extension/Plugin 能力

| 页面位置 | 用户操作 | 调用方式 | API/WS 消息 | 涉及状态 | 预期结果 | 对应测试 |
|---------|---------|---------|------------|---------|---------|---------|
| 命令面板 | 执行扩展命令 | 客户端 | `runWorkbenchCommand(commandId)` | - | 触发注册的命令逻辑 | - |
| 扩展注册 | 自动 (挂载时) | 客户端 | 读取 adapterRegistry / extensionPoints | workbenchCommands, quickActions | 功能按扩展清单注册 | - |
| 扩展面板 | 自动渲染 | 客户端 | 通过 manifest contributes.views | workbenchTabs | 按扩展清单展示自定义视图 | - |

---

## 九、仅页面能力（无 CLI / 无独立 API 入口）

| 能力 | 说明 | 缺口 |
|------|------|------|
| 快照 (Snapshot) | 纯 IndexedDB 客户端持久化 | 无 API、无 CLI |
| 书签目录 | localStorage 操作 | 无 API、无 CLI |
| 搜索面板 | 仅通过 UI 交互调用 /api/sessions/search | 无 CLI 包装 |
| 文件查看器 | 内联查看，触发 /api/read-file | 无 CLI 包装 |
| 文件上传 | POST /api/upload (base64) | 无 CLI 包装 |
| 模式/努力程度选择器 | WS command setMode/setEffort | 仅 WS，无 CLI/API |
| workbench tab 保留 | 纯客户端 UI 状态 | 无 API 持久化 |
| QR 页面 | /qr 页面 | 文案引用不存在的 `bridge connect` |

---

## 十、标记

- 有对应测试的项在"对应测试"列注明
- 空白表示尚无覆盖该路径的自动化测试
- `(planned)` 表示测试文件已计划但未创建
