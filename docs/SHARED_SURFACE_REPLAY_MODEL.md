# SharedSurface + RuntimeReplay 模型

> 跨设备 workbench tab 同步的完整模型。
> SharedSurface 是 source of truth，`workbench.tabs` 降级为向后兼容投影。

---

## 一、问题域

`workbench.tabs` 只能同步"有哪些 tab"，不能同步 tab 的运行时状态。
B 设备即使收到 tab 列表，终端也是空的——没有历史输出、没有 live output。

SharedSurface 解决这个问题：每个 shared tab 对应一个 surface，
surface 携带 `runtimeRef` 指向底层 runtime（terminal/plugin/adapter），
通过 `runtime.replay` 让 late joiner 看到历史，
通过 `runtime.output` 让所有订阅者看到 live output。

---

## 二、核心概念

### SharedSurface

一个 surface 代表一个可共享的工作台面板。

```
SharedSurface {
  surfaceId: string       // "surf_N_<ts36>"
  nodeId: string          // 所属节点
  title: string           // 面板标题
  viewType: string        // terminal | settings | plugin | ...
  scope: 'node' | 'global'
  shared: boolean
  runtimeRef: {
    kind: 'terminal' | 'plugin' | 'none'
    operationId?: string  // 关联的 RemoteOperation
    instanceId?: string   // 运行此 surface 的 instance
  }
  replayPolicy: ReplayPolicy  // 历史回放策略
  permissions?: SurfacePermission[]
  createdAt: number
  updatedAt: number
}
```

### ReplayPolicy

控制 late joiner 能看到多少历史：

| mode | 说明 |
|------|------|
| `none` | 不缓冲，不 replay（静态面板） |
| `latest` | 只保留最后一条输出 |
| `tail` | FIFO ring buffer，保留最近 N 行/B |
| `events` | 保留最近 N 个事件 |
| `full` | 保留全部（有 maxBytes 上限） |

terminal 默认 `{ mode: 'tail', lines: 5000, bytes: 500000 }`。

### RuntimeState

surface 关联的运行时状态：

```
RuntimeState {
  operationId: string
  nodeId: string
  surfaceId: string
  kind: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  outputBuffer: RuntimeOutputChunk[]   // 按 replayPolicy 裁剪
  eventBuffer: RuntimeEvent[]
  createdAt: number
  updatedAt: number
}
```

---

## 三、协议

### surface.* — 生命周期管理

```
surface.publish      browser→relay    创建 shared surface
surface.published    relay→browser    确认 + 返回完整 SharedSurface
surface.subscribe    browser→relay    订阅单个 surface（触发 runtime replay）
surface.subscribeNode browser→relay   订阅 node 下所有 surfaces
surface.update       browser→relay    更新 surface 元数据
surface.updated      relay→browser    广播元数据更新
surface.close        browser→relay    关闭 surface
surface.closed       relay→browser    广播关闭（发送者排除）
surface.list         relay→browser    返回 node 的 surface 列表（不触发 replay）
```

### runtime.* — 运行时数据流

```
runtime.output       relay→browser   scoped live output（仅 surface 订阅者）
runtime.status       relay→browser   运行时状态变更
runtime.result       relay→browser   运行时完成结果
runtime.replay       relay→browser   late joiner 历史回放
```

### 错误码

| 错误码 | 含义 |
|--------|------|
| `SURFACE_NOT_FOUND` | surface 不存在或已关闭 |
| `ACCESS_DENIED` | 没有所需权限 |
| `INVALID_REPLAY_POLICY` | replayPolicy 配置无效 |
| `RUNTIME_NOT_FOUND` | 关联的 runtime 不存在 |

---

## 四、数据流

### 4.1 创建 shared terminal

```
Browser A                    Relay                     Agent
  │                           │                         │
  ├─ surface.publish ────────►│                         │
  │  { nodeId, viewType,      │                         │
  │    runtimeRef,             │                         │
  │    replayPolicy }          │                         │
  │                           ├─ 创建 SharedSurface      │
  │                           ├─ 创建 RemoteOperation    │
  │                           ├─ relay.operation.start ─►│
  │                           │                         │
  │                           │  agent.operation.output  │
  │                           │◄─────────────────────────┤
  │                           │                         │
  │◄─ surface.published ─────┤                         │
  │   { surface, operationId }│                         │
  │                           │                         │
  │◄─ runtime.output ────────┤                         │
  │   (live, scoped)          │                         │
```

### 4.2 Late joiner (Browser B)

