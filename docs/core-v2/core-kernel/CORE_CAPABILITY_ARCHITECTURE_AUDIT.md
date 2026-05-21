# Core Capability Architecture Audit

> 审计日期: 2026-05-20 (updated 2026-05-21 — R12 network capability declarations)
> 审计范围: SessionNode v2 Go Core + System UI Plugin Host
> 审计目的: 明确当前状态、能力分布、平台支持、架构清洁度，指导下一步重构/抽象决策
> 工作区状态: go-core 多文件已修改（dispatcher, executor, notify, plan, capabilities, protocol errors, tests）；新增 internal/task/ 包和 internal/executor/task_cmds.go；R12 新增 network.* 5 个 capability 声明（connect/listen/dns/proxy/fetch）

---

## 1. Current Code Distribution

### 1.1 Go Core 包分布

| Area | Path | Responsibility | Lines (src) | Lines (test) | Cleanliness | Notes |
|---|---|---|---|---|---|---|
| Types | `pkg/types/` | 核心类型定义：ID 包装、CapabilityRequest/Response、CoreError、Plugin、History | 536 | 409 | **Clean** | 强类型 newtype 模式，零内部依赖 |
| Protocol | `pkg/protocol/` | WebSocket 线协议：Message 结构、编码、错误码 | 311 | 276 | **Clean** | 单一职责，JSON 信封 |
| Dispatcher | `internal/dispatcher/` | 统一调度器：8 步执行链（认证→解析→权限→路由→执行→审计） | 196 | 575 | **Clean** | 全接口注入，清晰的链式设计 |
| Executor | `internal/executor/` | 能力执行器：68+ capability handler 注册与执行 | 2743 | 1518 | **Acceptable Debt** | `plugin_cmds.go` 已拆分为 `plugin_install_cmds.go`, `plugin_files_cmds.go`, `plugin_cache_cmds.go`, `plugin_manage_cmds.go`, `plugin_permission_cmds.go`, `task_cmds.go`；Deps 仍是 God-object |
| Process | `internal/process/` | 进程管理：spawn、PTY、signal、resize、list | 571 | 340 | **Acceptable Debt** | Unix PTY 219 行完整，Windows PTY 20 行 stub；无状态机 |
| History | `internal/history/` | 会话事件存储：环形缓冲区、replay、tail、clear | 609 | 1344 | **Clean** | 设计合理，RangeTruncatedError 层级清晰 |
| Permission | `internal/permission/` | 权限检查：声明、授权、运行时校验 | 402 | 535 | **Acceptable Phase 1 Debt** | grant 模型完整，但路径约束强制执行仍浅（Phase 0 仅有 `path` 字段前缀匹配，无通配符/glob 解析） |
| Plugin Manifest | `internal/pluginmanifest/` | 插件 manifest 解析、校验、注册、冲突检测 | 1942 | 1616 | **Acceptable Debt** | 11 文件分组良好，但 `validate.go` (405)、`yaml.go` (371) 可拆分 |
| Server | `internal/server/` | HTTP/WS 入口：中间件、路由、组件组装 | 381 | 1201 | **Clean** | 合理的组装枢纽，381 行适中 |
| WSConn | `internal/wsconn/` | WebSocket 连接注册表：会话范围订阅、fan-out | 290 | 365 | **Clean** | 单一关注点，fan-out 正确 |
| Topology | `internal/topology/` | 多节点拓扑：peer 管理、重连、消息转发 | 467 | 2881 | **Acceptable Debt** | 非测试代码 467 行合理，E2E 测试 2081 行偏大但可接受 |
| Auth | `internal/auth/` | Token 认证：5 种 token 类型 | 55 | 76 | **Clean** | 轻量，可扩展 |
| Session | `internal/session/` | 会话生命周期：创建、状态、TTL、清理 | 246 | 383 | **Clean** | 清晰的会话状态管理 |
| Config | `internal/config/` | 配置管理：加载、合并、热更新 | 621 | 581 | **Clean** | 近期重构过（1180 行 diff），当前结构良好 |
| Notify | `internal/notify/` | 通知系统：send、request、respond | 231 | 214 | **Clean** | 轻量通知管道 |
| Plan | `internal/plan/` | Plan 模型：审批工作流前计划 | 283 | 368 | **Clean** | 独立模块 |
| Task | `internal/task/` | 任务追踪：Task 状态机、Step 步骤、Event 日志；支持 install/uninstall/check/cache_clear 任务类型 | 126 | 0 | **Clean** | 新模块，in-memory Store，无持久化 |
| Run | `internal/run/` | 长期资源索引：Run 模型、Policy 校验、in-memory Store；5 个 capability（create/list/info/stop/updatePolicy） | 210 | 155 | **Clean** | 新模块，in-memory Store with RWMutex；opaque metadata；状态同步自 ProcessManager |
| Logs | `internal/logs/` | 日志与审计：tail、query、export、rotate | 414 | 577 | **Clean** | 审计日志分离 |

### 1.2 System UI Plugin Host 分布

| Area | Path | Lines | Responsibility | Cleanliness | Notes |
|---|---|---|---|---|---|
| Plugin Host | `app/console/plugin-host/` | ~1000 | 插件渲染宿主、组件注册、manifest 桥接 | **Acceptable Debt** | `host-component-registry.tsx` (311 行改动中) 成长快 |
| Plugin Manager | `app/console/system-ui/views/plugin-manager.tsx` | ~600 | 插件列表、搜索、过滤、enable/disable | **Acceptable Debt** | 5 种页面状态处理得当，但与其他视图耦合度待观察 |
| Plugin Detail | `app/console/system-ui/views/plugin-detail.tsx` | ~900 | 单插件详情：8 个 tab（概览/环境/权限/文件/缓存/设置/日志/历史） | **Acceptable Debt** | 8 tab 内聚在单文件，若继续加 tab 需拆分 |
| Manifest Types | `app/console/plugin-host/plugin-manifest-types.ts` | ~130 | TS 侧 manifest 类型定义 | **Clean** | 与 Go 侧 `pluginmanifest/manifest.go` 独立演进，无共享 schema |
| Test Harness | `app/test-go-core/page.tsx` | ~80 | E2E 测试专用页，连接 Go Core WS | **Clean** | 独立测试页，不污染主 app |

### 1.3 边界清晰度判定

