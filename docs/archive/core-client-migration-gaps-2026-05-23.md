# CoreClient Migration Gaps — 核实版

基于对 `go-core/internal/executor/registry.go` 的完整排查，
Go Core 注册了 **80+ capability**，但前端 `core-types.ts` 只类型化了其中约 40 个。

## 结论速览

| # | 缺口 | 真实状态 | Go Core 能力 | 前端缺失 |
|---|------|---------|-------------|---------|
| 1 | 终端 resize | **前端类型缺口** | `process.resize` ✅ | `ProcessResizeParams` |
| 2 | Tab 同步 / Surface | **前端集成缺口** | `stream.subscribe` + `run.attach` ✅ | 前端未调用 |
| 3 | Extension Points | **Go 后端缺口** | `plugin.get` 不返回 `contributes` ❌ | 需补后端 |
| 4 | 文件树 | **前端类型缺口** | `fs.list/read/write/mkdir/remove/rename/stat` ✅ | 全部未类型化 |
| 5 | Queue 状态 | **架构差异** | 不存在，Go Core 同步执行模型无需队列 | 不影响功能 |

---

## 1. 终端 Runtime Resize — 前端类型缺口（非后端缺口）

**Go Core 已有**: `process.resize` — `{ sessionId, cols, rows }`

```go
// registry.go:233
r.Register("process.resize", processResize)

// process_cmds.go:86-111
type processResizePayload struct {
    SessionID string `json:"sessionId"`
    Cols      int    `json:"cols"`
    Rows      int    `json:"rows"`
}
```

平台支持：Linux/macOS `SupportFull`，Windows `SupportUnsupported`（Windows 无 PTY resize）。

**前端动作**：
1. 在 `core-types.ts` 新增 `ProcessResizeParams`
2. 在 `shell-terminal.tsx` 的 ResizeObserver 中调用 `core.call('process.resize', { sessionId, cols, rows })`
3. 移除 CoreClient mode 的 resize skip

---

## 2. Tab 同步 / Surface — 前端集成缺口（非后端缺口）

Go Core 的 `stream.subscribe` + `run.attach` + `stream.chunk` 事件
和老 relay 的 `surface.subscribe` → `runtime.replay` + `runtime.output`
**在架构上是等价的**，只是命名不同。

### Go Core 已有能力链

```
stream.subscribe  →  订阅 session 的流，fromSeq 可选，自动 replay history
run.attach        →  获取 run 元数据 + replay 数据 + stream 订阅状态
stream.chunk      →  实时推送到所有 subscriber（wsconn.Registry 管理多订阅者）
stream.replay     →  按 seq 回放历史
stream.tail       →  获取最近 N 行
```

关键代码路径：
- `spawnManagedProcess()` 在 `run_cmds.go:59-61` 自动调用 `ConnRoutes.Subscribe()` — **每次 run.create / process.spawn 都会自动订阅调用者的 WebSocket 连接**
- `wsconn.Registry` (`go-core/internal/wsconn/registry.go`) 管理多订阅者模型
- 其他设备可通过 `stream.subscribe({ sessionId, streamType, fromSeq })` 加入已有 session

### 与老 relay surface 协议的对应

| 老 relay | Go Core 等价 | 说明 |
|----------|-------------|------|
| `surface.subscribe` | `stream.subscribe` | 订阅 session 流 |
| `runtime.replay` | history replay（subscribe 时自动触发） | 从 fromSeq 回放 |
| `runtime.output` | `stream.chunk` 事件 | 实时推送 |
| `surface.publish` | ❌ 无独立 publish 步骤 | run.create 后即全局可发现，通过 run.list + stream.subscribe |

**结论**：`stream.subscribe` 就是 `surface.subscribe` 的原子等价物。不需要补任何 API。

---

## 3. Extension Points Manifest — Go 后端缺口

**Go Core 现状**：
- `plugin.list` 返回 `[{ pluginId, version, status, type, description }]` — **不包含** `contributes`
- `plugin.get` / `plugin.info` 调用 `buildPluginDetail()` — **不包含** `contributes`
- Manifest 解析器 (`pluginmanifest/parser.go`) 已能解析完整 manifest，但 handler 不暴露

**缺失**：`plugin.get` 应返回 manifest 中的 `contributes` 字段（views, commands, menus, chrome, keyHints, configuration, notifications）。

**Go Core 原子 API 改动**（最小化）：
在 `pluginGet` handler 中，如果 `Manifests.LoadManifest(pluginID)` 成功，
将 `m.Contributes` 序列化到返回的 `contributes` 字段：

```go
// plugin_manage_cmds.go pluginGet 函数
func pluginGet(req *types.CapabilityRequest, deps *Deps) (interface{}, error) {
    pluginID := extractPluginID(req, corePluginID)
    detail := buildPluginDetail(pluginID, deps)
    if m, err := deps.Manifests.LoadManifest(pluginID); err == nil && m != nil {
        detail["manifestVersion"] = m.ManifestVersion
        detail["contributes"] = m.Contributes  // ← 新增这一行
    }
    return detail, nil
}
```

前端 `PluginInfo` 新增可选字段 `contributes`。

---

## 4. 文件树 / 目录列表 — 前端类型缺口（非后端缺口）

**Go Core 已注册的完整 fs.* 能力族**：

| capability | payload | 返回 |
|-----------|---------|------|
| `fs.list` | `{ path }` | `{ path, entries: [{ name, isDir, size, mode }] }` |
| `fs.read` | `{ path }` | `{ path, size, data }` |
| `fs.write` | `{ path, data }` | `{ path, written }` |
| `fs.mkdir` | `{ path, all?, mode? }` | `{ path }` |
| `fs.remove` | `{ path, recursive? }` | `{ path }` |
| `fs.rename` | `{ oldPath, newPath }` | `{ oldPath, newPath }` |
| `fs.stat` | `{ path }` | `{ name, size, mode, modTime, isDir }` |

平台支持：Desktop `SupportFull`，Mobile `SupportUnsupported`。

`core-types.ts` 中 **零个** fs.* 类型被定义。

**前端动作**：在 `core-types.ts` 新增 `FsListParams`, `FsReadParams`, `FsStatParams` 等，
FileExplorer 改用 `core.call('fs.list', ...)` / `core.call('fs.read', ...)`。

---

## 5. Queue 状态 — 架构差异，不影响功能

**Go Core 无队列概念**：Executor 是同步的 — `Execute()` 直接返回 result 或 error。
长时间运行的操作（install、uninstall、check）通过 `task.*` 跟踪：
- `task.list` — 列出所有 task
- `task.info` — 查询单个 task 状态
- `task.event` — task 状态变更事件

老 relay 的 `queue.status` 是异步操作队列，Go Core 用 task 模型替代。
**不需要补 API**，前端可根据 `task.list` 展示异步操作进度。

---

## 实际需要补的只有 1 项

| 位置 | 改动 | 工作量 |
|------|------|--------|
| **Go Core** `plugin_manage_cmds.go` | `pluginGet` 返回 `contributes` | 1 行 |
| **前端** `core-types.ts` | 新增 10 个缺失类型的 params/result 类型 | ~40 行 |
| **前端** `shell-terminal.tsx` | ResizeObserver 调用 `process.resize` | ~5 行 |

其余全部是前端调用现有 API 的集成工作。
