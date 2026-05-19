# RemoteOperation 协议参考

> 统一远程执行模型。覆盖 terminal、plugin、adapter_command、task 四种操作类型。
> 双向协议：browser↔relay (operation.*) 和 relay↔agent (relay.operation.* / agent.operation.*)。

---

## 一、架构概览

```
Browser A ──WebSocket──┐
Browser B ──WebSocket──┤
                        Relay (RemoteOperationManager) ──WebSocket── Agent (OperationRunner)
Browser C ──WebSocket──┘
```

- **Relay**: 验证目标 (R1-R3)、创建 operation、订阅管理 (R4-R6)、转发到 agent、scoped broadcast
- **Agent**: 接收 `relay.operation.*` → 执行 → 回发 `agent.operation.*`
- **Browser**: 发起 `operation.start`、`operation.subscribe`、`operation.input`、`operation.cancel`

---

## 二、消息类型全览

### Browser → Relay

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `operation.start` | Browser → Relay | 发起远程操作 |
| `operation.input` | Browser → Relay | 向运行中的操作发送输入 |
| `operation.subscribe` | Browser → Relay | 订阅操作的 output/status/result |
| `operation.cancel` | Browser → Relay | 取消运行中的操作 |

### Relay → Agent

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `relay.operation.start` | Relay → Agent | 请求 agent 执行操作 |
| `relay.operation.input` | Relay → Agent | 转发 stdin 数据 |
| `relay.operation.cancel` | Relay → Agent | 请求 agent 取消操作 |

### Agent → Relay

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `agent.operation.status` | Agent → Relay | 状态变更通知 |
| `agent.operation.output` | Agent → Relay | 输出数据（流式或结构化） |
| `agent.operation.result` | Agent → Relay | 最终结果 |

### Relay → Browser (Scoped Broadcast)

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `operation.status` | Relay → Subscriber | 状态变更 |
| `operation.output` | Relay → Subscriber | 输出数据 |
| `operation.result` | Relay → Subscriber | 最终结果 |
| `error` | Relay → Sender | 错误（仅发送给请求发起者） |

---

## 三、消息格式

### `operation.start`

```json
{
  "v": 1, "ts": 1700000000000,
  "type": "operation.start",
  "body": {
    "nodeId": "inst_22_mp6ibr27",
    "kind": "plugin",
    "pluginId": "system-info",
    "command": "get",
    "input": { "text": "hello" }
  }
}
```

**字段说明**:
- `nodeId` (必填): 目标节点 ID
- `kind` (必填): `"plugin"` | `"adapter_command"` | `"terminal"` | `"task"`
- `pluginId` (kind=plugin 时必填): 插件标识符
- `command` (可选): 插件内子命令
- `input` (可选): 操作输入数据

### `operation.status`

```json
{
  "type": "operation.status",
  "body": {
    "operationId": "op_1_abc123",
    "nodeId": "inst_22_xxx",
    "kind": "plugin",
    "status": "running",
    "detail": "Executing system-info/get"
  }
}
```

**status 取值**: `"pending"` | `"starting"` | `"running"` | `"completed"` | `"failed"` | `"cancelled"`

### `operation.output`

```json
{
  "type": "operation.output",
  "body": {
    "operationId": "op_1_abc123",
    "seq": 1,
    "stream": "structured",
    "data": "{\"hostname\":\"PENGSPC\",\"platform\":\"win32\"}"
  }
}
```

**stream 取值**: `"stdout"` | `"stderr"` | `"structured"` | `"stdin_echo"`
**seq**: 单调递增序号，从 0 开始
**data**: 单条消息最大 64KB，operation 总 buffer 最大 512KB

### `operation.result`

```json
{
  "type": "operation.result",
  "body": {
    "operationId": "op_1_abc123",
    "success": true,
    "data": { "hostname": "PENGSPC", "platform": "win32" },
    "exitCode": 0,
    "error": null
  }
}
```

### `operation.subscribe`

```json
{
  "type": "operation.subscribe",
  "body": {
    "operationId": "op_1_abc123"
  }
}
```

订阅后立即收到 replay：当前 status → 所有 buffered output → 如果已完成则发 result。

### `operation.input`

```json
{
  "type": "operation.input",
  "body": {
    "operationId": "op_1_abc123",
    "data": "stdin data here"
  }
}
```

### `operation.cancel`

```json
{
  "type": "operation.cancel",
  "body": {
    "operationId": "op_1_abc123"
  }
}
```

---

## 四、路由不变量 (RemoteOperationManager)

所有不变量在 `src/remote-operation-manager.ts` 的 `validateTarget()` 中统一执行：