- **边界清楚**: types ↔ protocol ↔ dispatcher ↔ server 链。每一层职责单一，接口注入。
- **已解决**: `plugin_cmds.go` (1027 行) 已拆分为 `plugin_install_cmds.go`、`plugin_files_cmds.go`、`plugin_cache_cmds.go`、`plugin_manage_cmds.go`、`plugin_permission_cmds.go`、`task_cmds.go`，每个文件职责明确。
- **逻辑混合**: `executor/registry.go` 的 `Deps` struct 注入了 8+ 个服务（新增 TaskStore、PlanStore），反映了 executor 是系统中枢，但缺乏子模块边界。
- **Phase 1 债务可接受**: Windows PTY stub (20 行)、`manifest/json.go` (8 行空文件)、`pluginmanifest/parser.go` (62 行) — 都是占位符或薄包装，不影响扩展。
- **如果继续扩展会变架构问题**:
  - `Deps` 继续加字段 → 违反接口隔离原则
  - TS/Go 双份 manifest 类型继续独立演进 → 语义漂移
  - executor 无平台感知 → capability 在多平台上静默失败

---

## 2. Capability Inventory

### 2.1 完整能力清单

| Capability | Namespace | Handler/File | Current Status | Tests | Notes |
|---|---|---|---|---|---|
| `session.create` | session | `session_cmds.go` | **implemented** | Yes | 创建会话 |
| `session.destroy` | session | `session_cmds.go` | **implemented** | Yes | 销毁会话 |
| `session.list` | session | `session_cmds.go` | **implemented** | Yes | 列出会话 |
| `session.info` | session | `session_cmds.go` | **implemented** | Yes | 会话详情 |
| `session.get` | session | `session_cmds.go` | **implemented** | Yes | 获取指定会话 |
| `session.stop` | session | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `session.events` | session | `session_events.go` | **partial** | No | 事件流，handler 为 stub |
| `session.replay` | session | — | **not declared** | No | 通过 stream.replay 覆盖 |
| `stream.subscribe` | stream | `stream_cmds.go` | **implemented** | Yes | 订阅流事件 |
| `stream.write` | stream | `stream_cmds.go` | **implemented** | Yes | 写入流（stdin） |
| `stream.list` | stream | `stream_cmds.go` | **implemented** | Yes | 列出活跃流 |
| `stream.replay` | stream | `history_cmds.go` | **implemented** | Yes | 历史回放 |
| `stream.tail` | stream | `history_cmds.go` | **implemented** | Yes | 历史尾部查询 |
| `process.spawn` | process | `process_cmds.go` | **implemented** | Yes | 创建进程，Unix PTY / Windows pipe |
| `process.signal` (tree=true) | process | `process_cmds.go` | **partial (R11)** | Yes | OS-level best-effort tree termination. Windows: taskkill /T /F (kernel-mode, no enumeration). Unix: /proc traversal with pgrep -P fallback. Windows childrenOf via wmic is UNRELIABLE (partial). tree=false behavior unchanged. |
| `process.resize` | process | `process_cmds.go` | **implemented** | Yes | 调整 PTY 窗口（Windows no-op） |
| `process.list` | process | `process_cmds.go` | **implemented** | Yes | 列出进程 |
| `process.kill` | process | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `process.status` | process | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `run.create` | run | `run_cmds.go` | **implemented** | Yes | 创建长期资源记录并 spawn 进程，共享 spawnManagedProcess helper |
| `run.list` | run | `run_cmds.go` | **implemented** | Yes | 列出 run（支持 kind/pluginId/state 过滤），自动从 ProcessManager 同步状态 |
| `run.info` | run | `run_cmds.go` | **implemented** | Yes | 获取 run 详情 + 进程快照（pid/state/exitCode/command） |
| `run.stop` | run | `run_cmds.go` | **implemented** | Yes | 停止 run（向进程发 signal），更新 run 状态为 stopped |
| `run.updatePolicy` | run | `run_cmds.go` | **implemented** | Yes | 更新 run policy（onDisconnect/onCoreShutdown/persistHistory） |
| `fs.read` | fs | `fs_cmds.go` | **implemented** | Yes | 读文件 |
| `fs.write` | fs | `fs_cmds.go` | **implemented** | Yes | 写文件 |
| `fs.list` | fs | `fs_cmds.go` | **implemented** | Yes | 列目录 |
| `fs.mkdir` | fs | `fs_cmds.go` | **implemented** | Yes | 创建目录 |
| `fs.remove` | fs | `fs_cmds.go` | **implemented** | Yes | 删除文件/目录 |
| `fs.rename` | fs | `fs_cmds.go` | **implemented** | Yes | 重命名 |
| `fs.delete` | fs | — | **not declared** | No | 与 fs.remove 语义重复（capabilities.go 两者都列但 executor 仅注册 remove） |
| `fs.stat` | fs | `fs_cmds.go` | **implemented** | Yes | 文件状态（size、mtime、mode） |
| `env.get` | env | `env_cmds.go` | **implemented** | Yes | 获取环境变量 |
| `env.set` | env | `env_cmds.go` | **implemented** | Yes | 设置环境变量 |
| `env.list` | env | `env_cmds.go` | **implemented** | Yes | 列出环境变量 |
| `env.unset` | env | `env_cmds.go` | **implemented** | Yes | 删除环境变量 |
| `env.which` | env | `env_extra.go` | **implemented** | Yes | 查找二进制路径（CLI 检测核心） |
| `env.checkBinary` | env | `env_extra.go` | **implemented** | Yes | 检查二进制是否可用 |
| `env.home` | env | `env_extra.go` | **implemented** | Yes | 获取 HOME 目录 |
| `env.cwd` | env | `env_extra.go` | **implemented** | Yes | 获取当前工作目录 |
| `env.vars` | env | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `env.info` | env | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `system.info` | system | `system_cmds.go` | **implemented** | Yes | 系统信息 |
| `plugin.list` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 列出插件 |
| `plugin.get` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 获取插件 |
| `plugin.info` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 插件详情 |
| `plugin.status` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 插件状态 |
| `plugin.enable` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 启用插件 |
| `plugin.disable` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 禁用插件 |
| `plugin.check` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 环境检查 |
| `plugin.install` | plugin | `plugin_install_cmds.go` | **implemented** | Yes | 生成安装计划（步骤、风险、planId），存入 PlanStore |
| `plugin.install.plan` | plugin | `plugin_install_cmds.go` | **implemented** | Yes | 同 plugin.install，共享 pluginInstallPlan handler |
| `plugin.install.execute` | plugin | `plugin_install_cmds.go` | **implemented** | Yes | 验证已批准计划后 dry-run 执行步骤，记录历史。DRY-RUN：不执行真实系统命令 |
| `plugin.uninstall` | plugin | `plugin_install_cmds.go` | **implemented** | Yes | 清理 PlanStore 中注册文件和安装计划，记录历史。DRY-RUN：不删除真实文件 |
| `plugin.files.list` | plugin | `plugin_files_cmds.go` | **implemented** | Yes | 列出插件文件 |
| `plugin.files.register` | plugin | `plugin_files_cmds.go` | **implemented** | Yes | 存储文件路径到 PlanStore，供卸载流程使用 |
| `task.list` | task | `task_cmds.go` | **implemented** | Yes | 返回 TaskStore 中所有任务 |
| `task.info` | task | `task_cmds.go` | **implemented** | Yes | 根据 taskId 返回单个任务详情 |
| `plugin.cache.list` | plugin | `plugin_cache_cmds.go` | **implemented** | Yes | 缓存列表 |
| `plugin.cache.info` | plugin | `plugin_cache_cmds.go` | **implemented** | Yes | 缓存信息 |
| `plugin.cache.clear` | plugin | `plugin_cache_cmds.go` | **stub** | Yes | 批量清除（无 plan），返回 `not_implemented` |
| `plugin.cache.clear.plan` | plugin | `plugin_cache_cmds.go` | **implemented** | Yes | 生成清除计划，返回 planId |
| `plugin.cache.clear.execute` | plugin | `plugin_cache_cmds.go` | **implemented** | Yes | 执行清除缓存，记录历史 |
| `plugin.permissions.list` | plugin | `plugin_permission_cmds.go` | **implemented** | Yes | 权限列表 |
| `plugin.permissions.grant` | plugin | `plugin_permission_cmds.go` | **implemented** | Yes | 授权（高风险需审批） |
| `plugin.permissions.revoke` | plugin | `plugin_permission_cmds.go` | **implemented** | Yes | 撤销授权 |
| `plugin.config.get` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 获取配置 |
| `plugin.config.set` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 设置配置 |
| `plugin.config.schema` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 配置 schema |
| `plugin.history` | plugin | `plugin_manage_cmds.go` | **implemented** | Yes | 插件操作历史 |
| `node.list` | node | `node_cmds.go` | **implemented** | Yes | 节点列表 |
| `node.info` | node | `node_cmds.go` | **implemented** | Yes | 节点信息 |
| `node.health` | node | `node_cmds.go` | **implemented** | Yes | 节点健康 |
| `node.disconnect` | node | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `notify.send` | notify | `notify_cmds.go` | **implemented** | Yes | 发送通知 |
| `notify.request` | notify | `notify_cmds.go` | **implemented** | Yes | 请求审批 |
| `notify.respond` | notify | `notify_cmds.go` | **implemented** | Yes | 响应审批 |
| `config.get` | config | — | **not declared** | No | 全局配置获取，未注册 handler |
| `config.set` | config | — | **not declared** | No | 全局配置设置，未注册 handler |
| `config.list` | config | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `config.watch` | config | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `logs.tail` | logs | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `logs.query` | logs | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `logs.export` | logs | — | **not declared** | No | 仅在 KnownCapabilities 存在 |
| `session.history.getPolicy` | session.history | `history_cmds.go` | **implemented** | Yes | 获取历史策略 |
| `session.history.setPolicy` | session.history | `history_cmds.go` | **implemented** | Yes | 设置历史策略 |
| `session.history.stats` | session.history | `history_cmds.go` | **implemented** | Yes | 历史统计 |
| `session.history.list` | session.history | `history_cmds.go` | **implemented** | Yes | 列出历史 |
| `session.history.clear.plan` | session.history | `history_cmds.go` | **implemented** | Yes | 清除历史计划 |
| `session.history.clear.execute` | session.history | `history_cmds.go` | **implemented** | Yes | 执行清除历史 |
| `network.connect` | network | `network_cmds.go` | **declared (R12)** | Yes | 声明 + 策略/审计边界。声明为 DangerousCapability（默认 deny），`plugin.check` 返回 `missing_grant`。桌面平台 OS 子进程可自行发起网络连接，但 Core 不拦截/代理流量 |
| `network.listen` | network | `network_cmds.go` | **declared (R12)** | Yes | 声明 + 策略/审计边界。桌面平台完整支持（CLI 子进程可绑定端口）。声明为 DangerousCapability，`plugin.check` 返回 `missing_grant` |
| `network.dns` | network | `network_cmds.go` | **declared (R12)** | Yes | 声明 + 策略/审计边界。桌面平台完整支持（OS 级别 DNS 解析）。声明为 DangerousCapability，`plugin.check` 返回 `missing_grant` |
| `network.proxy` | network | `network_cmds.go` | **declared (R12), partial** | Yes | 声明为 `not_implemented`。无 Core 管理的代理/隧道。声明为 DangerousCapability。移动端不支持 |
| `network.fetch` | network | `network_cmds.go` | **declared (R12), partial** | Yes | 声明为 `not_implemented`。无 Core 管理的 HTTP 客户端。声明为 DangerousCapability。移动端不支持 |
| `approval.*` | approval | — | **not declared** | No | 审批流程，设计文档已计划但未实现 |
| `task.*` | task | `task_cmds.go` | **partial** | Yes | `task.list` 和 `task.info` 已实现；TaskStore 为 in-memory；Task 类型覆盖 install/uninstall/check/cache_clear |
| `audit.*` | audit | — | **not declared** | No | 审计日志查询，设计文档已计划但未实现 |
| `action.*` | action | — | **not declared** | No | 动作/命令注册，设计文档已计划但未实现 |

