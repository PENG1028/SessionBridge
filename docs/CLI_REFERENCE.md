# SessionBridge CLI 参考

> CLI 是 NodeRuntime 的本体入口。所有命令均以 `bridge` 为前缀。

---

## 一、命令概览

| 命令 | 用途 | --json | 状态 |
|------|------|--------|------|
| `bridge` | 启动节点（前台） | ❌ | implemented |
| `bridge --help` | 显示帮助 | - | implemented |
| `bridge --update` | 自更新到最新版本 | ❌ | implemented |
| `bridge daemon start` | 后台启动守护进程 | ❌ | implemented |
| `bridge daemon stop` | 停止守护进程 | ❌ | implemented |
| `bridge daemon status` | 查看守护进程状态 | ❌ | implemented |
| `bridge daemon install` | 注册开机自启 | ❌ | implemented |
| `bridge setup <opts>` | 配置节点设置 | ❌ | implemented |
| `bridge run <command>` | 通过本地 agent 执行命令 | ❌ | implemented (有 bug) |
| `bridge status` | 查看节点状态 | ❌ (planned) | **missing** |
| `bridge connect` | 连接到 upstream relay | ❌ (planned) | **stale-doc** |
| `bridge instances list` | 列出所有实例 | ❌ (planned) | **missing** |
| `bridge connections list` | 列出已保存连接 | ❌ (planned) | **missing** |
| `bridge auth status` | 查看认证状态 | ❌ (planned) | **missing** |
| `bridge auth toggle` | 开关认证 | ❌ (planned) | **missing** |
| `bridge auth change-password` | 修改密码 | ❌ (planned) | **missing** |
| `bridge config get` | 读取配置 | ❌ (planned) | **missing** |
| `bridge config set` | 修改配置 | ❌ (planned) | **missing** |
| `bridge logs` | 查看日志 | ❌ (planned) | **missing** |
| `bridge permissions get` | 查看权限 | ❌ (planned) | **missing** |
| `bridge permissions set` | 修改权限 | ❌ (planned) | **missing** |
| `bridge extensions list` | 列出扩展 | ❌ (planned) | **missing** |
| `bridge extensions reload` | 重载扩展 | ❌ (planned) | **missing** |
| `bridge operation start` | 启动远程操作 | ❌ (planned) | **missing** |

状态说明：`implemented` = 已实现，`missing` = 尚未实现，`stale-doc` = 文档/页面引用了但 CLI 不存在

---

## 二、已实现命令详细说明

### `bridge` — 启动节点

```
bridge [options]
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--upstream <url>` | string | - | 连接到上游 relay (agent 模式) |
| `--relay-port <n>` | number | 8080 | Relay 服务端口 |
| `--relay-token <token>` | string | - | Relay 认证令牌 |
| `--dashboard-token <t>` | string | - | Dashboard 访问密钥 |
| `--role <relay\|leaf>` | string | auto | 强制节点角色 |
| `--dir <path>` | string | cwd | 工作目录 |
| `--label <name>` | string | hostname | 节点标签 |
| `--log-file <path>` | string | - | 日志文件路径 |
| `--pid-file <path>` | string | - | PID 文件路径 |
| `--dev` | flag | false | 开发模式 (扩展隔离) |
| `--extensions <path>` | string (可重复) | - | 额外的扩展目录 |

**对应 HTTP API**: 启动后提供 `/api/status`, `/api/health`

**错误码**: 端口冲突 `EADDRINUSE`, daemon 冲突 "Daemon is already running"

---

### `bridge daemon start` — 后台启动守护进程

```
bridge daemon start [--pid-file <path>] [--log-file <path>] [--dir <path>]
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--pid-file <path>` | string | - | PID 文件路径 |
| `--log-file <path>` | string | - | 日志文件路径 |
| `--dir <path>` | string | cwd | 工作目录 |

**行为**: fork 子进程 (`BRIDGE_DAEMON=1`), 父进程退出。

---

### `bridge daemon stop` — 停止守护进程

```
bridge daemon stop [--pid-file <path>]
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--pid-file <path>` | string | - | PID 文件路径 |

---

### `bridge daemon status` — 守护进程状态

```
bridge daemon status [--pid-file <path>]
```

**输出示例（文本）:**
```
Daemon is running (pid 12345).
  Uptime: 2h 35m 12s
  PID file: /var/run/sessionbridge.pid
```

**--json 计划输出:**
```json
{
  "running": true,
  "pid": 12345,
  "uptime": 9312,
  "pidFile": "/var/run/sessionbridge.pid",
  "startedAt": "2026-05-15T10:30:00Z"
}
```

---

### `bridge daemon install` — 注册开机自启

```
bridge daemon install [--pid-file <path>]
```

**行为**: 在系统级注册 `bridge daemon start` 为开机自启服务。

---

### `bridge setup` — 配置节点设置

