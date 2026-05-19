# SessionBridge HTTP API 参考

> 所有 HTTP API 端点。Relay server 同时 serve REST API + WebSocket + 静态文件。
> 原则：API 是统一能力层，CLI 和页面都是它的消费者。

---

## 请求约定

- **Base URL**: `http://<host>:<relay-port>` (默认 8080)
- **Content-Type**: `application/json` (请求与响应)
- **Auth**: 远程访问需 `sb_session` cookie (由 `/api/auth/login` 设置)，localhost 绕过
- **CORS**: 所有 admin routes 返回 `Access-Control-Allow-Origin: *`
- **错误格式**: `{ "error": "message" }` 或 `{ "error": "message", "code": "ERROR_CODE" }`

---

## 一、实例管理

### `GET /api/instances`

列出所有已注册实例。

**响应**:
```json
{
  "instances": [{ "id": "inst_1_abc", "dir": "/path", "label": "node1", "status": "running", "source": "local", "adapterId": "shell", ... }],
  "activeId": "inst_1_abc"
}
```

**对应 CLI**: `bridge instances list --json` (planned)
**对应页面**: 左侧边栏实例列表
**测试**: -

---

### `GET /api/instances/:id`

获取单个实例详情。

**响应**: `{ "instance": { ... } }`
**错误**: 404 `{ "error": "Instance not found: :id" }`

**对应 CLI**: - (planned)
**对应页面**: 节点详情
**测试**: -

---

### `GET /api/instances/:id/status`

轻量状态查询。

**响应**:
```json
{
  "instanceId": "inst_1_abc", "status": "running", "source": "local",
  "adapterId": "shell", "model": null, "isProcessing": false, "queueDepth": 0
}
```

**对应 CLI**: -
**对应页面**: StatusBar
**测试**: -

---

### `POST /api/instances/:id/command`

向实例发送控制命令 (clear, restart, interrupt, rewind, setMode, setEffort, switch-instance 等)。

**请求**: `{ "command": "clear", "args": {} }`
**权限**: `processManagement`

**响应**: `{ "success": true, "instanceId": ":id", "command": "clear" }`
**错误**: 404 实例不存在, 503 远程 agent 未连接 / 无可写 transport

**对应 CLI**: -
**对应页面**: 命令面板, StatusBar
**测试**: -

---

### `POST /api/instances`

创建新实例（不 spawn 进程，进程由 relay 异步管理）。

**请求**: `{ "dir": "/path", "label": "name", "adapterId": "claude-code" }` — adapterId 必填
**权限**: `processManagement`

**响应** (201):
```json
{
  "success": true,
  "instance": { "id": "inst_2_def", "dir": "/path", "label": "name", "status": "starting", "adapterId": "claude-code" }
}
```

WS 广播: `instance.added`
**错误**: 400 `adapterId is required`, 400 目录不存在

**对应 CLI**: -
**对应页面**: 左侧边栏 "创建新实例"
**测试**: -

---

### `DELETE /api/instances/:id`

停止并删除实例。

**权限**: `processManagement`

**响应**: `{ "success": true }`
WS 广播: `instance.removed`

**对应 CLI**: -
**对应页面**: 左侧边栏 "杀死实例"
**测试**: -

---

## 二、别名管理

### `GET /api/aliases`

返回所有设备别名。

**响应**: `{ "aliases": { "remote:/path": "My Device" } }`

**对应 CLI**: -
**对应页面**: NodeNetworkView
**测试**: -

---

### `POST /api/aliases`

设置/更新别名，同时更新匹配实例的 label 并广播。

**请求**: `{ "instanceId": "inst_1", "alias": "My Device" }`

**响应**: `{ "success": true, "instance": { "id": "inst_1", "label": "My Device" } }`
WS 广播: `instance.updated`

**对应 CLI**: -
**对应页面**: NodeNetworkView
**测试**: -

---

### `DELETE /api/aliases/:identity`

删除别名。

**响应**: `{ "success": true }`

---

## 三、Sessions

### `GET /api/sessions`

列出最近会话 (通过第一个提供 SessionProvider 的 adapter)。

**响应**: `{ "sessions": [{ "sessionId": "...", "display": "...", "project": "...", "timestamp": 1234567890 }] }`

**对应 CLI**: -
**对应页面**: 历史面板
**测试**: -

---

## 四、健康与状态

### `GET /api/health`

增强健康检查。包含 uptime、实例统计、内存、系统信息。