### 2.2 状态统计

| Status | Count |
|---|---|
| **implemented** | 73 |
| **stub** | 1 (`plugin.cache.clear` — 仅 bulk clear 无 plan 仍为桩) |
| **partial** | 2 (`session.events`, `task.*`) |
| **not declared** (仅在 KnownCapabilities，未注册 executor handler) | 12 |
| **not declared** (完全缺失，不在 KnownCapabilities) | 3 (`approval.*`, `audit.*`, `action.*`) |
| **declared + partial (not_implemented)** | 2 (`network.proxy`, `network.fetch`) |
| **declared (declaration/policy only)** | 3 (`network.connect`, `network.listen`, `network.dns`) |

**总计**: executor `registerDefaults()` 注册 81 个 capability（73 完整实现 + 1 stub + 2 partial + 5 network declared），KnownCapabilities 声明 89 个设计能力。

**变化说明**: Round 7: 5 个原 stub capability（`plugin.install`, `plugin.install.plan`, `plugin.install.execute`, `plugin.uninstall`, `plugin.files.register`）已实现为 dry-run 框架；新增 `task.list` 和 `task.info`。Round 8: 新增 5 个 run 能力（`run.create`, `run.list`, `run.info`, `run.stop`, `run.updatePolicy`）+ `internal/run/` 包。Round 12: 新增 5 个 `network.*` capability 声明（`network.connect`, `network.listen`, `network.dns`, `network.proxy`, `network.fetch`）——全部为 DangerousCapability，桌面平台 connect/listen/dns 为 declaration 级别 full，proxy/fetch 为 partial (not_implemented)，移动端全部 unsupported。

---

## 3. Multi-Platform Support Matrix

### 3.1 Process

