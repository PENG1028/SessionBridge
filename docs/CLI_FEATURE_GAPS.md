# CLI 功能缺口与一致性审计

> 目标：CLI 作为 NodeRuntime 的本体入口，所有核心能力必须可通过 CLI --json 脚本化调用
> 原则：CLI ≥ API ≥ 页面 > 协议——能力先在 CLI 层暴露，API 和页面是它的消费者

---

## 一、缺口总表

| # | 场景 | 页面入口 | CLI 命令 | HTTP API | WS/Operation 协议 | --json | 当前状态 | 缺口 |
|---|------|---------|---------|----------|-------------------|--------|---------|------|
| 1 | 启动节点 | - | `bridge` (默认) | - | hello→welcome | ❌ | implemented | - |
| 2 | daemon start | - | `bridge daemon start` | POST /api/daemon/stop | - | ❌ | implemented | --json |
| 3 | daemon stop | - | `bridge daemon stop` | POST /api/daemon/stop | - | ❌ | implemented | --json |
| 4 | daemon status | - | `bridge daemon status` | - | - | output | implemented | --json parseable |
| 5 | daemon install | - | `bridge daemon install` | - | - | ❌ | implemented | --json |
| 6 | 查看节点状态 | Dashboard HTML, page.tsx 状态栏 | ❌ `bridge status` | GET /api/status, /api/health | - | ❌ | missing | **无 CLI 命令** |
| 7 | 查看连接状态 | page.tsx connection panel | ❌ `bridge connections list` | GET /api/connect, /api/connections | - | ❌ | partial | **CLI 缺失** |
| 8 | 连接 upstream relay | page.tsx connect form, startup banner | ❌ `bridge connect` | POST /api/connect | hello→agent.register | ❌ | **stale-doc** | **命令不存在但多处引用** |
| 9 | 断开 upstream relay | page.tsx disconnect btn | ❌ | POST /api/connect (disconnect) | - | ❌ | partial | **CLI 缺失** |
| 10 | 查看 peers/nodes | page.tsx topology panel | ❌ `bridge instances list` | GET /api/instances | peer.list | ❌ | partial | **CLI 缺失** |
| 11 | 查看单个 instance | page.tsx node detail | ❌ | GET /api/instances/:id | - | ❌ | partial | **CLI 缺失** |
| 12 | 打开远程 terminal | page.tsx terminal tab | ❌ | POST /api/shell/run → SSE stream | shell.spawn → agent.stdout | ❌ | partial | **CLI 缺失** |
| 13 | terminal 输入 | page.tsx terminal input | `bridge run <cmd>` (近似) | POST /api/shell/input | shell.input | ❌ | partial | bridge run 实现有 bug |
| 14 | terminal 输出流 | page.tsx terminal output | `bridge run <cmd>` (SSE) | GET /api/shell/stream | agent.stdout/agent.stderr | ❌ | partial | bridge run 用 dashboardPort=9843 |
| 15 | operation.start | ❌ 无页面直接入口 | ❌ | ❌ 仅 WS | operation.start (browser→relay→agent) | ❌ | needs-test | **无 CLI、无 API、无页面入口** |
| 16 | operation.input | ❌ 无页面直接入口 | ❌ | ❌ 仅 WS | operation.input | ❌ | needs-test | **无 CLI、无 API** |
| 17 | operation.subscribe | ❌ 无页面直接入口 | ❌ | ❌ 仅 WS | operation.subscribe | ❌ | needs-test | **无 CLI、无 API** |
| 18 | operation.cancel | ❌ 无页面直接入口 | ❌ | ❌ 仅 WS | operation.cancel | ❌ | needs-test | **无 CLI、无 API** |
| 19 | 插件 operation (mock-echo) | ❌ | ❌ | ❌ | operation.start kind=plugin pluginId=mock-echo | ❌ | needs-test | **仅协议测试覆盖** |
| 20 | 插件 operation (system-info) | ❌ | ❌ | ❌ | operation.start kind=plugin pluginId=system-info | ❌ | needs-test | **仅协议测试覆盖** |
| 21 | auth setup | 远程 /setup 页面 | `bridge setup --dashboard-token X` | POST /api/auth/setup | - | ❌ | implemented | - |
| 22 | auth login | 远程 /login 页面 | - | POST /api/auth/login | - | ❌ | implemented | 浏览器自动跳转 |
| 23 | auth 状态查询 | ❌ | ❌ `bridge auth status` | GET /api/auth/check | - | ❌ | missing | **CLI 缺失** |
| 24 | auth toggle | ❌ Settings panel (TODO) | ❌ | POST /api/auth/toggle | - | ❌ | missing | **CLI + 页面都缺失** |
| 25 | auth 改密码 | ❌ Settings panel (TODO) | ❌ | POST /api/auth/change-password | - | ❌ | missing | **CLI + 页面都缺失** |
| 26 | auth sessions 管理 | ❌ | ❌ | GET/DELETE /api/auth/sessions | - | ❌ | missing | **CLI + 页面都缺失** |
| 27 | config get | ❌ Settings panel (部分) | ❌ `bridge config get` | GET /api/config | - | ❌ | missing | **CLI 缺失** |
| 28 | config set | ❌ Settings panel (部分) | `bridge setup --relay X` (仅 relayUrl) | POST /api/config | - | ❌ | partial | CLI setup 只能设 5 个字段 |
| 29 | connections CRUD | ❌ | ❌ | GET/POST/DELETE /api/connections | - | ❌ | partial | **CLI 缺失** |
| 30 | permissions get/set | ❌ | ❌ | GET/POST /api/permissions | - | ❌ | partial | **CLI 缺失** |
| 31 | extensions list/reload | ❌ | ❌ | GET/POST /api/extensions | - | ❌ | partial | **CLI 缺失** |
| 32 | 查看日志 | ❌ | ❌ `bridge logs` | GET /api/logs | - | ❌ | missing | **CLI 缺失** |
| 33 | 节点更新 | ❌ Settings panel | `bridge --update` | - | - | ❌ | implemented | --json |
| 34 | Mobile/QR 连接 | /qr 页面 | ❌ | - | - | ❌ | partial | QR 页面写 bridge connect（不存在） |
| 35 | 外部访问开关 | ❌ Settings panel | ❌ | GET/POST /api/node/external | - | ❌ | partial | **CLI 缺失** |
| 36 | 进程列表 | ❌ | ❌ | GET /api/processes | - | ❌ | partial | **CLI 缺失** |
| 37 | 系统信息 | ❌ | ❌ | GET /api/system | system-info plugin | ❌ | partial | **CLI 缺失** |
| 38 | 通知设置 | ❌ | ❌ | GET/POST /api/notifications | - | ❌ | partial | **CLI 缺失** |
| 39 | 别名管理 | ❌ | ❌ | GET/POST/DELETE /api/aliases | - | ❌ | partial | **CLI 缺失** |