**响应**:
```json
{
  "status": "ok",
  "uptime": 123456, "uptimeMs": 123456,
  "instanceCount": 3, "localInstances": 2, "remoteInstances": 1, "runningInstances": 2,
  "activeInstanceId": "inst_1",
  "relayTokenSet": false, "relayTokenStatus": "unset",
  "memory": { "rss": 123456, "heapTotal": 45678, "heapUsed": 34567, "rssMB": 120, "heapMB": 33 },
  "system": { "platform": "win32", "hostname": "PC", "freemem": 123, "totalmem": 456, "loadavg": [0,0,0], "nodeVersion": "v20", "uptime": 123, "arch": "x64" },
  "instances": [...]
}
```

**对应 CLI**: `bridge status --json` (planned)
**对应页面**: ConnectionPanel
**测试**: -

---

### `GET /api/status`

运行时状态快照。

**响应**:
```json
{
  "version": "0.6.0", "label": "node1", "pid": 12345, "uptime": 123.4,
  "system": { "platform": "win32", "hostname": "PC", "arch": "x64", "cpus": 16, ... },
  "adapters": [{ "id": "shell", "available": true }, ...],
  "permissions": { "shellAccess": true, ... },
  "notifications": { "scenarios": [], "settings": {} }
}
```

**对应 CLI**: `bridge status --json` (planned)
**对应页面**: Dashboard HTML, page.tsx 状态栏
**测试**: -

---

### `GET /api/system`

系统信息（比 health 精简）。

**响应**: `{ "platform": "win32", "hostname": "PC", "arch": "x64", "cpus": 16, "memory": {...}, "uptime": 123, "nodeVersion": "v20" }`

**对应 CLI**: -
**对应页面**: Settings panel
**测试**: -

---

### `GET /api/processes?sort=cpu&limit=20`

进程列表。

**响应**: `[{ "pid": 123, "name": "node.exe", "cpu": 1.2, "memory": 123456, ... }]`

**对应 CLI**: -
**对应页面**: -
**测试**: -

---

## 五、配置

### `GET /api/config`

返回完整配置 (ConfigManager)。

**响应**: `{ "upstreamRelay": "...", "relayPort": 8080, ... }`

**对应 CLI**: `bridge config get` (planned)
**对应页面**: Settings panel (部分)
**测试**: -

---

### `POST /api/config`

合并部分配置更新。

**请求**: `{ "relayPort": 9000 }`

**响应**: `{ "success": true, "config": { ... } }`

**对应 CLI**: `bridge config set` (planned)
**对应页面**: Settings panel
**测试**: -

---

### `POST /api/config/connections`

Upsert 远程 relay 连接。

**请求**: `{ "id": "my-relay", "url": "ws://host:8080" }`

**响应**: `{ "success": true, "connections": [...] }`

**对应 CLI**: -
**对应页面**: NodeNetworkView
**测试**: -

---

### `DELETE /api/config/connections/:id`

删除远程 relay 连接。

**对应 CLI**: -
**对应页面**: NodeNetworkView
**测试**: -

---

## 六、Configuration System (Phase 4M)

### `GET /api/configuration/schema`

所有扩展配置贡献 + 属性 schema。

**响应**: `{ "contributions": [...], "properties": { "key": { "type": "string", "default": "", "description": "..." } } }`

**对应 CLI**: -
**对应页面**: Settings panel
**测试**: -

---

### `GET /api/configuration/values?scope=user|workspace`

读取指定 scope 的配置值（secret key 显示为 `[REDACTED]`）。

**响应**: `{ "scope": "user", "values": { "my.key": "value" } }`

**对应 CLI**: `bridge config get` (planned)
**对应页面**: Settings panel
**测试**: -

---

### `GET /api/configuration/inspect?key=...`

分层 inspect 结果 (user → workspace → default)。

**响应**: `{ "key": "my.key", "effectiveValue": "...", "userValue": "...", "workspaceValue": "...", "defaultValue": "..." }`

**对应 CLI**: -
**对应页面**: Settings panel
**测试**: -

---

### `PATCH /api/configuration/values`

更新配置值。Secret key 路由到 SecretStore。

**请求**: `{ "scope": "user", "key": "my.key", "value": "new" }`
**权限**: `configurationWrite`

**响应**: `{ "success": true, "key": "my.key", ... }`
**错误**: 400 未知 key, 400 校验失败

**对应 CLI**: `bridge config set` (planned)
**对应页面**: Settings panel
**测试**: -

---

### `DELETE /api/configuration/values?scope=...&key=...`

重置配置为默认值。Secret key 从 SecretStore 删除。

**权限**: `configurationWrite`

**响应**: `{ "success": true, ... }`

**对应 CLI**: -
**对应页面**: Settings panel "重置"
**测试**: -

---

## 七、Secrets (Phase 4M)

### `GET /api/secrets?key=...`

检查 secret 是否存在（**永不返回 secret 值**）。

**响应**: `{ "key": "api.key", "exists": true, "configured": true }`

