# Runtime Execution Audit

> Phase 4: 执行底座统一审计 — 2026-05-09
> Phase 4A: 旁路权限检查收口 — 2026-05-09（当前状态）

## 概述

当前存在四条独立的命令/Shell 执行路径，各有不同的生命周期管理、输出转发、权限检查和 adapter 集成深度。

## Phase 4A 完成状态

| 执行路径 | 权限检查 | 走 adapter | Phase 4A 动作 |
|---|---|---|---|
| Browser → relay-server shell.spawn | ✅ 已有 | ✅ | 无变更 |
| node-runtime spawnShell() | ✅ 新增 | ❌ 仍直连 spawn | 添加 `this.permissions.check('shellAccess')` |
| dashboard-server /api/shell/run | ✅ 新增 | ❌ 仍直连 spawn | 添加 `permissions.check('shellAccess')`，拒时回 403 |
| bridge run → dashboard-server | ✅ 继承 | ❌ 委托 Path 3 | 无变更，继承 Path 3 的保护 |

### 本阶段明确不做的事

- ❌ 没有统一进程生命周期到 InstanceManager
- ❌ 没有把所有 spawn 统一到 adapter 体系
- ❌ 没有实现插件级细粒度 command permission
- ❌ 没有实现 marketplace / install 流程

---

## 1. relay-server shell.spawn / shell.input（WebSocket 协议）

### 入口

- `src/relay-server.ts:1615` — WS message `shell.spawn`
- `src/relay-server.ts:1628` — WS message `shell.input`
- 辅助：`shell.lock` / `shell.unlock`（写锁管理）

### 流程

```
browser WS --shell.spawn--> relay-server
  └─ spawnShellForWs(ws, instanceId)
       ├─ 权限检查: permissions.check('shellAccess')
       ├─ 查找 terminal-capable adapter (resolveAdapterByCapability)
       ├─ 创建/复用 InstanceData
       └─ terminalAdapter.start({onOutput, onExit})  ← 走 adapter
```

### 进程生命周期

谁创建：`terminalAdapter.start()` — 委托给 adapter（如 ShellAdapter）
谁终止：`killInstance()` — 调用 `i.handle.stop()` + `i.process.kill()`
重启：`spawnShellForWs` 中的 reconnect 检测重用已有 handle
跟踪：通过 `InstanceManager`（`InstanceData` 对象）

### 输出转发

- `broadcastShellOutput(instanceId, data)` → `shellSubscribers` Map → 所有订阅的 WS
- 同时写入 `instance.outputBuffer` 用于断线重放

### 权限

- `permissions.check('shellAccess', { action: 'spawn_shell' })` — **有**
- 权限模型在 `src/relay-server.ts` 的 `PermissionModel` 实例中

### 是否走 adapter

**是** — 通过 `resolveAdapterByCapability('terminal', true)` 查找 terminal-capable adapter，然后调用 `adapter.start()`。ShellAdapter（`extensions/shell/index.ts`）是最常用的实现。

### 是否能被插件复用

**是** — 任何声明 `terminal: true` 的 adapter 都可以被这条路使用。插件只需在 manifest 中声明 capabilities.terminal。

### 写锁机制

- `shellLockMap`: instanceId → owning WS，防止多个 browser 同时写
- `shell.subscribe` / `shell.output` 是独立的订阅广播模型

---

## 2. node-runtime spawnShell()（agent 侧 shell）

### 入口

- `agent-core/node-runtime.ts:333` — `spawnShell()`
- 触发条件：agent 注册成功后的 `'registered'` 事件（line 231）

### 流程

```
agent 注册成功
  └─ relay.on('registered') → spawnShell()
       └─ child_process.spawn('bash' | 'powershell', ...)
            ├─ stdout → relay.sendStdout(chunk)
            ├─ stderr → relay.sendStderr(chunk)
            └─ stdin ← relay.on('stdin') → shellProc.stdin.write(data)
```

### 进程生命周期

谁创建：`NodeRuntime.spawnShell()` — 直接 `child_process.spawn()`
谁终止：`killShell()` — `shellProc.kill()`
重启：无自动重启（agent 重连时通过 `registered` 事件重新 spawn）
跟踪：`NodeRuntime.shellProc` 私有字段

### 输出转发

- stdout → `relay.sendStdout()` → WebSocket → relay-server → `agent.stdout` → `parseLine` / `broadcast`
- stderr → `relay.sendStderr()` → relay-server → `agent.stderr` → `broadcast`
- 有背压控制（256KB high / 64KB low watermark）

### 权限

**Phase 4A 已修复** — `spawnShell()` 入口调用 `this.permissions.check('shellAccess')`，拒绝时记录日志并跳过 spawn。

### 是否走 adapter

**否** — 直接 `child_process.spawn()`，不经过任何 adapter。ShellAdapter 未被使用。

### 是否能被插件复用

**否** — 硬编码在 `NodeRuntime` 中，插件无法干预。

### 关键缺陷

- 和 Path 1（relay-server shell.spawn）是功能重叠的。relay-server 已经有 terminal adapter 机制来管理 shell，node-runtime 自建了一套独立的 spawn 逻辑。
- PID 文件清理机制（`.sessionbridge/shell.pid`）与 InstanceManager 无关。

