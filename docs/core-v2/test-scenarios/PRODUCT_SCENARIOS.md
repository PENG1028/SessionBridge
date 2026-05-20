# SessionNode v2 — 产品场景与测试断言

> 13 个产品场景，覆盖所有核心功能路径
> 每个场景包含：业务价值、涉及模块、协议/API、权限、日志/audit、失败状态、测试断言
> 配套文档：ARCHITECTURE.md、PLUGIN_DEFINITION.md、CONTROL_PLANE_TEST_CASES.md

---

## 目录

1. [场景一：单机 Terminal 使用](#场景一单机-terminal-使用)
2. [场景二：跨节点 Session 转发](#场景二跨节点-session-转发)
3. [场景三：Claude Code AI 编程](#场景三claude-code-ai-编程)
4. [场景四：文件浏览与编辑](#场景四文件浏览与编辑)
5. [场景五：插件安装与管理](#场景五插件安装与管理)
6. [场景六：权限审批流](#场景六权限审批流)
7. [场景七：多浏览器同步](#场景七多浏览器同步)
8. [场景八：CI/CD 自动化部署](#场景八cicd-自动化部署)
9. [场景九：节点拓扑管理](#场景九节点拓扑管理)
10. [场景十：系统监控与告警](#场景十系统监控与告警)
11. [场景十一：缓存清理与副作用追踪](#场景十一缓存清理与副作用追踪)
12. [场景十二：离线与断线重连](#场景十二离线与断线重连)
13. [场景十三：多用户 Service Token 管理](#场景十三多用户-service-token-管理)

---

## 场景一：单机 Terminal 使用

### 业务价值

用户在自己的机器上打开一个终端 session，输入命令、查看输出。最基本的 Core 能力验证。

### 涉及模块

- Core: Session Manager, Stream Manager, Process Manager
- Plugin: shell (web+cli)
- Actor: system-ui (Web UI) / cli-user (CLI)

### 协议/API

```
Web UI:
  session.create { kind: "shell", command: "bash", pty: true, rows: 24, cols: 80 }
  → session.created { sessionId, streamIds }

  stream.subscribe { sessionId, streamType: "stdout", fromSeq: 0 }
  → stream.subscribed + stream.chunk（实时推送）

  stream.write { sessionId, streamType: "stdin", data: "ls -la\n" }
  → stream.chunk（stdout 输出）

  session.stop { sessionId }
  → session.event { eventType: "session.stopped" }

CLI:
  node shell open --cwd /home/user
  → 同上，通过 CLI 调 Core API
```

### 权限

| Actor | 所需权限 | 来源 |
|-------|---------|------|
| system-ui | session.create, stream.subscribe, stream.write, session.stop | 自动授予 |
| cli-user | 同上 | 本地 IPC（信任） |

### 日志/Audit

```
Core Log:
  session created: sessionId, pluginId="shell", kind="shell"
  session stopped: sessionId, exitCode

Audit Log:
  capability.call: session.create, allowed=true
  capability.call: stream.write, allowed=true
  capability.call: session.stop, allowed=true

Session Event Log:
  eventSeq 1: session.created { kind: "shell", command: "bash" }
  eventSeq 2: stream.stdout { data: "$\r\n" }
  eventSeq N: session.stopped { exitCode: 0 }
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| command 不存在 | BINARY_NOT_FOUND | session.create 返回 error，不创建 session |
| cwd 不存在 | INVALID_REQUEST | session.create 返回 error |
| pty 创建失败 | PROCESS_SPAWN_FAILED | session.created { ok: false } |
| session 已停止 | SESSION_ALREADY_STOPPED | stream.write 返回 error |
| 权限不足 | PERMISSION_DENIED | Dispatcher 拒绝 |

### 测试断言

```
P0:
  [ ] session.create 返回 sessionId 和 streamIds
  [ ] stream.subscribe 开始接收 stream.chunk
  [ ] stream.write 写入 stdin 后，stdout 有对应输出
  [ ] session.stop 后，进程退出，session.stopped 事件广播
  [ ] 权限不足时请求被 Dispatcher 拒绝

P1:
  [ ] pty resize 后进程窗口尺寸更新
  [ ] 并行创建多个 terminal session，各自独立
  [ ] 长时间无输入后 session 不超时
```

---

## 场景二：跨节点 Session 转发

### 业务价值

用户在本地发起操作，session 在远程 VPS 上创建和运行，所有 I/O 实时转发。控制平面核心能力。

### 涉及模块

- Core: Router, Remote Forwarder, Session Manager, Stream Manager
- Plugin: shell
- Actor: system-ui / cli-user
- 节点: relay, leaf (VPS)

### 协议/API

```
CLI:
  node shell open --target vps --cwd /repo

Web UI:
  session.create {
    pluginId: "shell",
    targetNodeId: "node_vps",
    payload: { kind: "shell", command: "bash", cwd: "/repo" }
  }

转发流程：
  1. Node A Core 收到 session.create
  2. Node A 校验 actor/plugin 权限
  3. Node A route → targetNodeId = node_vps
  4. Node A 检查 node_vps 在路由表中，连接可用
  5. Node A 通过 relay 转发请求到 Node B
  6. Node B Core 收到转发请求
  7. Node B 校验：请求来自可信 peer + 本地策略
  8. Node B 执行 session.create
  9. Node B 返回 session.created 给 Node A
  10. Node A 返回给客户端
```

### 权限

| 校验点 | 校验内容 | 在哪个节点 |
|--------|---------|-----------|
| Actor 认证 | token/通道有效 | Node A |
| Plugin 注册 | shell 已注册并启用 | Node A |
| 权限 | 有 session.create 权限 | Node A |
| 远程路由 | node_vps 可达 | Node A |
| 转发请求 | 来自可信 peer | Node B |
| 本地权限 | 本地策略允许 shell session 创建 | Node B |
| 路径约束 | cwd 在允许范围内 | Node B |

### 日志/Audit

```
Node A Audit:
  capability.call: session.create, targetNodeId=node_vps, allowed=true
  forward: session.create → node_vps, status=ok

Node B Audit:
  capability.call: session.create (forwarded from node_A), allowed=true

Node B Core Log:
  session created: sessionId, pluginId="shell", source="remote:node_A"
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| 目标节点不可达 | NODE_UNREACHABLE | session.create 返回 error |
| 目标节点拒绝 | FORWARD_ERROR | 转发失败返回 error |
| 目标节点上 command 不存在 | BINARY_NOT_FOUND | 目标节点执行失败 |
| 目标节点权限校验不过 | PERMISSION_DENIED | 目标节点返回权限错误 |
| relay 连接断开 | NODE_UNREACHABLE | 转发超时 |
| 信任级别不够 | FORBIDDEN | 目标节点拒绝转发请求 |

### 测试断言

```
P0:
  [ ] session.create { targetNodeId: remote_node } 成功在远程创建 session
  [ ] stream.write 写入内容通过 relay 转发到远程进程
  [ ] 远程进程 stdout 实时转发回本地客户端
  [ ] 目标节点不可达时返回 NODE_UNREACHABLE
  [ ] 目标节点上权限校验独立执行，不依赖源节点

P1:
  [ ] 远程 session.event 的 eventSeq 在目标节点生成
  [ ] 多个客户端同时订阅远程 session 的 stream
```

---

## 场景三：Claude Code AI 编程

### 业务价值

通过 Claude Code 插件在远程/本地运行 AI 编程会话，涉及进程管理、文件读写、审批流等综合能力。

### 涉及模块

- Core: Session Manager, Stream Manager, Permission Checker, Notify/Approval
- Plugin: claude-code (web+cli)
- Actor: plugin (claude-code)

### 协议/API

```
1. 环境检测
  action.request { capability: "env.checkBinary", payload: { name: "claude" } }
  → { found: true, path: "/usr/local/bin/claude", version: "0.21.0" }

2. 创建 Session
  session.create {
    pluginId: "claude-code",
    kind: "process",
    command: "claude",
    args: ["--output-format", "stream-json"],
    cwd: "/repo"
  }
  → { sessionId, streamIds }

3. 订阅输出 + 解析 stream-json
  stream.subscribe { sessionId, streamType: "stdout", fromSeq: 0 }
  → stream.chunk { data: base64 }（cliude 输出 stream-json）

4. AI 读文件（需审批）
  claude 需要读文件 /etc/hosts
  → claude-code 插件调 fs.read → Core 检查权限
  → 权限模式为 ask
  → Core 返回 NEED_APPROVAL
  → claude-code 插件调 notify.request
  → Core 推送 notify.approval.request 给所有 UI
  → 用户点 Allow → notify.respond
  → Core 回调 claude-code: notify.approval.result
  → claude-code 重试 fs.read

5. AI 写文件
  claude 需要写文件 /repo/main.go
  → claude-code 插件调 fs.write
  → Core 检查权限（路径约束内）
  → 执行写入
  → 记录 audit + 文件访问历史
```

### 权限

| 能力 | Grant 模式 | 说明 |
|------|-----------|------|
| env.checkBinary | allow | 低风险 |
| session.create | allow | 用户主动发起 |
| stream.subscribe | allow | 只读 |
| stream.write | allow | 用户输入 |
| fs.read | allow (约束: ~/.claude/**, ${workspace}/**) | 路径限制 |
| fs.write | ask | 每次需要用户同意 |
| notify.request | allow | 发起审批 |
| config.get | allow | 读配置 |

### 日志/Audit

```
Audit Log:
  capability.call: env.checkBinary, allowed=true
  capability.call: session.create, allowed=true
  capability.call: fs.read, allowed=true, path="/repo/main.go"
  capability.call: fs.write, allowed=true, path="/repo/main.go"
  approval.request: requestId, title="Read file"
  approval.response: requestId, action="allow-once", respondedBy="user"

File Access History:
  claude-code → fs.read → /repo/main.go → allowed=true
  claude-code → fs.write → /repo/main.go → allowed=true

Session Events:
  eventSeq 1: session.created { command: "claude" }
  eventSeq 2-N: stream.stdout { data: ... }
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| claude 二进制不存在 | BINARY_NOT_FOUND | session.create 失败 |
| 文件读路径不在约束内 | PATH_NOT_ALLOWED | fs.read 被拒绝 |
| 审批超时 | TIMEOUT | notify.request 超时回调 |
| claude 进程异常退出 | PROCESS_SPAWN_FAILED | session 状态变为 failed |
| 写入文件过大 | FILE_WRITE_ERROR | fs.write 返回错误 |
| 工作目录不存在 | INVALID_REQUEST | session.create 返回错误 |

### 测试断言

```
P0:
  [ ] claude 二进制存在时 session.create 成功
  [ ] stdout stream 实时推送 claude 输出的 stream-json
  [ ] fs.read 在路径约束内正常执行
  [ ] fs.read 超出路径约束时返回 PATH_NOT_ALLOWED
  [ ] fs.write 模式为 ask 时触发审批流
  [ ] 用户审批 allow 后 fs.write 继续执行
  [ ] 用户审批 deny 后 fs.write 被拒绝

P1:
  [ ] 审批"记住选择"后更新 Grant
  [ ] 多个审批请求同时存在，各自独立
  [ ] claude 进程结束后 session.errored 被记录
```

---

## 场景四：文件浏览与编辑

### 业务价值

用户通过 Web UI 或 CLI 浏览、读取、编辑远程机器上的文件。所有操作经过权限校验和审计。

### 涉及模块

- Core: FS Manager, Permission Checker
- Plugin: file-explorer (web-only)
- Actor: system-ui / cli-user

### 协议/API

```
Web UI:
  fs.list { path: "/home/user/project" }
  → { entries: [{ name: "main.go", type: "file", size: 1024 }, ...] }

  fs.read { path: "/home/user/project/main.go", offset: 0, limit: 4096 }
  → { data: "base64...", size: 1024, truncated: false }

  fs.write { path: "/home/user/project/main.go", data: "base64...", append: false }
  → { success: true, size: 1024 }

  fs.stat { path: "/home/user/project/main.go" }
  → { name: "main.go", type: "file", size: 1024, modTime: "...", mode: "0644" }
```

### 权限

| 能力 | Grant 模式 | 约束 |
|------|-----------|------|
| fs.list | allow | 路径约束 |
| fs.read | allow | 路径约束 |
| fs.stat | allow | 路径约束 |
| fs.write | ask | 路径约束 |
| fs.watch | allow | 路径约束 |

### 日志/Audit

```
Audit Log:
  capability.call: fs.list, path="/home/user/project", allowed=true
  capability.call: fs.read, path="/home/user/project/main.go", allowed=true
  capability.call: fs.write, path="/home/user/project/main.go", allowed=true
  
File Access History:
  file-explorer → fs.list → /home/user/project → allowed=true
  file-explorer → fs.read → /home/user/project/main.go → allowed=true
  file-explorer → fs.write → /home/user/project/main.go → allowed=true
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| 路径不存在 | FILE_NOT_FOUND | fs.read/list/stat 返回错误 |
| 路径越权 | PATH_NOT_ALLOWED | 权限校验拒绝 |
| 文件过大 | FILE_READ_ERROR | fs.read 返回 truncation 信息 |
| 写入只读路径 | PERMISSION_DENIED | fs.write 被策略拒绝 |
| 监控无效路径 | INVALID_REQUEST | fs.watch 路径不合法 |

### 测试断言

```
P0:
  [ ] fs.list 返回目录内容
  [ ] fs.read 读取文件内容（正常文件）
  [ ] fs.read 路径不在约束内时返回 PATH_NOT_ALLOWED
  [ ] fs.write 写入成功
  [ ] fs.write 到拒绝路径时返回 PERMISSION_DENIED
  [ ] fs.stat 返回文件元信息

P1:
  [ ] fs.watch 订阅文件变更后，文件修改触发推送
  [ ] 大文件分片读取（offset + limit）
  [ ] 跨节点文件操作（targetNodeId）
```

---

## 场景五：插件安装与管理

### 业务价值

用户通过 Web UI 或 CLI 发现、安装、启用、禁用、卸载插件。完整的插件生命周期管理。

### 涉及模块

- Core: Plugin Registry, Install Executor, Permission Checker, Env Checker
- Plugin: system-ui (Plugin Manager 页面)
- Actor: system-ui / cli-user

### 协议/API

```
1. 查看插件列表
  GET /api/plugins
  → { plugins: [{ id: "claude-code", status: "not_installed" }, ...] }

2. 环境检测
  POST /api/plugins/claude-code/check
  → { status: "missing", dependencies: [{ name: "claude", found: false }] }

3. 安装计划
  POST /api/plugins/claude-code/install/plan
  → { installId: "inst_001", steps: [...], requiresApproval: true }

4. 用户确认（UI 展示 plan，用户点确认）

5. 执行安装
  POST /api/plugins/claude-code/install/execute
  Body: { installId: "inst_001" }
  → { status: "running" }
  → WebSocket 实时推送安装日志

6. 授权权限
  POST /api/plugins/claude-code/permissions/grant
  Body: { capability: "fs.read", mode: "allow", constraints: {...} }

7. 启用
  POST /api/plugins/claude-code/enable
  → { success: true }

8. 禁用/卸载
  POST /api/plugins/claude-code/disable
  DELETE /api/plugins/claude-code
  → { success: true }
```

### 权限

| Actor | 所需权限 | 说明 |
|-------|---------|------|
| system-ui | plugin.list, plugin.check, plugin.install, plugin.enable/disable | 管理操作 |
| system-ui | plugin.permissions.grant/revoke | 权限管理 |

### 日志/Audit

```
Audit Log:
  plugin.check: claude-code, status=missing
  plugin.install: claude-code, installId=inst_001, status=success
  permission.grant: claude-code, capability=fs.read, mode=allow
  plugin.enable: claude-code, status=success

Install History:
  inst_001: install, claude-cli, success, 30s
  inst_002: upgrade, claude-cli, success, 25s

Install Side Effects:
  declared: ~/.claude/history.jsonl
  planned: ~/.sessionnode/downloads/inst_001/node-v18.msi
  discovered: C:/Users/.../npm-cache (shared)
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| 插件已存在 | PLUGIN_ALREADY_INSTALLED | install 返回错误 |
| 网络错误 | PLUGIN_INSTALL_FAILED | 安装过程失败 |
| 磁盘空间不足 | PLUGIN_INSTALL_FAILED | 安装命令失败 |
| 权限授予被拒 | PERMISSION_DENIED | Grant 操作被拒绝 |
| Manifiest 无效 | INVALID_REQUEST | 注册时验证失败 |

### 测试断言

```
P0:
  [ ] plugin.check 正确检测依赖状态
  [ ] plugin.install.plan 生成包含完整步骤的 Plan
  [ ] Plan 必须用户确认后才能执行
  [ ] plugin.install.execute 执行安装并推送实时日志
  [ ] 安装成功后的 env.check 确认新的状态
  [ ] plugin.enable/disable 切换插件启用状态
  [ ] 禁用状态下插件的能力调用被拒绝
  [ ] plugin.permissions.grant 正确存储 Grant

P1:
  [ ] 安装历史可查询（plugin.history）
  [ ] 安装日志可查看（plugin.install.logs）
  [ ] 插件卸载后清理相关文件
```

---

## 场景六：权限审批流

### 业务价值

插件调用高风险能力时，实时向用户请求审批。用户可在任一连接的 UI 上响应。审批历史可审计。

### 涉及模块

- Core: Permission Checker, Notify/Approval, Audit Logger
- Plugin: any feature plugin + system-ui
- Actor: plugin (请求方), system-ui (响应方)

### 协议/API

```
1. 插件发起能力调用
  action.request {
    pluginId: "claude-code",
    capability: "fs.write",
    payload: { path: "/repo/.env", data: "..." }
  }

2. Core 检查权限 → mode: ask
  → 路径 .env 在 deny 列表中，或模式为 ask
  → 返回 NEED_APPROVAL

3. 插件发起审批请求（插件自行决定是否发起审批）
  action.request {
    pluginId: "claude-code",
    capability: "notify.request",
    payload: {
      title: "Claude Code 想写入文件",
      body: "文件: /repo/.env\n操作: write",
      requestId: "req_original",  // 关联原始请求
      actions: [
        { id: "allow-once", label: "仅允许一次" },
        { id: "deny", label: "拒绝" }
      ],
      timeout: 30000
    }
  }

4. Core 推送审批请求给所有 Web UI
  → notify.approval.request { ... }

5. 用户响应
  action.request {
    pluginId: "system-ui",
    capability: "notify.respond",
    payload: { requestId: "req_abc", action: "allow-once" }
  }

6. Core 回调给请求方
  → notify.approval.result { action: "allow-once", respondedBy: "user" }

7. 插件重试原始能力调用
  action.request { capability: "fs.write", ... }
  → 此时有 Grant（如果是 allow-always）或临时决定（allow-once）
```

### 权限

| Actor | 所需权限 | 说明 |
|-------|---------|------|
| claude-code | notify.request | 发起审批 |
| system-ui | notify.respond | 响应审批 |

### 日志/Audit

```
Audit Log:
  capability.denied: claude-code, fs.write, reason="mode=ask"
  approval.request: requestId, pluginId=claude-code, title="Claude Code 想写入文件"
  approval.response: requestId, action="allow-once", respondedBy="user"
  capability.call: claude-code, fs.write, allowed=true

Grant 更新（如果用户选择"记住"）:
  permission.grant: claude-code, fs.write, mode=ask → allow (带约束)
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| 审批超时 | TIMEOUT | notify.approval.expired 事件 |
| 所有 UI 离线 | NODE_UNREACHABLE | 审批无法推送，（策略决定）超时拒绝 |
| 重复响应 | INVALID_REQUEST | 已响应的 requestId 再次响应被拒绝 |
| 无效 action | INVALID_REQUEST | action 不在 actions 列表中 |

### 测试断言

```
P0:
  [ ] mode=ask 的能力调用触发 NEED_APPROVAL 返回
  [ ] notify.request 后所有连接的 UI 收到 notify.approval.request
  [ ] 用户在任一 UI 上响应后，所有 UI 审批弹窗关闭
  [ ] notify.approval.result 正确回调给请求方
  [ ] 审批超时后触发 notify.approval.expired

P1:
  [ ] 用户选择"allow-always"后 Grant 更新为 allow
  [ ] 用户选择"deny-always"后 Grant 更新为 deny
  [ ] 审批弹窗包含完整的 capability、路径、actor 信息
```

---

## 场景七：多浏览器同步

### 业务价值

用户在多台设备上同时查看同一个 session 的输出。输入、输出在所有设备上同步。

### 涉及模块

- Core: Session Manager, Stream Manager (broadcast)
- Plugin: system-ui
- Actor: system-ui (多个浏览器)

### 协议/API

```
1. Browser A 创建 session
  session.create → session.created

2. Browser A 订阅 stdout
  stream.subscribe { fromSeq: 0 }

3. Browser B 打开同一台 Core（刷新后 welcome 包含 session）
  → welcome { sessions: [sess_abc, ...] }

4. Browser B 订阅 stdout
  stream.subscribe { sessionId: "sess_abc", fromSeq: **0** }
  → 收到从开始到最新的所有 event（replay）

5. Browser A 写 stdin
  stream.write { sessionId: "sess_abc", data: "ls\n" }

6. 进程输出
  → Core 广播 stream.chunk 给 A 和 B
  → A 和 B 都看到输出
```

### 权限

| 校验点 | 说明 |
|--------|------|
| Browser B 订阅 session | B 必须有 stream.subscribe 权限 |
| session 归属 | B 可以查看该 session（策略允许） |
| Browser B 写 stdin | B 必须有 stream.write 权限 |

### 日志/Audit

```
Session Events（所有浏览器共享）:
  eventSeq 1: session.created
  eventSeq 2: stream.stdin (来自 browser A)
  eventSeq 3: stream.stdout (ls 输出)
  eventSeq 4: stream.stdin (来自 browser B)
  eventSeq 5: stream.stdout (cat 输出)
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| Browser B 无权限 | PERMISSION_DENIED | stream.subscribe 被拒绝 |
| Browser B 连到不同 Core | — | 看不到不同 Core 的 session |
| Browser B 断线重连 | — | lastKnownSeq 续传 |

### 测试断言

```
P0:
  [ ] 多个浏览器订阅同一 session 后，都收到相同的 stream.chunk
  [ ] 新订阅的浏览器从 fromSeq 开始 receive replay
  [ ] 任一浏览器写 stdin，所有浏览器看到后续 stdout
  [ ] 一个浏览器断开不影响其他浏览器的订阅

P1:
  [ ] 浏览器断线后重连，从 lastKnownSeq 续传不漏数据
  [ ] 超过 ring buffer 大小的断线，从磁盘 replay 补齐
  [ ] 浏览器数量多时（10+）广播性能不显著下降
```

---

## 场景八：CI/CD 自动化部署

### 业务价值

CI/CD 脚本通过 Service Token 调用 Core API，在远程服务器上执行部署命令。无需人工介入，全审计。

### 涉及模块

- Core: Dispatcher, Process Manager, Permission Checker
- Actor: service (External Client)
- API: Capability API (HTTP)

### 协议/API

```
CI 脚本：
  POST /api/actions
  X-SessionNode-Token: svc_ci_deploy_abc123

  {
    "capability": "session.create",
    "targetNodeId": "node_vps",
    "payload": {
      "kind": "process",
      "command": "bash",
      "args": ["./deploy.sh"],
      "cwd": "/home/user/deploy"
    }
  }

  → { sessionId: "sess_abc", streamIds: {...} }

  CI 脚本轮询 session.get 检查状态：
  GET /api/sessions/sess_abc?token=svc_ci_deploy_abc123
  → { status: "running" }

  等待 session 退出：
  → 最终 status: "stopped", exitCode: 0
```

### 权限

```yaml
# Service Token 配置
core:
  auth:
    serviceTokens:
      - token: "svc_ci_deploy_abc123"
        label: "CI 部署脚本"
        permissions:
          capabilities:
            - session.create
            - session.stop
            - session.get
          constraints:
            commands:
              allow: ["bash", "node"]
            paths:
              allow: ["/home/user/deploy/**"]
```

### 日志/Audit

```
Audit Log:
  capability.call: session.create, actor=service(svc_ci_deploy_abc123), allowed=true
  capability.call: session.get, actor=service(...), allowed=true
  session.stopped: sess_abc, exitCode=0
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| Token 无效 | UNAUTHENTICATED | HTTP 401 |
| Token 过期 | TOKEN_EXPIRED | HTTP 401 |
| 能力未授权 | PERMISSION_DENIED | capability.call 拒绝 |
| command 不在约束内 | PERMISSION_DENIED | process.spawn 拒绝 |
| 目标节点不可达 | NODE_UNREACHABLE | session.create 失败 |
| 部署脚本返回非 0 | — | session 正常停止但 exitCode ≠ 0 |

### 测试断言

```
P0:
  [ ] 有效的 Service Token 可以调授权的 capability
  [ ] Service Token 调未授权的能力时被拒绝
  [ ] command 不在 token 约束范围内被拒绝
  [ ] 无效/过期 Token 返回 UNAUTHENTICATED
  [ ] External Client 不能调 Plugin Management API

P1:
  [ ] Service Token 的 audit 记录包含 token label
  [ ] Token 过期后所有请求被拒绝
  [ ] 多个 Token 各自权限隔离
```

---

## 场景九：节点拓扑管理

### 业务价值

用户管理多个节点的连接拓扑，查看节点状态，进行 relay/leaf 配置变更。

### 涉及模块

- Core: Topology Manager, Router
- Plugin: system-ui
- Actor: system-ui / cli-user

### 协议/API

```
1. 查看节点列表
  GET /api/nodes
  → { nodes: [{ nodeId, label, status, role, lastSeen }, ...] }

2. 查看节点详情
  GET /api/nodes/node_vps
  → { env, version, uptime, plugins, sessions }

3. 健康检查
  GET /api/nodes/node_vps/health
  → { status: "ok", uptime: 3600, rtt: 15 }

4. 节点连接事件（WebSocket 推送）
  → node.joined { nodeId, role }
  → node.left { nodeId, reason }

5. 断开节点
  POST /api/nodes/node_vps/disconnect
  → { success: true }
```

### 权限

| Actor | 所需权限 | 说明 |
|-------|---------|------|
| system-ui | node.read, node.info, node.health | 只读 |
| system-ui | node.disconnect | 管理操作（需要 Plan） |

### 日志/Audit

```
Core Log:
  node connected: nodeId=node_vps, role=leaf, address=wss://...
  node disconnected: nodeId=node_vps, reason=ping timeout

Audit Log:
  node.connected: nodeId=node_vps, role=leaf
  node.disconnected: nodeId=node_vps, reason=user initiated
  capability.call: node.disconnect, allowed=true
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| 节点不存在 | NODE_NOT_FOUND | node.get 返回 404 |
| 节点断连失败 | FORWARD_ERROR | disconnect 到目标节点失败 |
| 无权限 | PERMISSION_DENIED | node.disconnect 被拒绝 |
| 心跳超时 | — | 节点自动标记为 disconnected |

### 测试断言

```
P0:
  [ ] node.list 返回所有已知节点
  [ ] node.health 返回节点健康状态
  [ ] 节点连接后 node.joined 事件广播
  [ ] 节点断开后 node.left 事件广播
  [ ] node.disconnect 成功断开节点连接
  [ ] 无权限的节点操作被拒绝

P1:
  [ ] 节点断线自动检测并更新状态
  [ ] 节点重连后路由表恢复
  [ ] 节点角色变更（relay ↔ leaf）正确更新
```

---

## 场景十：系统监控与告警

### 业务价值

管理员查看 Core 运行状态、日志、审计，及时发现和排查问题。

### 涉及模块

- Core: Log Manager, Audit Logger, Health Checker
- Plugin: system-ui, system-monitor
- Actor: system-ui

### 协议/API

```
1. 查看 Core 日志
  GET /api/logs/core?level=error&limit=50
  → { lines: [{ ts, level, msg, nodeId }, ...] }

2. 查看 Audit 日志
  GET /api/logs/audit?action=permission.grant&limit=20
  → { lines: [{ ts, action, actor, pluginId }, ...] }

3. 实时 tail
  WebSocket: logs.tail { source: "core", level: "error" }
  → 实时推送日志行

4. 系统健康概览
  GET /api/health
  → { status: "ok", version: "2.0.0", uptime: 3600, nodes: 3, sessions: 5 }
```

### 权限

| Actor | 所需权限 | 说明 |
|-------|---------|------|
| system-ui | logs.read, logs.tail, logs.query | 日志查看 |
| system-ui | node.health | 健康检查 |

### 日志/Audit

```
Audit Log:
  capability.call: logs.query, source=audit, allowed=true
  capability.call: logs.tail, source=core, allowed=true
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| 日志源不存在 | INVALID_REQUEST | 日志查询返回错误 |
| 日志权限不足 | PERMISSION_DENIED | 插件不能看其他插件日志 |
| 日志文件损坏 | — | 部分日志不可读，不影响 Core 运行 |

### 测试断言

```
P0:
  [ ] logs.query 按 level 和时间范围过滤日志
  [ ] logs.tail 实时推送新日志
  [ ] 插件只能看自己的日志（不能看其他插件）
  [ ] system-ui 可以看所有日志

P1:
  [ ] 日志轮转后查询仍可用
  [ ] 大量日志下查询性能在可接受范围内
```

---

## 场景十一：缓存清理与副作用追踪

### 业务价值

用户清理插件缓存时，Core 生成清理计划、记录副作用、保护共享依赖。所有操作可追溯。

### 涉及模块

- Core: Cache Manager, Install Side Effect Tracker, Permission Checker
- Plugin: system-ui (Settings)
- Actor: system-ui

### 协议/API

```
1. 查看缓存列表
  GET /api/plugins/claude-code/cache
  → { caches: [{ id, paths, size, risk, clearable }, ...] }

2. 生成清理计划
  POST /api/plugins/claude-code/cache/clear
  Body: { cacheId: "claude-plugin-cache" }
  → { plan: { cacheId, path, estimatedSize, entries, risk, requiresApproval } }

3. 用户确认后执行
  POST /api/plugins/claude-code/cache/clear/execute
  Body: { cacheId: "claude-plugin-cache", planId: "..." }
  → { status: "success", freedSize: "12.5MB", freedEntries: 42 }

4. 查看共享依赖保护
  POST /api/plugins/claude-code/cache/clear
  Body: { cacheId: "npm-cache" }
  → { plan: { risk: "high", note: "Shared dependency (refCount: 2)", requiresApproval: true } }
```

### 权限

| Actor | 所需权限 | 说明 |
|-------|---------|------|
| system-ui | plugin.cache.list | 查看 |
| system-ui | plugin.cache.clear | 执行清理（需要 Plan） |

### 日志/Audit

```
Audit Log:
  cache.clear.plan: claude-code, cacheId=claude-plugin-cache, risk=low
  cache.clear.execute: claude-code, cacheId=claude-plugin-cache, status=success

Cleanup History:
  claude-code, cacheId=claude-plugin-cache, mode=core, 42 entries, 12.5MB, success

Side Effects:
  claude-plugin-cache: ~/.sessionnode/plugins/claude-code/cache (clearable)
  npm-cache: C:/Users/.../npm-cache (shared, refCount: 2)
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| 清理无 Plan | INVALID_REQUEST | 必须先 gen plan |
| 共享依赖引用 >0 | PERMISSION_DENIED | 需用户确认高风险 |
| 缓存不存在 | CACHE_NOT_FOUND | cacheId 无效 |
| 缓存不可清理 | CACHE_NOT_CLEARABLE | clearable=false |
| 磁盘错误 | CACHE_CLEAR_FAILED | 清理操作失败 |

### 测试断言

```
P0:
  [ ] plugin.cache.list 返回所有缓存条目
  [ ] plugin.cache.clear 先生成 Plan 再执行
  [ ] Plan 中正确展示 risk/entries/size
  [ ] 执行清理后文件被删除，size 更新
  [ ] 共享依赖清理需要高风险确认
  [ ] 清理历史可查询

P1:
  [ ] 引用计数 >0 的共享依赖不能直接清理
  [ ] 清理后插件重建缓存正常工作
```

---

## 场景十二：离线与断线重连

### 业务价值

网络不稳定时，Core 和客户端都能正确处理断线、重连、数据续传。不丢数据、不错乱。

### 涉及模块

- Core: WebSocket Manager, Stream Manager, Session Manager
- Plugin: system-ui
- Actor: all

### 协议/API

```
1. 客户端连接 Core WebSocket
  → hello { nodeId, lastKnownSeq: 42 }

2. Core 回复 welcome
  → { sessions: [...], lastSeq: 99 }

3. Core 推送未同步的 events（从 lastKnownSeq+1 到 lastSeq）
  → for each: session.event { eventSeq: 43, ... }
  → ...
  → session.event { eventSeq: 99, ... }

4. 客户端恢复
  → 与断开前状态一致

5. 超出 ring buffer：
  → 客户端发送 stream.replay { fromSeq: 0 }
  → Core 从磁盘读取 events.jsonl 返回
```

### 权限

无需额外权限。断线重连是 Core 基础设施能力。

### 日志/Audit

```
Core Log:
  websocket disconnected: clientId=xxx, reason=ping timeout
  websocket reconnected: clientId=xxx, fromSeq=42, missed=57 events
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| 断线时间过长 | — | session 继续运行，client 需要 replay |
| 重连后 token 过期 | UNAUTHENTICATED | hello 被拒绝 |
| 磁盘 events.jsonl 损坏 | — | replay 部分失败，返回已有数据 |
| Core 崩溃重启 | — | 上次 running session 标记为 stopped |

### 测试断言

```
P0:
  [ ] 客户端断线后 session 继续运行
  [ ] 客户端重连后收到未同步的 events（从 lastKnownSeq 续传）
  [ ] 超出 ring buffer 的断线从磁盘 replay 补齐
  [ ] Core 重启后 session 状态不丢失（停止的保留在磁盘）

P1:
  [ ] 快速连续断线重连（10 次）不丢失状态
  [ ] Client 断线后写入的 stdin 不丢（relay 缓冲）
  [ ] 多个客户端在不同时间断线重连，各自正确续传
```

---

## 场景十三：多用户 Service Token 管理

### 业务价值

管理员创建、管理多个 Service Token，每个 Token 有独立的权限范围和有效期。用于不同团队、不同自动化场景。

### 涉及模块

- Core: Auth Manager, Config Manager, Permission Checker
- Plugin: system-ui (Settings → Service Tokens)
- Actor: system-ui (管理员)

### 协议/API

```
1. 查看 Token 列表
  GET /api/config/auth/serviceTokens
  → { tokens: [{ label, permissions, expiresAt, createdAt }, ...] }

2. 创建新 Token
  POST /api/actions
  {
    pluginId: "system-ui",
    capability: "config.write",
    payload: {
      key: "core.auth.serviceTokens",
      value: [...existingTokens, {
        token: "svc_new_token_xyz",
        label: "Backup Script",
        permissions: {
          capabilities: ["session.create", "session.stop"],
          constraints: { commands: { allow: ["bash"] } }
        },
        expiresAt: "2027-06-01T00:00:00Z"
      }]
    }
  }
  → { success: true }

3. 撤销 Token
  同上，从列表中移除

4. 查看 Token 使用记录
  GET /api/logs/audit?actor=service&label=Backup+Script
  → { lines: [{ ts, action, capability, allowed }, ...] }
```

### 权限

| Actor | 所需权限 | 说明 |
|-------|---------|------|
| system-ui | config.write | 管理 Service Token（敏感 key）|

### 日志/Audit

```
Audit Log:
  config.write: key=core.auth.serviceTokens, action=add_token, label="Backup Script"
  config.write: key=core.auth.serviceTokens, action=revoke_token, label="Backup Script"
  capability.call: session.create, actor=service(Backup Script), allowed=true
```

### 失败状态

| 失败场景 | 错误码 | 表现 |
|---------|--------|------|
| Token 过期 | TOKEN_EXPIRED | 401 |
| Token 被撤销 | UNAUTHENTICATED | 401 |
| Token 权限不足 | PERMISSION_DENIED | 调用未授权能力 |
| 权限范围冲突 | INVALID_REQUEST | 能力约束格式错误 |

### 测试断言

```
P0:
  [ ] 创建新 Token 后可用 Token 调用授权 API
  [ ] Token 调未授权能力被拒绝
  [ ] Token 过期后所有请求被拒绝
  [ ] 撤销 Token 后立即生效
  [ ] 每个 Token 的 audit 记录可追踪（按 label 过滤）

P1:
  [ ] Token 权限范围变更后旧请求不受影响
  [ ] 大量 Token（100+）时认证性能不显著下降
  [ ] Token 到期前有日志告警
```

---

## 场景与文档映射

| 场景 | 主要涉及文档 |
|------|-------------|
| 一：Terminal | SESSION_AND_STREAM.md, CAPABILITY_API.md |
| 二：跨节点 | ARCHITECTURE.md, CORE_PROTOCOL.md |
| 三：Claude Code | PERMISSIONS.md, SESSION_AND_STREAM.md |
| 四：文件浏览 | CAPABILITY_API.md, PERMISSIONS.md |
| 五：插件管理 | PLUGIN_MANAGEMENT.md, PLUGIN_DEFINITION.md |
| 六：审批流 | PERMISSIONS.md, CORE_PROTOCOL.md |
| 七：多浏览器 | SESSION_AND_STREAM.md |
| 八：CI/CD | PLUGIN_DEFINITION.md, CORE_PROTOCOL.md |
| 九：拓扑 | ARCHITECTURE.md |
| 十：监控 | LOGS_AND_AUDIT.md |
| 十一：缓存 | PLUGIN_MANAGEMENT.md |
| 十二：离线 | SESSION_AND_STREAM.md |
| 十三：Token | PLUGIN_DEFINITION.md, PERMISSIONS.md |
