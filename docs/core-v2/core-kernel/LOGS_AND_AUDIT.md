# SessionNode v2 — 日志与审计系统设计

> Core Log + Audit Log + Session Events + 插件日志的统一设计
> 配套文档：ARCHITECTURE.md、CORE_PROTOCOL.md、SESSION_AND_STREAM.md、PLUGIN_MANAGEMENT.md

---

## 目录

1. [设计原则](#一设计原则)
2. [日志分类总表](#二日志分类总表)
3. [Core Log](#三core-log)
4. [Audit Log](#四audit-log)
5. [Session Event Log](#五session-event-log)
6. [Stream 日志](#六stream-日志)
7. [插件日志](#七插件日志)
8. [插件安装日志](#八插件安装日志)
9. [插件文件访问历史](#九插件文件访问历史)
10. [插件缓存清理历史](#十插件缓存清理历史)
11. [配置变更历史](#十一配置变更历史)
12. [权限变更历史](#十二权限变更历史)
13. [日志存储与轮转](#十三日志存储与轮转)
14. [日志查询 API](#十四日志查询-api)
15. [日志权限](#十五日志权限)
16. [防回退规则](#十六防回退规则)

---

## 一、设计原则

### 原则 1：每条日志都有来源

```
每一条日志都有明确的:
  - 类型（core | audit | session | plugin | stream）
  - 时间戳
  - 触发者（actor / pluginId）
  - 操作（action / capability / event）
  - 结果（成功 / 失败 / 拒绝）
```

### 原则 2：危险操作必须审计

```
Core 不区分 "管理操作" 和 "业务操作"。
以下操作全部视为危险操作，必须写入 audit log：
  - process.spawn / process.kill
  - fs.write / fs.delete
  - plugin.install / plugin.repair / plugin.uninstall
  - plugin.cache.clear.execute
  - plugin.permissions.grant / plugin.permissions.revoke
  - config.write
  - node.disconnect
  - notify.approval.response
```

### 原则 3：日志写入不阻塞业务

```
日志写入使用异步写入队列：
  - Core 操作完成后，日志异步写入磁盘
  - 日志写入失败不阻止操作完成
  - 日志写入失败记录到内存，定期重试
```

### 原则 4：日志不包含敏感内容

```
- stdout/stderr 可能包含敏感信息
- 流式数据只保留在 session 目录中（按权限访问）
- 不在 audit log 中记录文件内容
- 配置敏感值（token/password）在日志中脱敏
```

---

## 二、日志分类总表

| # | 日志类型 | 文件名 | 记录内容 | 保留策略 | 谁写入 |
|---|---------|--------|---------|---------|--------|
| 1 | Core Log | `core-YYYY-MM-DD.log` | 节点运行、路由、session 生命周期、错误、警告 | 按大小轮转，保留 10 个文件 | Core 内部 |
| 2 | Audit Log | `audit-YYYY-MM-DD.log` | 权限校验、危险操作、配置修改、节点连接/断开 | 长期保留，按天轮转 | Core Dispatcher |
| 3 | Session Event | `sessions/sess_xxx/events.jsonl` | session 的 eventSeq 序列 | 随 session 删除（保留 N 小时） | Core Session Manager |
| 4 | Stream 日志 | `sessions/sess_xxx/stdout.log`, `stderr.log` | stdout/stderr 原始内容 | 按大小截断（100MB） | Core Stream Manager |
| 5 | 插件日志 | `plugin-{id}-YYYY-MM-DD.log` | 插件通过 Core 写入的日志 | 按大小轮转，保留 5 个文件 | Core Log API（插件调用） |
| 6 | 插件安装日志 | `plugins/{id}/install/inst_xxx/stdout.log`, `stderr.log` | 安装命令的 stdout/stderr | 永久保留（与 install 记录共存亡） | Core Install Executor |
| 7 | 插件文件访问 | `plugins/{id}/files/access-history.jsonl` | 插件通过 Core fs API 的文件操作 | 按大小轮转，保留 3 个文件 | Core fs/plugin API |
| 8 | 插件缓存清理 | `plugins/{id}/cache/cleanup-history.jsonl` | 缓存清理操作记录 | 按大小轮转，保留 5 个文件 | Core Cache Manager |
| 9 | 配置变更历史 | 与 audit log 合并 | config.write 记录 | 同 audit log | Core Config |
| 10 | 权限变更历史 | 与 audit log 合并 | permission.grant/revoke | 同 audit log | Core Permission |

### 存储目录总览

```
~/.sessionnode/
├── logs/
│   ├── core-2026-05-19.log
│   ├── core-2026-05-20.log
│   ├── audit-2026-05-19.log
│   ├── audit-2026-05-20.log
│   ├── plugin-claude-code-2026-05-19.log
│   ├── plugin-shell-2026-05-19.log
│   └── plugin-system-ui-2026-05-19.log
│
├── sessions/
│   ├── sess_abc/
│   │   ├── meta.json
│   │   ├── events.jsonl
│   │   ├── stdout.log
│   │   ├── stderr.log
│   │   └── stdin.log
│   └── ...
│
└── plugins/
    └── claude-code/
        ├── files/
        │   └── access-history.jsonl
        ├── cache/
        │   └── cleanup-history.jsonl
        └── install/
            └── inst_001/
                ├── stdout.log
                └── stderr.log
```

---

## 三、Core Log

### 用途

记录 Core 运行时的关键事件：启动、关闭、连接、错误、警告。

### 日志级别

| 级别 | 含义 | 示例 |
|------|------|------|
| `debug` | 调试信息 | 消息路由细节、请求参数 |
| `info` | 常规信息 | 节点启动、session 创建/停止、插件加载 |
| `warn` | 警告 | 节点连接不稳定、配置缺失使用默认值 |
| `error` | 错误 | 进程启动失败、磁盘写入失败、路由失败 |

### 日志格式

```json
{"ts":"2026-05-19T10:00:00.000Z","level":"info","msg":"Core started","nodeId":"node_abc","version":"2.0.0"}
{"ts":"2026-05-19T10:00:01.000Z","level":"info","msg":"Session created","sessionId":"sess_abc","pluginId":"claude-code","kind":"process"}
{"ts":"2026-05-19T10:00:02.000Z","level":"warn","msg":"Node vps ping timeout","nodeId":"node_vps","rtt":15000}
{"ts":"2026-05-19T10:00:03.000Z","level":"error","msg":"Session spawn failed","sessionId":"sess_def","error":"binary claude not found"}
```

### 日志字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `ts` | 是 | ISO 8601 时间戳 |
| `level` | 是 | debug / info / warn / error |
| `msg` | 是 | 人类可读的消息 |
| `nodeId` | 推荐 | 产生此日志的节点 |
| `sessionId` | 有时 | 与此日志相关的 session |
| `pluginId` | 有时 | 与此日志相关的插件 |
| `error` | 有时 | 错误详情 |
| `requestId` | 有时 | 关联的请求 ID |
| 其他 | 按需 | 额外的结构化字段 |

### 什么写入 Core Log

```
写入 Core Log:
  ✓ Core 启动/关闭
  ✓ Session 创建/停止
  ✓ 节点连接/断开
  ✓ 插件加载/注册
  ✓ 请求路由失败
  ✓ 能力执行错误
  ✓ 配置加载
  ✓ 进程异常退出

不写入 Core Log:
  ✗ 每次 stream.chunk（那是 stream log）
  ✗ 每次 action.request 成功（那是 audit log）
  ✗ 普通权限校验通过（那是 audit log）
  ✗ 插件业务日志（那是插件日志）
```

---

## 四、Audit Log

### 用途

记录所有安全敏感操作。用于安全审查、问题排查、合规要求。

### 审计事件类型

```go
type AuditAction string
const (
    // 能力调用
    AuditCapabilityCall    AuditAction = "capability.call"
    AuditCapabilityDenied  AuditAction = "capability.denied"

    // Session
    AuditSessionCreate     AuditAction = "session.create"
    AuditSessionStop       AuditAction = "session.stop"

    // 配置
    AuditConfigWrite       AuditAction = "config.write"
    AuditConfigDelete      AuditAction = "config.delete"

    // 插件管理
    AuditPluginInstall     AuditAction = "plugin.install"
    AuditPluginRepair      AuditAction = "plugin.repair"
    AuditPluginUninstall   AuditAction = "plugin.uninstall"
    AuditPluginEnable      AuditAction = "plugin.enable"
    AuditPluginDisable     AuditAction = "plugin.disable"

    // 权限
    AuditPermissionGrant   AuditAction = "permission.grant"
    AuditPermissionRevoke  AuditAction = "permission.revoke"

    // 缓存
    AuditCacheClear        AuditAction = "cache.clear"

    // FS 写/删
    AuditFSWrite           AuditAction = "fs.write"
    AuditFSDelete          AuditAction = "fs.delete"

    // 节点
    AuditNodeConnected     AuditAction = "node.connected"
    AuditNodeDisconnected  AuditAction = "node.disconnected"

    // 审批
    AuditApprovalRequest   AuditAction = "approval.request"
    AuditApprovalResponse  AuditAction = "approval.response"
)
```

### 审计格式

```json
// 能力调用
{"ts":"2026-05-19T10:00:00.000Z","action":"capability.call","actor":{"type":"web","id":"browser_abc"},"pluginId":"claude-code","capability":"fs.read","targetNodeId":"","allowed":true,"requestId":"req_abc"}

// 能力拒绝
{"ts":"2026-05-19T10:00:01.000Z","action":"capability.denied","actor":{"type":"plugin","id":"system-ui"},"pluginId":"claude-code","capability":"fs.delete","targetNodeId":"","reason":"capability not declared in manifest","requestId":"req_def"}

// 配置修改
{"ts":"2026-05-19T10:00:02.000Z","action":"config.write","actor":{"type":"web","id":"browser_abc"},"pluginId":"system-ui","key":"plugins.claude-code.defaultModel","value":"[set]"}

// 插件安装
{"ts":"2026-05-19T10:00:05.000Z","action":"plugin.install","actor":{"type":"web","id":"browser_abc"},"pluginId":"system-ui","targetPlugin":"claude-code","installId":"inst_20260519_001","status":"success","duration":30000}

// 权限授予
{"ts":"2026-05-19T10:01:00.000Z","action":"permission.grant","actor":{"type":"web","id":"browser_abc"},"pluginId":"system-ui","targetPlugin":"claude-code","capability":"fs.read","mode":"allow","constraints":{"allow":["~/.claude/**","${workspace}/**"],"deny":["**/.env"]}}

// 节点连接
{"ts":"2026-05-19T10:02:00.000Z","action":"node.connected","nodeId":"node_vps","role":"leaf","address":"wss://vps.example.com/ws"}

// 审批响应
{"ts":"2026-05-19T10:03:00.000Z","action":"approval.response","requestId":"req_ghi","pluginId":"claude-code","action":"allow-once","respondedBy":"user","responderId":"browser_abc"}
```

### 审计字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `ts` | 是 | ISO 8601 时间戳 |
| `action` | 是 | 审计事件类型 |
| `actor` | 是 | 操作者（type + id） |
| `pluginId` | 是 | 发起操作的插件 |
| `requestId` | 有时 | 关联请求 |
| `allowed` | 有时 | 是否允许（capability.call/denied） |
| `reason` | 有时 | 拒绝原因 |
| `error` | 有时 | 错误信息 |

### 什么写入 Audit Log

```
写入 Audit Log:
  ✓ 每次 capability.call（调用能力）
  ✓ 每次 capability.denied（能力被拒绝）
  ✓ session.create / session.stop
  ✓ config.write / config.delete
  ✓ plugin.install / plugin.repair / plugin.uninstall
  ✓ plugin.enable / plugin.disable
  ✓ permission.grant / permission.revoke
  ✓ cache.clear
  ✓ fs.write / fs.delete
  ✓ node.connected / node.disconnected
  ✓ approval.request / approval.response
  ✓ 登录/登出

不写入 Audit Log:
  ✗ 普通的 fs.list / fs.read（那在文件访问历史）
  ✗ 普通的 stream.subscribe
  ✗ session.event 推送
  ✗ 每次 plugin.check（那是插件日志）
```

---

## 五、Session Event Log

### 用途

记录 session 的完整事件序列。用于 replay、多端同步、历史查询。

### 格式

```jsonl
# ~/.sessionnode/sessions/sess_abc/events.jsonl
{"eventSeq":1,"eventType":"session.created","pluginId":"claude-code","payload":{"kind":"process","command":"claude"},"timestamp":1712345678000}
{"eventSeq":2,"eventType":"stream.stdout","pluginId":"claude-code","payload":{"data":"ewogICJ0eXBlIjogInRleHQiLAogICJjb250ZW50IjogIkhlbGxvISIKfQo="},"timestamp":1712345678005}
{"eventSeq":3,"eventType":"stream.stdout","pluginId":"claude-code","payload":{"data":"ewogICJ0eXBlIjogInRvb2xfdXNlIiwKICAibmFtZSI6ICJSZWFkIgp9Cg=="},"timestamp":1712345678010}
{"eventSeq":4,"eventType":"notify.approval","pluginId":"claude-code","payload":{"requestId":"req_abc","title":"Read file","body":"/etc/hosts"},"timestamp":1712345678015}
```

### Event 类型（同 SESSION_AND_STREAM.md）

| eventType | payload | 说明 |
|-----------|---------|------|
| `session.created` | `{ kind, command, args?, cwd? }` | session 创建 |
| `session.stopped` | `{ exitCode, signal? }` | session 停止 |
| `session.errored` | `{ error }` | session 错误 |
| `stream.stdout` | `{ data: base64 }` | stdout 输出 |
| `stream.stderr` | `{ data: base64 }` | stderr 输出 |
| `stream.stdin` | `{ data: base64 }` | 用户输入 |
| `notify.approval` | `{ requestId, title, body }` | 审批请求 |

### 生命周期

```
创建: session 创建时自动创建 events.jsonl
写入: 每个 event 产生时追加
读取: via session.events / stream.replay API
清理: session 停止并超期后，events.jsonl 随 session 目录一起删除
```

---

## 六、Stream 日志

### 用途

保存 stdout/stderr 的纯文本内容，用于后续查看、搜索、导出。

### 格式

纯文本文件，不经过 base64。

```text
# ~/.sessionnode/sessions/sess_abc/stdout.log
{"type":"text","content":"Hello!"}
{"type":"tool_use","name":"Read","input":{"path":"/etc/hosts"}}
```

```text
# ~/.sessionnode/sessions/sess_abc/stderr.log
Warning: model response took 5.2s
```

### 写入策略

```
- 每个 stream chunk 同时写入 events.jsonl（base64）和 stdout.log（纯文本）
- stdout.log/stderr.log 是纯文本，用于人读
- events.jsonl 是结构化数据，用于 replay
- stdin.log 可选（默认不记录，可在 manifest 中开启）
```

### 大小控制

```
- 默认最大 100MB
- 超过后截断保留尾部 50MB
- 可配置
- 截断时写一条 truncation mark
```

---

## 七、插件日志

### 用途

插件通过 Core API 写入的日志。插件不需要自己管理日志文件。

### 写入方式

```json
// 插件 → Core
{
  "type": "action.request",
  "requestId": "req_abc",
  "pluginId": "claude-code",
  "capability": "logs.write",     // 写日志能力
  "payload": {
    "level": "info",
    "msg": "processing user request",
    "sessionId": "sess_abc",
    "requestId": "req_abc"
  }
}
```

### 存储

```
~/.sessionnode/logs/plugin-claude-code-2026-05-19.log

{"ts":"...","level":"info","msg":"Parser started","sessionId":"sess_abc","pluginId":"claude-code"}
{"ts":"...","level":"warn","msg":"Unexpected response format","sessionId":"sess_abc","pluginId":"claude-code","raw":"..."}
{"ts":"...","level":"error","msg":"Connection lost to claude process","sessionId":"sess_abc","pluginId":"claude-code"}
```

### 插件日志特点

```
- 插件不直接写文件
- 插件通过 Core 的 logs.write 能力写入
- Core 写入到 plugin-{id}.log
- 日志文件名包含 pluginId，方便区分
- 日志按 Core 相同的轮转策略管理

内置的 system-ui、shell 插件也走同一机制。
```

---

## 八、插件安装日志

### 用途

记录整个安装过程的完整输出，用于排查安装失败。

### 存储

```
~/.sessionnode/plugins/claude-code/install/inst_001/
  ├── stdout.log    # 安装命令的 stdout
  ├── stderr.log    # 安装命令的 stderr
  ├── result.json   # 安装结果
  ├── plan.json     # 安装计划
  ├── side-effects.json  # 副作用记录
  ├── pre-snapshot.json  # 安装前快照
  └── post-snapshot.json # 安装后快照
```

### 查询

```bash
# CLI 查询
node plugin logs claude-code --install inst_001
node plugin logs claude-code --install inst_001 --tail 50

# HTTP API
GET /api/plugins/claude-code/install/inst_001/logs
```

---

## 九、插件文件访问历史

### 用途

记录插件通过 Core fs API 的所有文件操作，用于安全审查和问题排查。

### 存储

```jsonl
# ~/.sessionnode/plugins/claude-code/files/access-history.jsonl
{"pluginId":"claude-code","nodeId":"node_abc","path":"~/.claude/settings.json","action":"read","timestamp":1712345678000,"requestId":"req_abc","allowed":true}
{"pluginId":"claude-code","nodeId":"node_abc","path":"~/.claude/projects","action":"list","timestamp":1712345679000,"requestId":"req_def","allowed":true}
{"pluginId":"claude-code","nodeId":"node_abc","path":"/repo/main.go","action":"read","timestamp":1712345680000,"requestId":"req_ghi","allowed":true}
{"pluginId":"claude-code","nodeId":"node_abc","path":"/repo/main.go","action":"write","timestamp":1712345681000,"requestId":"req_jkl","allowed":true}
{"pluginId":"claude-code","nodeId":"node_abc","path":"/repo/.env","action":"read","timestamp":1712345682000,"requestId":"req_mno","allowed":false}
```

### 记录什么

```
每次 fs.list / fs.read / fs.write / fs.delete / fs.stat 都记录。

记录字段:
  - pluginId
  - nodeId
  - path
  - action (read/write/delete/list/stat)
  - timestamp
  - requestId
  - allowed (是否通过权限校验)

不记录:
  - 文件内容（只记录路径和操作）
  - session stream 数据（那是 stream log）
```

---

## 十、插件缓存清理历史

### 用途

记录所有缓存清理操作，确保可追溯。

### 存储

```jsonl
# ~/.sessionnode/plugins/claude-code/cache/cleanup-history.jsonl
{"ts":"2026-05-19T10:00:00.000Z","action":"clear","cacheId":"claude-plugin-cache","paths":["~/.sessionnode/plugins/claude-code/cache"],"mode":"core","entriesBefore":42,"sizeBefore":"12.5MB","entriesAfter":0,"sizeAfter":"0B","status":"success","actor":{"type":"web","id":"browser_abc"}}
{"ts":"2026-05-19T11:00:00.000Z","action":"clear","cacheId":"claude-workspace-cache","paths":["/repo/.sessionnode-cache/claude-code"],"mode":"plugin","status":"success","actor":{"type":"cli","id":"terminal"}}
```

---

## 十一、配置变更历史

### 用途

配置修改是可追溯的，与 audit log 合并存储。

### 存储

配置变更事件写入 `audit.log`：

```json
{"ts":"2026-05-19T10:00:00.000Z","action":"config.write","pluginId":"system-ui","key":"plugins.claude-code.defaultModel","oldValue":"[hidden]","newValue":"[hidden]","requestId":"req_abc"}
{"ts":"2026-05-19T10:00:01.000Z","action":"config.write","pluginId":"claude-code","key":"plugins.claude-code.theme","oldValue":"dark","newValue":"light","requestId":"req_def"}
```

### 敏感值脱敏

```
敏感 key（token、password、secret、key）的值在日志中替换为 [hidden]：

敏感 key 列表:
  - core.auth.*
  - *.token
  - *.secret
  - *.password
  - *.apiKey

非敏感 key:
  - plugins.*.theme
  - plugins.*.defaultModel
  - logs.level
```

---

## 十二、权限变更历史

### 用途

权限变更记录，与 audit log 合并存储。

### 存储

```json
// 授权
{"ts":"2026-05-19T10:00:00.000Z","action":"permission.grant","pluginId":"system-ui","targetPlugin":"claude-code","capability":"fs.read","mode":"allow","constraints":{"allow":["~/.claude/**"]},"grantedBy":"user"}

// 撤销
{"ts":"2026-05-19T10:00:01.000Z","action":"permission.revoke","pluginId":"system-ui","targetPlugin":"claude-code","capability":"fs.write","revokedBy":"user"}
```

---

## 十三、日志存储与轮转

### Core Log 轮转

```
文件名: core-YYYY-MM-DD.log
轮转: 按大小轮转（默认 100MB）
保留: 10 个文件
路径: ~/.sessionnode/logs/
```

### Audit Log 轮转

```
文件名: audit-YYYY-MM-DD.log
轮转: 按天轮转，不受大小限制
保留: 长期保留（可配置保留天数，默认 365 天）
路径: ~/.sessionnode/logs/
```

### 配置文件

```yaml
# ~/.sessionnode/config.yaml
core:
  log:
    level: info                # debug | info | warn | error
    maxSize: "100MB"
    maxFiles: 10
    auditRetentionDays: 365
    sessionRetentionHours: 1   # session 停止后保留时间
    stdoutMaxSize: "100MB"     # stream stdout.log 大小限制
```

---

## 十四、日志查询 API

### HTTP API

```http
# Core Log
GET /api/logs/core
  ?level=error
  &from=2026-05-19T00:00:00Z
  &to=2026-05-19T23:59:59Z
  &limit=100
  → { lines: [{ ts, level, msg, pluginId? }, ...] }

# Audit Log
GET /api/logs/audit
  ?action=permission.grant
  &pluginId=claude-code
  &limit=100
  → { lines: [{ ts, action, actor, pluginId, ... }, ...] }

# Session Events
GET /api/logs/session/:sessionId
  ?fromSeq=0
  &toSeq=100
  → { events: [{ eventSeq, eventType, payload, timestamp }, ...] }

# 插件日志
GET /api/logs/plugin/:pluginId
  ?level=error
  &limit=50
  → { lines: [{ ts, level, msg }, ...] }

# 插件文件访问历史
GET /api/plugins/:pluginId/files/access
  ?action=write
  &limit=100
  → { records: [{ path, action, timestamp, allowed }, ...] }

# 插件缓存清理历史
GET /api/plugins/:pluginId/cache/history
  → { records: [{ ts, action, cacheId, status }, ...] }
```

### CLI

```bash
# Core 日志
node logs tail [--level error] [--lines 50]

# Audit 日志
node logs audit [--action permission.grant] [--lines 50]

# Session 日志
node logs session sess_abc [--fromSeq 0] [--toSeq 100]

# 插件日志
node plugin logs claude-code [--level error] [--lines 50]

# 插件安装日志
node plugin logs claude-code --install inst_001 [--tail 50]

# 文件访问历史
node plugin files claude-code --access [--action write]
```

---

## 十五、日志权限

### 权限定义

| 权限 | 可查看的内容 |
|------|-------------|
| `logs.read` | Core Log、Audit Log、Plugin Log 的元信息 |
| `logs.tail` | 实时 tail 日志 |
| `logs.query` | 按条件过滤日志 |
| `logs.session` | Session Event Log |
| `plugin.files.accessHistory` | 插件文件访问历史 |
| `plugin.cache.history` | 缓存清理历史 |

### 查看限制

```
- 插件只能查看自己的文件访问历史
- system-ui （有 logs.read）可以查看所有日志
- Session event 只对 session 绑定插件的订阅者可见
- 不暴露其他插件的日志给无关插件
```

---

## 十六、防回退规则

| # | 规则 | 后果 |
|---|------|------|
| 1 | **禁止危险操作不写 audit log** | `process.spawn`、`fs.write`、`plugin.install` 等必须写 audit |
| 2 | **禁止日志写入阻塞业务操作** | 日志异步写入，写入失败不影响操作完成 |
| 3 | **禁止 audit log 中记录文件内容** | audit log 记录操作本身，不记录操作数据 |
| 4 | **禁止 Core Log 和 Audit Log 合并** | 用途不同：Core Log 是运行时事件，Audit Log 是安全事件 |
| 5 | **禁止插件直接写文件写日志** | 插件必须通过 Core 的 `logs.write` 能力写日志 |
| 6 | **禁止不记录权限拒绝的 audit** | 被拒绝的调用也必须记录（谁、什么、为什么拒绝） |
| 7 | **禁止日志保留策略让 audit log 被轻易覆盖** | audit log 按天轮转，长期保留；core log 按大小轮转 |
| 8 | **禁止敏感配置值明文出现在日志中** | token、password、secret 等必须脱敏为 [hidden] |
| 9 | **禁止日志文件有不可控的增长** | stdout.log 设置最大大小（默认 100MB），超过后截断 |
| 10 | **禁止日志 API 暴露其他插件的敏感信息** | 插件只能查看自己的文件访问历史和缓存清理历史 |

---

## 附录：日志速查表

### 我想查...

```text
Q: Core 为什么启动失败了？
→ 看 core-YYYY-MM-DD.log，搜 error 级别

Q: 插件安装到哪里了？
→ 看 audit.log，搜 plugin.install

Q: ClaudeCode 读了哪些文件？
→ 看 plugins/claude-code/files/access-history.jsonl

Q: 昨天谁改了配置？
→ 看 audit-YYYY-MM-DD.log，搜 config.write

Q: Session 为什么退出了？
→ 看 sessions/sess_xxx/events.jsonl，搜 session.stopped

Q: 缓存什么时候清理的？
→ 看 plugins/claude-code/cache/cleanup-history.jsonl

Q: 哪个插件有什么权限？
→ 不是日志，看 plugins/{id}/permissions.json 或调 plugin.permissions.get

Q: 安装命令的输出？
→ 看 plugins/claude-code/install/inst_001/stdout.log

---

## 十七、Task 生命周期审计事件

### 审计事件类型

```go
const (
    AuditTaskCreate    AuditAction = "task.create"
    AuditTaskComplete  AuditAction = "task.complete"
    AuditTaskFailed    AuditAction = "task.failed"
    AuditTaskCancel    AuditAction = "task.cancel"
)
```

### 审计格式

```json
// Task 创建
{"ts":"2026-05-19T10:00:00.000Z","action":"task.create","actor":{"type":"system-ui","id":"browser_abc"},"taskId":"task_001","taskType":"reconcile","target":"claude-code","desiredState":"enabled","currentState":"missing_dep"}

// Task 完成
{"ts":"2026-05-19T10:01:00.000Z","action":"task.complete","actor":{"type":"system-ui","id":"browser_abc"},"taskId":"task_001","taskType":"reconcile","status":"success","duration":60000,"stepsTotal":3,"stepsCompleted":3}

// Task 失败
{"ts":"2026-05-19T10:01:00.000Z","action":"task.failed","actor":{"type":"system-ui","id":"browser_abc"},"taskId":"task_001","taskType":"reconcile","error":{"code":"INSTALL_FAILED","message":"npm install failed"},"failedStep":"Step 2/3"}

// Task 取消
{"ts":"2026-05-19T10:00:30.000Z","action":"task.cancel","actor":{"type":"web","id":"browser_abc"},"taskId":"task_001","reason":"user cancelled"}
```

### 审计字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `taskId` | 是 | 任务 ID |
| `taskType` | 是 | reconcile / install / cache-clear / plugin-check |
| `target` | 有时 | 目标插件或 session |
| `status` | 有时 | success / failed / cancelled |
| `duration` | 有时 | 执行时长（毫秒） |
| `error` | 有时 | 失败详情 |

---

## 十八、Service Token 审计

### 审计事件

所有 Service Token 相关的操作必须记录 audit：

| 事件 | 记录内容 |
|------|---------|
| Token 创建 | token label, permissions, expiresAt |
| Token 撤销 | token label |
| Token 能力调用 | token label, capability, allowed |
| Token 调用被拒 | token label, capability, reason |
| Token 过期自动失效 | token label, expiredAt |

### 审计格式

```json
// Token 创建
{"ts":"2026-05-19T10:00:00.000Z","action":"auth.token.create","actor":{"type":"system-ui","id":"browser_abc"},"tokenLabel":"CI 部署脚本","permissions":{"capabilities":["session.create","session.stop","fs.read"]},"expiresAt":"2027-01-01T00:00:00Z"}

// Token 撤销
{"ts":"2026-05-19T11:00:00.000Z","action":"auth.token.revoke","actor":{"type":"system-ui","id":"browser_abc"},"tokenLabel":"CI 部署脚本"}

// Token 能力调用成功
{"ts":"2026-05-19T10:05:00.000Z","action":"capability.call","actor":{"type":"service","id":"CI 部署脚本"},"capability":"session.create","allowed":true,"requestId":"req_ci_001","targetNodeId":"node_vps"}

// Token 能力调用被拒
{"ts":"2026-05-19T10:06:00.000Z","action":"capability.denied","actor":{"type":"service","id":"CI 部署脚本"},"capability":"plugin.install","allowed":false,"reason":"capability not in token permissions","requestId":"req_ci_002"}

// Token 过期
{"ts":"2027-01-02T00:00:00.000Z","action":"auth.token.expired","tokenLabel":"CI 部署脚本","expiredAt":"2027-01-01T00:00:00Z"}
```

### Token 审计特殊处理

```
1. Token 值不记录
   audit 中记录的 tokenLabel，而不是 token 值本身

2. 过期自动记录
   Core 在检测到 Token 过期时写一条 audit

3. 权限变更记录
   Token 权限修改（config.write）视为敏感操作，写 audit

4. 调用频率记录
   可选的频率限制告警（同一 token 短时间大量调用被拒）
```

---

## 十九、防回退规则补充

| # | 规则 | 后果 |
|---|------|------|
| 11 | **禁止 Task 审计不记录 taskId** | 无法追踪任务执行 |
| 12 | **禁止 Service Token 调用不记录 label** | 无法追踪哪个 Token 调用了什么 |
| 13 | **禁止 Token 值明文出现在审计日志中** | Token 必须脱敏 |
| 14 | **禁止 Task 失败不记录失败原因** | 无法排查失败根因 |
```
