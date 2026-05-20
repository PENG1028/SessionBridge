# SessionNode Core Capability API

> Go Core 的能力边界、权限模型、API 设计
> 配套文档：ARCHITECTURE.md

---

## 目录

1. [设计原则](#一设计原则)
2. [最小可用能力表](#二最小可用能力表)
3. [统一 Dispatcher](#三统一-dispatcher)
4. [协议设计](#四协议设计)
5. [权限模型](#五权限模型)
6. [配置分层](#六配置分层)
7. [认证与 Actor](#七认证与-actor)
8. [已有插件的能力组合](#八已有插件的能力组合)
9. [第一版最小闭环](#九第一版最小闭环)

---

## 一、设计原则

### Core API 不按插件设计，按机器能力设计

```
不要:                    要:
/api/claude/start        process.spawn
/api/terminal/create     session.create + stream.subscribe
/api/fileExplorer/list   fs.list
```

ClaudeCode、Terminal、File Explorer 都只是组合这些能力的消费者。

### 统一入口

所有能力调用走同一个 Dispatcher，不分 HTTP/WS/CLI：

```
HTTP ─┐
WS   ─┤──▶ Dispatcher ──▶ Permission Check ──▶ Route ──▶ Execute
CLI  ─┘
```

### 权限是 Core 的责任，不是插件的

插件声明需要什么，Core 决定给不给。每次调用都校验。

---

## 二、最小可用能力表

### Node

| 能力 | 用途 | 参数 |
|------|------|------|
| `node.list` | 列出所有节点 | - |
| `node.info` | 获取节点详情 | `nodeId` |
| `node.health` | 健康检查 | `nodeId` |

### Session

| 能力 | 用途 | 参数 |
|------|------|------|
| `session.create` | 创建 session（长期运行实体） | `kind`, `command`, `args`, `cwd`, `env` |
| `session.list` | 列出所有 session | `nodeId?` |
| `session.get` | 获取 session 详情 | `sessionId` |
| `session.stop` | 停止 session | `sessionId` |
| `session.events` | 获取 session event 列表 | `sessionId`, `fromSeq?`, `toSeq?` |
| `session.replay` | 获取 session event 流 | `sessionId`, `fromSeq` |

### Process

| 能力 | 用途 | 参数 |
|------|------|------|
| `process.spawn` | 启动进程（由 session.create 内部调用） | `command`, `args`, `cwd`, `env` |
| `process.kill` | 终止进程 | `sessionId` |
| `process.resize` | 调整 pty 尺寸 | `sessionId`, `rows`, `cols` |
| `process.status` | 进程状态 | `sessionId` |

### Stream

| 能力 | 用途 | 参数 |
|------|------|------|
| `stream.subscribe` | 订阅 stream（WebSocket） | `sessionId`, `streamType`, `fromSeq?` |
| `stream.write` | 写入 stream（stdin） | `sessionId`, `data` |
| `stream.replay` | 回放 stream 历史 | `sessionId`, `streamType`, `fromSeq`, `toSeq?` |

### FS

| 能力 | 用途 | 参数 |
|------|------|------|
| `fs.list` | 目录列表 | `path` |
| `fs.read` | 文件读取 | `path`, `offset?`, `limit?` |
| `fs.write` | 文件写入 | `path`, `data`, `append?` |
| `fs.stat` | 文件信息 | `path` |
| `fs.watch` | 文件监控（WebSocket） | `path` |

### Env

| 能力 | 用途 | 参数 |
|------|------|------|
| `env.info` | 系统信息 | - |
| `env.checkBinary` | 检查二进制是否存在 | `name`, `version?` |
| `env.which` | 查找二进制路径 | `name` |
| `env.home` | 用户 home 目录 | - |
| `env.cwd` | 当前工作目录 | `sessionId?` |
| `env.vars` | 读取环境变量 | `keys?` |

### Config

| 能力 | 用途 | 参数 |
|------|------|------|
| `config.get` | 读取配置 | `key` |
| `config.set` | 写入配置 | `key`, `value` |
| `config.list` | 列出配置命名空间 | `prefix?` |
| `config.watch` | 配置变更订阅（WebSocket） | `key?` |

### Logs

| 能力 | 用途 | 参数 |
|------|------|------|
| `logs.tail` | 查看最新日志 | `source`, `lines?` |
| `logs.query` | 查询日志 | `source`, `level?`, `from?`, `to?`, `limit?` |
| `logs.session` | 查看 session 日志 | `sessionId` |

### Notify

| 能力 | 用途 | 参数 |
|------|------|------|
| `notify.send` | 发送通知 | `type`, `title`, `body` |
| `notify.request` | 发起审批请求 | `title`, `body`, `actions`, `timeout` |
| `notify.respond` | 响应审批请求 | `requestId`, `action` |

### Plugin

| 能力 | 用途 | 参数 |
|------|------|------|
| `plugin.list` | 列出已注册插件 | - |
| `plugin.get` | 获取插件详情 | `pluginId` |
| `plugin.enable` | 启用插件 | `pluginId` |
| `plugin.disable` | 禁用插件 | `pluginId` |
| `plugin.permissions.get` | 查看插件权限 | `pluginId` |
| `plugin.permissions.grant` | 授权权限 | `pluginId`, `capability`, `constraints?` |
| `plugin.permissions.revoke` | 撤销权限 | `pluginId`, `capability` |

---

## 三、统一 Dispatcher

### 核心数据结构

```go
// pkg/types/capability.go

type Actor struct {
    Type string `json:"type"` // "web" | "cli" | "plugin" | "node" | "service"
    ID   string `json:"id"`
}

type CapabilityRequest struct {
    RequestID    string          `json:"requestId"`
    Actor        Actor           `json:"actor"`
    PluginID     string          `json:"pluginId,omitempty"` // 插件调用时必填，External Client 不填
    TargetNodeID string          `json:"targetNodeId,omitempty"` // 空 = 本机
    Capability   string          `json:"capability"`
    Payload      json.RawMessage `json:"payload"`
    Timestamp    int64           `json:"timestamp"`
}

type CapabilityResponse struct {
    RequestID string      `json:"requestId"`
    OK        bool        `json:"ok"`
    Payload   interface{} `json:"payload,omitempty"`
    Error     *CoreError  `json:"error,omitempty"`
}

type CoreError struct {
    Code    string `json:"code"`
    Message string `json:"message"`
}
```

### Dispatcher 执行链

```go
// internal/node/dispatcher.go

func (d *Dispatcher) Dispatch(req *CapabilityRequest) *CapabilityResponse {
    // 1. 认证身份
    actor := d.auth.Authenticate(req.Actor)
    if actor == nil {
        return d.error(req, "UNAUTHENTICATED", "invalid actor")
    }

    // 2. 解析插件
    plugin := d.plugins.Get(req.PluginID)
    if plugin == nil {
        return d.error(req, "PLUGIN_NOT_FOUND", "unknown plugin: "+req.PluginID)
    }

    // 3. 检查插件是否启用
    if !plugin.Enabled {
        return d.error(req, "PLUGIN_DISABLED", "plugin is disabled")
    }

    // 4. 检查权限
    if err := d.permissions.Check(req); err != nil {
        d.audit.Log(req, false, err.Error())
        return d.error(req, "PERMISSION_DENIED", err.Error())
    }

    // 5. 路由到目标节点
    if req.TargetNodeID != "" && req.TargetNodeID != d.node.ID() {
        return d.routeRemote(req)
    }

    // 6. 执行能力
    result, err := d.executor.Execute(req)
    if err != nil {
        d.audit.Log(req, false, err.Error())
        return d.error(req, "EXECUTION_ERROR", err.Error())
    }

    // 7. 审计日志
    d.audit.Log(req, true, "")

    // 8. 返回结果
    return &CapabilityResponse{
        RequestID: req.RequestID,
        OK:        true,
        Payload:   result,
    }
}
```

### 远程路由

```go
func (d *Dispatcher) routeRemote(req *CapabilityRequest) *CapabilityResponse {
    // 检查目标节点是否可达
    target := d.topology.Get(req.TargetNodeID)
    if target == nil {
        return d.error(req, "NODE_UNREACHABLE", "target node not found")
    }

    // 通过 relay 转发请求
    resp, err := target.Forward(req)
    if err != nil {
        return d.error(req, "FORWARD_ERROR", err.Error())
    }

    return resp
}
```

### 三种入口都走 Dispatcher

```go
// HTTP handler
func (h *HTTPHandler) HandleAction(w http.ResponseWriter, r *http.Request) {
    var req CapabilityRequest
    json.NewDecoder(r.Body).Decode(&req)
    req.Actor = Actor{Type: "web", ID: r.RemoteAddr}
    resp := h.dispatcher.Dispatch(&req)
    json.NewEncoder(w).Encode(resp)
}

// WebSocket handler
func (h *WSHandler) HandleMessage(msg *Message) {
    var req CapabilityRequest
    msg.DecodePayload(&req)
    req.Actor = Actor{Type: msg.From.Type, ID: msg.From.ID}
    resp := h.dispatcher.Dispatch(&req)
    msg.Respond(resp)
}

// CLI handler
func (h *CLIHandler) HandleExec(cmd *cobra.Command, args []string) {
    req := CapabilityRequest{
        PluginID:     "shell",
        Capability:   "session.create",
        TargetNodeID: cmd.Flag("target").Value.String(),
        Payload:      buildPayload(cmd, args),
    }
    resp := h.dispatcher.Dispatch(&req)
    printResponse(resp)
}
```

---

## 四、协议设计

### WebSocket 消息

```json
// === Action（一次性能力调用）===

// 请求
{
  "type": "action.request",
  "requestId": "req_123",
  "pluginId": "claude-code",
  "targetNodeId": "node_vps",
  "capability": "fs.list",
  "payload": { "path": "~/.claude" },
  "timestamp": 1712345678000
}

// 成功
{
  "type": "action.response",
  "requestId": "req_123",
  "ok": true,
  "payload": { "entries": [...] },
  "timestamp": 1712345678001
}

// 失败
{
  "type": "action.response",
  "requestId": "req_123",
  "ok": false,
  "error": { "code": "PERMISSION_DENIED", "message": "path not allowed" },
  "timestamp": 1712345678001
}


// === Session ===

// 创建 session
{
  "type": "session.create",
  "requestId": "req_124",
  "pluginId": "claude-code",
  "targetNodeId": "node_vps",
  "payload": {
    "kind": "process",
    "command": "claude",
    "args": ["--output-format", "stream-json"],
    "cwd": "/repo",
    "env": { "CLAUDE_MODEL": "sonnet" }
  }
}

// 创建成功
{
  "type": "session.created",
  "requestId": "req_124",
  "ok": true,
  "sessionId": "sess_abc",
  "streamIds": {
    "stdin": "stream_stdin_abc",
    "stdout": "stream_stdout_abc",
    "stderr": "stream_stderr_abc"
  }
}

// Session event（Core → subscriber 实时推送）
{
  "type": "session.event",
  "sessionId": "sess_abc",
  "eventSeq": 42,
  "pluginId": "claude-code",
  "event": "stream.stdout",
  "payload": { "stream": "stdout", "data": "base64..." },
  "timestamp": 1712345679000
}

// 停止 session
{
  "type": "session.stop",
  "requestId": "req_125",
  "pluginId": "claude-code",
  "sessionId": "sess_abc"
}

// Session 停止事件
{
  "type": "session.event",
  "sessionId": "sess_abc",
  "eventSeq": 99,
  "event": "session.stopped",
  "payload": { "exitCode": 0 }
}


// === Stream ===

// 订阅 stream
{
  "type": "stream.subscribe",
  "requestId": "req_126",
  "pluginId": "claude-code",
  "sessionId": "sess_abc",
  "streamType": "stdout",
  "fromSeq": 0
}

// 订阅确认
{
  "type": "stream.subscribed",
  "requestId": "req_126",
  "ok": true,
  "sessionId": "sess_abc",
  "streamType": "stdout"
}

// Stream chunk（实时）
{
  "type": "stream.chunk",
  "sessionId": "sess_abc",
  "streamType": "stdout",
  "eventSeq": 43,
  "data": "base64...",
  "timestamp": 1712345679000
}

// 写入 stdin
{
  "type": "stream.write",
  "requestId": "req_127",
  "pluginId": "shell",
  "sessionId": "sess_abc",
  "data": "bHMgLWxhCg=="
}


// === Notify / Approval ===

// 审批请求
{
  "type": "notify.request",
  "requestId": "req_128",
  "pluginId": "claude-code",
  "payload": {
    "title": "Read file",
    "body": "Claude wants to read /etc/hosts",
    "actions": [
      { "id": "allow-once", "label": "Allow Once" },
      { "id": "allow-workspace", "label": "Allow for workspace" },
      { "id": "deny", "label": "Deny" }
    ],
    "timeout": 30000
  }
}

// 审批请求推送（Core → 所有 Web UI）
{
  "type": "notify.approval.request",
  "requestId": "req_128",
  "pluginId": "claude-code",
  "payload": {
    "title": "Read file",
    "body": "Claude wants to read /etc/hosts",
    "actions": [...],
    "timeout": 30000
  }
}

// 用户响应
{
  "type": "notify.respond",
  "requestId": "req_128",
  "pluginId": "_web",
  "action": "allow-once"
}

// 审批结果（Core → 请求方）
{
  "type": "notify.approval.result",
  "requestId": "req_128",
  "action": "allow-once",
  "respondedBy": "user",
  "timestamp": 1712345680000
}
```

### HTTP API

```http
GET  /api/core/health

GET  /api/nodes
GET  /api/nodes/:nodeId

POST /api/actions
# Body: { capability, pluginId?, targetNodeId?, payload }
# pluginId: 插件调用时必填，External Client 不填
# → { requestId, ok, payload }

GET  /api/actions/:requestId

GET  /api/sessions
POST /api/sessions
# Body: { pluginId, kind, command, args?, cwd?, env?, targetNodeId? }
# → { sessionId, streamIds }

GET  /api/sessions/:sessionId
DELETE /api/sessions/:sessionId

GET  /api/plugins
GET  /api/plugins/:pluginId
GET  /api/plugins/:pluginId/permissions
POST /api/plugins/:pluginId/permissions/grant
POST /api/plugins/:pluginId/permissions/revoke

GET  /api/config
PUT  /api/config/:key

GET  /api/logs/core
GET  /api/logs/audit
GET  /api/logs/session/:sessionId
```

WebSocket 端点：

```
/ws
```

所有流式、订阅、推送走 WebSocket。action.request/response 也可以走 WebSocket（不用 HTTP 轮询）。

---

## 五、权限模型

### 四层结构

```
1. Core Capability
   Go Core 实现的所有能力（fs.*, process.*, ...）

2. Plugin Request
   插件 manifest 声明需要哪些能力和约束

3. Grant
   用户/管理员实际授予的权限（存 config.yaml）

4. Runtime Check
   每次 Dispatcher.Dispatch() 检查
```

### 插件 Manifest 权限声明

```yaml
# plugins/claude-code/plugin.yaml
id: claude-code
version: "1.0.0"

requires:
  capabilities:
    - env.checkBinary
    - fs.list
    - fs.read
    - fs.write
    - process.spawn
    - process.stdin
    - process.stdout
    - stream.subscribe
    - stream.write
    - logs.session
    - notify.request
    - config.get
    - config.set

permissions:
  fs.read:
    description: "Read project files and Claude config"
    allow:
      - "~/.claude/**"
      - "${workspace}/**"
    deny:
      - "**/.env"
      - "**/node_modules/**"

  fs.write:
    description: "Write project files"
    allow:
      - "${workspace}/**"
    deny:
      - "**/.env"

  process.spawn:
    description: "Start Claude Code process"
    allow:
      - "claude"
    deny: []

  env.vars:
    description: "Read environment variables"
    allow:
      - "PATH"
      - "HOME"
      - "CLAUDE_*"

  config:
    description: "Plugin configuration"
    keys:
      - "plugins.claude-code.*"
```

### Grant 存储

```yaml
# ~/.sessionnode/config.yaml
plugin:
  grants:
    claude-code:
      fs.read:
        mode: allow
        constraints:
          allow: ["~/.claude/**", "${workspace}/**"]
          deny: ["**/.env"]
      process.spawn:
        mode: allow
        constraints:
          allow: ["claude"]
      notify.request:
        mode: allow              # 不需要额外约束
      config.write:
        mode: allow
        constraints:
          keys: ["plugins.claude-code.*"]

    file-explorer:
      fs.list:
        mode: allow
      fs.read:
        mode: ask                # 每次询问
```

### Runtime Check 流程

```go
func (c *Checker) Check(req *CapabilityRequest) error {
    plugin := c.registry.Get(req.PluginID)

    // 1. 插件是否声明此能力
    if !plugin.Requires(req.Capability) {
        return &CoreError{Code: "CAPABILITY_NOT_DECLARED"}
    }

    // 2. 是否有 grant
    grant := c.policy.GetGrant(req.PluginID, req.Capability)
    if grant == nil {
        return &CoreError{Code: "NOT_GRANTED"}
    }

    // 3. grant 模式
    switch grant.Mode {
    case "deny":
        return &CoreError{Code: "PERMISSION_DENIED"}
    case "ask":
        // 返回 "need_approval"，Core 触发 notify.request
        return &CoreError{Code: "NEED_APPROVAL"}
    case "allow":
        // 继续
    }

    // 4. 路径约束检查
    if grant.Constraints != nil && grant.Constraints.Allow != nil {
        if !matchPath(grant.Constraints.Allow, grant.Constraints.Deny, payloadPath(req.Payload)) {
            return &CoreError{Code: "PATH_NOT_ALLOWED"}
        }
    }

    return nil
}
```

### 权限时序

```
插件加载 ──▶ 读取 manifest
           ▶ 检查已存 grant
           ▶ 缺失 → 标记 pending
           ▶ 用户打开权限页面 → 看到 pending 权限
           ▶ 用户授权 → 写入 grant
           ▶ 插件可用
```

---

## 六、配置分层

### 配置层级

```
core config         → ~/.sessionnode/config.yaml        # 全局配置
  node config       → ~/.sessionnode/nodes/{id}.yaml     # 节点覆盖
    plugin config   → ~/.sessionnode/plugins/{id}.yaml   # 插件配置
      workspace config → 工作区内的 .sessionnode.yaml    # 项目级配置
```

示例：

```yaml
# ~/.sessionnode/config.yaml
core:
  listen: ":8080"
  dataDir: "~/.sessionnode"
  auth:
    enabled: true
    adminToken: "..."        # 首次启动生成
  log:
    level: "info"
    maxSize: "100MB"
    maxFiles: 10

node:
  name: "PENGSPC"
  role: "relay"              # relay | leaf | standalone

plugins:
  claude-code:
    enabled: true
    defaultModel: "sonnet"
    permissionMode: "default" # default | ask | deny
  file-explorer:
    enabled: true
  shell:
    enabled: true
  system-status:
    enabled: true

workspaces:
  "F:/Work Document/project/sessionBridge":
    trusted: false
    plugins:
      claude-code:
        allowed: true
```

### 配置读取规则

```
config.get("plugins.claude-code.defaultModel")
  → 查 workspace config → 有则返回
  → 查 plugin config → 有则返回
  → 查 core config → 有则返回
  → 返回默认值 "sonnet"
```

### CLI 和 Web 都是 Config 的客户端

```
CLI: node config set plugins.claude-code.defaultModel sonnet
Web: 设置页 → 插件 → ClaudeCode → 默认模型
     ↓                ↓
  Core API: config.set { key: "plugins.claude-code.defaultModel", value: "sonnet" }
```

---

## 七、认证与 Actor

### Actor 模型

每个请求必须标明身份：

```go
type Actor struct {
    Type string `json:"type"` // "web" | "cli" | "plugin" | "node" | "service"
    ID   string `json:"id"`
    Token string `json:"token,omitempty"`
}
```

### Token 类型

| Token | 用途 | 权限级别 |
|-------|------|---------|
| `admin` | 初始配置、管理操作 | 全部（安装后应禁用或轮换） |
| `node` | 节点间通信 | relay + 本节点能力 |
| `plugin` | 插件进程 → Core IPC | 受限（按 grant） |
| `web` | 浏览器会话 | 受限（用户操作） |
| `service` | External Client（CI/CD、脚本等） | 受限（按 token 声明） |

第一版实现：

```yaml
# ~/.sessionnode/config.yaml
core:
  auth:
    enabled: true
    adminToken: "ntf8_2kD..."    # 首次启动打印到 stdout
    webTokens:                    # 浏览器令牌，用户从 Web UI 生成
      - "web_tok_abc"
      - "web_tok_def"
    serviceTokens:              # External Client 令牌，管理员创建
      - name: "ci-deploy"
        token: "svc_tok_xxx"
        capabilities: ["session.create", "fs.read", "plugin.status"]
        constraints:
          targetNode: "node-*"
```

### 认证流程

```
请求 → 提取 token → 查 token 表 → 确定 Actor → 注入 Dispatcher
```

---

## 八、已有插件的能力组合

### Terminal 插件

```yaml
# plugins/shell/plugin.yaml
id: shell
capabilities:
  - session.create    # spawn shell process
  - stream.subscribe  # subscribe stdout/stderr
  - stream.write      # write stdin
  - process.resize    # pty resize
  - session.stop      # kill shell
  - session.list      # list sessions
```

用户操作：

```
1. 用户点 "New Terminal"
2. 前端调 session.create { kind: "process", command: "bash"|"powershell"|"zsh" }
3. Core 返回 { sessionId, streamIds }
4. 前端 stream.subscribe { sessionId, streamType: "stdout", fromSeq: 0 }
5. 实时接收 stream.chunk
6. 用户输入 → stream.write { sessionId, data: "ls\n" }
7. Resize → process.resize { sessionId, rows: 24, cols: 80 }
8. 关闭 → session.stop { sessionId }
```

### File Explorer 插件

```yaml
# plugins/file-explorer/plugin.yaml
id: file-explorer
capabilities:
  - fs.list
  - fs.read
  - fs.stat
  - fs.watch
```

用户操作：

```
1. 用户打开文件树
2. 展开目录 → fs.list { path: "/home/user/project" }
3. 点击文件 → fs.read { path: "main.go", limit: 4096 }
4. 属性 → fs.stat { path: "main.go" }
5. 文件变更 → fs.watch { path: "/home/user/project" }
   → 实时 fs.event 推送
```

### ClaudeCode 插件

```yaml
# plugins/claude-code/plugin.yaml
id: claude-code
capabilities:
  - env.checkBinary    # 检查 claude 是否存在
  - config.get         # 读取配置
  - config.set         # 写入配置
  - fs.list            # 读取 ~/.claude/projects
  - fs.read            # 读取 history, config
  - fs.write           # 写入 workspace 文件
  - session.create     # 启动 claude 进程
  - stream.subscribe   # 订阅 stdout/stderr
  - stream.write       # 写入 stdin
  - stream.replay      # 重放输出
  - logs.session       # session 日志
  - notify.request     # approval request
  - notify.send        # 通知
```

用户操作：

```
1. 打开 ClaudeChatView
2. env.checkBinary("claude") → found: true
3. fs.list("~/.claude/projects") → 显示项目列表
4. 用户选项目 → session.create { command: "claude", args: [...], cwd: "/repo" }
5. stream.subscribe stdout/stderr
6. parser 解析 stream-json → 渲染 tool blocks
7. Claude 要读文件 → notify.request → 用户点 Allow → notify.respond
8. Claude 写文件 → fs.write → Core 记录 audit
9. 用户关闭 → session.stop
```

### System Status 插件

```yaml
# plugins/system-status/plugin.yaml
id: system-status
capabilities:
  - env.info
  - node.health
  - logs.tail
  - config.get
  - session.list
```

---

## 九、第一版最小闭环

### 先做的能力

```
node.list
env.checkBinary
fs.list
fs.read
config.get
config.set
session.create
session.list
session.stop
session.events
stream.subscribe
stream.write
logs.session
plugin.list
plugin.permissions.get
plugin.permissions.grant
```

### 能跑起来的东西

```
Terminal:       session.create + stream.subscribe + stream.write
ClaudeCode:     env.checkBinary + fs.list + session.create + stream.subscribe + stream.write
File Explorer:  fs.list + fs.read
Web Settings:   config.get + config.set + plugin.permissions.grant
CLI:            session.create + stream.subscribe + stream.write
```

### 后面再补

```
fs.watch       文件监控（WebSocket）
notify.request 审批流（依赖 UI slot 系统）
process.resize 终端 resize
env.vars       环境变量读取
config.watch   配置变更订阅
node.health    健康检查
```

### 核心判断标准

```
Core API 不是给某个插件定制的，
而是给所有插件提供受权限控制的机器能力。

Web 能调，CLI 能调，插件也能调，
但所有路径都回到 Go Core 的：
  Dispatcher → Permission → Route → Audit
```