| Capability | Windows Desktop | Linux Server | macOS | Mobile/Browser | Current Implementation | Gap |
|---|---|---|---|---|---|---|
| `process.spawn` | **partial** (pipe fallback) | **full** (PTY) | **full** (PTY) | **unsupported** | `pty_unix.go` / `pty_windows.go` | Windows 无 PTY，用 pipe 代替；移动端无本地进程 |
| `process.signal` | **partial** | **full** | **full** | **unsupported** | `manager.go` Signal() | Windows signal 语义受限 |
| `process.resize` | **no-op** | **full** | **full** | **unsupported** | `pty_windows.go` no-op | Windows 需要 ConPTY 支持 resize |
| `process.list` | **full** | **full** | **full** | **unsupported** | `manager.go` List() | 平台无关 |
| OS subprocess tree | **partial** (taskkill /T /F, no enum) | **partial** (/proc traversal) | **partial** (/proc traversal) | **unsupported** | `process_cmds.go` signal handler | R11: best-effort tree termination. Windows uses taskkill /T /F (kernel-mode, no wmic dependency). Unix enumerates via pgrep then signals. tree=false behavior unchanged (except Windows where all signals are /T /F). |
| Background/detached process | **not implemented** | **not implemented** | **not implemented** | **not implemented** | 无 | 所有平台均缺失 |

### 3.2 PTY / Stream

| Capability | Windows Desktop | Linux Server | macOS | Mobile/Browser | Current Implementation | Gap |
|---|---|---|---|---|---|---|
| `stream.subscribe` | **full** | **full** | **full** | **full** | wsconn + history | WebSocket 可在移动端订阅 |
| `stream.write` | **full** | **full** | **full** | **full** | 平台无关 | 无 |
| `stream.replay` | **full** | **full** | **full** | **full** | history store replay | 无 |
| `stream.tail` | **full** | **full** | **full** | **full** | history store tail | 无 |
| PTY support | **partial** (pipe) | **full** (creack/pty) | **full** (creack/pty) | **unsupported** | build-tag 分离 | Windows 需 ConPTY |
| stdin redaction | **full** | **full** | **full** | N/A | history store Record() | 双层深度防御已实现 |

### 3.3 Filesystem

| Capability | Windows Desktop | Linux Server | macOS | Mobile/Browser | Current Implementation | Gap |
|---|---|---|---|---|---|---|
| `fs.read` | **full** | **full** | **full** | **unsupported** | `os.ReadFile` | 移动端无本地 FS 访问 |
| `fs.write` | **full** | **full** | **full** | **unsupported** | `os.WriteFile` | 同上 |
| `fs.list` | **full** | **full** | **full** | **unsupported** | `os.ReadDir` | 同上 |
| `fs.remove` | **full** | **full** | **full** | **unsupported** | `os.RemoveAll` | 同上 |
| `fs.mkdir` | **full** | **full** | **full** | **unsupported** | `os.MkdirAll` | 同上 |
| `fs.rename` | **full** | **full** | **full** | **unsupported** | `os.Rename` | 同上 |
| path constraints | **not implemented** | **not implemented** | **not implemented** | N/A | 无 | Manifest 可声明路径约束但 Core 未校验 |

### 3.4 Environment

| Capability | Windows Desktop | Linux Server | macOS | Mobile/Browser | Current Implementation | Gap |
|---|---|---|---|---|---|---|
| `env.get` | **full** | **full** | **full** | **partial** | `os.Getenv` | 移动端仅有 JS 环境 |
| `env.set` | **full** | **full** | **full** | **unsupported** | `os.Setenv` | 移动端无持久环境 |
| `env.list` | **full** | **full** | **full** | **partial** | `os.Environ` | 同上 |
| `env.unset` | **full** | **full** | **full** | **unsupported** | `os.Unsetenv` | 同上 |
| `env.which` | **full** | **full** | **full** | **unsupported** | `os.LookPath` | 移动端无 PATH |
| `env.checkBinary` | **full** | **full** | **full** | **unsupported** | `os.LookPath` | 同上 |
| `env.home` | **full** | **full** | **full** | **partial** | `os.UserHomeDir` | 移动端可能返回空 |
| `env.cwd` | **full** | **full** | **full** | **partial** | `os.Getwd` | 移动端受限 |

### 3.5 Plugin Management

| Capability | Windows Desktop | Linux Server | macOS | Mobile/Browser | Notes |
|---|---|---|---|---|---|
| `plugin.list/get/info/status` | **full** | **full** | **full** | **full** | 平台无关 |
| `plugin.enable/disable` | **full** | **full** | **full** | **full** | 平台无关 |
| `plugin.check` | **full** | **full** | **full** | **full** | 平台无关 |
| `plugin.permissions.*` | **full** | **full** | **full** | **full** | 平台无关 |
| `plugin.config.*` | **full** | **full** | **full** | **full** | 平台无关 |
| `plugin.cache.*` | **full** | **full** | **full** | **full** | 平台无关 |
| `plugin.history` | **full** | **full** | **full** | **full** | 平台无关 |
| `plugin.install.*` | **implemented** (dry-run) | **implemented** (dry-run) | **implemented** (dry-run) | **implemented** (dry-run) | 安装/卸载为 dry-run 框架；PlanStore in-memory |
| `plugin.files.register` | **implemented** | **implemented** | **implemented** | **implemented** | 文件路径存储到 PlanStore |
| `task.*` | **implemented** | **implemented** | **implemented** | **implemented** | task.list/task.info；TaskStore in-memory |

### 3.6 Network

> **Important**: Core does NOT sandbox arbitrary OS child process network traffic. The `network.*` capabilities provide **declaration, policy, and audit boundaries only**. OS child processes (e.g., Claude CLI, npm, git) can make network calls at the OS level without going through any Core proxy or interception layer. The capability declarations exist so the permission system can require explicit grants, log audit events, and present permission prompts -- but they do not enforce network isolation.

| Capability | Windows Desktop | Linux Server | macOS | Mobile/Browser | Current Implementation | Gap |
|---|---|---|---|---|---|---|
| `network.connect` | **full** (declaration) | **full** (declaration) | **full** (declaration) | **unsupported** | 声明为 DangerousCapability。桌面平台 OS 子进程可自行发起出站连接，Core 不拦截/代理流量。`plugin.check` 返回 `missing_grant` | 无 Core 代理/沙箱。移动端不支持 |
| `network.listen` | **full** (declaration) | **full** (declaration) | **full** (declaration) | **unsupported** | 声明为 DangerousCapability。桌面平台 OS 子进程可绑定端口。`plugin.check` 返回 `missing_grant` | 移动端不支持 |
| `network.dns` | **full** (declaration) | **full** (declaration) | **full** (declaration) | **unsupported** | 声明为 DangerousCapability。桌面平台 OS 级别 DNS 解析。`plugin.check` 返回 `missing_grant` | 移动端不支持 |
| `network.proxy` | **partial** (not_implemented) | **partial** (not_implemented) | **partial** (not_implemented) | **unsupported** | 声明为 DangerousCapability。无 Core 管理的代理/隧道实现。`plugin.check` 返回 `unsupported_capability` | 所有平台均缺失 Core 代理 |
| `network.fetch` | **partial** (not_implemented) | **partial** (not_implemented) | **partial** (not_implemented) | **unsupported** | 声明为 DangerousCapability。无 Core 管理的 HTTP 客户端。`plugin.check` 返回 `unsupported_capability` | 所有平台均缺失 Core fetch 实现 |