```
Browser B                    Relay
  │                           │
  ├─ surface.subscribeNode ──►│
  │  { nodeId }                │
  │                           ├─ 查找 node 下所有 surface
  │◄─ surface.list ──────────┤
  │   [{ surfaceId, ... }]    │
  │                           │
  │◄─ runtime.replay ────────┤
  │   { surfaceId, outputs }  │  ← 历史输出（按 replayPolicy 裁剪）
  │                           │
  │◄─ runtime.output ────────┤  ← 后续 live output
  │◄─ runtime.result ────────┤  ← 如果已完成
```

### 4.3 Input/Cancel 路径

```
Browser A                    Relay                     Agent
  │                           │                         │
  ├─ operation.input ────────►│                         │
  │  { operationId, data }     ├─ relay.operation.input─►│
  │                           │                         │
  ├─ operation.cancel ───────►│                         │
  │  { operationId }           ├─ relay.operation.cancel►│
```

Terminal 输入通过 `operation.input` 发送（带上 surface 的 `operationId`），
而不是通过 `shell.input`。这确保了跨 relay 的输入也能正确路由。

---

## 五、跨 Relay 转发

### 5.1 转发路径

```
Browser → LOCAL relay → VPS relay → Browser (on VPS)
```

当 LOCAL relay 的 browser 创建 surface 时：
1. LOCAL relay 创建 surface + operation
2. LOCAL relay 通过 `_sendUpstream` 转发 `surface.publish` 给 VPS
3. VPS relay 收到 agent-forwarded surface，执行 label remapping
4. VPS relay 导入 surface，广播给 VPS 上的 browser 订阅者

### 5.2 Label-based instance remapping

`__local__` 是 browser 侧标识本地 relay 的虚拟节点 ID。
跨 relay 转发时，目标 relay 无法通过 `__local__` 找到对应 instance。

解决方案：转发时附带 `_label`（hostname），目标 relay 按 label 匹配 instance：

```
LOCAL relay                            VPS relay
  │                                      │
  ├─ surface.publish ───────────────────►│
  │  { nodeId: '__local__',              │
  │    surface: {...},                   │
  │    _label: 'PENGSPC' }              │
  │                                      ├─ 查找 label='PENGSPC' 的 instance
  │                                      ├─ remapNodeId = matched.id
  │                                      ├─ 导入 surface
  │                                      └─ 广播
```

---

## 六、workbench.tabs 兼容投影

老浏览器只理解 `workbench.tabs`，不理解 `surface.*`。

当 surface 创建/更新/关闭时，SurfaceManager 调用 `toWorkbenchTab(surface)` 生成
兼容的 tab 对象，插入 `workbenchTabStore` 并 `broadcastTabs`。

老浏览器看到 tab 存在（title, viewType, instanceId），但无法获得 runtime replay。
新浏览器通过 `surface.subscribeNode` 获得完整的 surface + replay 数据。

---

## 七、Replay Policy 裁剪行为

### tail (terminal 默认)

```
发送 6000 行 → outputBuffer 保留最近 5000 行
line-1 到 line-1000 → 被裁剪
line-1001 到 line-6000 → 保留
late joiner replay → 收到 5000 个 output chunk
```

### latest

```
每次新 output → 替换整个 buffer
late joiner replay → 只收到最后一条
```

### none

```
不缓冲任何 output
late joiner replay → 空的，只收到 status + result
```

---

## 八、Sender Exclusion

- `surface.published` — 只发回给发送者
- `surface.closed` — 发给所有订阅者，**排除**发送者
- `runtime.output` / `runtime.replay` — 发给所有 surface 订阅者
- `runtime.result` — 发给所有订阅者（包括 late joiner）

---

## 九、相关文件

| 文件 | 内容 |
|------|------|
| `extensions/types.ts` | SharedSurface, ReplayPolicy, RuntimeState 类型定义 |
| `src/surface-manager.ts` | SurfaceManager 核心引擎 |
| `src/relay-server.ts` | surface.* / runtime.* 协议处理器 |
| `app/page.tsx` | UI surface handlers + publishSurfaceForTab |
| `app/shell-terminal.tsx` | TerminalView surface replay 支持 |
| `tests/integration/shared-surface-terminal-replay.test.mjs` | MVP 协议测试 (31 tests) |
| `tests/integration/shared-surface-replay-cap.test.mjs` | replay cap 测试 (12 tests) |
| `tests/integration/shared-surface-ui-contract.test.mjs` | UI contract 测试 (48 tests) |