**状态标记说明**：`implemented`=已完整实现, `partial`=部分实现, `missing`=完全缺失, `stale-doc`=文档/文案引用不存在的东西, `needs-test`=有实现但缺测试

---

## 二、严重不一致 (P0)

### 2.1 `bridge connect` — 被多处引用但不存在

**引用位置**：
- `src/index.ts:402` 启动 banner: `bridge connect ${relayAddr}`
- `src/admin-routes.ts:159` QR 页面: `bridge connect ${connectUrl}`
- `src/admin-routes.ts:806` /api/connect GET 响应: `command: bridge connect ...`

**实际情况**：CLI 没有 `connect` 子命令。用户看到提示后输入 `bridge connect ...` 会直接启动为 node（fallback 到默认模式）。

### 2.2 `bridge run` 使用已废弃的 dashboardPort=9843

`src/run-command.ts:83`:
```typescript
`--dashboard-port=${opts.dashPort}`,  // dashPort 默认为 9843
```

dashboardPort 文档已标记为 `@deprecated`，dashboard 已整合到 relay port (9000)。但 `run-command.ts` 仍使用 9843 端口启动 agent 并与其通信。

### 2.3 `run-command.ts` 传递不存在的 `agent` 子命令

`src/run-command.ts:82`:
```typescript
'agent',  // 传给 CLI 作为 args[0]
```

但 `src/index.ts` 没有 `agent` 子命令的处理逻辑。`args[0] === 'agent'` 会 fallthrough 到默认 node 模式，`--dashboard-port=9843` 被解析为 CLI flag。

### 2.4 `run-command.ts` 使用错误的 CLI flag