### 3.7 Summary — Platform Gap Count

| Platform | Full | Partial | Unsupported | Not Implemented | Not Declared |
|---|---|---|---|---|---|
| Windows Desktop | 44 | 8 | 0 | 0 | 16 |
| Linux Server | 50 | 2 | 0 | 0 | 16 |
| macOS | 50 | 2 | 0 | 0 | 16 |
| Mobile/Browser | 23 | 4 | 21 | 0 | 16 |

---

## 4. Desired Core Architecture

### 4.1 三个概念必须分离

当前系统中 "capability 是否可用" 由三层隐式信息混合决定：
1. 是否在 executor 注册了 handler
2. 平台 Build Tag 是否正确
3. 权限注册表是否有条目

这导致调用方无法在调用前知道一个 capability 是否可用，只能调用并处理错误。对于跨平台插件（如 Claude Code），这是不可接受的——插件需要在启动时就确定哪些能力当前平台支持。

**建议的三层分离:**

```
Declared        →  Core 认识这个 capability（在 KnownCapabilities 中）
                   →  Plugin manifest 可以声明它的权限
Supported       →  当前 runtime/platform 支持这个 capability
                   →  Windows/Linux/macOS/mobile 各有不同
Granted         →  当前 actor/plugin 有权限调用
                   →  allow/deny/ask + 约束 + 过期

三者独立判断:
  Declared but Unsupported  → process.spawn on mobile → 返回 ErrNotSupported
  Supported but Not Granted  → fs.delete on Windows, plugin 未授权 → 返回 ErrNotGranted
  Granted but Dep Missing   → claude-code 有 process.spawn grant 但 claude CLI 未安装 → 返回 ErrDependencyMissing
```

### 4.2 建议的模块结构（不实现）

```
go-core/internal/capability/
  registry.go       // 从 pluginmanifest/capabilities.go 迁移 KnownCapabilities
                    // 成为能力声明的单一真相源
  support.go        // RuntimePlatform 检测 + 每平台的能力支持标记
                    // 函数: IsCapabilitySupported(cap, platform) bool
  matrix.go         // 完整的能力×平台矩阵
                    // 数据驱动，不硬编码
  resolver.go       // CheckCapability(cap, pluginCtx) → Declared×Supported×Granted
                    // 组合 capability registry + permission checker + platform info

go-core/internal/platform/
  platform.go       // RuntimePlatform 枚举
                    // func CurrentPlatform() Platform
                    // func IsWindows() bool, IsLinux() bool, IsDarwin() bool
  capabilities_platform.go  // 平台特性检测
                            // func HasPTY() bool, HasSubprocessTree() bool
```

### 4.3 迁移顺序

1. **Phase A**: 创建 `internal/platform/` 包，提供 `CurrentPlatform()` 基础能力（最小侵入，可用 Go build tags）
2. **Phase B**: 在 **dispatcher** 层增加 platform check（pre-execution 阶段），而非嵌入 executor handler 中。如果 capability 已声明但当前平台不支持，在 dispatcher 处返回结构化错误，避免每个 handler 单独处理平台逻辑
3. **Phase C**: 将 `KnownCapabilities` 从 `pluginmanifest/` 迁移到 `internal/capability/`，增加 platform support 标记
4. **Phase D**: 在 Plugin Manager UI 中根据 capability resolver 结果展示每个插件的平台兼容性

---

## 5. Claude Code Plugin Kernel Readiness

### 5.1 需求对照

| Claude Code Requirement | Required Core Capability | Current Status | Platform Gap | Priority |
|---|---|---|---|---|
| CLI detection (`which claude`) | `env.which` / `env.checkBinary` | **implemented** | 无 | — |
| Process spawn (`claude` subprocess) | `process.spawn` | **implemented** | Windows partial (pipe) | **P0** |
| PTY interactive session | PTY support | **implemented** (Unix) **partial** (Win) | Windows ConPTY 缺失。**注意**: 完整 Windows 终端体验需要 ConPTY，但 Linux-first Claude Code skeleton 不应被此项完全阻塞 | **P0** (Linux skeleton 不依赖) |
| Stream write (stdin) | `stream.write` | **implemented** | 无 | — |
| Stream read (stdout/stderr) | `stream.subscribe` | **implemented** | 无 | — |
| Stdin redaction | 双层深度防御 | **implemented** | 无 | — |
| Stdout/stderr history | `session.history.*` | **partial** | 无 | **P1** |
| Replay/tail | `stream.replay` / `stream.tail` | **implemented** | 无 | — |
| OS subprocess tree tracking | 进程树追踪 | **partial (R11)** best-effort | Windows: taskkill /T /F (kernel-mode, no children enumeration). Unix: pgrep-based /proc traversal. Windows childrenOf/wmic is unreliable. tree=false is also /T /F on Windows. | — |
| Process kill (SIGTERM/SIGKILL) | `process.signal` / `process.kill` | **partial** | Windows signal 受限 | **P1** |
| Background/detached process | detached process | **implemented** (via run.create + keep_running policy) | 所有平台 | — |
| File read/write/list | `fs.*` | **implemented** | 无 | — |
| Permission approval (`ask` grant) | `notify.request` + `permission.*` | **implemented** | 无 | — |
| Network outbound (HTTP API calls) | `network.*` | **declared (R12)** — 5 capabilities declared with DangerousCapability status; desktop connect/listen/dns full (declaration); proxy/fetch partial (not_implemented)。Core 不拦截 OS 子进程流量。移动端全部 unsupported | 所有平台 | **P1** (declaration done, Core proxy/sandbox pending) |
| Cache management (`~/.claude`) | `plugin.cache.*` | **implemented** | 无 | — |
| Config management | `plugin.config.*` | **implemented** | `config.set` not declared | **P2** |
| Multiple sessions/conversations | `session.*` | **implemented** | 无 | — |
| Long-running session (TTL > 1h) | `session.*` | **implemented** | TTL 可配置 | — |
| UI surface integration | Plugin Host + TerminalView | **implemented** | 无 | — |
| Plugin install lifecycle | `plugin.install`, `plugin.install.plan`, `plugin.install.execute`, `plugin.uninstall`, `plugin.files.register` | **implemented** (dry-run) | Dry-run only; PlanStore in-memory; real package manager integration is NEXT step | **P1** |
| Plugin history | `plugin.history` | **implemented** | 内存模式 | **P2** |
| Task tracking | `task.list`, `task.info` | **implemented** | TaskStore in-memory | **P2** |
| Cross-node execution | `node.*` + topology | **implemented** | 无 | — |
| Mobile client viewing/control | stream.subscribe over WS | **implemented** | 移动端可订阅 | **P2** |