---

## 3. dashboard-server /api/shell/run（HTTP API）

### 入口

- `agent-core/dashboard-server.ts:269` — `POST /api/shell/run`
- 辅助端点：`/api/shell/stream`（SSE）、`/api/shell/input`（stdin）、`/api/shell/kill`

### 流程

```
HTTP POST /api/shell/run { command, cwd }
  └─ spawn('cmd.exe', ['/c', command]) 或 spawn('sh', ['-c', command])
       ├─ stdout → broadcast(chunk) → SSE + relay
       ├─ stderr → broadcast(chunk) → SSE + relay
       └─ close  → relay.sendInstanceExit + 5s 后清理
```

### 进程生命周期

谁创建：`startDashboard` 中的 `child_process.spawn()`
谁跟踪：`shellInstances` Map（`ShellRunInstance` 对象）
谁终止：`/api/shell/kill` 或进程自身退出
清理：exit 后 5s 延迟删除

### 输出转发

- SSE：`POST /api/shell/run` 返回 `{ instanceId, pid }`，客户端再通过 `GET /api/shell/stream?id=` 获取 SSE 流
- Relay：如果 `relay` 连接存在，通过 `relay.sendStdoutForInstance()` / `relay.sendStderrForInstance()` 转发到 relay-server
- Relay 实例注册：`relay.sendInstanceSpawn()` → relay 创建 remote instance → relay-side 的 `agent.stdout` 处理

### 权限

**Phase 4A 已修复** — `/api/shell/run` handler 在 spawn 前调用 `permissions.check('shellAccess', { command })`，拒绝时返回 403 JSON 错误。

### 是否走 adapter

**否** — 直接 `child_process.spawn()`，不经过任何 adapter。

### 是否能被插件复用

**否** — 硬编码在 dashboard-server 中。

### 关键缺陷

- 和 Path 1、Path 2 是功能重叠的第三套 shell 执行机制
- `shellInstances` Map 与 `InstanceManager` 完全无关，进程跟踪碎片化
- Relay 集成是事后添加的（`relay?.on('instanceSpawned', ...)`），不是原生设计

---

## 4. bridge run 命令行路径（CLI → dashboard-server）

### 入口

- `src/run-command.ts:98` — `runCommand()`
- CLI 入口：`src/index.ts` 中的 `run` 子命令

### 流程

```
bridge run "<command>"
  └─ runCommand({ dashPort, command, ... })
       ├─ agentAlive(dashPort) → 检查 agent dashboard 是否运行
       ├─ 如果 agent 未运行 → startAgentBg() 后台启动 agent
       ├─ POST /api/shell/run { command, cwd }  ← 走 Path 3
       ├─ SSE 流 /api/shell/stream?id=  → 输出到 stdout
       └─ stdin 转发（raw mode）→ POST /api/shell/input
```

### 进程生命周期

完全委托给 Path 3（dashboard-server `/api/shell/run`）。CLI 侧只做：
- Ctrl+C → `POST /api/shell/kill`
- Ctrl+D → detach（不做 kill，进程继续运行）

### 输出转发

- SSE 流直接写到 `process.stdout`
- 无 relay 集成

### 权限

**无** — 委托给 Path 3，而 Path 3 不做权限检查。

### 是否走 adapter

**否** — 委托给 Path 3，Path 3 直接 spawn。

### 是否能被插件复用

**否** — 但可以通过插件在 dashboard-server 端添加 API 端点扩展。

---

## 对比总表

| 维度 | relay-server shell.spawn | node-runtime spawnShell() | dashboard-server /api/shell/run | bridge run |
|---|---|---|---|---|
| **进程创建** | adapter.start() → adapter 内 spawn | 直接 child_process.spawn | 直接 child_process.spawn | 委托 dashboard-server |
| **进程跟踪** | InstanceManager (InstanceData) | NodeRuntime.shellProc 私有字段 | shellInstances Map | 委托 dashboard-server |
| **输出转发** | WS broadcastShellOutput | relay.sendStdout/sendStderr | SSE + relay.sendStdoutForInstance | SSE → stdout |
| **权限检查** | ✅ permissions.check('shellAccess') | ✅ permissions.check('shellAccess')（Phase 4A） | ✅ permissions.check('shellAccess')（Phase 4A） | ✅ 继承 Path 3 |
| **走 adapter** | ✅ 是（terminal adapter） | ❌ 否 | ❌ 否 | ❌ 否 |
| **插件可复用** | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 |
| **背压控制** | ❌ 无 | ✅ 有（256KB/64KB） | ❌ 无 | N/A |
| **用途** | Browser 终端面板 | Agent 侧常驻 shell | 后台命令执行（无终端 UI） | CLI 命令执行 |

---

## 统一方向建议

### 问题

