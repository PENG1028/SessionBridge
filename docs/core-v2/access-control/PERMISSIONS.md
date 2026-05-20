# SessionNode v2 — 权限系统设计

> Core Capability → Plugin Request → Grant → Runtime Check → Audit
> 配套文档：ARCHITECTURE.md、CAPABILITY_API.md、CORE_PROTOCOL.md、PLUGIN_MANAGEMENT.md

---

## 目录

1. [设计原则](#一设计原则)
2. [权限总表](#二权限总表)
3. [三层模型](#三三层模型)
4. [Grant 模式](#四grant-模式)
5. [权限校验流程](#五权限校验流程)
6. [约束系统](#六约束系统)
7. ["Ask" 模式——实时审批](#七ask-模式实时审批)
8. [System UI 权限](#八system-ui-权限)
9. [远程节点权限](#九远程节点权限)
10. [权限变更审计](#十权限变更审计)
11. [Web UI 权限管理](#十一web-ui-权限管理)
12. [CLI 权限管理](#十二cli-权限管理)
13. [第一版实现范围](#十三第一版实现范围)
14. [防回退规则](#十四防回退规则)

---

## 一、设计原则

### 原则 1：Core Capability 是原子砖块

```text
Core 定义 fs.* / process.* / config.* / plugin.* 等原子能力。
插件声明需要哪些，用户授予哪些。
Core 不定义"ClaudeCode 权限"和"Terminal 权限"的区别。
```

### 原则 2：每次调用都校验

```text
不像传统应用"登录后就可以做任何事"。
SessionNode 的每个 action.request 都独立校验。
插件声明能力 ≠ 插件获得能力。
能力调用权限在运行时由 Dispatcher 逐次检查。
```

### 原则 3：权限是 Core 的责任，不是插件的

```text
插件不自己检查"我能不能读这个文件"。
插件调用 fs.read，Core 检查路径约束。
插件不绕过、不自检、不代行。
```

### 原则 4：Web 和 CLI 走同一套权限

```text
System UI 调 Core API 和 CLI 调 Core API 的权限校验路径一致。
没有"CLI 权限更高"或"Web 可以绕过"。
```

### 原则 5：Target Node 上校验

```text
请求从 node A 转发到 node B 后，
在 node B 的 Core 上重新校验权限。
Relay 不代行、不绕过。
```

---

## 二、权限总表

### Node

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `node.read` | 查看节点列表和状态 | low | 基本信息 |
| `node.info` | 查看节点详细信息 | low | 含 env 信息 |
| `node.health` | 健康检查 | low | ping |
| `node.disconnect` | 断开节点连接 | high | 影响拓扑 |

### Session

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `session.list` | 列出 session | low | 只读 |
| `session.read` | 查看 session 详情 | low | 包含 stream 元信息 |
| `session.create` | 创建 session | medium | 启动进程 |
| `session.stop` | 停止 session | medium | 终止进程 |
| `session.events` | 查看 session 事件 | low | 读事件日志 |

### Stream

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `stream.subscribe` | 订阅 stream | low | 读实时输出 |
| `stream.write` | 写入 stream | medium | 写 stdin |
| `stream.replay` | 回放 stream 历史 | low | 读历史数据 |

### Process

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `process.spawn` | 启动进程 | **high** | 执行任意命令 |
| `process.kill` | 终止进程 | medium | 杀进程 |
| `process.resize` | 调整 pty 尺寸 | low | 终端 resize |
| `process.status` | 查看进程状态 | low | CPU/内存 |

### FS

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `fs.list` | 列出目录 | low | 读文件名 |
| `fs.stat` | 查看文件信息 | low | 元数据 |
| `fs.read` | 读取文件 | low-medium | 读内容（敏感文件需要保护） |
| `fs.write` | 写入文件 | **high** | 修改文件 |
| `fs.delete` | 删除文件 | **high** | 删除文件 |
| `fs.watch` | 文件监控 | low | 订阅变更事件 |
| `fs.exists` | 检查文件存在 | low | 快速检测 |

### Env

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `env.info` | 系统信息 | low | OS/arch |
| `env.checkBinary` | 检查二进制 | low | 安装检测 |
| `env.which` | 查找二进制路径 | low | which/where |
| `env.home` | 用户 home 目录 | low | 路径 |
| `env.cwd` | 当前工作目录 | low | 路径 |
| `env.vars` | 读取环境变量 | low-medium | 可能包含敏感信息 |
| `env.path` | 查看 PATH | low | 路径列表 |

### Config

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `config.list` | 列出配置项 | low | 读 key 列表 |
| `config.read` | 读取配置值 | low | 读值 |
| `config.write` | 写入配置 | medium | 改值（影响系统行为） |
| `config.watch` | 订阅配置变更 | low | 事件订阅 |

### Logs

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `logs.read` | 读取日志 | low | 包含系统信息 |
| `logs.tail` | 实时 tail 日志 | low | 实时输出 |
| `logs.query` | 查询日志 | low | 过滤搜索 |

### Notify

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `notify.send` | 发送通知 | low | 向用户发消息 |
| `notify.request` | 发起审批请求 | low | 请求用户审批 |
| `notify.respond` | 响应审批 | medium | 代行审批 |

### Plugin Management

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `plugin.list` | 列出插件 | low | 只读 |
| `plugin.read` | 查看插件详情 | low | 含 manifest |
| `plugin.enable` | 启用插件 | medium | 暴露新能力 |
| `plugin.disable` | 禁用插件 | medium | 关闭插件 |
| `plugin.install` | 安装插件 | **high** | 执行外部命令 |
| `plugin.repair` | 修复插件 | **high** | 执行命令 |
| `plugin.uninstall` | 卸载插件 | **high** | 删除文件 |
| `plugin.check` | 环境检测 | low | 只读 |
| `plugin.history` | 安装历史 | low | 只读 |

### Plugin Files / Cache

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `plugin.files.readRegistry` | 查看文件注册表 | low | 只读 |
| `plugin.files.register` | 注册文件位置 | medium | 写入 registry |
| `plugin.files.accessHistory` | 文件访问历史 | low | 只读 |
| `plugin.cache.list` | 缓存列表 | low | 只读 |
| `plugin.cache.info` | 缓存详情 | low | 只读 |
| `plugin.cache.clear.plan` | 清理计划 | low | 生成 plan |
| `plugin.cache.clear.execute` | 执行清理 | **high** | 删除文件 |

### Plugin Permissions

| 权限 | 操作 | 危险等级 | 说明 |
|------|------|---------|------|
| `plugin.permissions.read` | 查看权限 | low | 只读 |
| `plugin.permissions.grant` | 授予权限 | **high** | 影响系统安全 |
| `plugin.permissions.revoke` | 撤销权限 | **high** | 影响插件功能 |

---

## 三、三层模型

### 第一层：Core Capability

Go Core 实现的所有原子能力。定义在 `internal/executor/` 中。

```go
// Core 侧定义：哪些能力存在，有哪些参数校验
type CapabilityDef struct {
    Name        string
    Description string
    RiskLevel   string // "low" | "medium" | "high"
    NeedPlan    bool   // 是否需要 plan + 确认
}
```

### 第二层：Plugin Manifest 声明

插件作者声明插件需要哪些能力。

```yaml
# plugins/claude-code/plugin.yaml
requires:
  capabilities:
    - fs.read
    - fs.write
    - process.spawn
    - notify.request

permissions:
  fs.read:
    description: "Read project files"
    allow:
      - "~/.claude/**"
      - "${workspace}/**"
    deny:
      - "**/.env"
```

### 第三层：Grant 存储

用户实际授予的权限，存储在 `~/.sessionnode/config.yaml`。

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
      fs.write:
        mode: ask    # 每次写入需要审批
```

### 三层之间的关系

```
Core Capability 定义"能做到什么"（技术边界）
Plugin Manifest 声明"需要什么"（需求边界）
Grant 决定"允许什么"（策略边界）

Core Capability ⊇ Plugin Request ⊆ Grant
（Core 实现的能力必须覆盖插件声明的）
（Grant 只能授予插件声明的能力）
```

---

## 四、Grant 模式

### 三种模式

| 模式 | 含义 | 适用场景 |
|------|------|---------|
| `allow` | 允许，不询问 | 低风险操作（fs.list, env.info） |
| `ask` | 每次需要用户审批 | 中风险操作（fs.write 到敏感路径） |
| `deny` | 拒绝 | 明确禁止（fs.delete 系统文件） |

### 默认策略

| 能力 | 默认模式 | 理由 |
|------|---------|------|
| `node.read` | allow | 只读，无风险 |
| `session.list` | allow | 只读 |
| `stream.subscribe` | allow | 只读（session 已创建后） |
| `env.info` | allow | 系统基本信息 |
| `env.checkBinary` | allow | 只读 |
| `fs.list` | allow | 只读（路径约束内） |
| `fs.read` | allow | 读文件（路径约束内） |
| `fs.stat` | allow | 元数据 |
| `config.read` | allow | 只读 |
| `logs.read` | allow | 只读 |
| `notify.send` | allow | 仅通知 |
| `notify.request` | allow | 发起审批 |
| `session.create` | allow | 用户主动发起 |
| `session.stop` | allow | 用户主动发起 |
| `stream.write` | allow | 用户主动输入 |
| `process.kill` | allow | 用户主动终止 |
| `process.resize` | allow | 用户操作 |
| `plugin.list` | allow | 只读 |
| `plugin.read` | allow | 只读 |
| `fs.write` | **ask** | 写文件影响大 |
| `fs.delete` | **ask** | 删文件影响大 |
| `process.spawn` | **ask** | 执行命令影响大 |
| `plugin.install` | **ask** | 安装需要确认 |
| `plugin.permissions.grant` | **ask** | 权限管理需要确认 |
| `plugin.cache.clear.execute` | **ask** | 删除文件需要确认 |
| `config.write` | ask | 改配置影响大 |
| `node.disconnect` | ask | 节点管理需要确认 |

### Grant 存储变迁

```
初始状态: 无 grant
用户安装插件 → 看到 manifest 声明 → 逐一授权 → grant 创建
用户修改权限 → grant 更新
用户撤销 → grant 删除或标记 deny
```

---

## 五、权限校验流程

### Dispatcher 中的校验

```go
func (d *Dispatcher) Dispatch(req *CapabilityRequest) *CapabilityResponse {
    // Step 1: 认证
    actor := d.auth.Authenticate(req.Actor)

    // Step 2: 检查插件存在且启用
    plugin := d.plugins.Get(req.PluginID)
    if plugin == nil {
        return errorResp(req, "PLUGIN_NOT_REGISTERED")
    }
    if !plugin.Enabled {
        return errorResp(req, "PLUGIN_DISABLED")
    }

    // Step 3: 权限校验
    err := d.permissions.Check(req)
    if err != nil {
        d.audit.Log(req, false, err.Error())  // audit 记录拒绝
        switch e := err.(type) {
        case *NeedApprovalError:
            // 触发审批流程
            d.notify.RequestApproval(req, e)
            return errorResp(req, "NEED_APPROVAL")
        default:
            return errorResp(req, "PERMISSION_DENIED")
        }
    }

    // Step 4: 路由（本地或远程）
    // ...

    // Step 5: 执行
    result, err := d.executor.Execute(req)

    // Step 6: Audit
    d.audit.Log(req, err == nil, "")

    // Step 7: 返回
    if err != nil {
        return errorResp(req, "EXECUTION_ERROR", err.Error())
    }
    return successResp(req, result)
}
```

### Permission Checker 内部逻辑

```go
func (c *Checker) Check(req *CapabilityRequest) error {
    // 1. 插件是否声明此能力
    if !c.pluginManifest.HasCapability(req.PluginID, req.Capability) {
        return &NotGrantedError{
            Capability: req.Capability,
            Reason:     "capability not declared in manifest",
        }
    }

    // 2. 是否有 grant
    grant := c.policy.GetGrant(req.PluginID, req.Capability)
    if grant == nil {
        // 没有 grant = 未授权，需要用户决定
        return &NeedApprovalError{
            Capability: req.Capability,
            Message:    fmt.Sprintf("plugin %s needs %s permission", req.PluginID, req.Capability),
        }
    }

    // 3. Grant 模式检查
    switch grant.Mode {
    case "deny":
        return &PermissionDeniedError{Capability: req.Capability}
    case "ask":
        return &NeedApprovalError{
            Capability: req.Capability,
            Message:    grant.AskMessage,
        }
    case "allow":
        // 继续
    }

    // 4. 约束检查
    if grant.Constraints != nil {
        if err := c.checkConstraints(grant.Constraints, req.Capability, req.Payload); err != nil {
            return err
        }
    }

    return nil
}
```

### 时序图

```
Plugin                    Dispatcher              Permission            User
  │                          │                        │                  │
  │  action.request          │                        │                  │
  │ ──────────────────────▶  │                        │                  │
  │                          │── plugin enabled? ──▶  │                  │
  │                          │◀── ok ─────────────────│                  │
  │                          │                        │                  │
  │                          │── check capability ──▶ │                  │
  │                          │◀── has grant? ─────────│                  │
  │                          │                        │                  │
  │  ┌─ 有 grant ────────────┤                        │                  │
  │  │                       │── execute ──────────── │                  │
  │  │                       │── audit ────────────── │                  │
  │  │  action.response      │                        │                  │
  │  │ ◀──────────────────── │                        │                  │
  │  │                       │                        │                  │
  │  └─ 无 grant / ask ──────┤                        │                  │
  │                          │── notify.request ────  │                  │
  │                          │                        │  approval.push   │
  │                          │                        │ ───────────────▶ │
  │                          │                        │                  │── respond
  │                          │                        │ ◀─────────────── │
  │                          │◀── approval.result ─── │                  │
  │                          │── re-check ──────────  │                  │
  │                          │── execute ──────────── │                  │
  │  action.response         │                        │                  │
  │ ◀────────────────────── │                        │                  │
```

---

## 六、约束系统

### 路径约束

用于 fs.* 和 process.spawn 类型的能力。

```yaml
permissions:
  fs.read:
    constraints:
      path:
        allow:                    # Glob 匹配
          - "~/.claude/**"
          - "${workspace}/**"
          - "/repo/**"
        deny:
          - "**/.env"
          - "**/node_modules/**"
          - "**/.git/**"

  process.spawn:
    constraints:
      command:
        allow:                    # 精确字符串匹配
          - "claude"
          - "bash"
          - "zsh"
          - "powershell"
        deny: []
```

### 配置 Key 约束

用于 config.* 类型的能力。

```yaml
permissions:
  config:
    constraints:
      keys:
        allow:
          - "plugins.claude-code.*"
        deny:
          - "plugins.claude-code.secret.*"
```

### Env 约束

用于 env.vars 类型的能力。

```yaml
permissions:
  env.vars:
    constraints:
      keys:
        allow:
          - "PATH"
          - "HOME"
          - "CLAUDE_*"
          - "SHELL"
        deny:
          - "SECRET_*"
          - "TOKEN_*"
```

### 约束检查实现

```go
func (c *Checker) checkConstraints(constraints *PermissionConstraints, capability string, payload interface{}) error {
    switch capability {
    case "fs.read", "fs.write", "fs.delete", "fs.list":
        path := extractPath(payload)
        if !matchGlob(constraints.Path.Allow, path) {
            return &PathNotAllowedError{Path: path}
        }
        if matchGlob(constraints.Path.Deny, path) {
            return &PathNotAllowedError{Path: path, Reason: "path in deny list"}
        }

    case "process.spawn":
        command := extractCommand(payload)
        if !matchCommand(constraints.Command.Allow, command) {
            return &CommandNotAllowedError{Command: command}
        }

    case "config.get", "config.set":
        key := extractKey(payload)
        if !matchKey(constraints.Keys.Allow, key) {
            return &KeyNotAllowedError{Key: key}
        }
    }

    return nil
}
```

### ${workspace} 变量的处理

```
运行时替换：
  ${workspace} → 用户当前工作目录

约束存储按替换后的绝对路径存储。
Grant 创建时如果包含 ${workspace}，替换成实际路径后存入 grants。

例如：
  grant 中 allow: ["${workspace}/**"]
  实际存储: allow: ["/home/user/project/**"]
```

---

## 七、"Ask" 模式——实时审批

### 触发条件

```
1. Grant 模式为 "ask"
2. 没有 Grant（首次调用）
3. 路径/命令不在 Grant 的 allow 范围内，但在 deny 范围外
```

### 审批流程

```
1. Dispatcher 收到 action.request
2. Permission Checker 返回 NEED_APPROVAL
3. Dispatcher 调用 notify.Request()
4. Core 向所有连接的 Web UI 推送 notify.approval.request
5. 所有 UI 上显示审批弹窗
6. 用户在任一 UI 上响应（Allow / Deny）
7. Core 收到 notify.respond
8. Core 向请求方推送 notify.approval.result
9. 请求方收到结果后继续或放弃
10. 如果 Allow，Dispatcher 自动重试执行
11. 写入 audit log
12. 可选择将 ask 升级为 allow（"记住我的选择"）
```

### 审批弹窗内容

```json
{
  "type": "notify.approval.request",
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "payload": {
    "title": "Claude Code 想执行操作",
    "body": "启动进程: claude",
    "detail": "工作目录: /repo\nclaude --output-format stream-json",
    "capability": "process.spawn",
    "actions": [
      { "id": "allow-once", "label": "仅允许一次" },
      { "id": "allow-always", "label": "记住并允许" },
      { "id": "deny", "label": "拒绝" },
      { "id": "deny-always", "label": "记住并拒绝" }
    ],
    "timeout": 30000
  }
}
```

### 用户"记住"后的 Grant 更新

```yaml
# "allow-always" → 创建 grant
claude-code:
  process.spawn:
    mode: allow
    constraints:
      command:
        allow: ["claude"]
    grantedAt: 1712345678000
    grantedBy: "user"

# "deny-always" → 创建 deny grant
claude-code:
  fs.delete:
    mode: deny
    grantedAt: 1712345679000
    grantedBy: "user"
```

---

## 八、System UI 权限

### 自动授予

System UI 的权限由 Core 启动时硬编码授予，不可撤销。

```go
// Core 启动时
coreStart() {
    // 注册 system-ui 插件
    pluginRegistry.Register(&PluginDefinition{
        ID:      "system-ui",
        Kind:    "system",
        Builtin: true,
        Enabled: true,
    })

    // 自动授予所有权限
    for _, cap := range systemUICapabilities {
        policy.SetGrant("system-ui", cap, &PermissionGrant{
            Mode: "allow",
        })
    }
}
```

### System UI 权限清单

```yaml
system-ui:
  node.read:            allow    # 查看节点
  node.info:            allow    # 节点详情
  node.health:          allow    # 健康检查
  node.disconnect:      allow    # 断开节点
  session.list:         allow    # 列出 session
  session.read:         allow    # session 详情
  session.create:       allow    # 创建 session
  session.stop:         allow    # 停止 session
  session.events:       allow    # 查看事件
  stream.subscribe:     allow    # 订阅 stream
  stream.write:         allow    # 写 stdin
  stream.replay:        allow    # 回放
  config.get:           allow    # 读配置
  config.set:           allow    # 写配置
  config.list:          allow    # 列配置
  logs.read:            allow    # 读日志
  logs.tail:            allow    # 实时日志
  logs.query:           allow    # 查询日志
  plugin.list:          allow    # 列插件
  plugin.read:          allow    # 插件详情
  plugin.check:         allow    # 环境检测
  plugin.enable:        allow    # 启用插件
  plugin.disable:       allow    # 禁用插件
  plugin.install:       allow    # 安装插件
  plugin.repair:        allow    # 修复
  plugin.history:       allow    # 安装历史
  plugin.files.*:       allow    # 文件管理
  plugin.cache.*:       allow    # 缓存管理
  plugin.permissions.*: allow    # 权限管理
```

### 限制

即使 System UI 权限全部自动授予：
- 所有调用仍然走 Dispatcher（不走 bypass）
- 所有调用写入 audit log
- 远程操作时目标节点重新校验

---

## 九、远程节点权限

### 原则

```
目标节点权限在目标节点校验。
Relay 只转发，不代行权限检查。
```

### 流程

```
1. Plugin 发 action.request { targetNodeId: "node_vps", capability: "fs.read" }
2. Node A Core 校验：
   - 插件注册
   - 插件启用
   - 插件有 fs.read 声明
   - Plugin 有 grant（或需要审批）
   - （路径约束等在本机不检查，由目标节点检查）
3. Node A 转发到 Node B（targetNodeId → node_vps）
4. Node B Core 收到：
   - actor 可信（来自已知 peer）
   - 插件在 Node B 上也有注册（或允许转发）
   - 重新检查路径约束等本地条件
   - 执行 fs.read
5. Node B 返回结果给 Node A
6. Node A 返回给插件
```

### 远程权限配置

```yaml
# Node A config.yaml
topology:
  nodes:
    node_vps:
      address: "wss://vps.example.com/ws"
      token: "node_tok_xyz"
      # 是否允许该 node 代表本机插件执行权限校验
      trustLevel: "full"     # full | capability | routing-only
```

```
trustLevel:
  full:          完全信任，本机权限判定结果
  capability:    信任本机能力调用，但检查目标节点路径约束
  routing-only:  只做路由转发，不信任（目标节点完全重新校验）
```

---

## 十、权限变更审计

### 审计事件

所有权限变更必须记录到 `audit.log`：

| 事件 | 记录内容 |
|------|---------|
| Grant 创建 | pluginId, capability, mode, constraints, grantedBy |
| Grant 更新 | pluginId, capability, oldMode → newMode |
| Grant 撤销 | pluginId, capability, revokedBy |
| 权限校验拒绝 | pluginId, capability, targetNodeId, reason |
| 权限审批响应 | requestId, action, respondedBy |
| 权限审批超时 | requestId, timeout |

### 审计格式

```json
// audit-2026-05-19.log
{"ts":"...","action":"permission.grant","pluginId":"claude-code","capability":"fs.read","mode":"allow","constraints":{"allow":["~/.claude/**"]},"grantedBy":"user","requestId":"req_abc"}
{"ts":"...","action":"permission.check.denied","pluginId":"claude-code","capability":"fs.delete","targetNodeId":"","reason":"capability not declared","requestId":"req_def"}
{"ts":"...","action":"permission.ask.response","requestId":"req_ghi","pluginId":"claude-code","capability":"fs.write","action":"allow-always","respondedBy":"user"}
```

---

## 十一、Web UI 权限管理

### 插件详情页中的权限

```
Plugin Detail
  ├── Permissions
  │   ├── fs.read        → allow  | 路径: ~/.claude/**, ${workspace}/**
  │   ├── fs.write       → ask    | 路径: ${workspace}/**
  │   ├── process.spawn  → allow  | 命令: claude
  │   └── fs.delete      → deny
  │
  ├── [Edit] → 修改权限
  │   ├── Mode: allow | ask | deny
  │   ├── 路径约束: [添加/删除 allow/deny 规则]
  │   └── [Save]
  │
  └── [Revoke All] → 撤销所有权限 → 确认弹窗 → 插件变 disabled
```

### 首次安装权限引导

```
┌────────────────────────────────────────┐
│  Claude Code 需要以下权限：              │
│                                        │
│  ☑ fs.read                             │
│     读取 ~/.claude/** 和 workspace 文件  │
│                                        │
│  ☑ process.spawn                       │
│     启动 claude 二进制                   │
│                                        │
│  ☐ fs.write                            │
│     写入 workspace 文件                  │
│     [每次询问]                          │
│                                        │
│  ☐ fs.delete                           │
│     清理缓存                            │
│     [拒绝]                              │
│                                        │
│  ┌────────────────────┐ ┌────────────┐ │
│  │  Accept Selected   │ │  Deny All  │ │
│  └────────────────────┘ └────────────┘ │
└────────────────────────────────────────┘
```

---

## 十二、CLI 权限管理

### Commands

```bash
# 查看插件权限
node plugin permissions claude-code
→ fs.read      allow  路径: ~/.claude/**, ${workspace}/**
  fs.write     ask    路径: ${workspace}/**
  process.spawn allow 命令: claude

# 授予权限
node plugin grant claude-code fs.read "~/.claude/**"
node plugin grant claude-code process.spawn "claude"
node plugin grant claude-code fs.write "${workspace}/**" --mode ask

# 撤销权限
node plugin revoke claude-code fs.read "~/.claude/**"
node plugin revoke claude-code fs.write

# 重置所有权限
node plugin permissions claude-code --reset
```

### CLI 审批

CLI 环境中的 ask 模式：

```bash
$ node claude start
→ Claude Code 需要启动进程: claude
  权限: process.spawn
  是否允许? (y/N) y
  记住选择? (y/N) n
→ 启动成功
```

---

## 十三、第一版实现范围

### 必须实现

```
Permission Checker 基础框架
  - Check(pluginId, capability, payload) → error
  - 支持 allow/deny/ask 三种模式
  - 支持路径约束检查 (fs.*)

Grant 存储
  - 存储到 config.yaml
  - 启动时加载

Dispatcher 集成
  - 每次 action.request 调用 Check
  - 拒绝时返回 PERMISSION_DENIED / NEED_APPROVAL

Audit
  - 所有 permission.check.* 记录到 audit.log

System UI 自动授权
  - system-ui 所有权限自动 allow
  - 不走 ask 流程
```

### 后续实现

```
Ask 模式审批流程
  - notify.request → notify.approval.request → notify.respond
  - 自动重试（allow 后）

${workspace} 变量替换
  - Grant 中 ${workspace} 运行时替换为实际路径

远程节点权限
  - 目标节点重新校验
  - trustLevel 配置

约束系统的 command/key/env 扩展
  - process.spawn 的命令约束
  - config 的 key 约束
  - env.vars 的 key 约束

约束系统的高级 glob
  - ** 匹配
  - 否定匹配
  - 多路径 allow/deny

频率限制
  - 1000 req/min/plugin
```

---

## 十四、防回退规则

| # | 规则 | 后果 |
|---|------|------|
| 1 | **禁止 Core 能力调用不经过 Permission Check** | Dispatcher 必须在 execute 前调用 Check |
| 2 | **禁止 Web 和 CLI 使用不同的权限路径** | Web 和 CLI 都通过 Core Dispatcher，路径一致 |
| 3 | **禁止 relay 绕过目标节点权限校验** | 目标节点必须独立检查，relay 不代行 |
| 4 | **禁止 Core 内部模块直接暴露能力给插件** | 所有能力必须通过 Dispatcher 暴露 |
| 5 | **禁止没有 Grant 时使用 "allow" 作为默认值** | 无 Grant = 不可用，必须用户确认 |
| 6 | **禁止 system-ui 绕过权限校验** | system-ui 权限已预先 allow，但校验路径不可跳过 |
| 7 | **禁止插件 manifest 声明能力 = 自动获得** | Manifest 只声明需要什么，Grant 由用户决定 |
| 8 | **禁止全局管理员模式跳过所有权限** | 所有能力调用必须记录 audit，不能"管理员免检" |
| 9 | **禁止权限校验失败时不写 audit** | 被拒绝的调用也必须记录 |
| 10 | **禁止 grant 存储不由 Core 管理** | CLI 和 Web 都通过 Core API 修改 grant，不能各自存一份 |

---

## 十五、Service Token 权限

### Token 权限模型

Service Token 是 External Client 的认证方式，权限通过 config.yaml 配置：

```yaml
core:
  auth:
    serviceTokens:
      - token: "svc_ci_deploy_abc123"
        label: "CI 部署脚本"
        permissions:
          capabilities:
            - session.create
            - session.stop
            - fs.read
          constraints:
            commands:
              allow: ["bash", "node"]
            paths:
              allow: ["/home/user/deploy/**"]
        expiresAt: "2027-01-01T00:00:00Z"
```

### Token 权限特点

```text
1. 无默认权限
   Token 必须显式声明能力，未声明的能力自动拒绝

2. 支持约束
   Token 可带路径约束、命令约束，与插件 Grant 的约束格式一致

3. 可过期
   过期后自动失效，所有请求返回 TOKEN_EXPIRED

4. 可撤销
   管理员从 config.yaml 移除 Token 后立即生效

5. 可审计
   每次调用 audit 记录包含 token label
```

### Token 权限校验流程

```go
func (c *Checker) CheckServiceToken(token *ServiceToken, req *CapabilityRequest) error {
    // 1. 验证 token 未过期
    if token.ExpiresAt != nil && time.Now().After(*token.ExpiresAt) {
        return &CoreError{Code: "TOKEN_EXPIRED"}
    }

    // 2. 检查能力是否被授权
    if !token.HasCapability(req.Capability) {
        return &CoreError{Code: "NOT_GRANTED",
            Message: fmt.Sprintf("capability %s not authorized for this token", req.Capability)}
    }

    // 3. 约束检查
    if token.Constraints != nil {
        if err := checkTokenConstraints(token.Constraints, req); err != nil {
            return err
        }
    }

    return nil
}
```

### 与 Plugin Grant 的区别

| 维度 | Service Token | Plugin Grant |
|------|-------------|-------------|
| 认证方式 | 预共享 Token | Plugin IPC 通道 |
| 权限来源 | config.yaml 配置 | Manifest 声明 + 用户授权 |
| 权限范围 | 能力级别 + 约束 | 能力级别 + 路径/命令约束 |
| 生命周期 | 管理员管理 | 随插件安装/卸载 |
| 适用场景 | CI/CD、自动化 | 插件运行时 |
| 是否可调 Plugin Management API | 否 | 否（仅 system-ui/cli-user） |

---

## 十六、目标节点权限校验模型

### 三层校验

跨节点调用时，权限在三个层面校验：

```text
请求路径:
  Plugin → Node A Core → [Relay] → Node B Core → Execute

校验点 1 — Node A（源节点）:
  - Actor 身份认证
  - Plugin 注册和启用状态
  - Plugin 有该能力的 Grant（或需要审批）
  - 转发到 Node B 的权限（信任级别）

校验点 2 — Relay（转发层）:
  - 不执行业务权限校验
  - 只做消息转发和连接管理

校验点 3 — Node B（目标节点）:
  - 请求来自可信 Node（预共享 token 验证）
  - 插件在 Node B 上的注册状态（或允许转发策略）
  - 目标节点本地约束（路径约束、命令约束）
  - 目标节点本地策略（trustLevel）
```

### trustLevel 配置

```yaml
# Node A config.yaml
topology:
  nodes:
    node_vps:
      address: "wss://vps.example.com/ws"
      token: "node_tok_xyz"
      trustLevel: "capability"   # full | capability | routing-only
```

| trustLevel | 含义 | 目标节点校验 |
|-----------|------|-------------|
| `full` | 完全信任源节点权限判定 | 跳过权限校验，只检查路径约束 |
| `capability` | 信任能力调用，检查约束 | 执行全部校验 + 本地约束 |
| `routing-only` | 只做路由 | 完全重新校验 |

### 防回退

```text
1. 目标节点必须独立校验
   relay 不代行，不绕过

2. trustLevel 不能等于 "none"
   至少 routing-only，目标节点做完整校验

3. 远程 session 的权限变更立即生效
   不依赖源节点缓存
```

---

## 十七、System UI 权限补充

### System UI 的定位

System UI 是 Core 的内置控制面，拥有最高 UI 权限但仍然走 Core Protocol：

```text
  - 权限自动授予 ✓
  - 权限不可撤销 ✓（否则 UI 无法工作）
  - 仍走 Dispatcher ✓
  - 仍写 audit log ✓
  - 不可代表其他插件 ✓
  - 不可绕过远程节点校验 ✓
```

### System UI 与 Feature Plugin 权限对比

| 维度 | System UI | Feature Plugin |
|------|-----------|----------------|
| pluginId | "system-ui" | "claude-code" |
| 权限来源 | Core 启动时硬编码授予 | Manifest 声明 + 用户 Grant |
| 权限范围 | 所有管理能力 | 声明的能力 |
| 是否可撤销 | 不可撤销 | 可撤销 |
| audit 记录 | 全部记录 | 全部记录 |
| 远程权限 | 目标节点重新校验 | 目标节点重新校验 |

### System UI 权限清单（补充）

除了已有的 management 权限，system-ui 还拥有以下服务权限：

```yaml
system-ui 额外权限:
  task.create:        allow    # 创建 Reconcile Task
  task.cancel:        allow    # 取消 Task
  auth.token.list:    allow    # 查看 Service Token 列表（不暴露 token 值）
  auth.token.manage:  allow    # 管理 Service Token（需 Plan）
  health.read:        allow    # 健康检查
```

### 防回退

```text
1. system-ui 的权限自动授予 ≠ 绕过校验
   所有调用仍然经过 Dispatcher

2. system-ui 不可替代
   用户可以开发替代控制面，但 system-ui 是默认控制面

3. system-ui 不依赖 feature plugin
   Core + system-ui 独立可用
```