### 5.2 Ready or Not?

| Priority | Count | Items |
|---|---|---|
| **P0** (必须实现) | 1 | Windows PTY support（Linux-first skeleton 不依赖） |
| **P1** (应该实现) | 3 | `network.*` Core proxy/sandbox（声明已完成 R12，策略/审计边界已建立）、Real package manager execution（install commands via process.spawn）、`process.kill` + Windows signal |
| **P2** (锦上添花) | 4 | Persistent plan/task stores、disk-mode plugin history、mobile client control、path constraints enforcement |

**结论**: 当前离能搭 Claude Code 插件差 **1 个 P0 项**——Windows PTY 需 ConPTY 支持（Linux-first Claude Code skeleton 可先绕过）。`network.*` 已在 R12 (2026-05-21) 完成声明（5 个 capability：connect/listen/dns full declaration + proxy/fetch partial not_implemented），权限/审计边界已建立，但 Core 仍不拦截 OS 子进程网络流量。OS subprocess tree tracking 已在 R11 (2026-05-21) 以 best-effort 方式实现：`process.signal(tree=true)` 和 `run.stop(tree=true)` 终止完整 OS 进程树（Windows: taskkill /T, Unix: /proc traversal with pgrep -P fallback）。CLI 检测（`env.which`/`env.checkBinary`）已实现，install lifecycle 已实现为 dry-run 框架（plan/approve/execute/uninstall/files.register），审批工作流通过 dispatcher Planner 接口和 `notify.respond` 已连接。预计 P0 工作 1 周，P1 + P2 再 1-2 周。

---

## 6. Architecture Cleanliness Verdict

| Area | Verdict | Reason |
|---|---|---|
| Dispatcher | **Clean** | 接口注入，8 步链清晰，196 行适中 |
| Executor Registry | **Acceptable Phase 1 Debt** | 注册模式对，但 `Deps` God-object（8+ 服务注入）+ 无平台感知；`plugin_cmds.go` 已成功拆分为 6 个文件 |
| Process Manager | **Acceptable Phase 1 Debt** | Unix 端完整，Windows stub 可接受，缺状态机 |
| Permission Checker | **Acceptable Phase 1 Debt** | grant 模型完整（allow/deny/ask + 约束 + 过期 + 溯源），但路径约束强制执行仍浅（Phase 0 仅有 `path` 字段前缀匹配，无通配符/glob 解析） |
| History Store | **Clean** | 环形缓冲区设计合理，redact 策略正确 |
| Plugin Manifest (Go) | **Acceptable Phase 1 Debt** | 11 文件组织良好，但 validate.go/yaml.go 可拆 |
| Plugin Manifest Bridge (UI) | **Risky** | TS/Go 双份类型独立演进，无共享 schema，语义漂移风险 |
| Capability Registry (KnownCapabilities) | **Needs Refactor Before Expansion** | 与 executor `registerDefaults()` 手动同步，已有测试防漂移但架构不干净 |
| Platform Support | **Risky** | 无 Platform 概念，无 capability×platform 矩阵，无运行时支持检测 |
| Test Portability | **Needs Refactor Before Expansion** | E2E 测试依赖 `cat`/`sleep`/`echo` 等 Unix 命令，Windows 上不可运行 |
| Server | **Clean** | 合理的组装枢纽 |
| Task Store | **Clean** | 新模块：Task 状态机 + Step + Event；in-memory，无持久化 |
| Plan Store (in executor) | **Acceptable Phase 1 Debt** | PlanStore 在 executor 包内（非独立包），in-memory，无 TTL；plan 批准/拒绝通过 dispatcher Planner 接口和 notify.respond 已连接 |
| Install Lifecycle (dry-run) | **Acceptable Phase 1 Debt** | 安装/卸载/文件注册已从 stub 升级为 dry-run 框架；审批工作流贯穿 dispatcher Plan-Before-Apply 步骤；错误码 PLAN_REQUIRED/APPROVAL_REQUIRED/APPROVAL_DENIED 已定义并返回 |

### 6.1 Cleanliness Heat Map

```
Clean:                    7 个 (types, protocol, dispatcher, history, server, task, logs)
Acceptable Phase 1 Debt:  7 个 (executor registry, process, permission, pluginmanifest, topology, plan/install lifecycle, plan store)
Needs Refactor:           2 个 (capability registry, test portability)
Risky:                    2 个 (plugin manifest bridge UI, platform support)
```

---

## 7. Recommended Execution Order

### Step 1: Fix Windows Go Test Portability

- **目标**: 让 `go test ./...` 在 Windows 上全绿（当前依赖 Unix 命令的测试在 Windows 上不可运行）
- **改动范围**: `internal/executor/executor_test.go`、`internal/process/manager_test.go`、所有使用 `cat`/`sleep`/`echo`/`sh` 的测试
- **方案**: 用 Go helper 函数替代外部命令。例如 `createTempBinary` 已存在，继续扩展此模式；将 `echo E2E_TERMINAL_OK` 改为写 Go 生成的 helper 程序
- **验证**: `go test ./...` 在 Windows 上通过
- **不应做**: 不要添加 `skipOnWindows` build tag（这会让测试永久不可靠）；不要引入外部依赖

### Step 2: Introduce Capability Support Resolver

- **目标**: 实现 Declared × Supported × Granted 三层分离
- **改动范围**:
  - 新建 `internal/platform/platform.go`（~30 行）：`CurrentPlatform()` + 枚举
  - 新建 `internal/capability/support.go`（~80 行）：capability × platform 矩阵
  - 修改 `internal/dispatcher/`：在 pre-execution 阶段增加 platform check（不在 executor handler 中嵌入平台逻辑）
- **验证**: `go test ./...` + 新增针对矩阵的单元测试
- **不应做**: 不要大规模迁移 `KnownCapabilities`（Phase C 后面再搞）；不要改 UI

### Step 3: Split plugin_cmds.go ✅ DONE

