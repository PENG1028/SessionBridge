# Plugin Surface Sync Contract

> 插件开发者的 SharedSurface 同步契约。定义平台保证 vs 插件必须做的事，
> 防止出现"测试 pass 但 UI 没效果"的同步回归。

---

## 一、SurfaceSyncContract 类型

```ts
/** 平台向每个插件提供的同步契约 */
interface SurfaceSyncContract {
  /** 平台保证：surface 发布后 relay 会持久化并广播给同 node 的所有订阅者 */
  publish: {
    /** 调用 sendMessage('surface.publish', opts) 后 relay 保证的行为 */
    guaranteed: [
      'relay 创建 SharedSurface 记录（持久化在 SurfaceManager）',
      'relay 创建关联的 RemoteOperation（如果 runtimeRef.kind !== "none"）',
      'relay 返回 surface.published（含完整 surfaceId + operationId）',
      'relay 向所有 nodeSubscribers 广播 surface.published',
      'surface 出现在后续 surface.subscribeNode 的返回列表中',
    ];
    /** 调用者必须验证的行为 */
    callerMust: [
      '检查 surface.published 响应中的 surfaceId 不为空',
      '将 surfaceId 写入 PaneTab._surfaceId',
      '将 operationId 写入 PaneTab._operationId',
      '确保 tab.id === surface.surfaceId（防止重复创建）',
    ];
  };

  /** 平台保证：进入 node 时 surface.subscribeNode 返回完整列表 */
  subscribe: {
    guaranteed: [
      '返回该 node 下所有 shared surface 的完整列表',
      '每个 surface 携带 runtimeRef（instanceId + operationId）',
      '每个 surface 携带 replayPolicy',
      '自动触发每个 surface 的 runtime replay（如果 surface 有 runtime state）',
      '后续新增的 surface 通过 surface.published push 到达',
    ];
    callerMust: [
      '在 handleEnterNode 时同时发送 workbench.subscribe + surface.subscribeNode',
      '用 surfaceId 去重 localStorage 恢复的 tabs',
      '收到 surface.list 后遍历创建/合并 PaneTab',
    ];
  };

  /** 平台保证：runtime replay 送达 late joiner */
  replay: {
    guaranteed: [
      'runtime.replay 包含按 replayPolicy 裁剪的历史 output',
      'output 格式与 agent.operation.output 一致（stream + data + seq）',
      'replay 在 surface.subscribe 后自动触发',
    ];
    callerMust: [
      'ShellTerminal 在 _surfaceId 存在时走 surface 路径（connectSurface）',
      '将 runtime.replay 的 outputs 写入 xterm.js terminal buffer',
      '将后续 runtime.output 继续追加到 terminal buffer',
    ];
  };

  /** 平台保证：live output 广播给所有订阅者 */
  liveOutput: {
    guaranteed: [
      'relay 将 agent.operation.output 桥接为 runtime.output',
      'runtime.output 只广播给订阅了该 surface 的 WebSocket',
      'output 顺序由 seq 保证',
    ];
    callerMust: [
      '输入通过 operation.input 发送（带 operationId），不走 shell.input',
      'ShellTerminal 的 onData 根据 _surfaceId/_operationId 选择路由',
      'Ctrl+L / Ctrl+C 也走 operation.input 路径',
    ];
  };
}
```

---

## 二、同步规则

### 规则 1: surfaceId 是唯一标识

PaneTab 的 `id` 必须等于 surface 的 `surfaceId`。这是去重的唯一依据。
localStorage 恢复的 tabs 如果 server surface 已存在同 surfaceId 的 tab，以 server 为准。

```
localStorage tab (id: "tab_abc") + server surface (surfaceId: "surf_N_xyz")
  → 如果 tab.instanceId === surface.runtimeRef.instanceId:
      MERGE: 升级 localStorage tab 添加 _surfaceId + _operationId
  → 否则:
      CREATE: 新建 tab，id = surface.surfaceId
```

### 规则 2: 发布 surface 前必须先有 instanceId

`surface.publish` 需要 `runtimeRef.instanceId` 指向一个运行中的 instance。
UI 流程必须是：`createInstance()` → `bindCurrentTabInstance(instanceId)` → `publishSurfaceForTab(tab, instanceId)`。

如果 instanceId 不存在或已断连，relay 返回错误。

### 规则 3: _surfaceId 非空时 ShellTerminal 走 surface 路径

```
if (tab._surfaceId && tab._operationId) {
  // Surface 路径: WebSocket → surface.subscribe → runtime.replay → runtime.output
  // 输入: operation.input { operationId }
} else {
  // Shell 路径: WebSocket → shell.spawn → shell.output
  // 输入: shell.input { instanceId }
}
```

### 规则 4: 空 placeholder tab 必须清理

`createInitialState()` 创建的 `viewType: 'empty'` tab 是占位符。
当收到真实 surface tab 后，必须删除所有 empty tab：

```ts
const emptyTabs = pane.tabs.filter(t => t.viewType === 'empty');
const realTabs = pane.tabs.filter(t => t.viewType !== 'empty');
if (realTabs.length > 0 && emptyTabs.length > 0) {
  for (const empty of emptyTabs) {
    dispatch({ type: 'CLOSE_TAB', paneId, tabId: empty.id });
  }
}
```

### 规则 5: localStorage 恢复与 server surface 的优先级