1. **三套 spawn 机制**：relay-server（走 adapter）、node-runtime（直接 spawn）、dashboard-server（直接 spawn），没有共享抽象层。
2. **进程跟踪碎片化**：InstanceManager、NodeRuntime.shellProc、shellInstances Map 三个独立的跟踪点。
3. **权限检查不一致**：只有 relay-server shell.spawn 有权限检查，其他路径绕过。
4. **输出转发模型不同**：WS 广播、SSE 流、relay agent.stdout 三种方式，各有不同的 subscriber 管理。
5. **Adapter 集成不完整**：只有 relay-server shell.spawn 走 adapter，其他两条直接 spawn 路径绕过了 adapter 的能力声明和生命周期管理。

### 建议方向

#### A. 短期（已完成的 Phase 4A）

1. ~~**给 dashboard-server /api/shell/run 加权限检查**~~ — ✅ 已完成（Phase 4A）。在 spawn 前调用 `permissions.check('shellAccess')`。dashboard-server 已有 `PermissionModel` 引用（传给 `startDashboard`），可以直接使用。

2. ~~**给 node-runtime spawnShell() 加权限检查**~~ — ✅ 已完成（Phase 4A）。通过 `this.permissions.check('shellAccess')`。

3. **清理 bridge run 文档** — 当前 `bridge run` 的 agent 启动路径（`startAgentBg`）和 relay 连接检测逻辑比较脆弱，建议明确是否作为 stable API。

#### B. 中期（需设计，下一阶段候选）

4. **统一 Shell 抽象层** — 在 `extensions/` 层新增 `ShellService` 接口：
   - 统一 `spawn(cmd, cwd) → ShellHandle`
   - 统一 `onOutput / onExit / write / kill`
   - 统一权限检查点
   - 三个执行路径都迁到这个接口上

5. **InstanceManager 接管所有进程跟踪** — 让 dashboard-server 的 `shellInstances` 和 node-runtime 的 `shellProc` 也注册到 InstanceManager：
   - 统一生命周期管理（shutdown 时不再需要三处遍历）
   - 统一输出 buffer 管理（断线重放）
   - 统一 audit log

#### C. 长期（架构变更）

6. **消除 node-runtime 直接 spawn** — 改为走 ShellAdapter（或通用 TerminalAdapter）：
   - node-runtime 注册成功后调用 `adapter.start({...})` 创建 shell
   - ShellAdapter 的 `resolveSpawnCommand()` 已经能正确处理 bash/powershell/cmd
   - 这样 agent 侧 shell 也能获取 adapter 的能力声明和权限检查

7. **消除 dashboard-server 直接 spawn** — 同样改为走 adapter 体系：
   - `/api/shell/run` → 创建临时 instance → adapter.start()
   - 利用已有的 InstanceHandle.send/stop/onBlock 接口
   - relay 转发变成 adapter 内置行为，不需要事后 `relay.on('instanceSpawned')` 手动连线

---

## 附录：关键文件映射

| 文件 | 职责 | 涉及路径 |
|---|---|---|
| `src/relay-server.ts` | WS 协议 + shell.spawn/input | Path 1 |
| `src/instance-manager.ts` | 实例生命周期跟踪 | Path 1 |
| `extensions/shell/index.ts` | ShellAdapter 实现 | Path 1 |
| `extensions/claude-code/index.ts` | Claude Code adapter（结构化事件） | Path 1（其他 adapter） |
| `agent-core/node-runtime.ts` | Agent 节点编排 + spawnShell | Path 2 |
| `agent-core/dashboard-server.ts` | Dashboard HTTP API + /api/shell/run | Path 3 |
| `agent-core/relay-connection.ts` | Agent→Relay WS 连接 | Path 2, Path 3 |
| `agent-core/capability-host.ts` | 权限检查封装（agent 侧） | Path 2（旁路） |
| `src/run-command.ts` | bridge run CLI | Path 4 |
| `extensions/types.ts` | 核心类型：AgentAdapter, StartInstanceInput, InstanceHandle | 所有路径 |
| `agent-core/permissions.ts` | PermissionModel | Path 1（relay-server） |

---

## 附录：当前执行拓扑图

```
Browser (Next.js UI)
  │
  ├─ WS ───► relay-server ───► adapter.start() ───► child_process    [Path 1: shell.spawn]
  │                               (ShellAdapter / ClaudeCodeAdapter)
  │
  ├─ WS ───► relay-server ───► adapter.start() ───► child_process    [Path 1: structured chat]
  │                               (ClaudeCodeAdapter, via spawnInstance)
  │
  └─ HTTP ─► dashboard-server ──► child_process                     [Path 3: /api/shell/run]
                │
                └── SSE ───► CLI (bridge run)                        [Path 4]

Agent (NodeRuntime)
  │
  ├─WS─► upstream relay ──► relay-server ──► adapter.parseLine()    [Path 2: stdout via agent.stdout]
  │
  └─ spawnShell() ──► [permissions.check] ──► child_process         [Path 2: node-runtime shell]
       (bash/powershell, direct spawn, no adapter, Phase 4A: +perm)

Dashboard (dashboard-server)
  │
  POST /api/shell/run ──► [permissions.check] ──► child_process     [Path 3: Phase 4A: +perm]
       (cmd.exe / sh, direct spawn, no adapter, 403 on deny)
```