- **目标**: 防止 1027 行的文件继续膨胀
- **已完成**: `internal/executor/plugin_cmds.go` → 已拆分为:
  - `plugin_install_cmds.go`（install, install.plan, install.execute, uninstall, PlanStore）
  - `plugin_cache_cmds.go`（cache.list, cache.info, cache.clear, cache.clear.plan, cache.clear.execute）
  - `plugin_permission_cmds.go`（permissions.list, permissions.grant, permissions.revoke）
  - `plugin_files_cmds.go`（files.list, files.register）
  - `plugin_manage_cmds.go`（list, get, info, status, enable, disable, check, history, config.get, config.set, config.schema）
  - `task_cmds.go`（task.list, task.info）
  - 同时将 install/uninstall/files.register 从 stub 升级为 dry-run 实现
  - 审批工作流通过 dispatcher Planner 接口 + notify.respond 已连接
- **验证**: `go test ./...` 通过

### Step 4: Add Platform Support Matrix Docs/Tests

- **目标**: 让跨平台支持状态显式化
- **改动范围**: `internal/capability/matrix.go` + 本文档的持续更新
- **方案**: 每个 capability 在矩阵中标记 `full`/`partial`/`unsupported`/`not implemented`
- **验证**: 新测试验证矩阵与 executor 注册一致性
- **不应做**: 不要改已有 capability 行为

### Step 5: Implement OS-Level Subprocess Tree Tracking ✅ DONE (R11, 2026-05-21)

- **目标**: Claude Code P0 — 追踪 `claude` 进程及其子进程
- **改动范围**: `internal/process/manager.go` + 平台文件
- **方案**: Windows 用 `taskkill /T`，Unix 用 `/proc` 遍历（pgrep -P 作为 fallback）
- **前置依赖**: Step 2（capability support resolver）— 需要在矩阵中标记此能力
- **验证**: `go test ./...` + E2E 测试 spawn 嵌套进程后 verify 进程树
- **不应做**: 不要支持跨节点进程树（Phase 2）
- **完成状态**: 已实现 best-effort 方案。`process.signal(tree=true)` 和 `run.stop(tree=true)` 终止完整 OS 进程树。tree=false (default) 行为完全不变。所有树操作均为 best-effort：先尝试终止子进程，始终终止父进程。如果子进程枚举失败，父进程仍然被 signal。

### Step 5a: Process Tree Design Constraints (R11, 2026-05-21)

The OS-level process tree termination is **best-effort**, NOT a full process supervisor. Key design constraints:

- **Windows (PARTIAL)**: `killProcessTree` uses `taskkill /T /F` directly (kernel-mode, no wmic dependency). `childrenOf` via wmic is unreliable — may return 0 children even when children exist. Tests are marked partial on Windows when wmic enumeration fails. `signalByPID` always uses `/T /F` (Windows cannot signal a single PID without affecting children). tree=false and tree=true are therefore equivalent on Windows — this is a platform limitation, not a bug. `taskkill` operates without admin privileges and is restricted to processes owned by the same user. System-level or other-user child processes will not be terminated.
- **Unix**: Uses `/proc` traversal to enumerate child PIDs, with `pgrep -P` as fallback. If `/proc` is not mounted or the process exits mid-enumeration, child enumeration may fail.
- **If enumeration fails**: The parent process is still signaled. The operation does not fail — it warns and proceeds. This is intentional: a partial tree termination is better than no termination at all.
- **tree=false (default)**: Behavior is completely unchanged from pre-R11. Only the directly-spawned process receives the signal.
- **Core restart restore**: Still NOT supported. If Go Core restarts, run state is lost, OS processes do not survive, and previous process trees are not re-trackable.
- **Cross-node process trees**: Not supported. Tree termination applies only to the local node's process hierarchy.
- **Claude Code production**: Still NOT ready. Requires Windows PTY support (Linux-first skeleton can proceed without PTY). `network.*` capability declarations are now complete (R12) but Core does not sandbox/proxy OS child process network traffic.
- **Real package manager install**: Still dry-run only. The PlanStore, approval flow, and task tracking framework are in place but `process.spawn` is not wired to package manager commands.

### Step 6: Only Then — Claude Code Plugin Skeleton

- **目标**: 创建 `plugins/claude-code/plugin.yaml` + 最小 adapter
- **改动范围**: 仅 `plugins/claude-code/` + `app/`（UI surface）
- **不应做**: 不要改 `src/` 或 `go-core/` 的核心逻辑

---

## 8. Final Output

### A. Architecture Summary

- SessionNode 是一个 **WebSocket-first 能力执行引擎**：所有操作（会话/流/进程/文件/插件管理）统一通过 `action.request` 协议调度，由 `dispatcher` 执行 8 步链（认证→解析→权限→路由→执行→审计）。
- Core 分为 **两层 18 个包**：`pkg/` 提供零依赖的类型和协议定义，`internal/` 提供实现。边界清晰，无跨层静态导入违规。新增 `internal/task/` 包提供任务追踪。
- **权限模型是亮点**：完整的 grant 模型（allow/deny/ask + 约束 + 过期 + 溯源），已通过 dispatcher 的 8 步链强制执行。审批工作流已连接：dispatcher Plan-Before-Apply 步骤通过 Planner 接口 gating 高风险操作，`notify.respond` 提供批准/拒绝通道。
- **插件安装生命周期已实现（dry-run 框架）**：`plugin.install`/`plugin.install.plan`/`plugin.install.execute`/`plugin.uninstall`/`plugin.files.register` 全部从 stub 升级为 dry-run 实现。PlanStore 管理计划状态（pending_approval → approved/denied → executing → completed/failed），dispatcher 在 pre-execution 步骤验证计划。审批通过 `notify.respond` 传递。真实包管理器集成是下一步。
- **插件系统设计相对成熟**：manifest 规范完整（YAML 解析/校验/冲突检测）、能力声明、UI 适配器贡献——但 TS/Go 双份类型独立演进是风险点。
- **进程/流/会话设计稳健**：双层 stdin 安全策略（默认排除 + Record 替换）、环形缓冲区 replay/tail、会话 TTL 清理都已实现。
- **最大的漏洞是平台抽象缺失**：没有 `Platform` 概念，没有 `capability × platform` 支持矩阵，没有运行时支持检测——插件无法在调用前知道一个能力是否在当前平台上可用。
- **文件拆分已完成**: `plugin_cmds.go` (1027 行) 已拆分为 `plugin_install_cmds.go`、`plugin_cache_cmds.go`、`plugin_permission_cmds.go`、`plugin_files_cmds.go`、`plugin_manage_cmds.go`、`task_cmds.go`，每个文件职责明确。
- **Go Core 与 System UI 之间存在模糊带**：plugin manifest 类型在 TS 和 Go 中独立维护，无共享 schema 约束。目前两个现存插件（terminal、system-info）声明简单，尚未暴露问题，但随插件数量和复杂度增长会加速漂移。
- **E2E 测试 Windows 可移植性差**：测试中大量使用 `echo`、`cat`、`sleep` 等 Unix 命令，在 Windows 上无法运行。
- **Claude Code 就绪度 ~85%**：基础能力（session/stream/process/fs/permission/env CLI 检测）齐全，install lifecycle 已实现（dry-run），审批工作流已连接，task 追踪已就位，OS subprocess tree 已实现（R11, best-effort），`network.*` 已声明（R12, 5 capabilities with policy/audit boundaries）——仍缺 1 个 P0 能力（Windows PTY）和真实包管理器执行。

