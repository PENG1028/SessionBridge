# SessionNode v2 — 控制平面测试用例

> 产品场景 → 测试用例矩阵 → P0/P1/P2 优先级
> 配合 go-core/internal/ 目录下的单元测试和集成测试实现
> 配套文档：PRODUCT_SCENARIOS.md、ARCHITECTURE.md、CORE_PROTOCOL.md

---

## 目录

1. [测试分级定义](#一测试分级定义)
2. [P0 测试用例](#二p0-测试用例)
3. [P1 测试用例](#三p1-测试用例)
4. [P2 测试用例](#四p2-测试用例)
5. [防回退测试用例](#五防回退测试用例)
6. [测试覆盖矩阵](#六测试覆盖矩阵)

---

## 一、测试分级定义

### P0 — 阻塞性（不可上线）

```
标准:
  - 核心功能路径不通
  - 数据丢失或损坏
  - 安全漏洞
  - 权限绕过
  - 所有上线前的 smoke test
```

### P1 — 重要（可上线但需修复）

```
标准:
  - 非核心但常用功能异常
  - 性能退化
  - UX 不完整但可 workaround
  - 错误处理不完善
```

### P2 — 一般（可上线，后续修复）

```
标准:
  - 边界情况
  - 极端场景
  - 管理功能细节
  - 扩展性
```

---

## 二、P0 测试用例

### 2.1 Session 核心生命周期

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-001 | session.create 成功返回 sessionId + streamIds | 场景一 | `response.sessionId != ""`，`response.streamIds.stdout != ""` |
| TC-002 | stream.subscribe 开始接收 stream.chunk | 场景一 | subscribe 后收到 `type: "stream.subscribed"`，接着收到 `type: "stream.chunk"` |
| TC-003 | stream.write 写入 stdin 后 stdout 有输出 | 场景一 | `stream.write("echo hello")` → 收到包含 "hello" 的 stream.chunk |
| TC-004 | session.stop 后进程退出、事件广播 | 场景一 | stop 后收到 `eventType: "session.stopped"`，exitCode 正确 |
| TC-005 | session.list 返回活跃 session | 场景一 | 创建后 list 包含该 session，stop 后不再包含 |
| TC-006 | session.get 返回 session 详情 | 场景一 | 返回 status / kind / pluginId / command / cwd 等字段 |

### 2.2 权限校验

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-010 | 未授权能力调用被 Dispatcher 拒绝 | 场景一 | `PERMISSION_DENIED`，不执行能力 |
| TC-011 | 已授权能力调用正常执行 | 场景一 | `ok: true`，能力正确执行 |
| TC-012 | 插件未注册时所有调用被拒绝 | 场景一 | `PLUGIN_NOT_REGISTERED` |
| TC-013 | 插件禁用时能力调用被拒绝 | 场景五 | `PLUGIN_DISABLED` |
| TC-014 | mode=deny 的 Grant 拒绝能力调用 | 场景六 | `PERMISSION_DENIED` |
| TC-015 | mode=ask 的 Grant 触发审批流程 | 场景六 | dispatcher 返回 `NEED_APPROVAL` |
| TC-016 | 路径约束 deny 匹配时拒绝文件操作 | 场景四 | `PATH_NOT_ALLOWED` |
| TC-017 | 路径约束 allow 不匹配时拒绝文件操作 | 场景四 | `PATH_NOT_ALLOWED` |
| TC-018 | 路径约束 allow 匹配时允许文件操作 | 场景四 | fs.read 成功 |

### 2.3 跨节点转发

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-020 | session.create { targetNodeId } 在远程创建 session | 场景二 | sessionId 由目标节点生成，内容在远程执行 |
| TC-021 | stream.write 通过 relay 转发到远程进程 | 场景二 | 远程进程收到 stdin 输入 |
| TC-022 | 远程进程 stdout 实时转发回本地 | 场景二 | 本地收到 stream.chunk |
| TC-023 | 目标节点不可达时返回 NODE_UNREACHABLE | 场景二 | `NODE_UNREACHABLE` |
| TC-024 | 目标节点独立校验权限，不依赖源节点 | 场景二 | 源节点允许但目标节点拒绝时，请求被拒绝 |
| TC-025 | 无权限跳过 relay 转发到远程 | 场景二 | 远程操作时权限在目标节点校验 |

### 2.4 认证与 Actor

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-030 | 无效 Token 返回 UNAUTHENTICATED | 场景八 | HTTP 401 或 WebSocket 拒绝 |
| TC-031 | 过期 Token 返回 TOKEN_EXPIRED | 场景十三 | 401 |
| TC-032 | Service Token 调未授权能力被拒绝 | 场景八 | `PERMISSION_DENIED` |
| TC-033 | Service Token 调授权能力正常执行 | 场景八 | `ok: true` |
| TC-034 | PluginId 未注册被 Dispatcher 拒绝 | 场景三 | `PLUGIN_NOT_REGISTERED` |
| TC-035 | External Client 不能调 Plugin Management API | 场景八 | 403 或 `PERMISSION_DENIED` |
| TC-036 | Actor 类型不可由客户端伪造 | 场景八 | Core 根据 token 填充 actor.type，忽略客户端声明 |

### 2.5 审批流

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-040 | notify.request 推送 notify.approval.request 给所有 UI | 场景六 | 所有连接收到审批请求 |
| TC-041 | 用户 respond 后 notify.approval.result 回调请求方 | 场景六 | 请求方收到 result |
| TC-042 | 审批超时后 notify.approval.expired | 场景六 | 超时后触发 expired 事件 |
| TC-043 | 同一 requestId 多次响应，首次有效 | 场景六 | 第二次响应返回 `INVALID_REQUEST` |
| TC-044 | "allow-always" 选择后 Grant 更新为 allow | 场景六 | Grant.mode == "allow" |

### 2.6 日志与审计

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-050 | 每次 capability.call 写 audit log | 场景十 | audit.log 包含相应记录 |
| TC-051 | 被拒绝的调用也写 audit log | 场景十 | `capability.denied` 记录 |
| TC-052 | 危险操作（fs.write/process.spawn）写 audit | 场景十 | audit.log 包含 action 记录 |
| TC-053 | session 的 events.jsonl 包含完整 eventSeq | 场景一 | eventSeq 从 1 开始，单调递增，不跳跃 |
| TC-054 | logs.query 按条件过滤正确 | 场景十 | 返回符合过滤条件的日志 |
| TC-055 | 插件只能查看自己的文件访问历史 | 场景十 | 插件 A 不能看插件 B 的 access-history |

### 2.7 插件管理

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-060 | plugin.check 正确检测依赖状态 | 场景五 | 缺失依赖标记为 missing |
| TC-061 | plugin.install.plan 生成完整 Plan | 场景五 | plan.steps 包含所有步骤 |
| TC-062 | Plan 必须确认后才能执行 | 场景五 | 无确认直接 execute 被拒绝 |
| TC-063 | plugin.install.execute 推送实时日志 | 场景五 | WebSocket 收到 stream.chunk（安装输出） |
| TC-064 | plugin.enable/disable 切换状态 | 场景五 | enable 后能力可用，disable 后不可用 |
| TC-065 | plugin.permissions.grant 正确存储 Grant | 场景五 | grant 后能力调用通过 |
| TC-066 | Manifest 验证失败标记为 invalid | 场景五 | invalid 插件不注册 |

### 2.8 多浏览器同步

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-070 | 多个浏览器收到相同的 stream.chunk | 场景七 | 所有订阅者收到相同 eventSeq 的数据 |
| TC-071 | 新订阅者从 fromSeq 开始 replay | 场景七 | 收到 fromSeq 到最新的所有 events |
| TC-072 | 某浏览器写 stdin，所有浏览器看到 stdout | 场景七 | 所有订阅者收到相同的后续输出 |
| TC-073 | 某浏览器断开不影响其他浏览器 | 场景七 | 其他浏览器继续接收 |

### 2.9 节点拓扑

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-080 | node.list 返回所有已知节点 | 场景九 | 包含 relay 和 leaf |
| TC-081 | node.health 返回正确状态 | 场景九 | `status: "ok"` 或 `"unreachable"` |
| TC-082 | 节点连接后 node.joined 事件广播 | 场景九 | 所有连接收到推送 |
| TC-083 | 节点断开后 node.left 事件广播 | 场景九 | 所有连接收到推送 |

### 2.10 断线重连

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-090 | 客户端断线后 session 继续运行 | 场景十二 | session status 保持 running |
| TC-091 | 重连后收到 lastKnownSeq 后的未同步 events | 场景十二 | 不丢数据、不重复 |
| TC-092 | Core 重启后 session 状态正确恢复 | 场景十二 | stopped session 保留在磁盘 |

### 2.11 缓存与副作用

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-100 | plugin.cache.list 返回所有缓存条目 | 场景十一 | 包含 id / paths / risk / clearable |
| TC-101 | plugin.cache.clear 生成 Plan 后才执行 | 场景十一 | 无 Plan 的 clear 被拒绝 |
| TC-102 | Plan 展示 risk / entries / size | 场景十一 | 字段完整 |
| TC-103 | 共享依赖清理需要高风险确认 | 场景十一 | risk=high，requiresApproval=true |

---

## 三、P1 测试用例

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-110 | pty resize 正确更新终端尺寸 | 场景一 | resize 后进程终端尺寸变化 |
| TC-111 | 并行创建多个 session，各自独立 | 场景一 | 不同的 sessionId，互不影响 |
| TC-112 | 长时间无输入 session 不超时 | 场景一 | session 保持 running |
| TC-113 | 远程 session 的 eventSeq 在目标节点生成 | 场景二 | eventSeq 在目标节点单调递增 |
| TC-114 | 多个客户端订阅远程 session 的 stream | 场景二 | 所有客户端收到相同推送 |
| TC-115 | 审批"记住选择"正确更新 Grant | 场景三 | Grant.mode 更新为 allow |
| TC-116 | 多个审批请求同时存在，各自独立 | 场景三 | 各自超时/响应互不影响 |
| TC-117 | 大文件分片读取 (offset + limit) | 场景四 | 读取指定范围正确 |
| TC-118 | 跨节点文件操作 (targetNodeId) | 场景四 | 远程文件读写正确 |
| TC-119 | fs.watch 文件变更推送 | 场景四 | 文件修改后收到 fs.event |
| TC-120 | 安装历史可查询 (plugin.history) | 场景五 | 返回正确记录 |
| TC-121 | 安装日志可查看 (plugin.install.logs) | 场景五 | 返回 stdout/stderr |
| TC-122 | 插件卸载后清理文件 | 场景五 | uninstall 后清理相关目录 |
| TC-123 | 审批弹窗包含完整信息 | 场景六 | capability / path / actor |
| TC-124 | 浏览器断线重连后从 lastKnownSeq 续传 | 场景七 | 不丢数据 |
| TC-125 | ring buffer 溢出后从磁盘 replay 补齐 | 场景七 | stream.replay 返回完整数据 |
| TC-126 | 10+ 浏览器订阅时广播性能 | 场景七 | 延迟在可接受范围 |
| TC-127 | Service Token audit 包含 label | 场景八 | audit 记录中显示 token label |
| TC-128 | Token 过期后所有请求被拒绝 | 场景十三 | 401 |
| TC-129 | 多个 Token 权限隔离 | 场景十三 | Token A 不能调 Token B 的能力 |
| TC-130 | 节点断线自动检测 | 场景九 | 心跳超时后状态更新 |
| TC-131 | 节点重连后路由表恢复 | 场景九 | 路由功能正常 |
| TC-132 | 日志轮转后查询仍可用 | 场景十 | 轮转后日志可查 |
| TC-133 | 大量日志下查询性能 | 场景十 | 响应时间可接受 |
| TC-134 | 引用计数 >0 的共享依赖不可直接清理 | 场景十一 | clear 失败提示共享依赖 |
| TC-135 | 清理后插件重建缓存正常 | 场景十一 | 插件启动后缓存自动创建 |
| TC-136 | 快速连续断线重连（10 次） | 场景十二 | 状态不丢失 |
| TC-137 | 多个客户端各自正确续传 | 场景十二 | 各自 lastKnownSeq 正确 |
| TC-138 | Token 权限变更后旧 Token 受新限制 | 场景十三 | 配置更新后立即生效 |

---

## 四、P2 测试用例

| 编号 | 测试用例 | 场景来源 | 断言 |
|------|---------|---------|------|
| TC-140 | session.create 时 command 不存在返回 BINARY_NOT_FOUND | 场景一 | 错误码正确 |
| TC-141 | cwd 不存在返回 INVALID_REQUEST | 场景一 | 错误码正确 |
| TC-142 | 远程节点 relay 转发失败时返回 FORWARD_ERROR | 场景二 | 错误码正确 |
| TC-143 | 目标节点 command 不存在的错误 | 场景二 | 目标节点返回 BINARY_NOT_FOUND |
| TC-144 | 大文件 fs.read 返回 truncation 信息 | 场景四 | truncated: true |
| TC-145 | fs.watch 路径不合法返回错误 | 场景四 | INVALID_REQUEST |
| TC-146 | 安装网络错误处理 | 场景五 | PLUGIN_INSTALL_FAILED |
| TC-147 | 磁盘空间不足导致安装失败 | 场景五 | 安装命令失败 |
| TC-148 | Manifest 版本号不合法 | 场景五 | 验证失败 |
| TC-149 | 审批已响应的 requestId 二次响应被拒绝 | 场景六 | INVALID_REQUEST |
| TC-150 | 审批 action 不在 actions 列表 | 场景六 | INVALID_REQUEST |
| TC-151 | 断线后 events.jsonl 磁盘损坏的恢复 | 场景十二 | 部分 replay 成功 |
| TC-152 | Token 权限范围格式错误的校验 | 场景十三 | 配置保存时验证 |
| TC-153 | 100+ Token 认证性能 | 场景十三 | 认证延迟可接受 |
| TC-154 | 日志文件损坏不影响 Core 运行 | 场景十 | Core 继续运行，日志部分不可读 |
| TC-155 | 节点角色变更 (relay ↔ leaf) | 场景九 | 路由表正确更新 |
| TC-156 | 空闲 session 超时清理策略 | 场景一 | 超期 stopped session 被清理 |

---

## 五、防回退测试用例

这些测试用例验证防回退规则的执行。每个用例对应 PLUGIN_DEFINITION.md 中的一条防回退规则。

| 编号 | 验证规则 | 测试方法 | 断言 |
|------|---------|---------|------|
| TC-200 | 禁止 Core 出现 ClaudeCode 专用 API | 检查 Core API 端点列表 | 没有 `/api/claude/*` 或等价路径 |
| TC-201 | 禁止 PluginId 伪造 | 用未注册的 pluginId 调用 action.request | 返回 `PLUGIN_NOT_REGISTERED` |
| TC-202 | 禁止 External Client 使用 pluginId | 用 service token 调 action.request 时报 pluginId | Core 忽略或使用 token 身份 |
| TC-203 | 禁止 Service Token 默认管理员权限 | 创建无权限声明的 token | 所有能力调用被拒绝 |
| TC-204 | 禁止 Capability/Plugin Management API 混用 | External Client 调 plugin.install | 拒绝 |
| TC-205 | 禁止 Desired State 绕过 Plan/权限 | 直接设置 desired state | 不经 Plan 不生效 |
| TC-206 | 禁止 Actor 类型由客户端指定 | 客户端声明 actor.type="system-ui" | Core 覆盖为真实类型 |
| TC-207 | 禁止高危操作没有 Plan | 直接调 cache.clear.execute 无 plan | 拒绝 |
| TC-208 | 禁止 Manifest 声明 = 自动获得授权 | Manifest 声明能力但无 Grant | 能力调用被 `NOT_GRANTED` 拒绝 |
| TC-209 | 禁止插件绕过 Core 操作机器 | 插件进程内执行本地命令（不走 Core API） | Core 无法阻止但审计可发现 |
| TC-210 | 禁止 Core 成为 Web UI 专用后端 | 只启动 Core 无 Web UI | CLI 和 API 正常工作 |
| TC-211 | 禁止 CLI 成为独立状态源 | CLI 本地缓存和 Core 状态对比 | Core 状态始终最新 |
| TC-212 | 禁止 Relay 拥有业务状态 | Relay 重启后不保留 session 信息 | session 在 leaf 节点上运行不受影响 |
| TC-213 | 禁止 system-ui 绕过 Core Protocol | system-ui 直接调 Core 内部函数 | 无此类代码路径 |
| TC-214 | 禁止 tabId 当 sessionId | 前端传 tabId 到 Core API | Core 不认识 tabId |
| TC-215 | 禁止浏览器维护 session 真相 | 前端读取 localStorage 的 session 列表对比 Core list | Core list 最准确 |
| TC-216 | 禁止 session event 没有 eventSeq | 检查 events.jsonl | 每条有 eventSeq |
| TC-217 | 禁止 relay 修改业务状态 | Relay 收到 session.event 后 | relay 不创建/修改 session |

---

## 六、测试覆盖矩阵

### 场景 → 测试用例覆盖

| 场景 | P0 用例数 | P1 用例数 | P2 用例数 | 防回退用例 | 总计 |
|------|----------|----------|----------|-----------|------|
| 一：Terminal | 6 | 3 | 2 | — | 11 |
| 二：跨节点 | 6 | 2 | 2 | — | 10 |
| 三：Claude Code | — | 2 | — | — | 2 |
| 四：文件浏览 | — | 3 | 2 | — | 5 |
| 五：插件管理 | 7 | 3 | 4 | — | 14 |
| 六：审批流 | 5 | 1 | 2 | — | 8 |
| 七：多浏览器 | 4 | 3 | — | — | 7 |
| 八：CI/CD | — | 1 | — | — | 1 |
| 九：拓扑 | 4 | 2 | 1 | — | 7 |
| 十：监控 | 3 | 2 | 1 | — | 6 |
| 十一：缓存 | 4 | 2 | — | — | 6 |
| 十二：离线 | 3 | 3 | 1 | — | 7 |
| 十三：Token | — | 3 | 2 | — | 5 |
| 防回退 | — | — | — | 18 | 18 |

### 测试类型分布

| 测试类型 | 用例数 | 说明 |
|---------|--------|------|
| P0（阻塞性） | 56 | 核心功能、安全、权限 |
| P1（重要） | 31 | 常用功能、边界情况 |
| P2（一般） | 16 | 极端场景、管理细节 |
| 防回退 | 18 | 架构违规检测 |
| **总计** | **121** | |

### 测试覆盖优先级建议

```
实现阶段 1（MVP）：
  覆盖所有 P0 用例（56 个）
  覆盖 TC-200 ~ TC-209（防回退 10 个）
  总覆盖: 66 个测试用例

实现阶段 2：
  覆盖所有 P1 用例（31 个）
  覆盖 TC-210 ~ TC-218（防回退 9 个）
  总覆盖: 106 个测试用例

实现阶段 3：
  覆盖所有 P2 用例（16 个）
  总覆盖: 121 个测试用例
```