| 不变量 | 规则 | 失败返回 |
|--------|------|---------|
| R1 | 目标节点必须存在 | `TARGET_NOT_FOUND` |
| R2 | 远程 agent 必须处于 WebSocket.OPEN 状态 | `AGENT_DISCONNECTED` |
| R3 | 绝不 fallback 到本地执行 | 直接返回错误 |
| R4 | Output 仅发送给订阅者（scoped，非全局广播） | - |
| R5 | Status 变更广播给所有订阅者 | - |
| R6 | Late joiner 获得完整 replay（status + output buffer + result） | - |

---

## 五、Operation 生命周期

```
创建 (starting)
  → forwarding to agent (running)
    → agent 发送 output (running, 可多次)
    → agent 发送 result (completed / failed)
  → 或被取消 (cancelled)
```

**状态机**:
```
pending → starting → running → completed
                            → failed
                     → cancelled
```

**垃圾回收**: 已完成/失败/取消的 operation，在最后一个订阅者断开后 5 分钟自动清理。

---

## 六、Agent 端 (OperationRunner)

`agent-core/operation-runner.ts` 是 agent 端的对称实现。

### 消息分发

```typescript
// node-runtime.ts 中 relayMessage handler:
if (msg.type === 'relay.operation.start'
  || msg.type === 'relay.operation.input'
  || msg.type === 'relay.operation.cancel') {
  this.operationRunner.handleMessage(msg);
}
```

### Handler 注册

```typescript
const runner = new OperationRunner(transport);
runner.registerHandler('custom_kind', async (ctx, transport, onCancel) => {
  transport.send('agent.operation.status', { operationId: ctx.operationId, kind: ctx.kind, status: 'running' });
  transport.send('agent.operation.output', { operationId: ctx.operationId, stream: 'structured', seq: 1, data: 'result' });
  transport.send('agent.operation.result', { operationId: ctx.operationId, success: true, data: {} });
});
```

### 内置 Handler

| kind | pluginId | 说明 | 测试覆盖 |
|------|---------|------|---------|
| `plugin` | `mock-echo` | 最小往返证明：echo input.text + hostname | real-agent-operation-protocol.test.ts (39/39) |
| `plugin` | `system-info` | 返回 agent 设备真实系统状态 | real-agent-operation-protocol.test.ts (39/39) |
| `adapter_command` | 任意 | 返回 adapter + hostname | real-agent-operation-protocol.test.ts (39/39) |

### 取消支持

Handler 可通过 `onCancel` 注册取消回调：
```typescript
this.registerHandler('long_task', async (ctx, transport, onCancel) => {
  let cancelled = false;
  onCancel(() => { cancelled = true; });
  // ... periodic check of cancelled flag
});
```

---

## 七、Relay 端实现要点

`src/relay-server.ts` 中的消息处理入口（第 2270-2339 行）：

```
operation.start:
  1. 验证 nodeId 存在
  2. validateTarget(nodeId, instanceManager.get) → R1, R2, R3
  3. create(nodeId, kind, opts)
  4. subscribe(op.operationId, ws) → 发起者也是订阅者
  5. emitStatus('starting')
  6. 如果是 remote source → forwardToAgent(op, instance, send, envelope)
  7. emitStatus('running')

operation.input:
  → operationManager.forwardInputToAgent(operationId, data, instanceManager.get, send, envelope)

operation.subscribe:
  → operationManager.subscribe(operationId, ws, send, envelope)
  → 自动 replay: status → output buffer → result (如果 terminal)

operation.cancel:
  → operationManager.cancel(operationId, send, envelope)
```

---

## 八、错误处理

| 错误码 | 触发条件 | 方向 |
|--------|---------|------|
| `MISSING_NODE` | operation.start 没有 nodeId | Relay → Sender |
| `TARGET_NOT_FOUND` | nodeId 不在 instanceManager 中 | Relay → Sender |
| `AGENT_DISCONNECTED` | 远程 agent WebSocket 未 OPEN | Relay → Sender |
| `OPERATION_NOT_FOUND` | subscribe/cancel 不存在的 operationId | Relay → Sender |
| `No handler for kind` | Agent 端未注册该 kind 的 handler | Agent → Relay → Subscribers |

错误消息仅发送给请求发起者，不广播给所有订阅者。

---

## 九、与 Terminal 的关系

Terminal 操作 (`shell.spawn`) 已部分集成到 RemoteOperation 模型：

- `shell.spawn` → 创建 `kind="terminal"` 的 RemoteOperation
- agent.stdout/stderr → 同时通过 shell subscribers 和 `operationManager.emitOutput()` 发送
- agent.exit → 通过 `operationManager.complete()` 完成

**当前限制**: 新的 `operation.start kind=terminal` 路径尚未实现 (仅 legacy `shell.spawn` 可用)。

---

## 十、SharedSurface 协议 (surface.* + runtime.*)