### B. Cleanliness Verdict

**当前架构还能继续，不需要立刻停下来重构。** `plugin_cmds.go` 已成功拆分，install lifecycle 已实现（dry-run），审批工作流已连接。但 2 件事必须先收口：

1. **能力 × 平台矩阵必须建立** — `Declared`/`Supported`/`Granted` 三层概念分离是跨平台插件的前提
2. **Windows 测试可移植性必须修复** — 基线不可信就没法谈 CI

另外，`Deps` God-object 继续膨胀（8+ 服务注入），需要在下一个迭代中考虑接口隔离。PlanStore 和 TaskStore 均为 in-memory，需要持久化方案才能用于生产。

### C. Capability Matrix Summary

最重要的能力缺口（按影响面排序）：

| Gap | Impact | Priority |
|---|---|---|
| `network.*` 声明完成 (R12) | 5 个 capability 已声明（connect/listen/dns full; proxy/fetch partial not_implemented）。策略/审计边界已建立，但 Core 代理/沙箱未实现，OS 子进程网络流量不受拦截 | P1 |
| OS subprocess tree | R11 (2026-05-21) 已实现 best-effort 方案：`process.signal(tree=true)` 和 `run.stop(tree=true)` 终止完整 OS 进程树。Windows: taskkill /T, Unix: /proc traversal with pgrep -P fallback。不再阻塞 Claude Code 开发。 | — |
| Windows PTY 仅有 pipe fallback | Windows 终端无 TTY 交互 | P0 |
| `process.kill` / `process.status` 未声明 | 进程生命周期管理不完整 | P1 |
| `plugin.install.*` / `plugin.uninstall` / `plugin.files.register` 已实现（dry-run） | 生命周期框架已就位，但无真实包管理器执行；PlanStore in-memory | P1 |
| `config.*`、`logs.*`、`audit.*` 未声明 | 运维面能力缺失 | P2 |

### D. Claude Code Readiness

| Priority | Status | Items |
|---|---|---|
| **P0** | 1 项缺失 | Windows PTY（Linux-first skeleton 不依赖） |
| **P1** | 4 项部分/缺失 | `network.*` Core proxy/sandbox（声明已完成 R12）、Real package manager execution、process.kill/status handler、path constraints enforcement |
| **P2** | 3 项微调 | Persistent plan/task stores、disk-mode plugin history、mobile client control |

**Install lifecycle（dry-run）和 approval workflow 已就位。OS subprocess tree 已在 R11 (2026-05-21) 以 best-effort 方式实现（`process.signal(tree=true)` / `run.stop(tree=true)`）。`network.*` 声明已在 R12 (2026-05-21) 完成（5 个 capability：connect/listen/dns full declaration + proxy/fetch partial not_implemented），权限/审计边界已建立。Linux-first skeleton 可先行（不依赖 Windows PTY）。**

### E. Next Agent Prompt

```
你必须只做以下两件事，按顺序执行。不要扩 scope。

---

Step 1: Fix Windows Go Test Portability

目标：确保 `go test ./...` 在 Windows 上全量通过。

当前问题：多个测试文件使用 Unix shell 命令（echo/cat/sleep/sh），
Windows 上不可用。

改动范围：
- go-core/internal/executor/executor_test.go
- go-core/internal/process/manager_test.go
- 其他使用外部命令的测试

方案：
1. 创建 go-core/internal/testutil/ 包，提供：
   - EchoBinary() — 生成输出指定文本的跨平台 helper 二进制
   - CatBinary() — 生成 mirror stdin 到 stdout 的 helper 二进制
   - SleepBinary() — 生成 sleep 指定秒数的 helper 二进制
2. 用 testutil helper 替换测试中的外部命令调用
3. 对于 platform assumption test（如 process/pty），
   保持 build tag 隔离但确保 Unix/Windows 都有对应的测试路径
4. 用 go build tags 且不引入 skipOnWindows

验证方式：
- Windows 上: cd go-core && go test ./... 2>&1
- Linux 上: 同样命令确保无回归

禁止：
- 不要添加 t.Skip() 在 Windows 上跳过测试
- 不要引入新的外部 Go 依赖
- 不要改任何 capability handler 的行为
- 不要加 //go:build ignore

---

Step 2: Introduce Capability Support Resolver

目标：建立 Declared × Supported × Granted 三层分离的最小子集。

改动范围（仅 Go Core）：
1. 新建 go-core/internal/platform/platform.go
   - type Platform string: "windows" | "linux" | "darwin" | "unknown"
   - func CurrentPlatform() Platform
   - 用 runtime.GOOS

2. 新建 go-core/internal/capability/support.go
   - type SupportLevel: "full" | "partial" | "unsupported"
   - func SupportLevel(capability, platform) SupportLevel
   - 数据驱动的矩阵表（Go map[string]map[Platform]SupportLevel）
   - 初始化覆盖 session/stream/process/fs/env/plugin/system 命名空间

3. 在 dispatcher 的 pre-execution 阶段增加 check:
   - 如果 capability declared（在 handlers map 中）
     但 Supported 是 "unsupported"
     → 返回结构化错误（新错误码：ErrCodeCapNotSupported）
   - 不在 executor handler 中嵌入平台逻辑

4. 新增测试：go-core/internal/capability/support_test.go
   - 验证每个 declared capability 在矩阵中有对应条目
   - 验证 process.spawn 在 windows 上是 "partial"
   - 验证 fs.read 在所有桌面平台是 "full"

验证方式：
- cd go-core && go test ./internal/capability/...
- cd go-core && go test ./...（确保无回归）

禁止：
- 不要迁移 KnownCapabilities（Phase C 以后做）
- 不要改 UI
- 不要改 permission checker
- 不要在 executor handler 内部嵌入平台逻辑（平台 check 应在 dispatcher pre-execution 统一处理）
```

选择 Step 1 的理由：测试可移植性是所有后续工作的前提——CI 跑不起来，改什么都是盲写。

选择 Step 2 的理由：平台感知是跨平台插件（Claude Code）的前提——没有它，插件在 Windows 上调用 PTY 能力只会收到晦涩的 error，而不是明确的 "unsupported on this platform"。

两个步骤互不依赖，但建议先 Step 1 再 Step 2，因为 Step 2 需要可信的测试基线来验证。