`src/run-command.ts:86`:
```typescript
if (opts.relayUrl) args.push(`--relay=${opts.relayUrl}`);
```

但 CLI 实际接受的参数是 `--upstream`，不是 `--relay`。`--relay` 只在 `bridge setup` 子命令下有效。

---

## 三、能力缺口 (P1)

### 3.1 缺失 CLI 子命令

以下场景有 API 但无 CLI：

| 缺失命令 | 替代方案 | 影响 |
|---------|---------|------|
| `bridge status` | curl /api/status | AI agent 不可脚本化 |
| `bridge instances list` | curl /api/instances | 同上 |
| `bridge connections list` | curl /api/connections | 同上 |
| `bridge auth status` | curl /api/auth/check | 同上 |
| `bridge auth toggle` | curl POST /api/auth/toggle | 同上 |
| `bridge auth change-password` | curl POST /api/auth/change-password | 同上 |
| `bridge config get/set` | curl /api/config | 同上 |
| `bridge logs` | curl /api/logs | 同上 |
| `bridge permissions get/set` | curl /api/permissions | 同上 |
| `bridge extensions list/reload` | curl /api/extensions | 同上 |
| `bridge operation start` | 仅 WS 协议 | 不可脚本化 |
| `bridge node external` | curl /api/node/external | 同上 |

### 3.2 缺失 HTTP API 入口

RemoteOperation 的统一模型目前 **只能通过 WebSocket 协议** 触发：
- `operation.start` — 无 HTTP API 包装
- `operation.subscribe` — 无 HTTP API 包装
- `operation.cancel` — 无 HTTP API 包装

建议至少为 `operation.start` 增加 `POST /api/operation/start` HTTP 端点，以便 curl/脚本触发。

---

## 四、协议层面缺口 (P2)

### 4.1 OperationRunner 内置 handler 只有 2 个

`agent-core/operation-runner.ts` 的 `registerBuiltins()` 只注册了 `mock-echo` 和 `system-info` 两个 plugin handler。其他 extension（claude-code, shell, host）尚未通过 OperationRunner 统一调度。

### 4.2 operation.input 是 placeholder

`OperationRunner.input()` 只 echo 回 `stdin_echo` stream，没有写入实际进程 stdin。长运行任务（如远程 shell）的交互式输入路径不完整。

---

## 五、已一致的能力（验证通过）

| 能力 | CLI | API | 页面 | 测试 |
|------|-----|-----|------|------|
| 启动 relay server | `bridge` | - | - | admin-auth-gate.ts |
| agent 注册到 relay | `bridge --upstream X` | - | page.tsx 连接指示 | real-agent-operation-protocol.ts |
| mock-echo operation | - | - | - | real-agent-operation-protocol.ts (39/39) |
| system-info operation | - | - | - | real-agent-operation-protocol.ts (39/39) |
| auth setup/login/logout | - | /api/auth/* | /setup, /login | admin-auth-gate.ts, admin-auth.ts (24/24) |
| config merge (undefined fix) | - | - | - | config-merge.ts (8/8) |
| workbench tab sync | - | workbench.subscribe | page.tsx tabs | - |

---

## 六、下一步优先级

### P0 — 会导致用户误操作
1. **`bridge connect` 幽灵命令** — 要么实现 `bridge connect` 子命令，要么将所有引用改为 `bridge --upstream <url>`
2. **`run-command.ts` bug** — 修复 dashboardPort 和错误的 CLI flag
3. **dashboardToken undefined override** — 已在 `config.ts` + `index.ts` 修复（本 session 前半部分）

### P1 — CLI/API/Page 不一致
4. 补充 `bridge status --json`
5. 补充 `bridge instances list --json`
6. 补充 `bridge connections list --json`
7. 补充 `bridge auth status --json`
8. 补充 `bridge operation start --json` (包装 WS protocol)
9. 将 `bridge setup` 的字段补全（dashboardAuthEnabled, dashboardSessionTtl 等）

### P2 — 文档/测试
10. 写 CLI_REFERENCE.md
11. 写 API_REFERENCE.md
12. 写测试：cli-api-parity.test.mjs

### P3 — 体验优化
13. terminal input/output 的 CLI 体验改进
14. 移动端 QR 连接流程验证
