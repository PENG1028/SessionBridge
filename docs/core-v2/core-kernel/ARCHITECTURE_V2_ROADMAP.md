# Core v2 Architecture Roadmap

> 本文档定义 Go Core 从当前状态到"可审计、可恢复、可回滚、可裁剪"目标架构的完整演化路线。
> 覆盖: Operation Log、重启恢复、Forward-Only Hub Mode、Capability 裁剪、契约测试。
> 状态: **规划中** — 尚未开始实现。

---

## 目录

1. [现状评估](#一现状评估)
2. [目标架构](#二目标架构)
3. [核心数据模型](#三核心数据模型)
4. [OpLog 存储引擎](#四oplog-存储引擎)
5. [Content Store](#五content-store)
6. [Dispatcher 集成（Opt-out 框架级记录）](#六dispatcher-集成opt-out-框架级记录)
7. [操作分类表](#七操作分类表)
8. [重启恢复](#八重启恢复)
9. [回滚引擎](#九回滚引擎)
10. [Forward-Only Hub Mode](#十forward-only-hub-mode)
11. [Capability 裁剪](#十一capability-裁剪)
12. [角色关系总图](#十二角色关系总图)
13. [契约测试体系](#十三契约测试体系)
14. [实现阶段](#十四实现阶段)
15. [存储布局总览](#十五存储布局总览)

---

## 一、现状评估

### 1.1 不自洽清单

当前核心的"代码写了但没串起来"的问题：

| 问题 | 位置 | 影响 |
|------|------|------|
| Run Store 持久化代码完整但 main.go 没调用 | `run/persist.go` vs `cmd/node/main.go:197` | 重启 run 记录丢失 |
| Task 类型完整但 TaskStore 未实例化 | `task/task.go` vs `cmd/node/main.go` | `task.list` 永远返回 nil |
| `resolvePath` 定义未被调用 | `fs_cmds.go:95-104` | 死代码 |
| `history.Store` 三个 stub 方法 | `history/store.go:400-415` | 死代码 |
| 双层 audit（dispatcher + executor 各记一次） | `dispatcher.go:110-216` + `registry.go:169-195` | 重复记录 |
| AuditStore 无限 append | `logs/audit_store.go:32-42` | 长期运行 OOM |
| Process 退出后不清理 entry | `process/manager.go:217-220` | 内存泄漏 |
| 磁盘历史文件无 RotateWriter | `history/store.go:469-506` | 无限增长 |
| PlanStore 不清理 terminal 状态的 plan | `plan/plan.go:138-214` | 内存泄漏 |
| Session store 纯内存 | `session/store.go` | 重启丢 |
| 默认 history mode=memory | `session/session.go:10` (DefaultHistoryPolicy) | 重启终端输出丢 |

### 1.2 架构根因

所有问题归结为同一个根因：**没有统一的操作记录层。** 每个 store 自己管自己的持久化，自己管自己的恢复，自己管自己的上限。结果是：
- 有的持久化了但没启用
- 有的完全没持久化
- 有的没有上限
- 有的有上限但不一致

**解决方案不是分别修每个 store，而是引入 Operation Log 作为唯一的事实来源（Source of Truth），所有 store 降级为可丢弃的投影（Projection）。**

---

## 二、目标架构

```
                          ┌──────────────────────────────┐
                          │     Dispatcher (8 步链)       │
                          │   + 第 9 步: OpLog Record     │
                          └──────────┬───────────────────┘
                                     │ 自动记录 (opt-out)
                                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Operation Log                              │
│              (append-only, 持久化, Event Sourcing)                 │
│                                                                   │
│  [op_001] [op_002] [op_003] ... [op_N]                           │
│    │         │         │              │                            │
│    └─────────┴─────────┴──────────────┘                            │
│                          │                                         │
│                          ▼                                         │
│  ┌────────────────────────────────────────────────────┐           │
│  │           Rebuild On Restart (投影重建)              │           │
│  │                                                     │           │
│  │  OpLog.Replay(0) → session.Store (恢复)             │           │
│  │  OpLog.Replay(0) → run.Store (恢复)                  │           │
│  │  OpLog.Replay(0) → plan.PlanStore (恢复)             │           │
│  │  OpLog.Query()  → audit.list (替代 AuditStore)       │           │
│  └────────────────────────────────────────────────────┘           │
│                          │                                         │
│                          ▼                                         │
│  ┌────────────────────────────────────────────────────┐           │
│  │               Rollback Engine                       │           │
│  │                                                     │           │
│  │  A类 → Content Store 恢复 before                    │           │
│  │  B类 → 删除 artifact + 一致性验证                   │           │
│  │  C类 → 执行逆操作 (stop/disconnect/uninstall)       │           │
│  └────────────────────────────────────────────────────┘           │
│                                                                   │
│  ┌────────────────────────────────────────────────────┐           │
│  │               Content Store (hash 去重)             │           │
│  │  ~/.sessionnode/trash/<hash[:2]>/<hash>            │           │
│  │  refCount + GC 联动 OpLog 截断                     │           │
│  └────────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
            │                       │                       │
            ▼                       ▼                       ▼
    session.Store              run.Store              plan.PlanStore
    (投影, 可丢弃)              (投影, 可丢弃)           (投影, 可丢弃)
```

**核心原则：**

1. **OpLog 是 Source of Truth** — 所有可变操作先写 OpLog，再更新内存 store
2. **内存 Store 是投影** — 任何时候都可以从 OpLog 重建，重启不丢
3. **操作分类（A/B/C/D）** — 不同操作不同回滚语义，不统一存内容
4. **Opt-out 框架级记录** — 不是 handler 自觉，是 dispatcher 自动
5. **OpLog 本身是 optional** — Hub 角色不需要它

---

## 三、核心数据模型

### 3.1 Operation

```go
// pkg/types/operation.go

type OpID string    // 格式: "op_<timestamp>_<seq>"

type OpClass string
const (
    OpClassContent  OpClass = "A"   // 存内容，可回滚（配置/小文件）
    OpClassArtifact OpClass = "B"   // 存元数据，可删除（下载/安装产物）
    OpClassState    OpClass = "C"   // 存状态，可逆转（进程/会话/peer）
    OpClassNoop     OpClass = "D"   // 不存（只读查询/流）
)

type Operation struct {
    OpID        OpID              `json:"opId"`
    Class       OpClass           `json:"class"`
    Capability  string            `json:"capability"`
    Actor       Actor             `json:"actor"`
    Params      json.RawMessage   `json:"params"`       // 本次操作的参数
    Timestamp   int64             `json:"timestamp"`

    // A 类: 内容引用
    ContentBefore *ContentRef     `json:"contentBefore,omitempty"` // 旧内容备份
    ContentAfter  *ContentRef     `json:"contentAfter,omitempty"`  // 新内容 hash

    // B 类: 产物追踪
    Artifacts   []ArtifactRef     `json:"artifacts,omitempty"`

    // C 类: 状态快照
    StateBefore *StateSnapshot    `json:"stateBefore,omitempty"`
    StateAfter  *StateSnapshot    `json:"stateAfter,omitempty"`

    // 元数据
    RolledBackAt int64            `json:"rolledBackAt,omitempty"` // 0 = 未回滚
    SessionID   string            `json:"sessionId,omitempty"`
    TargetNode  string            `json:"targetNode,omitempty"`
}
```

### 3.2 ContentRef

```go
type ContentRef struct {
    Path     string `json:"path"`     // 原始路径
    Hash     string `json:"hash"`     // SHA256(contents)
    Size     int64  `json:"size"`
    StoredAt string `json:"storedAt"` // ContentStore 内路径
}
```

### 3.3 ArtifactRef

```go
type ArtifactRef struct {
    Path string `json:"path"`
    Hash string `json:"hash,omitempty"` // 大文件可选 hash
    Size int64  `json:"size,omitempty"`
}
```

### 3.4 StateSnapshot

```go
type StateSnapshot struct {
    Type     string      `json:"type"`     // "session", "run", "plan", "peer"
    StateID  string      `json:"stateId"`
    Snapshot interface{} `json:"snapshot"` // 状态的具体结构
}
```

### 3.5 序列化示例

```json
// A 类: fs.write 写配置文件
{
  "opId": "op_1712345678000_1",
  "class": "A",
  "capability": "fs.write",
  "actor": {"type": "plugin", "id": "terminal"},
  "params": {"path": "/home/user/.config/app.json", "data": "{\"key\":\"value\"}"},
  "timestamp": 1712345678000,
  "contentBefore": {
    "path": "/home/user/.config/app.json",
    "hash": "sha256:a1b2c3d4e5f6...",
    "size": 128,
    "storedAt": "trash/a1/b2c3d4e5f6..."
  },
  "contentAfter": {
    "path": "/home/user/.config/app.json",
    "hash": "sha256:1a2b3c4d5e6f...",
    "size": 142
  }
}

// B 类: 下载文件
{
  "opId": "op_1712345679000_2",
  "class": "B",
  "capability": "download",
  "actor": {"type": "plugin", "id": "system-ui"},
  "params": {"url": "https://example.com/pkg.tar.gz", "dest": "/tmp/pkg.tar.gz"},
  "timestamp": 1712345679000,
  "artifacts": [
    {"path": "/tmp/pkg.tar.gz", "hash": "sha256:b2c3d4e5f6a7...", "size": 4194304}
  ]
}

// C 类: run.create
{
  "opId": "op_1712345680000_3",
  "class": "C",
  "capability": "run.create",
  "actor": {"type": "web", "id": "browser_abc"},
  "params": {"kind": "terminal", "command": "npm run dev", "cwd": "/project"},
  "timestamp": 1712345680000,
  "stateAfter": {
    "type": "run",
    "stateId": "run_1712345680000_1",
    "snapshot": {"runId": "run_1712345680000_1", "state": "running"}
  }
}

// D 类: 不记录
// fs.list, fs.read, sys.info, stream.* → OpLog 无条目
```

---

## 四、OpLog 存储引擎

### 4.1 文件布局

```
~/.sessionnode/oplog/
├── CHUNK_0000000001.jsonl    ← 每个 chunk 固定 10000 条
├── CHUNK_0000000002.jsonl    ← 纯追加，不修改已有 chunk
├── CHUNK_0000000003.jsonl
└── INDEX.json                ← 可选加速索引（opId → chunkNo, offset）
```

### 4.2 关键行为

```go
// internal/oplog/store.go

type Store struct {
    baseDir    string       // ~/.sessionnode/oplog/
    maxRecords int          // 默认 100000
    chunkSize  int          // 默认 10000 条/chunk
    mu         sync.RWMutex

    // 内存索引 — 重启时从磁盘重建
    byID    map[OpID]*operationMeta  // {opId → {chunkNo, seq}}
    byTime  []*operationMeta          // 有序列表，用于快速截断
}

type operationMeta struct {
    OpID      OpID
    Class     OpClass
    Timestamp int64
    ChunkNo   int64
    Seq       int     // 在 chunk 内的偏移
    Size      int64   // JSON 行长度（用于 Seek）
}

func (s *Store) Append(op *Operation) (OpID, error) {
    // 1. 生成 OpID: "op_<unixms>_<seq>"
    // 2. 序列化为 JSON 一行
    // 3. 写入当前 chunk 文件（追加）
    //    → 如果当前 chunk 达到 chunkSize，换新 chunk
    // 4. 写入由文件锁保护（flock 或同名 .lock 文件）
    // 5. 更新内存索引
    // 6. 如果 total > maxRecords，触发截断
}

func (s *Store) Get(opID OpID) *Operation {
    // 1. 查内存索引 → chunkNo + seq
    // 2. 从 chunk 文件读取指定行
    // 3. 反序列化
}

func (s *Store) Replay(fromID OpID) []*Operation {
    // 从 fromID 开始重放到最新
    // 用于重启重建投影
}

func (s *Store) Query(filter OpFilter) []*Operation {
    // 支持: byClass, byTimeRange, byCapability, byActor, byPath
    // 遍历内存索引 → 按 chunk 批量读
}

func (s *Store) Truncate() {
    // 保留最后 maxRecords 条
    // 删除更老的 chunk 文件
    // 更新内存索引
    // 通知 ContentStore GC（释放对应 blob 的 refCount）
}
```

### 4.3 写入保证

```
- Append 使用文件锁（LOCK_EX），并发安全
- 写入后不修改/删除已有行（append-only）
- 截断只删除整个 chunk 文件，不修改剩余 chunk
- 一次 Append 最多一次 write 系统调用
```

### 4.4 重启恢复

```go
func (s *Store) Load() error {
    // 1. 扫描 opLog 目录，列出所有 CHUNK_*.jsonl 文件
    // 2. 按 chunk 编号升序遍历
    // 3. 解析每行 → 重建 byID 和 byTime 索引
    // 4. 记录当前最大 chunk 编号和序列号
}
```

### 4.5 Role 级别可选

```go
// main.go
switch cfg.Node.Role {
case "hub", "relay":
    opLog = nil     // 转发节点不本地执行，不需要 OpLog
default:
    opLog = oplog.NewStore(filepath.Join(dataDir, "oplog"))
}

// Dispatcher 中 OpLog 为 nil 时跳过记录
if d.opLog == nil {
    return result  // 不记录
}
```

---

## 五、Content Store

### 5.1 用途

专门存储 A 类操作的 "before content" —— 写入操作覆盖前的旧文件内容。

### 5.2 去重原理

Content-Addressable Storage: **内容寻址 + 引用计数**

```go
// internal/content/store.go

type Store struct {
    baseDir string   // ~/.sessionnode/trash/
}

func (cs *Store) Store(data []byte) (*ContentRef, error) {
    hash := sha256Hex(data)
    blobPath := cs.blobPath(hash)  // trash/<hash[:2]>/<hash>

    if fileExists(blobPath) {
        cs.incRef(hash)    // 已存在 → 只增引用
    } else {
        os.MkdirAll(dirname(blobPath), 0700)
        os.WriteFile(blobPath, data, 0400)
        cs.setRef(hash, 1) // 新文件 → 引用计数 = 1
    }

    return &ContentRef{Hash: hash, Size: len(data), StoredAt: blobPath}, nil
}

func (cs *Store) Restore(ref *ContentRef) ([]byte, error) {
    return os.ReadFile(cs.blobPath(ref.Hash))
}

func (cs *Store) Release(hash string) error {
    // 引用计数 -1
    // 为 0 时不立即删除，等 GC
}

func (cs *Store) GC() GCResult {
    // 扫描所有 refCount = 0 的 blob
    // 删除文件
    // 返回释放字节数
}
```

### 5.3 引用生命周期

```
fs.write /etc/config.json
  ├── 读旧内容 → Store(oldData) → refCount++
  ├── 写入新内容
  └── OpLog.Append { ContentBefore: ref }

OpLog 截断（删除旧 chunk）:
  └── 对应 Operation 的 ContentBefore → Release(hash) → refCount--

ContentStore GC:
  └── refCount = 0 → 物理删除
```

### 5.4 大文件降级

```
写入文件大小超过阈值（默认 1MB）：
  → 不存入 ContentStore（太大）
  → 降级为 B 类（只记录 path + hash + size）
  → 回滚时无法恢复旧内容，只能报告"文件已被覆盖，旧内容未备份"
```

---

## 六、Dispatcher 集成（Opt-out 框架级记录）

### 6.1 第 9 步链

在现有 8 步链后增加一步：

```go
func (d *Dispatcher) Dispatch(req *CapabilityRequest) *CapabilityResponse {
    // Step 1-8: 认证、解析、权限、plan、路由、执行、审计、返回
    // ... 现有逻辑不变 ...

    // Step 9: OpLog 自动记录（opt-out）
    if !req.SkipRecording && d.opLog != nil {
        d.recordOperation(req, resp, execResult)
    }

    return resp
}
```

### 6.2 recordOperation

```go
func (d *Dispatcher) recordOperation(req, resp, execResult) {
    class := classifyCapability(req.Capability)
    if class == OpClassNoop {
        return  // D 类不记
    }

    op := &Operation{
        Class:       class,
        Capability:  req.Capability,
        Actor:       req.Actor,
        Params:      req.Payload,
        Timestamp:   now,
        TargetNode:  string(req.TargetNodeID),
    }

    if class == OpClassContent {
        // ContentBefore 由 handler 在执行前通过 Capture 设置
        // ContentAfter 由 handler 在结果中返回 hash
        op.ContentBefore = extractContentBefore(req)
        op.ContentAfter  = extractContentAfter(resp)
    }

    if class == OpClassArtifact {
        op.Artifacts = extractArtifacts(req, resp)
    }

    if class == OpClassState {
        op.StateBefore = captureStateBefore(req)
        op.StateAfter  = captureStateAfter(req, resp)
    }

    d.opLog.Append(op)
}
```

### 6.3 classifyCapability 映射表

```go
func classifyCapability(cap string) OpClass {
    switch {
    // A 类 — 存内容
    case strings.HasPrefix(cap, "fs.write"):
        return OpClassContent
    case strings.HasPrefix(cap, "config.set"):
        return OpClassContent
    case strings.HasPrefix(cap, "env.set"):
        return OpClassContent
    case strings.HasPrefix(cap, "permission."):
        return OpClassContent
    case strings.HasPrefix(cap, "fs.rename"):
        return OpClassContent

    // B 类 — 存元数据
    case strings.HasPrefix(cap, "fs.remove"):
        return OpClassArtifact
    case strings.HasPrefix(cap, "fs.mkdir"):
        return OpClassArtifact
    case strings.HasPrefix(cap, "download"):
        return OpClassArtifact
    case strings.HasPrefix(cap, "install"):
        return OpClassArtifact
    case strings.HasPrefix(cap, "uninstall"):
        return OpClassArtifact
    case strings.HasPrefix(cap, "sync."):
        return OpClassArtifact

    // C 类 — 存状态
    case strings.HasPrefix(cap, "session."):
        return OpClassState
    case strings.HasPrefix(cap, "run."):
        return OpClassState
    case strings.HasPrefix(cap, "process."):
        return OpClassState
    case strings.HasPrefix(cap, "peer."):
        return OpClassState
    case strings.HasPrefix(cap, "node.invite."):
        return OpClassState
    case strings.HasPrefix(cap, "node.peer."):
        return OpClassState
    case strings.HasPrefix(cap, "task."):
        return OpClassState
    case strings.HasPrefix(cap, "plan."):
        return OpClassState
    case strings.HasPrefix(cap, "approval."):
        return OpClassState
    case strings.HasPrefix(cap, "admin."):
        return OpClassState

    // D 类 — 不记
    case strings.HasPrefix(cap, "fs.read"),
         strings.HasPrefix(cap, "fs.list"),
         strings.HasPrefix(cap, "fs.stat"),
         strings.HasPrefix(cap, "sys."),
         strings.HasPrefix(cap, "stream."),
         strings.HasPrefix(cap, "logs."),
         strings.HasPrefix(cap, "audit."),
         strings.HasPrefix(cap, "node.list"),
         strings.HasPrefix(cap, "node.info"),
         strings.HasPrefix(cap, "node.health"),
         strings.HasPrefix(cap, "env.get"),
         strings.HasPrefix(cap, "env.list"),
         strings.HasPrefix(cap, "env.which"),
         strings.HasPrefix(cap, "env.checkBinary"),
         strings.HasPrefix(cap, "env.home"),
         strings.HasPrefix(cap, "env.cwd"),
         strings.HasPrefix(cap, "update.status"),
         strings.HasPrefix(cap, "update.check"):
        return OpClassNoop

    // 默认: 保守视为 C 类（有状态变更，记录之）
    default:
        return OpClassState
    }
}
```

### 6.4 Opt-out 标记

```go
// 调用方可以显式跳过记录
{
  "type": "action.request",
  "capability": "fs.write",
  "payload": {...},
  "_skipRecording": true  // ← 此操作不记入 OpLog
}
```

Dispatcher 在反序列化时检查这个字段：

```go
type CapabilityRequest struct {
    // ... 现有字段 ...
    SkipRecording bool `json:"_skipRecording,omitempty"`
}
```

---

## 七、操作分类表

所有现有 capability 按分类：

| API | 分类 | OpLog 记录内容 |
|-----|------|---------------|
| `fs.write` | **A** | before 全文 + after hash |
| `fs.rename` | **A** | oldPath + newPath |
| `config.set` | **A** | oldValue + newValue |
| `env.set` | **A** | oldValue + newValue |
| `permission.grant` | **A** | 旧 grant 状态 |
| `permission.revoke` | **A** | 旧 grant 状态 |
| `fs.remove` | **B** | path + stat |
| `fs.mkdir` | **B** | path |
| `session.create` | **C** | session config |
| `session.destroy` | **C** | session ID + 旧状态 |
| `run.create` | **C** | command, args, cwd |
| `run.stop` | **C** | 旧 state |
| `run.updatePolicy` | **C** | 旧 policy |
| `process.spawn` | **C** | spawn config |
| `process.signal` | **C** | signal + PID |
| `peer.*` | **C** | peer identity |
| `node.invite.*` | **C** | invite config |
| `task.create` | **C** | task config |
| `task.update` | **C** | task 旧状态 |
| `network.connect` | **C** | target address |
| `sync.diff` | **B** | diff target path |
| `sync.apply` | **B** | 产物文件列表 |
| `admin.*` | **C** | admin 操作参数 |
| `fs.read` | **D** | 不记 |
| `fs.list` | **D** | 不记 |
| `fs.stat` | **D** | 不记 |
| `sys.*` | **D** | 不记 |
| `stream.*` | **D** | 不记 OpLog（另有 history store）|
| `logs.*` | **D** | 不记 |
| `audit.*` | **D** | 不记 |
| `node.list` | **D** | 不记 |
| `update.*` | **D** | 不记（更新检查本身是只读的） |

---

## 八、重启恢复

### 8.1 原理

OpLog 是唯一的事实来源，内存 store 在重启后从 OpLog 重建。

```
启动流程 (v2):
  1. 加载配置
  2. 加载 OpLog（扫描 chunk 文件，重建索引）
  3. 从 OpLog Replay(0) 重建 session.Store / run.Store / plan.PlanStore
  4. 检测 OS 层面还在跑的进程，关联到重建的 run 记录
  5. 启动 WebSocket 服务
```

### 8.2 重建函数

```go
// cmd/node/main.go — 简化版

func main() {
    // ... 配置加载 ...

    // 初始化 OpLog
    opLog := oplog.NewStore(filepath.Join(dataDir, "oplog"))
    opLog.Load()  // 扫描磁盘，重建内存索引

    // 从 OpLog 重建投影
    sessStore := session.NewStore()
    runStore  := run.NewStore()
    planStore := plan.NewPlanStore()

    for _, op := range opLog.Replay("op_0") {  // 从第一条开始
        rebuildFromOp(op, sessStore, runStore, planStore)
    }

    // 检测孤儿进程
    orphanProcIDs := detectOrphanProcesses(runStore)
    for _, pid := range orphanProcIDs {
        runStore.UpdateState(pid, run.StateOrphaned)
    }

    // ... 启动服务 ...
}

func rebuildFromOp(op *Operation, sStore *session.Store, rStore *run.Store, pStore *plan.PlanStore) {
    switch op.Capability {
    case "session.create":
        sStore.RebuildFromOp(op)
    case "session.destroy":
        sStore.Delete(extractSessionID(op))
    case "run.create":
        rStore.RebuildFromOp(op)
    case "run.stop":
        rStore.UpdateState(extractRunID(op), run.StateStopped)
    case "run.updatePolicy":
        rStore.UpdateOpFromOp(op)
    // ... 其他操作类似 ...
    }
}
```

### 8.3 孤儿进程检测

```go
func detectOrphanProcesses(runStore *run.Store) []string {
    var orphans []string
    for _, r := range runStore.List("", "", "") {
        if r.State != run.StateRunning {
            continue
        }
        // 检查进程是否还在
        if !processExists(r.ProcessID) {
            if r.Policy.RestartRestore {
                runStore.UpdateState(r.RunID, run.StateRestorable)
            } else {
                runStore.UpdateState(r.RunID, run.StateOrphaned)
            }
            orphans = append(orphans, r.ProcessID)
        }
    }
    return orphans
}
```

### 8.4 现有 store 的重建接入

| Store | 可重建 | 方式 |
|-------|--------|------|
| `session.Store` | ✅ | 从 OpLog 回放 session.create/destroy |
| `run.Store` | ✅ | 从 OpLog 回放 run.create/stop/updatePolicy |
| `plan.PlanStore` | ✅ | 从 OpLog 回放 plan.create/approve/deny |
| `process.Manager` | ⚠️ 部分 | 进程是 OS 资源，只能 attach 还在跑的 |
| `history.Store` | ❌ 不改 | 已有 disk mode，保持独立 |
| `logs.Buffer` | ❌ 不改 | 运行时缓冲，重启丢正常 |

### 8.5 审计查询的后备

当前 `audit.list` 从内存 `AuditStore` 查询。改为从 OpLog 查询：

```go
func auditList(req, deps) (interface{}, error) {
    ops := deps.OpLog.Query(OpFilter{
        Classes:    []OpClass{OpClassContent, OpClassArtifact, OpClassState},
        FromTime:   from,
        ToTime:     to,
        Actor:      actor,
        Capability: capability,
        Limit:      limit,
    })
    return ops, nil
}
```

这样 `audit.list` 在重启后也不为空。

---

## 九、回滚引擎

### 9.1 逆操作映射

```go
var inverseOps = map[string]InverseFunc{
    // A 类: 内容恢复
    "fs.write":     inverseFsWrite,       // 写回 before
    "fs.rename":    inverseFsRename,       // 反向 rename
    "config.set":   inverseConfigSet,      // 设回旧值
    "env.set":      inverseEnvSet,         // 设回旧值
    "permission.*": inversePermission,     // 还原旧 grant

    // B 类: 删除产物
    "fs.remove":    inverseFsRemove,       // 从 trash 恢复（需要 ContentStore 支持）
    "fs.mkdir":     inverseFsMkdir,        // 删目录
    "download":     inverseDownload,       // 删文件
    "install":      inverseInstall,        // 卸载

    // C 类: 状态逆转
    "session.create":  inverseSessionCreate,   // session.destroy
    "session.destroy": inverseSessionDestroy,  // 重建 session
    "run.create":      inverseRunCreate,       // run.stop
    "run.stop":        inverseRunStop,         // run.create（如果可重启）
    "process.spawn":   inverseProcessSpawn,    // SIGTERM
    "peer.*":          inversePeer,            // disconnect
}
```

### 9.2 单操作回滚

```go
type RollbackEngine struct {
    opLog   *oplog.Store
    content *content.Store
}

func (e *RollbackEngine) Rollback(opID OpID) (*Operation, error) {
    op := e.opLog.Get(opID)
    if op == nil {
        return nil, ErrOpNotFound
    }
    if op.RolledBackAt != 0 {
        return nil, ErrAlreadyRolledBack
    }

    switch op.Class {
    case OpClassContent:
        data, err := e.content.Restore(op.ContentBefore)
        if err != nil {
            return nil, fmt.Errorf("restore content: %w", err)
        }
        os.WriteFile(op.ContentBefore.Path, data, 0644)

    case OpClassArtifact:
        for _, art := range op.Artifacts {
            os.Remove(art.Path)
        }

    case OpClassState:
        fn, ok := inverseOps[op.Capability]
        if !ok {
            return nil, fmt.Errorf("no inverse for %s", op.Capability)
        }
        if err := fn(op.StateBefore); err != nil {
            return nil, err
        }
    }

    // 标记回滚（追加一个 RollbackEvent，不是修改原记录）
    e.opLog.Append(&Operation{
        Class:      OpClassNoop,
        Capability: "_rollback",
        Params:     json.RawMessage(`{"rolledBackOpId":"` + opID + `"}`),
        Actor:      Actor{Type: "system", ID: "rollback-engine"},
        Timestamp:  now,
    })

    op.RolledBackAt = now  // 内存标记
    return op, nil
}
```

**重要：回滚事件本身也是一条 OpLog 记录。** 不是修改原记录，是追加一条 `_rollback` 事件。

### 9.3 范围回滚

```go
func (e *RollbackEngine) RollbackRange(from, to time.Time) ([]OpID, error) {
    ops := e.opLog.Query(OpFilter{
        FromTime: from.UnixMilli(),
        ToTime:   to.UnixMilli(),
        Classes:  []OpClass{OpClassContent, OpClassArtifact, OpClassState},
    })

    // 逆序回滚（后发生的先撤销）
    var rolledBack []OpID
    for i := len(ops) - 1; i >= 0; i-- {
        if ops[i].RolledBackAt != 0 {
            continue
        }
        e.Rollback(ops[i].OpID)
        rolledBack = append(rolledBack, ops[i].OpID)
    }
    return rolledBack, nil
}
```

### 9.4 回滚预览（Dry-run）

```go
func (e *RollbackEngine) DryRun(opID OpID) (*RollbackPreview, error) {
    op := e.opLog.Get(opID)
    if op == nil {
        return nil, ErrOpNotFound
    }

    preview := &RollbackPreview{
        OpID:         opID,
        Capability:   op.Capability,
        WillRestore:  []string{},   // A 类会被恢复的文件
        WillDelete:   []string{},   // B 类会被删除的文件
        WillRevert:   []string{},   // C 类会被逆转的状态
    }

    switch op.Class {
    case OpClassContent:
        preview.WillRestore = append(preview.WillRestore, op.ContentBefore.Path)
    case OpClassArtifact:
        for _, art := range op.Artifacts {
            preview.WillDelete = append(preview.WillDelete, art.Path)
        }
    case OpClassState:
        preview.WillRevert = append(preview.WillRevert, op.Capability+": "+op.StateBefore.StateID)
    }

    return preview, nil
}
```

### 9.5 一致性验证

```go
func (e *RollbackEngine) VerifyArtifacts() []ConsistencyReport {
    ops := e.opLog.Query(OpFilter{Classes: []OpClass{OpClassArtifact}})
    var reports []ConsistencyReport

    for _, op := range ops {
        for _, art := range op.Artifacts {
            info, err := os.Stat(art.Path)
            if os.IsNotExist(err) {
                reports = append(reports, ConsistencyReport{
                    OpID: op.OpID, Path: art.Path,
                    Status: "missing", ExpectedSize: art.Size,
                })
                continue
            }
            if art.Hash != "" && quickHash(art.Path) != art.Hash {
                reports = append(reports, ConsistencyReport{
                    OpID: op.OpID, Path: art.Path,
                    Status: "corrupted", ExpectedSize: art.Size, ActualSize: info.Size(),
                })
            }
        }
    }
    return reports
}
```

---

## 十、Forward-Only Hub Mode

### 10.1 概念

Forward-Only Hub Mode 是一个 Core 节点的运行模式——它只转发消息，不本地执行任何能力。

```
        ┌───────────────────┐
        │   Leaf (PC)       │
        │   process.spawn   │────┐
        └───────────────────┘    │
                                 │ mesh.call
        ┌───────────────────┐    │    ┌───────────────────┐
        │   Leaf (VPS)      │────┼────│  Hub (ForwardOnly) │
        │   fs.write        │    │    │  不本地执行        │
        └───────────────────┘    │   │  只路由到目标      │
                                 │    └─────────┬─────────┘
        ┌───────────────────┐    │              │
        │   Leaf (手机)     │────┘              │ mesh.call
        │   stream.subscribe│                   │ (目标节点)
        └───────────────────┘                   ▼
                                        ┌───────────────────┐
                                        │   Leaf (服务器)    │
                                        │   真正执行能力      │
                                        └───────────────────┘
```

### 10.2 Config

```go
// internal/config/config.go
type NodeConfig struct {
    Name    string `json:"name"`
    Role    string `json:"role"`              // "standalone", "relay", "leaf", "hub"
    HubMode bool   `json:"hubMode,omitempty"` // 显式开关，role="hub" 时自动为 true
}
```

### 10.3 Topology 层拦截

```go
// internal/topology/topology.go

type PeerTopology struct {
    // ... 现有字段 ...
    forwardOnly bool  // 新增
}

func (pt *PeerTopology) handleMeshCall(senderID types.NodeID, msg *protocol.Message) {
    if pt.forwardOnly {
        targetIsLocal := msg.TargetNodeID == "" || msg.TargetNodeID == pt.localID
        if targetIsLocal {
            // 拒绝：hub 不本地执行
            pt.sendError(senderID, msg.RequestID, "HUB_MODE_REJECTED",
                "this node is in forward-only mode and does not execute capabilities")
            return
        }
        // 目标不是本机 → 正常转发（路由功能不受影响）
    }
    // 原有 Dispatch 逻辑
}
```

### 10.4 Admin 旁路

Hub 管理员需要通过 localhost 管理节点本身。方案是**额外监听一个 localhost-only HTTP 端口**，通过独立的 admin handler 处理：

```go
// internal/server/server.go

func (s *Server) startAdminServer() {
    adminMux := http.NewServeMux()
    adminMux.HandleFunc("/status", s.handleAdminStatus)
    adminMux.HandleFunc("/peers", s.handleAdminPeers)
    adminMux.HandleFunc("/policy", s.handleAdminPolicy)

    adminAddr := "127.0.0.1:9190"
    log.Printf("[admin] admin server on %s", adminAddr)
    if err := http.ListenAndServe(adminAddr, adminMux); err != nil {
        log.Printf("[admin] admin server error: %v", err)
    }
}

// Admin handler 通过 dispatcher 执行（加上 OpLog 记录）
func (s *Server) handleAdminPolicy(w, r) {
    resp := s.dispatcher.Dispatch(&CapabilityRequest{
        Capability: "admin.policy.set",
        Actor:      Actor{Type: "admin", ID: "localhost"},
        Payload:    body,
        BypassHubCheck: true,  // 绕过 ForwardOnly 检查
        // 不跳过 OpLog → admin 操作同样被记录
    })
}
```

**Admin 操作也走 OpLog。** 这样攻击者攻破 admin 端口也逃不过审计追踪。

### 10.5 relay.policy 协议

当 Hub 负载过高时，可以广播策略给连接的 Leaf：

```go
// pkg/protocol/message.go
const MsgTypeRelayPolicy = "relay.policy"

type RelayPolicyPayload struct {
    Status          string   `json:"status"`          // "normal" | "busy" | "maintenance"
    RateLimit       string   `json:"rateLimit,omitempty"`       // "10req/min"
    MaxConnections  int      `json:"maxConnections,omitempty"`
    RetryAfter      int      `json:"retryAfter,omitempty"`      // 秒
    Features        []string `json:"features,omitempty"`        // 可用功能列表
    Message         string   `json:"message,omitempty"`
}

// Hub 端定期广播
func (pt *PeerTopology) BroadcastPolicy(payload *RelayPolicyPayload) {
    msg := &protocol.Message{Type: MsgTypeRelayPolicy, Payload: json.Marshal(payload)}
    pt.broadcastToPeers(msg)
}

// Leaf 端处理
case protocol.MsgTypeRelayPolicy:
    var policy RelayPolicyPayload
    json.Unmarshal(msg.Payload, &policy)
    leaf.onPolicyUpdate(&policy)
```

### 10.6 OpLog 在 Hub 上的行为

Hub 模式下：
- `opLog = nil`（不初始化）
- Dispatcher 的 OpLog 步骤跳过
- Hub 不产生任何 Operation 记录

这不是缺陷——**Hub 从设计上就不执行操作，所以没有操作可记录。** Leaf 节点各自记录自己的操作。

---

## 十一、Capability 裁剪

### 11.1 概念

不同产品/部署场景需要的 capability 集合不同。终端场景需要 `process.spawn`，纯 Hub 场景不需要。

### 11.2 实现方式

**不采用运行时配置。** 采用构建时组合（Build-time composition）：

```go
// internal/executor/registry.go

type RegistryConfig struct {
    // 按命名空间开关
    Process  bool  // process.spawn/signal/resize/list
    History  bool  // session.history.*
    Update   bool  // update.check/plan/status
    Network  bool  // network.*
    Sync     bool  // sync.diff/apply/status
    Admin    bool  // admin.*

    // 分类表扩展
    Classifiers map[string]OpClass  // 额外能力的分类
}

func New(deps *Deps, cfg RegistryConfig) *Registry {
    r := &Registry{handlers: make(map[string]ExecFunc), deps: deps}
    r.registerCore(cfg)  // 始终注册的能力
    r.registerConditional(cfg)
    return r
}

func (r *Registry) registerCore(cfg RegistryConfig) {
    // 这些始终注册
    r.Register("fs.read", fsRead, OpClassNoop)
    r.Register("fs.write", fsWrite, OpClassContent)
    r.Register("fs.list", fsList, OpClassNoop)
    // ... 其他通用能力 ...
    r.Register("session.create", sessionCreate, OpClassState)
    r.Register("session.destroy", sessionDestroy, OpClassState)
    r.Register("run.create", runCreate, OpClassState)
    r.Register("config.set", configSet, OpClassContent)
}

func (r *Registry) registerConditional(cfg RegistryConfig) {
    if cfg.Process {
        r.Register("process.spawn", processSpawn, OpClassState)
        r.Register("process.signal", processSignal, OpClassState)
        r.Register("process.resize", processResize, OpClassState)
        r.Register("process.list", processList, OpClassState)
    }
    if cfg.History {
        r.Register("session.history.setPolicy", historySetPolicy, OpClassState)
        r.Register("session.history.clear.execute", historyClearExecute, OpClassState)
    }
    if cfg.Update {
        r.Register("update.check", updateCheck, OpClassNoop)
        r.Register("update.plan", updatePlan, OpClassNoop)
    }
    if cfg.Network {
        r.Register("network.connect", networkConnect, OpClassState)
        r.Register("network.listen", networkListen, OpClassState)
    }
    if cfg.Sync {
        r.Register("sync.diff", syncDiff, OpClassArtifact)
        r.Register("sync.apply", syncApply, OpClassArtifact)
        r.Register("sync.status", syncStatus, OpClassNoop)
    }
    if cfg.Admin {
        r.Register("admin.status", adminStatus, OpClassNoop)
        r.Register("admin.policy.set", adminPolicySet, OpClassState)
    }
}
```

### 11.3 main.go 配置

```go
// cmd/node/main.go — Hub 版本的注册配置
execReg := executor.New(execDeps, executor.RegistryConfig{
    Process: false,   // Hub 不 spawn 进程
    History: false,   // Hub 不记录终端历史
    Update:  true,    // Hub 需要更新检查
    Network: false,   // Hub 不执行网络能力
    Sync:    false,   // Hub 不做文件同步
    Admin:   true,    // Hub 需要 admin 管理
})
```

### 11.4 分类表扩展

不同产品 fork 后在 main.go 中注册分类：

```go
// 新项目的 main.go
execDeps.OpClassifier.Register("sync.diff", OpClassArtifact)
execDeps.OpClassifier.Register("sync.apply", OpClassArtifact)
execDeps.OpClassifier.RegisterDefault(OpClassState)  // 未知 cap 默认为 C
```

---

## 十二、角色关系总图

```
                    角色 × 组件矩阵

              standalone     leaf        relay       hub
             ─────────────────────────────────────────────
OpLog           ✅ 需要       ✅ 需要      ❌         ❌
ContentStore    ✅ 需要       ✅ 需要      ❌         ❌
RollbackEngine  ✅ 需要       ✅ 需要      ❌         ❌
ForwardOnly     ❌           ❌           ❌         ✅
Admin API       ❌(可选)      ❌(可选)     ❌(可选)    ✅ 必须
Cap.Process     ✅           ✅           ❌         ❌
Cap.History     ✅           ✅           ❌         ❌
Cap.Admin       ❌(可选)      ❌(可选)     ✅ 需要     ✅ 需要
Relay Policy    ❌           ✅ 监听       ✅ 广播     ✅ 广播
RestartRecovery ✅           ✅           ❌         ❌
```

**规则：** 只要节点"本地执行能力"，它就需要 OpLog + ContentStore + RollbackEngine。纯转发节点不需要。

---

## 十三、契约测试体系

见 [CORE_CAPABILITY_ARCHITECTURE_AUDIT.md](CORE_CAPABILITY_ARCHITECTURE_AUDIT.md) 的扩展。

### 13.1 三层契约

```
Layer 1 — 能力清单契约
  验证: 注册的能力集与预期一致
  场景: 每次新增/删除/重命名 capability

Layer 2 — 结构契约（可选）
  验证: 每个 capability 的请求/响应 JSON 结构
  场景: 结构变更频繁时启用，稳定后可关

Layer 3 — 行为契约
  验证: 每个 capability 的副作用
  场景: 每次修改 handler 实现
```

### 13.2 Layer 1 实现

```go
// executor/contract_test.go

func TestCapabilityInventory(t *testing.T) {
    // 定义基线
    expected := []CapabilityEntry{
        {Name: "fs.write",   Class: "A"},
        {Name: "fs.remove",  Class: "B"},
        {Name: "run.create", Class: "C"},
        // ...
    }

    actual := listAllRegistered(reg)

    // diff 输出（不 fail，仅 warning）
    diff := diffInventory(expected, actual)
    if diff != "" {
        t.Logf("能力清单变更:\n%s", diff)
        // 开发者需在 commit message 说明
    }
}
```

### 13.3 Layer 3 实现

```go
// executor/contract_test.go

func TestFsWriteBehavior(t *testing.T) {
    tmpFile := filepath.Join(t.TempDir(), "test.txt")

    // 调用 fs.write
    resp := callCapability(t, "fs.write", map[string]interface{}{
        "path": tmpFile, "data": "hello",
    })

    // 验证: 文件被创建
    data, _ := os.ReadFile(tmpFile)
    assert.Equal(t, "hello", string(data))

    // 验证: 如果 OpLog 存在，应有记录
    if opLog != nil {
        ops := opLog.Query(OpFilter{Capability: "fs.write", Limit: 1})
        assert.Len(t, ops, 1)
        assert.Equal(t, tmpFile, ops[0].ContentAfter.Path)
    }
}

func TestConsistency_OpLogRebuildAfterRestart(t *testing.T) {
    core := startCoreWithTempDir(t)
    defer core.Stop()

    op1 := core.Do("fs.write",  "/tmp/test.txt", "hello")
    op2 := core.Do("config.set", "core.log.level", "debug")
    op3 := core.Do("run.create", "npm run dev")

    // 模拟重启
    core.Restart()

    // 验证: run 仍在
    assert.NotNil(t, core.RunGet(op3.RunID))

    // 验证: audit 查询不空
    ops := core.OpLogQuery()
    assert.Len(t, ops, 3)

    // 回滚 op1
    core.Rollback(op1.OpID)
    // 验证: 文件内容恢复为 before
}
```

### 13.4 CI 中的契约测试

```yaml
# .github/workflows/contract.yml
test:
  - go test ./internal/executor/... -run TestCapabilityInventory
  - go test ./internal/executor/... -run Test.*Behavior
  - go test ./internal/oplog/...
  - go test ./internal/content/...
  - go test ./... -run TestConsistency -tags=e2e
```

---

## 十四、实现阶段

### Phase 0 — 清扫地基（现有不自洽）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P0.1 启用 Run Store 持久化 | `cmd/node/main.go:197` | ~10 行 |
| P0.2 AuditStore 加环形上限 | `logs/audit_store.go` | ~30 行 |
| P0.3 实例化 TaskStore | `cmd/node/main.go` | ~5 行 |
| P0.4 删除死代码（stub + 重复 audit） | 多文件 | ~50 行删除 |
| P0.5 磁盘历史加 RotateWriter | `history/store.go:469-506` | ~50 行 |
| P0.6 PlanStore 自动清理 | `plan/plan.go` | ~40 行 |
| P0.7 Layer 1 + Layer 3 契约测试 | `executor/contract_test.go` | ~300 行 |

**交付物：** 现有不自洽全部修完，契约测试基线建立。

---

### Phase 1 — OpLog 核心

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P1.1 定义 Operation 数据结构 | `pkg/types/operation.go` | ~100 行 |
| P1.2 OpLog 存储引擎 | `internal/oplog/store.go` | ~300 行 |
| P1.3 Content Store | `internal/content/store.go` | ~150 行 |
| P1.4 classifyCapability | `internal/executor/classify.go` | ~80 行 |
| P1.5 Dispatcher 集成（第 9 步） | `internal/dispatcher/dispatcher.go` | ~100 行 |
| P1.6 OpLog 单元测试 + 集成测试 | `internal/oplog/*_test.go` | ~400 行 |

**交付物：** OpLog 开始自动记录所有操作，但不影响现有功能。

---

### Phase 2 — 重启恢复

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P2.1 OpLog.Replay → rebuild stores | `cmd/node/main.go` | ~100 行 |
| P2.2 rebuildFromOp 分发函数 | `internal/oplog/rebuild.go` | ~150 行 |
| P2.3 孤儿进程检测 | `cmd/node/main.go` | ~50 行 |
| P2.4 audit.list 改从 OpLog 查询 | `executor/log_audit_cmds.go` | ~30 行 |
| P2.5 重启恢复 E2E 测试 | `cmd/node/main_test.go` | ~200 行 |

**交付物：** Core 重启后 session/run/plan/audit 数据恢复。

---

### Phase 3 — 回滚引擎

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P3.1 逆操作映射表 | `internal/oplog/inverse.go` | ~200 行 |
| P3.2 Rollback 单操作 | `internal/oplog/rollback.go` | ~100 行 |
| P3.3 Rollback 范围 | `internal/oplog/rollback.go` | ~50 行 |
| P3.4 Dry-run 预览 | `internal/oplog/rollback.go` | ~40 行 |
| P3.5 一致性验证 | `internal/oplog/verify.go` | ~80 行 |
| P3.6 注册 operations.* API | `executor/registry.go` | ~50 行 |
| P3.7 回滚 E2E 测试 | 测试 | ~300 行 |

**交付物：** 外部可调用的回滚能力。

---

### Phase 4 — Forward-Only Hub Mode

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P4.1 Config 加 HubMode | `internal/config/config.go` | ~5 行 |
| P4.2 Topology 拦截 | `internal/topology/topology.go` | ~60 行 |
| P4.3 Admin 管理端点 | `internal/server/server.go` | ~150 行 |
| P4.4 Admin 端点走 OpLog | `internal/server/server.go` | ~30 行 |
| P4.5 relay.policy 协议 | `pkg/protocol/message.go` + `topology.go` | ~100 行 |
| P4.6 负载监控 goroutine | `internal/server/server.go` | ~80 行 |
| P4.7 OpLog 按角色 optional | `cmd/node/main.go` | ~10 行 |
| P4.8 Hub E2E 测试 | 测试 | ~200 行 |

**交付物：** Hub 角色部署 + admin 管理 + 协议策略广播。

---

### Phase 5 — Capability 裁剪 + 存储治理

| 任务 | 文件 | 工作量 |
|------|------|--------|
| P5.1 RegistryConfig + 条件注册 | `internal/executor/registry.go` | ~100 行 |
| P5.2 各产品 main.go 配置 | `cmd/node/main.go` (各 fork) | ~20 行/产品 |
| P5.3 OpLog 截断 + ContentStore GC 联动 | `internal/oplog/store.go` + `content/store.go` | ~100 行 |
| P5.4 磁盘配额配置 | `internal/config/config.go` | ~30 行 |
| P5.5 存储治理 E2E 测试 | 测试 | ~150 行 |

**交付物：** 可按需裁剪能力 + 存储不会无限增长。

---

## 十五、存储布局总览

### 完整布局

```
~/.sessionnode/
│
├── config.json                    ← 配置
├── identity.json                   ← 节点身份
├── trusted_peers.json              ← 信任的 peer
│
├── update-source.json              ← 更新源
├── update-policy.json              ← 更新策略
├── update-status.json              ← 更新状态
│
├── oplog/                          ← 新增: Operation Log
│   ├── CHUNK_0000000001.jsonl
│   ├── CHUNK_0000000002.jsonl
│   └── ...
│
├── trash/                          ← 新增: Content Store
│   ├── a1/
│   │   └── a1b2c3d4e5f6...
│   ├── b2/
│   │   └── b2c3d4e5f6a7...
│   └── ...
│
├── logs/
│   ├── core.log                    ← 运行时日志（RotateWriter）
│   ├── core.log.1 ... .10
│   ├── audit.log                   ← 审计日志（RotateWriter，并存 OpLog）
│   └── audit.log.1 ... .10
│
├── sessions/                       ← 终端历史（已有，disk mode）
│   └── <sessionId>/
│       ├── stdout.log
│       ├── stderr.log
│       └── events.jsonl
│
└── runs.json                       ← 修复: Run Store 持久化（已有代码但未启用）
```

### 按角色的最小布局

```
standalone/leaf (全功能):
  ~/.sessionnode/oplog/     ← OpLog 必须
  ~/.sessionnode/trash/     ← ContentStore 必须
  ~/.sessionnode/logs/      ← 日志

hub (纯转发):
  ~/.sessionnode/logs/      ← 只有日志
  ~/.sessionnode/更新文件    ← 更新检查需要
  (不需要 oplog/ trash/ sessions/)

headless 转发器（最小）:
  ~/.sessionnode/logs/      ← 只有日志
  (其他都可以不创建)
```

---

## 附：与现有文档的关系

| 现有文档 | 与本文件的关系 |
|---------|--------------|
| `LOGS_AND_AUDIT.md` | OpLog 不取代 audit.log。两者共存：audit.log 是物理安全副本，OpLog 是结构化可查询的操作记录。 |
| `SESSION_AND_STREAM.md` | 不修改 session/stream 现有设计。OpLog 记录 session 创建/销毁等操作事件，不记录 stream chunk。 |
| `CORE_CAPABILITY_ARCHITECTURE_AUDIT.md` | 本文件是实现该审计报告提出的大部分改进的路线图。 |
| `PUBLIC_MESH_SECURITY.md` | Hub Mode 不改变 mesh 安全模型。ForwardOnly 是在 topology 层加的拦截，不修改信任链。 |
| `SELF_UPDATE.md` | 更新保持只读。OpLog 不记录 update.check 等只读操作。 |