---

### `PUT /api/secrets`

设置 secret 值。

**请求**: `{ "key": "api.key", "value": "sk-xxx" }`
**权限**: `configurationWrite`

**响应**: `{ "success": true, "key": "api.key", "configured": true }`

---

### `DELETE /api/secrets?key=...`

删除 secret。

**权限**: `configurationWrite`

**响应**: `{ "success": true, "key": "api.key", "configured": false }`

---

## 八、连接管理

### `GET /api/connections`

列出所有已保存连接 (从 `connections.json`)。

**响应**: `{ "connections": [{ "id": "local", "name": "local", "url": "ws://127.0.0.1:8080", ... }] }`

**对应 CLI**: `bridge connections list --json` (planned)
**对应页面**: ConnectionPanel, NodeNetworkView
**测试**: -

---

### `POST /api/connections`

添加或更新连接。

**请求**: `{ "id": "my-relay", "url": "ws://host:8080" }`

**响应**: `{ "success": true, "connections": [...] }`

**对应 CLI**: -
**对应页面**: NodeNetworkView
**测试**: -

---

### `DELETE /api/connections/:id`

删除连接。

**对应 CLI**: -
**对应页面**: NodeNetworkView
**测试**: -

---

## 九、Relay 连接

### `GET /api/connect`

获取 upstream relay 连接状态。

**响应**:
```json
{
  "relayUrl": "ws://upstream:8080",
  "configuredRelay": "ws://upstream:8080",
  "connected": true,
  "status": "registered",
  "instanceId": "inst_22_xxx",
  "error": "",
  "token": "abc123…",
  "command": "bridge connect ws://upstream:8080",
  "role": "leaf"
}
```

**注意**: `command` 字段引用了不存在的 `bridge connect` 命令 — 参见 `CLI_FEATURE_GAPS.md` §2.1。

**对应 CLI**: `bridge connect --json` (stale-doc)
**对应页面**: ConnectionPanel, startup banner
**测试**: -

---

### `POST /api/connect`

连接或断开 upstream relay。

**连接请求**: `{ "relayUrl": "ws://upstream:8080", "token": "optional" }`
**断开请求**: `{ "disconnect": true }`

**连接成功** (200): `{ "ok": true, "relayUrl": "ws://...", "status": "registered", "instanceId": "inst_22_xxx", "message": "Connected" }`
**连接失败** (502): `{ "ok": false, "relayUrl": "", "status": "...", "error": "Upstream not reachable or did not register" }`
**断开** (200): `{ "ok": true, "relayUrl": "", "message": "Disconnected" }`

**对应 CLI**: `bridge connect <url>` (stale-doc)
**对应页面**: ConnectionPanel "连接上游 relay" 按钮
**测试**: -

---

## 十、认证

### `GET /setup`

首次设置页面 (HTML)。已设置 token 时重定向到 `/login`。

**Localhost**: 重定向到 `/` (有 out/) 或 `http://localhost:3000` (dev)

---

### `POST /api/auth/setup`

首次设置访问密钥。同时创建 session 并设置 cookie。

**请求**: `{ "password": "secret123", "confirm": "secret123" }` (JSON) 或 `password=...&confirm=...` (form)

**成功**: 302 → `/`, `Set-Cookie: sb_session=...`
**错误**: 密码 < 8 字符, 两次输入不一致, token 已设置

**对应 CLI**: `bridge setup --dashboard-token X`
**对应页面**: /setup
**测试**: `admin-auth-gate.ts`

---

### `GET /login`

登录页面 (HTML)。Localhost 重定向到 `/`。

---

### `POST /api/auth/login`

提交密码登录。

**请求**: `{ "token": "secret123" }` (JSON) 或 `token=...` (form)

**成功**: 302 → `/`, `Set-Cookie: sb_session=...`
**错误**: 密码错误

**对应页面**: /login
**测试**: `admin-auth-gate.ts`

---

### `POST /api/auth/logout`

登出，清除 session。

**响应**: `{ "ok": true }`, `Set-Cookie: sb_session=; Max-Age=0`

**对应页面**: 任意页面 "登出"
**测试**: `admin-auth.ts`

---

### `GET /api/auth/check`

检查认证状态。

**响应**:
```json
{
  "authenticated": true,
  "authEnabled": true,
  "tokenSet": true,
  "session": { "createdAt": "...", "expiresAt": "..." }
}
```

Localhost: `{ "authenticated": true, "authEnabled": true, "tokenSet": true, "local": true }`

**对应 CLI**: `bridge auth status --json` (planned)
**对应页面**: Settings panel
**测试**: `config-merge.test.ts` (indirect)

---

### `POST /api/auth/toggle`

开关认证。