SharedSurface 是 workbench tab 共享的 source of truth。
它包装 RemoteOperation，为 browser 提供 surface 粒度的订阅和历史 replay。
详见 [`docs/SHARED_SURFACE_REPLAY_MODEL.md`](SHARED_SURFACE_REPLAY_MODEL.md)。

### surface.* — 生命周期

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `surface.publish` | Browser → Relay | 创建 shared surface |
| `surface.published` | Relay → Sender | 确认 + 返回完整 SharedSurface |
| `surface.subscribe` | Browser → Relay | 订阅单个 surface（触发 runtime replay） |
| `surface.subscribeNode` | Browser → Relay | 订阅 node 下所有 surfaces |
| `surface.update` | Browser → Relay | 更新 surface 元数据 |
| `surface.updated` | Relay → Subscribers | 广播元数据更新 |
| `surface.close` | Browser → Relay | 关闭 surface |
| `surface.closed` | Relay → Subscribers | 广播关闭（发送者排除） |
| `surface.list` | Relay → Subscriber | 返回 node 的 surface 列表 |

### runtime.* — 运行时数据

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `runtime.output` | Relay → Subscribers | Scoped live output |
| `runtime.status` | Relay → Subscribers | 运行时状态变更 |
| `runtime.result` | Relay → Subscribers | 运行时完成结果 |
| `runtime.replay` | Relay → Subscriber | Late joiner 历史回放 |

### surface.publish (terminal 示例)

```json
{
  "type": "surface.publish",
  "body": {
    "nodeId": "inst_22_xxx",
    "title": "Shared Terminal",
    "viewType": "terminal",
    "scope": "node",
    "shared": true,
    "runtimeRef": { "kind": "terminal", "instanceId": "inst_22_xxx" },
    "replayPolicy": { "mode": "tail", "lines": 5000, "bytes": 500000 }
  }
}
```

### surface.published

```json
{
  "type": "surface.published",
  "body": {
    "surfaceId": "surf_1_abc123",
    "surface": {
      "surfaceId": "surf_1_abc123",
      "nodeId": "inst_22_xxx",
      "title": "Shared Terminal",
      "viewType": "terminal",
      "runtimeRef": {
        "kind": "terminal",
        "instanceId": "inst_22_xxx",
        "operationId": "op_1_abc123"
      },
      "replayPolicy": { "mode": "tail", "lines": 5000, "bytes": 500000 }
    }
  }
}
```

### runtime.replay

```json
{
  "type": "runtime.replay",
  "body": {
    "surfaceId": "surf_1_abc123",
    "operationId": "op_1_abc123",
    "outputs": [
      { "seq": 0, "stream": "stdout", "data": "line-1\n" },
      { "seq": 1, "stream": "stdout", "data": "line-2\n" }
    ],
    "status": "running"
  }
}
```

### 错误码

| 错误码 | 触发条件 |
|--------|---------|
| `SURFACE_NOT_FOUND` | surface 不存在或已关闭 |
| `ACCESS_DENIED` | 无所需权限 |
| `INVALID_REPLAY_POLICY` | replayPolicy 配置无效 |
| `RUNTIME_NOT_FOUND` | 关联 runtime 不存在 |

### 跨 Relay 转发

surface.publish 从 browser 路径创建后，通过 `_sendUpstream` 转发给上游 relay。
转发时附带 `_label`（hostname）用于目标 relay 的 instance remapping。
详见 `SHARED_SURFACE_REPLAY_MODEL.md` §五。

---

## 十一、已知缺口

1. **没有 HTTP API 包装**: operation.start/input/subscribe/cancel 只能通过 WebSocket 触发，没有 `POST /api/operation/start` 等价端点
2. **没有 CLI 包装**: `bridge operation start --json` 已设计契约但未实现
3. **`operation.input` 是 placeholder**: Agent 端的 `OperationRunner.input()` 只 echo ❰stdin_echo❱ stream，不写入实际进程 stdin
4. **只注册了 2 个 plugin handler**: mock-echo 和 system-info。其他 extension (claude-code, shell, host) 尚未集成
5. **Terminal 未完全迁移**: 新的 `operation.start kind=terminal` 未实现，仍用 legacy `shell.spawn`

---

## 十二、测试

- `tests/integration/real-agent-operation-protocol.test.ts` — 39/39 assertions, 覆盖 mock-echo + system-info + subscribe replay + input + bad target + agent disconnect
- `tests/integration/remote-routing-invariants.test.mjs` — 路由不变量测试
- `tests/integration/shared-remote-terminal-session` — terminal session 共享测试
- `tests/integration/shared-surface-terminal-replay.test.mjs` — SharedSurface MVP 协议测试 (31 tests)
- `tests/integration/shared-surface-replay-cap.test.mjs` — replay cap 测试 (12 tests)
- `tests/integration/shared-surface-ui-contract.test.mjs` — UI contract 测试 (48 tests)
