# Plugin Platform — 验证/审查清单

> 插件平台开发、审查、审计的检查项。覆盖 manifest 校验、权限模型、生命周期、存储管理、安全合规。

---

## 1. Manifest 校验

### 1.1 格式校验

- [ ] `manifestVersion` 为 `"1"`（不支持其他版本）
- [ ] `id` 为 kebab-case，非保留 ID（`system-ui` / `sessionnode-core`）
- [ ] `core` section 存在（必选）
- [ ] 所有 ID 以 `<pluginId>.` 为前缀（NAMESPACE 规则）
- [ ] 无重复 permission ID
- [ ] capability 字符串在已知列表中
- [ ] `default` 值为 `ask` / `deny` / `allow` 之一

### 1.2 安全校验

- [ ] 危险能力（`process.spawn` / `fs.delete` / `plugin.install.execute` 等）没有 `default: allow`（除非 `trusted: true`）
- [ ] `process.spawn` / `fs.write` / `fs.delete` 的描述非空
- [ ] `fs.delete` 有路径约束且 `default` 为 `ask` 或 `deny`
- [ ] `plugin.install.execute` 对应的 task 有 `planRequired: true`
- [ ] clearable path 不指向危险系统目录（`/`、`~`、`C:\`、`System32`、`Program Files`）

### 1.3 路径校验

- [ ] entry 路径为相对路径，无 `..` 转义
- [ ] entry 路径不以 `/`、`\`、`C:` 开头
- [ ] CLI 命令数 ≤ 2000
- [ ] 路径变量 `${workspace}` / `${plugin.dir}` 等在声明中有效

---

## 2. 权限模型

### 2.1 三层交集校验

- [ ] Actor 权限包含该能力
- [ ] Plugin Grant 已授予该能力
- [ ] 目标节点策略允许该能力调用
- [ ] 三层交集非空 → 允许；任意层缺失 → DENIED

### 2.2 Grant 生命周期

- [ ] 安装后检查是否需要 Grant
- [ ] Grant UI 展示给用户（allow / deny / ask 三选）
- [ ] Grant 持久化到 config.yaml
- [ ] 每次能力调用校验 Grant
- [ ] 用户可随时撤销 Grant（通过 UI 或 CLI）

### 2.3 PluginId 防伪造

- [ ] WebSocket 连接认证时 Core 注入 pluginId
- [ ] action.request 使用连接认证的 pluginId，忽略 payload 中的
- [ ] 已注册的 pluginId 才允许通过 Dispatcher
- [ ] UI/CLI adapter 不走 Core 权限绕过

---

## 3. 生命周期

### 3.1 发现与注册

- [ ] 扫描路径含 `~/.sessionnode/plugins/*/plugin.yaml`
- [ ] 扫描路径含 `./plugins/*/plugin.yaml`
- [ ] 扫描路径含 `$SESSIONNODE_PLUGIN_PATH/*`
- [ ] 注册时检查 pluginId 冲突
- [ ] 注册后广播 `plugin.registered` 事件

### 3.2 环境检测

- [ ] local 节点独立执行 check
- [ ] VPS 节点独立执行 check
- [ ] check 记录到文件（env-checks/latest.json + history.jsonl）
- [ ] semver 约束正确比较
- [ ] optional 依赖缺失 → ok 不阻塞
- [ ] required 依赖缺失 → missing_dep

### 3.3 安装

- [ ] 安装前生成 plan（Plan Before Apply）
- [ ] Plan 包含 installId、steps、totalRisk、requiresApproval
- [ ] 用户确认 plan 后才执行 install
- [ ] 安装前执行 pre-snapshot（PATH、binary、env）
- [ ] 安装后执行 post-snapshot
- [ ] 对比快照生成 DiscoveredSideEffect
- [ ] 记录 InstallArtifact
- [ ] 写 plugin history + audit log

### 3.4 启用/禁用

- [ ] 启用 → updated installed.json + 广播 plugin.enabled
- [ ] 禁用 → updated installed.json + 广播 plugin.disabled
- [ ] 禁用时 daemon 任务停止

### 3.5 卸载

- [ ] 检查共享依赖引用计数（refCount > 0 阻止删除）
- [ ] 生成卸载计划（将删除的文件列表）
- [ ] 用户确认
- [ ] 执行卸载后标记 uninstalled（保留历史）

### 3.6 更新

- [ ] 加载新版本 Manifest
- [ ] 对比新旧 capabilities/permissions/files/caches
- [ ] 生成更新计划
- [ ] 用户确认后执行
- [ ] 更新后重新 check

---

## 4. 存储与缓存

### 4.1 文件声明

- [ ] Manifest 声明的文件路径在 Core 登记
- [ ] 运行时注册的文件路径在 Core 登记
- [ ] 安装扫描发现的副作用路径在 Core 登记
- [ ] 所有文件访问记录 pluginId/nodeId/path/action

### 4.2 缓存管理

- [ ] 缓存清理前生成 plan（Plan Before Apply）
- [ ] Plan 包含 cacheId、paths、estimatedSize、risk、requiresApproval
- [ ] 用户确认后执行清理
- [ ] 清理后重新扫描，更新缓存信息
- [ ] 写 audit log + 清理历史

### 4.3 共享依赖保护

- [ ] 共享依赖有 refCount
- [ ] 清理前检查 refCount
- [ ] refCount > 0 → 拒绝清理（或高风险提示）
- [ ] 卸载时不删除 refCount > 0 的共享依赖

### 4.4 下载管理

- [ ] 下载文件进入 `~/.sessionnode/downloads/inst_xxx/`
- [ ] 下载记录包含 url / filename / checksum / size / downloadedAt / usedBy / cleanupPolicy

---

## 5. Core API

### 5.1 Capability 调用

- [ ] 所有调用走 `action.request` 统一格式
- [ ] pluginId 由 Core 注入（非 payload）
- [ ] targetNodeId 为空 → 本机执行
- [ ] targetNodeId 非空 → 路由到目标节点
- [ ] 目标节点独立校验权限

### 5.2 危险能力

- [ ] 危险能力调用前生成 Plan
- [ ] Plan 包含操作描述、风险等级、预计影响
- [ ] 用户批准后执行
- [ ] 执行后记录 audit
- [ ] 审批超时（默认 5 分钟）后自动拒绝

---

## 6. 审计合规

- [ ] 所有能力调用记录 audit
- [ ] 权限 Grant/Revoke 记录 audit
- [ ] 插件安装/卸载记录 audit
- [ ] 配置修改记录 audit
- [ ] 缓存清理记录 audit
- [ ] 审计日志包含 actor / action / target / result / detail
- [ ] 高危操作写两条 audit（plan 创建 + 执行结果）

---

## 7. Desired / Actual State Reconcile

- [ ] config.yaml 中的 desired state 被读取
- [ ] 实际状态通过 check 检测
- [ ] 差异表所有组合有对应操作
- [ ] Desired State 不直接触发操作（经 Plan + 权限）

---

## 8. 跨节点操作

- [ ] local 和 VPS 各自独立 check
- [ ] 跨节点权限在目标节点独立校验
- [ ] 目标节点有自己的 trustLevel 和本地策略
- [ ] relay 不代行权限判断

---

## 9. 防回退规则检查

| # | 规则 | 验证方式 |
|---|------|---------|
| 1 | 禁止插件绕过 Core 自己安装依赖 | 审查 process.spawn 调用是否经 Core |
| 2 | 禁止插件绕过 Core 读写缓存 | 审查 fs API 调用路径 |
| 3 | 禁止缓存清理没有 plan | 拦截缓存清理请求，要求 plan |
| 4 | 禁止 install 没有 history | 检查安装流程是否有 history 写入 |
| 5 | 禁止文件访问不记录 pluginId/nodeId/path/action | 审查 fs API 调用日志 |
| 6 | 禁止插件把缓存藏在 Core 不知道的位置 | 安装前后快照对比 |
| 7 | 禁止删除共享依赖不生成高风险 plan | 共享依赖清理必须标记 high risk |
| 8 | 禁止高危操作没有 Plan 直接执行 | 拦截高危 capability 调用 |
| 9 | 禁止安装没有 history 记录 | 检查安装流程的 audit 写入 |
| 10 | 禁止 install plan 没有用户确认就执行 | Plan 必须 hasApproval 才执行 |
| 11 | 禁止 environment check 只在 local 不在 target node | 双节点各自独立 check |

---

## 10. 插件示例验证

- [ ] claude-code：systemUi + cli + daemon 三 adapter 组合
- [ ] terminal：trusted: true + 危险能力 + systemUi + cli
- [ ] node-monitor：daemon + webhook 纯后台
- [ ] file-browser：systemUi-only 纯 UI
- [ ] 每个示例的 manifest 通过校验
- [ ] 每个示例的权限模型符合三层交集

---

## 11. 文档一致性

- [ ] PLUGIN_DEFINITION.md 与 PLUGIN_MANIFEST_SPEC.md 的格式一致
- [ ] PLUGIN_CORE_API_CONTRACT.md 的 capability 列表与实现一致
- [ ] PLUGIN_ADAPTERS.md 的 adapter 声明与 manifest spec 一致
- [ ] PLUGIN_SECURITY_MODEL.md 的权限模型与 access-control/ 一致
- [ ] CHECKLIST.md 条目覆盖所有防回退规则
- [ ] README.md 阅读顺序与文档体系一致

---

## 12. CLI Adapter

### 12.1 命令注册

- [ ] 命令名在全局索引中唯一（无不同插件同名冲突）
- [ ] 命令名不与保留名冲突（`help` / `version` / `exit` / `quit` / `clear` / `plugin` / `node` / `session` / `config` / `log`）
- [ ] 同一插件内无重复命令名
- [ ] 声明的 `capability` 在 `core.permissions` 中存在
- [ ] CLI 命令数 ≤ 2000

### 12.2 参数与路由

- [ ] `--target <nodeId>` 与 `--local` 互斥（同时出现时报错）
- [ ] `--target` 存在 → targetNodeId = 指定值
- [ ] `--local` 或两者都无 → targetNodeId = ""（本机）
- [ ] 短选项（`-t` 等）在所有插件命令中全局唯一

### 12.3 输出规范

- [ ] `--format json` 时 stdout 输出合法 JSON（可被 `jq` 解析）
- [ ] `--format json` + 错误时，错误为 JSON 格式写入 stderr
- [ ] exit code 0 = 成功，非 0 = 错误（1-9 语义稳定）
- [ ] stdout 只输出命令结果，stderr 输出诊断信息

### 12.4 安全与审计

- [ ] CLI Host 不决定 pluginId（由 Core 连接认证时注入）
- [ ] action.request 使用连接认证的 pluginId，忽略 payload 中的
- [ ] Service Token 调用没有 pluginId，不能调插件管理 API
- [ ] 危险能力在非 TTY 环境必须明确 approval 策略（`--approve` 或拒绝）
- [ ] 非 TTY + 无 `--approve` + 高危操作 → 强制拒绝（即使有 `--approve` 标记）
- [ ] 所有 CLI 能力调用记录 audit（含 `detail.cli` 和 `detail.command` 字段）
- [ ] CLI 命令不走 Core 权限绕过