**请求**: `{ "enabled": true }`
**前置条件**: 未设置密码时不能开启

**响应**: `{ "ok": true, "authEnabled": true }`

**对应 CLI**: `bridge auth toggle` (planned)
**对应页面**: Settings panel
**测试**: -

---

### `POST /api/auth/change-password`

修改访问密钥（需旧密码验证），所有现有 session 失效。

**请求**: `{ "oldToken": "old", "newToken": "new" }`

**响应**: `{ "ok": true, "message": "密码已更改，所有会话已失效" }`
**错误**: 403 旧密码错误, 400 新密码 < 8 字符

**对应 CLI**: `bridge auth change-password` (planned)
**对应页面**: Settings panel
**测试**: -

---

### `GET /api/auth/sessions`

列出活动 session。

**响应**: `[{ "id": "abc123…", "createdAt": "...", "expiresAt": "...", "userAgent": "Chrome/..." }]`

---

### `DELETE /api/auth/sessions?id=...`

撤销指定 session。

**响应**: `{ "ok": true }`

---

## 十一、Shell (Ad-hoc)

### `POST /api/shell/run`

执行命令（短生命周期），通过 SSE 流式返回输出。

**请求**: `{ "command": "dir", "cwd": "/path" }`
**权限**: `shellAccess`

**响应**: `{ "instanceId": "sh_xxx", "pid": 12345 }`

**注意**: 如果 relay 连接存在，同时 forward 到 relay 节点。

**对应 CLI**: `bridge run <command>` (有 bug — 见 `CLI_FEATURE_GAPS.md` §2.2-2.4)
**对应页面**: terminal
**测试**: -

---

### `GET /api/shell/stream?id=...`

SSE 流式订阅 shell 输出。

**响应**: `text/event-stream`
- `data:{"stream":"stdout","data":"...output..."}`
- `data:{"type":"exit","code":0}`

---

### `POST /api/shell/input`

向运行中的 shell 写入 stdin。

**请求**: `{ "instanceId": "sh_xxx", "data": "dir\r\n" }`

**响应**: `{ "ok": true }`
**错误**: 404 实例不存在或 stdin 已关闭

---

### `POST /api/shell/kill`

杀死 shell 实例。

**请求**: `{ "instanceId": "sh_xxx" }`

**响应**: `{ "ok": true }`

---

## 十二、扩展

### `GET /api/extensions`

获取扩展状态 (dev mode only)。

**非 dev 模式**: `{ "enabled": false, "state": "disabled" }`
**dev 模式**: 返回扩展信息 + configurations 列表

---

### `POST /api/extensions`

执行扩展管理操作。

**请求**: `{ "action": "reload" }`

**响应**: `{ "ok": true, "message": "Reloading..." }`

**对应 CLI**: `bridge extensions reload` (planned)
**对应页面**: -
**测试**: -

---

## 十三、其他

### `POST /api/daemon/stop`

关闭 relay 服务（daemon 管理用）。

**响应**: `{ "ok": true, "message": "Shutting down..." }`

**对应 CLI**: `bridge daemon stop`

---

### `GET /qr`

QR 码连接页面 (HTML)。

**URL 参数**: `?url=ws://...&token=...`

**注意**: 页面文案引用不存在的 `bridge connect` 命令。

---

### `GET /api/node/external`

检测网络外部可达性。

**响应**: `{ "ips": [...], "reachable": true/false }`

---

### `POST /api/node/external`

开关外部访问 (dashboard bind)。

**请求**: `{ "enable": true }`

**响应**: `{ "enabled": true, "bind": "0.0.0.0", "port": 8080, "message": "..." }`

---

### `GET /api/logs`

最近 50 条管理日志。

**响应**: `["[timestamp] message", ...]`

**对应 CLI**: `bridge logs` (planned)

---

### `GET /api/permissions`

获取权限 grants。

**响应**: `{ "shellAccess": true, "processManagement": true, ... }`

---

### `POST /api/permissions`

修改权限。

**请求**: `{ "category": "shellAccess", "value": false }`

**响应**: `{ "ok": true, "grants": { ... } }`

**对应 CLI**: `bridge permissions set` (planned)

---

### `GET /api/notifications`

获取通知设置。

**响应**: `{ "scenarios": [...], "settings": {...} }`

---

### `POST /api/notifications`

修改通知设置。

**请求**: `{ "scenarioId": "agent.connected", "value": true }`

**响应**: `{ "scenarios": [...], "settings": {...} }`

---

## 十四、标记

- 有对应测试的端点在"测试"列注明
- 空白表示尚无覆盖该端点的自动化测试
- `(planned)` 表示 CLI 命令已设计契约但未实现
- `(有 bug)` 表示 CLI 命令存在但已知有问题