1. server surface（通过 `surface.subscribeNode` 返回的）优先级高于 localStorage
2. localStorage tab 如果与 server surface 有相同 instanceId → MERGE（升级添加 _surfaceId）
3. localStorage tab 如果 surfaceId 不在 server 返回列表中 → 保留但标记 `stale`（后续可清理）
4. server surface 不在 localStorage 中 → 自动创建 tab

### 规则 6: surfacePublishInFlight 防止重复发布

同一个 `(nodeId, instanceId, tabId)` 组合在 5 秒内只会发布一次。
`surface.published` 回执到达时清除 in-flight 标记。

---

## 三、按 viewType 的同步推荐

### terminal

| 项目 | 推荐值 |
|------|--------|
| `replayPolicy` | `{ mode: 'tail', lines: 5000, bytes: 500000 }` |
| `runtimeRef.kind` | `'terminal'` |
| `scope` | `'node'` |
| `shared` | `true` |
| 输入协议 | `operation.input { operationId, data }` |
| 输出协议 | `runtime.output { stream, data, seq }` |
| ShellTerminal | 必须支持双路径（surface + shell） |
| autoCreate | TerminalView 自动 createInstance + bindCurrentTabInstance + publishSurfaceForTab |

### settings / dashboard / file-browser

| 项目 | 推荐值 |
|------|--------|
| `replayPolicy` | `{ mode: 'none' }` |
| `runtimeRef.kind` | `'none'` |
| `scope` | `'node'` |
| `shared` | `true`（如果想跨设备可见）或 `false`（仅本地） |
| 同步方式 | 只通过 workbench.tabs（不涉及 runtime） |

### plugin (自定义插件视图)

| 项目 | 推荐值 |
|------|--------|
| `replayPolicy` | 取决于插件类型。有实时输出的用 `tail`，纯 UI 的用 `none` |
| `runtimeRef.kind` | `'plugin'` |
| `runtimeRef.pluginId` | 插件 manifest 中的 id |
| `scope` | `'node'` 或 `'global'` |
| 输入协议 | `operation.input { operationId, data }` |
| 输出协议 | 在 `agent.operation.output` 中携带结构化数据 |
| 同步方式 | surface.publish + runtime.replay（完整路径） |

对于 plugin 类型，平台保证：
- `surface.publish` → relay 创建 surface + 关联 operation
- relay 转发 `relay.operation.start` 给 agent（带 pluginId）
- agent 的 OperationRunner 查找对应 handler 执行
- 输出通过 `agent.operation.output` → relay → `runtime.output` 广播

---

## 四、平台保证 vs 插件责任

### 平台保证（relay + SurfaceManager）

- [x] surface 创建后持久化在 SurfaceManager
- [x] surface 在 `surface.subscribeNode` 返回列表中
- [x] 新 surface 通过 `surface.published` push 给所有 node 订阅者
- [x] runtime replay 按 replayPolicy 裁剪后送达 late joiner
- [x] live output（runtime.output）广播给所有 surface 订阅者
- [x] surface 关闭时 broadcast `surface.closed`
- [x] 跨 relay forward（upstream → label remap → importFromUpstream）

### 插件/UI 责任

- [ ] 必须在创建 instance 后调用 `publishSurfaceForTab`
- [ ] 必须将 surfaceId 写入 tab 元数据（`_surfaceId`）
- [ ] 必须在 handleEnterNode 时同时发送 `surface.subscribeNode`
- [ ] ShellTerminal/自定义 terminal 必须支持双路径（surface vs shell）
- [ ] 输入必须走 `operation.input`（带 operationId）而非 `shell.input`
- [ ] 收到 surface.list 后必须清理 empty placeholder tabs
- [ ] 收到 surface.closed 后必须关闭对应 tab

---

## 五、反回归检查清单

新增或修改插件同步逻辑时，逐项确认：

```
□ UI 调用 ensureSurfacePublished 了吗？
  → TerminalView 的 useEffect 在 instanceId 非空且 !_surfaceId 时会触发

□ UI 真的发了 surface.publish 吗？
  → publishSurfaceForTab 在 nodeId 非空、viewType=terminal、!_surfaceId 时发送
  → 在浏览器控制台过滤 [debugSurface] 查看

□ relay 创建 surface 了吗？
  → GET /api/debug/surfaces 查看 surfaceDebug.surfaces
  → 检查 surface.publish.created 事件

□ B 设备 subscribeNode 了吗？
  → handleEnterNode 中发送 surface.subscribeNode
  → 同一 tab 每 30s 自动重订阅

□ B 设备收到 surface.list 了吗？
  → handleSystemMessage 中的 surface.list handler
  → 检查 debugSurface 日志 "RECEIVED surface.list"

□ runtime 有 replay buffer 吗？
  → GET /api/debug/surfaces 查看 surfaceDebug.surfaces[].outputBufferSize
  → 检查 runtime.replay 事件

□ input 走 operation.input 吗？
  → ShellTerminal 在 _surfaceId + _operationId 时走 operation.input
  → 检查 debugSurface 日志 "input routing: operation.input"
```

---

## 六、诊断命令

```bash
# 查看 relay 侧 surface 状态
curl http://localhost:8080/api/debug/surfaces | jq .

# 浏览器控制台（访问时带 ?debugSurface=1）
# 过滤 [debugSurface] 前缀查看所有 surface 相关日志
```