```
bridge setup [options]
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `--relay <url>` | string | 设置默认 upstream relay URL |
| `--relay-token <token>` | string | 设置 relay 认证令牌 |
| `--dashboard-token <t>` | string | 设置 dashboard 访问密钥 |
| `--ntfy-topic <topic>` | string | 设置 ntfy.sh 推送通知主题 |
| `--label <name>` | string | 设置节点标签 |

**行为**: 写入 `.sessionbridge/agent.json`。不传参数时显示当前配置。

**错误码**: 无 (静默写入)

**--json**: ❌ 未实现

---

### `bridge run <command>` — 通过 agent 执行命令

```
bridge run [--port <n>] [--relay <url>] [--dir <path>] [--label <name>] <command...>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--port <n>` | number | 9843 | Agent dashboard 端口 (**已废弃**，应改为 relay port) |
| `--relay <url>` | string | - | Upstream relay URL |
| `--dir <path>` | string | - | 工作目录 |
| `--label <name>` | string | - | 节点标签 |

**已知 bug**:
1. `--port` 默认值为 9843 (dashboard 已废弃)
2. 内部使用 `--relay=` flag 但 CLI 实际接受 `--upstream`
3. 内部传递不存在的 `agent` 子命令

**HTTP API 等价**: `POST /api/shell/run` → `GET /api/shell/stream` + `POST /api/shell/input`

---

## 三、缺失命令的契约定义

以下命令计划实现，此处定义其正式契约。

### `bridge status --json`

```
bridge status [--json]
```

**--json 输出:**
```json
{
  "version": "0.6.0",
  "label": "PENGSPC",
  "pid": 12345,
  "uptime": 3600,
  "role": "leaf",
  "nodeId": "b4a745246cdb170b2391c7cedd0b97af",
  "system": {
    "platform": "win32",
    "hostname": "PENGSPC",
    "arch": "x64",
    "cpus": 16,
    "memory": { "total": 34359738368, "free": 17179869184 }
  },
  "adapters": [
    { "id": "shell", "available": true },
    { "id": "claude-code", "available": true }
  ],
  "relayConnected": true,
  "upstreamRelay": "ws://43.160.241.180:8080",
  "instanceId": "inst_22_mp6ibr27"
}
```

**对应 HTTP API**: `GET /api/status` (关键字段一致)

---

### `bridge connect <url>`

```
bridge connect <url> [--token <token>] [--json]
```

**行为**: 连接到指定 relay，持久化 upstreamRelay 到 agent.json。

**--json 输出:**
```json
{
  "ok": true,
  "relayUrl": "ws://43.160.241.180:8080",
  "status": "registered",
  "instanceId": "inst_22_mp6ibr27"
}
```

**对应 HTTP API**: `POST /api/connect`

---

### `bridge instances list --json`

```
bridge instances list [--source local|remote] [--status running|stopped] [--json]
```

**--json 输出:**
```json
{
  "instances": [],
  "activeId": "inst_1_abc123"
}
```

**对应 HTTP API**: `GET /api/instances`

---

### `bridge operation start --json`

```
bridge operation start --node <nodeId> --kind plugin --plugin-id system-info [--command get] [--input '{}'] [--subscribe] [--json]
```

**--json 输出:**
```json
{
  "operationId": "op_1_mp5nr3ul",
  "status": "running",
  "nodeId": "inst_22_mp6ibr27"
}
```

**对应 WS 协议**: `operation.start`

---

### `bridge auth status --json`

```
bridge auth status [--json]
```

**--json 输出:**
```json
{
  "authEnabled": true,
  "tokenSet": true,
  "authenticated": true,
  "sessionExpires": "2026-05-29T14:00:00Z"
}
```

**对应 HTTP API**: `GET /api/auth/check`

---

## 四、错误码规范

所有 CLI 命令在失败时应返回非零退出码，并在 `--json` 模式下输出结构化错误：

| 退出码 | 含义 | JSON 字段 |
|--------|------|-----------|
| 0 | 成功 | `{ "ok": true }` |
| 1 | 一般错误 | `{ "error": "message" }` |
| 2 | 权限不足 | `{ "error": "Permission denied", "code": "PERMISSION_DENIED" }` |
| 3 | 未找到 | `{ "error": "Not found", "code": "NOT_FOUND" }` |
| 4 | 连接失败 | `{ "error": "Connection failed", "code": "CONNECTION_FAILED" }` |
| 5 | 上游不可达 | `{ "error": "Upstream not reachable", "code": "UPSTREAM_UNREACHABLE" }` |

---

## 五、AI Agent 可调用性

标记为 `--json` 支持的命令均可被 AI agent 解析输出并自动化决策。当前已实现命令中仅 `bridge daemon status` 和 `bridge` (启动) 有部分可脚本化输出。

建议优先级：
1. `bridge status --json` → 替代 curl /api/status
2. `bridge connect --json` → 替代 curl POST /api/connect
3. `bridge instances list --json` → 替代 curl /api/instances
4. `bridge operation start --json` → 首次为 WS protocol 提供脚本化入口
