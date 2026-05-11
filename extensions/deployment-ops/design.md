# DeploymentOpsAdapter 设计

> 为 SessionBridge 设计一个运维部署插件，不破坏其"纯通用"核心设计理念。

---

## 一、设计原则（与 SessionBridge 理念对齐）

SessionBridge Core 的核心信条是：**不知道任何具体东西**。不认识 Claude，不认识 Shell，不认识 ops。

我的插件遵守同样的约束：**我只在 adapter 层做事，不要求 Core 为我加任何领域逻辑。**

```
SessionBridge Core（纯通用，不修改）
       │
       ├── Adapter: Claude Code     ← 对话式
       ├── Adapter: Shell           ← 交互式
       ├── Adapter: System Info     ← 只读式
       └── Adapter: Deployment Ops  ← 我要写的（确定性操作式）
                                     ↑
                           同样实现 AgentAdapter 接口
                           不要求 Core 为我开任何后门
```

---

## 二、核心矛盾分析

### 2.1 现有 Adapter 接口是对话式的

```ts
// SessionBridge 的 AgentAdapter
interface AgentAdapter {
  start(input: StartInstanceInput): Promise<InstanceHandle>;
  // InstanceHandle:
  //   send(text)        ← 发文本，适合对话
  //   sendCommand(cmd)  ← 控制命令
  //   stop()            ← 结束
  //   onBlock(handler)  ← 接收输出块
}
```

Ops 需要的是：

```ts
// 我想要的操作模式
checkHealth(): Promise<HealthReport>        // 确定性查询
deploy(plan: DeployPlan): Promise<DeployResult>  // 多步骤操作
rollback(target: string): Promise<void>     // 回滚
```

### 2.2 这不是冲突，是适配

Sender/Receiver 模式是通用的。send 发命令，onBlock 收结果——区别在于**格式约定**：

```
对话模式:
  send("git status")
  onBlock({ type: "text", text: "On branch main..." })

Ops 模式:
  sendCommand("deploy.check", { service: "worker" })
  onBlock({ type: "status", status: "ok", data: [...], meta: {...} })
```

**Core 不需要区分这两者。** 它只负责把 `sendCommand` 路由到 adapter，以及把 `onBlock` 的数据推给 UI。

适配的关键在于：adapter 内部解析命令，做领域逻辑。Core 完全置身事外。

### 2.3 唯一真正的摩擦点：PermissionModel

当前 PermissionModel 是布尔开关：

```ts
check('shellAccess') → { allowed: true }
```

Ops 需要条件门：

```
"允许 pm2 restart，但前提是 check-v2-readiness 通过"
"允许 git pull，但前提是工作区干净，且在正确分支"
```

**方案：PermissionModel 不改，OpsAdapter 自己做预检。**

```ts
// OpsAdapter 内部实现安全门，不依赖 Core
async executeOp(op: string, params: unknown): Promise<OpResult> {
  // 先跑预检
  const gates = await this.preflight(op);
  if (gates.some(g => g.status === 'BLOCK')) {
    return { ok: false, blockedBy: gates.filter(g => g.status === 'BLOCK') };
  }
  // 执行实际操作
  return this.runOp(op, params);
}
```

这样做的好处：**不改 Core，权限逻辑完全在 adapter 层，且每个项目可以有自己的一套预检规则。**

---

## 三、我建议加的扩展（最小化，非侵入）

三个扩展点，全部是**可选**的，adapter 可以不实现：

### 3.1 扩展一：Adapter 加 `getOpsCapabilities()`

```ts
// AgentAdapter 新增可选方法
interface AgentAdapter {
  // ...现有方法（不变）...

  /** 可选：声明本 adapter 支持哪些确定性操作 */
  getOpsCapabilities?(): OpsCapability[];
}

interface OpsCapability {
  id: string;           // "deploy" | "check" | "rollback" | "status"
  name: string;         // "部署" | "健康检查" | "回滚" | "状态"
  description: string;  // "执行完整部署流程：git pull → build → restart"
  params: Record<string, ParamDef>;  // 参数定义
  timeout?: number;     // 超时时间 ms
  isDestructive: boolean;  // 是否是破坏性操作（需要二次确认）
}
```

**为什么加这个：**
- Core UI 可以动态展示 "这个 adapter 支持什么操作"
- 用户点一下按钮而不是打字
- Claude Code adapter 返回空数组，OpsAdapter 返回实际列表

**为什么不破坏通用性：**
- Core 不解析 `OpsCapability` 里的任何东西
- Core 只负责展示和路由，不负责执行
- Adapter 不实现这个接口也完全可用

### 3.2 扩展二：Agent 启动参数加 `--role`

```ts
// 只在 agent 启动参数层面加，Core 模型不改
session-bridge agent --role web    --label "生产 Web 服务器"
session-bridge agent --role worker --label "生产 Worker 服务器"
session-bridge agent --role db     --label "数据库服务器"
```

Relay 端接收到注册后，在实例列表里展示角色信息。Core 不需要知道"web"是什么意思——它只是一个展示用的标签。

```json
{
  "type": "agent.register",
  "body": {
    "dir": "/home/deploy/AurumScout",
    "label": "生产 Web 服务器",
    "role": "web"        // 新增，Core 不解析
  }
}
```

### 3.3 扩展三：PermissionModel 加 context 透传

当前：

```ts
check(category: PermissionContext): { allowed: boolean; reason?: string }
```

改为：

```ts
check(
  category: PermissionContext,
  context?: Record<string, unknown>  // 透传给上层判断
): { allowed: boolean; reason?: string }
```

这样 PermissionModel 的存储还是布尔值，但 `context` 可以传给上层的审批逻辑做动态判断。PermissionModel 本身不改行为，只是多透传一个参数。

**这三个扩展是全部需要的改动。** 如果这三个你也不想动 Core，那也完全可以——OpsAdapter 在 adapter 层自己处理角色和权限，只是 UI 层面少一些展示。

---

## 四、DeploymentOpsAdapter 完整功能列表

### 4.1 层级结构

```
DeploymentOpsAdapter
│
├── Core 能力（必须实现，否则没有意义）
│   ├── health.check     — 全面健康检查
│   ├── status.report    — 详细状态报告
│   └── ops.check        — 预检（验证是否可以执行某操作）
│
├── 部署能力
│   ├── deploy          — 完整部署流程
│   ├── deploy.rollback — 回滚到上一个版本
│   └── deploy.status   — 查看当前部署状态
│
├── 进程管理
│   ├── pm2.status      — 查看 PM2 进程状态
│   ├── pm2.restart     — 重启指定服务
│   ├── pm2.logs        — 获取最近日志
│   └── pm2.monitor     — 内存/CPU 使用
│
├── Git 操作
│   ├── git.status      — 查看工作区状态
│   ├── git.pull        — 拉取最新代码
│   ├── git.diff        — 查看变更
│   └── git.checkout    — 切换分支/提交
│
├── 数据验证
│   ├── data.check-v2   — 运行 check-v2-readiness
│   ├── data.batches    — V2 批次状态
│   ├── data.redis      — Redis 缓存状态
│   └── data.backup     — 触发/验证备份
│
└── 告警能力
    ├── alert.emit       — 通过 SessionBridge 发送告警
    └── alert.history    — 最近告警记录
```

### 4.2 每个操作的接口定义

```ts
// ─── 查询类（只读，无副作用）─────────────────────────

interface StatusReport {
  hostname: string;
  role: 'web' | 'worker' | 'db' | 'unknown';
  services: ServiceStatus[];
  system: {
    cpu: { load: number[]; cores: number };
    memory: { total: number; free: number; usedPercent: number };
    disk: { total: number; free: number; usedPercent: number };
    uptime: number;
  };
  git: {
    branch: string;
    commit: string;
    isClean: boolean;
    lastPullAgo: string;
  };
  env: Record<string, string>;  // V2_ENABLED, NODE_ENV 等
  errors: string[];              // 检测到的问题
}

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    name: string;         // "PM2 进程" / "PostgreSQL 连接" / "Redis 连接"
    status: 'pass' | 'fail' | 'warn';
    detail: string;
    durationMs: number;
  }[];
}

// ─── 预检（所有操作前的安全门）───────────────────────

interface PreflightGate {
  gate: string;           // "clean_working_tree" | "on_correct_branch"
  status: 'PASS' | 'BLOCK' | 'WARN';
  message: string;         // 通过/失败/警告信息
  fixHint?: string;        // 修复建议
}

interface PreflightResult {
  gates: PreflightGate[];
  overall: 'PASS' | 'BLOCK' | 'WARN';
  // BLOCK 时操作不允许执行
  // WARN 时需要用户确认
  // PASS 时自动继续
}

// ─── 部署操作（有副作用，需要预检）────────────────────

interface DeployPlan {
  target: 'web' | 'worker' | 'all';
  gitRef?: string;          // 分支/标签/commit，默认当前分支
  skipBuild?: boolean;      // 跳过 build（纯配置变更）
  skipHealthCheck?: boolean; // 跳过部署后健康检查
  env?: Record<string, string>; // 部署时设置的环境变量
}

interface DeployStep {
  step: number;
  name: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  durationMs?: number;
  output?: string;
  error?: string;
  rollbackAction?: string;   // 此步骤的回滚说明
}

interface DeployResult {
  ok: boolean;
  plan: DeployPlan;
  steps: DeployStep[];
  error?: string;
  rollbackAvailable: boolean;  // 是否可以回滚
}
```

### 4.3 安全门预检链（按操作类型）

不同操作需要不同的预检，以 `deploy` 为例：

```
操作: deploy (目标: worker)

预检链:
  □ 1. working_tree_clean    → git status --porcelain 为空
  □ 2. on_correct_branch     → 当前在 feat/v2-algos（或配置的分支）
  □ 3. ahead_of_remote       → git pull 不会冲突
  □ 4. enough_disk_space     → 剩余 > 5GB
  □ 5. enough_memory         → 可用内存 > 1GB（build 需要）
  □ 6. services_healthy      → 现有 PM2 进程健康
  □ 7. no_running_pipeline   → V2 pipeline 不在运行
  □ 8. recent_backup         → 数据库 24h 内有备份

全部 PASS → 自动执行
有 WARN   → 提示用户确认
有 BLOCK  → 拒绝执行，附修复方案
```

---

## 五、在 3 机部署中的实际工作流

### 5.1 初始化：每台机器启动 agent

```bash
# Web 服务器
session-bridge agent \
  --relay ws://relay-server:8080 \
  --role web \
  --dir /home/deploy/AurumScout \
  --label "生产 Web (Server A)"

# Worker 服务器
session-bridge agent \
  --relay ws://relay-server:8080 \
  --role worker \
  --dir /home/deploy/AurumScout \
  --label "生产 Worker (Server B)"

# 数据库服务器
session-bridge agent \
  --relay ws://relay-server:8080 \
  --role db \
  --dir /home/deploy/AurumScout \
  --label "生产 DB (Server C)"
```

### 5.2 Dashboard 看到

```
┌────────────────────────────────────────────────
│  🖥 部署拓扑
│
│  [WEB]   生产 Web (Server A)      ✅ online
│    ├─ V2_ENABLED=1  |  latest: abc1234
│    └─ aurum-web (pm2)  |  mem: 128MB  |  uptime: 12d
│
│  [WORKER] 生产 Worker (Server B)  ✅ online
│    ├─ V2_ENABLED=1  |  latest: abc1234
│    └─ aurum-worker (pm2)  |  mem: 256MB  |  uptime: 12d
│
│  [DB]   生产 DB (Server C)        ✅ online
│    ├─ PostgreSQL (systemd)  |  conn: 12/100
│    └─ Redis (systemd)  |  mem: 180MB/1GB
│
│  操作: [部署全部] [部署 Web] [部署 Worker] [健康检查]
└────────────────────────────────────────────────
```

### 5.3 一键部署全部

```
你点击 [部署全部]

系统自动执行:
  Step 1/6: 预检三部机器          → 全部 PASS ✅
  Step 2/6: 更新 Worker 服务器    → git pull + build + restart ✅
    验证: health.check           → healthy ✅
  Step 3/6: 更新 Web 服务器      → git pull + build + restart ✅
    验证: health.check           → healthy ✅
  Step 4/6: 验证 DB 数据          → check-v2-readiness ✅
  Step 5/6: 验证端到端            → API 查询正常 ✅
  Step 6/6: 清理旧构建            → 保留最近 3 个版本 ✅

结果: 全部成功 (总耗时 143s)
操作人: zhp    操作时间: 2026-05-05 14:32:00
回滚可用: 是（保留上一个版本的 .next 和 dist/）
```

### 5.4 故障自动阻断

```
你在 Web 服务器上点击 restart
系统预检发现:

  ❌ BLOCK: aurum-web 当前请求量 120rps，重启会导致请求中断
     建议: 在低峰期操作，或先切流量

  ⚠️ WARN: 当前工作区有未提交的更改 (3 files)
     建议: git stash 后再操作

操作已阻止。请先处理 BLOCK 项。
```

---

## 六、与 SessionBridge 现有组件的关系

```
SessionBridge Core          DeploymentOpsAdapter
────────────────────────────────────────────────────
PermissionModel             → 调用，不自建权限系统
CapabilityHost              → 通过它做 fs.read / process.spawn
RelayConnection             → 通过它发告警通知
SystemInfoAdapter           → 复用它的系统信息采集能力
Dashboard Server            → 复用它的 HTTP 端口做 API

不依赖：
  ClaudeCodeAdapter         → OpsAdapter 不需要知道 Claude
  ShellAdapter              → OpsAdapter 自己 spawn 进程
```

**OpsAdapter 对 Core 的依赖只有：**
1. 能被 Core 启动和管理（`start()` / `stop()`）
2. 能通过 CapabilityHost 执行系统操作
3. 能通过 RelayConnection 发送通知

如果 Core 以后提供 `getOpsCapabilities()` 接口，OpsAdapter 就多一个声明能力。不提供也完全不影响功能。

---

## 七、实现优先级（MVP → 完整版）

### Phase 1 — 基础可用（1 周）

```
✅ status.report      — 系统状态报告
✅ health.check       — 健康检查（调用已有 monitoring.ts）
✅ ops.check          — 预检链（工作区、分支、磁盘）
✅ pm2.status         — PM2 进程查看
✅ data.check-v2      — V2 数据验证（调用已有 check-v2-readiness.ts）
```

单机验证通过后再上多机。

### Phase 2 — 部署能力（1 周）

```
✅ deploy             — 单机部署（git pull + build + restart）
✅ deploy.rollback    — 单机回滚
✅ pm2.restart        — PM2 进程管理
✅ git.status/diff    — Git 操作
```

### Phase 3 — 多机编排（1 周）

```
✅ 角色感知            — web/worker/db 分流
✅ 多机部署计划        — 按顺序部署全部机器
✅ 跨机健康验证        — 部署后验证端到端
```

### Phase 4 — 完善（持续）

```
✅ 告警集成            — 通过 relay 发通知
✅ 操作审计            — 记录每次操作
✅ 定时健康检查        — 周期性自动检查
✅ HTTP API           — 供 CI/CD 调用
```

---

## 八、总结：冲突吗？

**不冲突。**

SessionBridge 的核心：**Core 通用，adapter 做领域逻辑。** DeploymentOpsAdapter 严格遵守这个原则：

| 维度 | SessionBridge 现在的做法 | OpsAdapter 的做法 | 冲突？ |
|------|------------------------|-------------------|--------|
| 协议 | 消息信封 type + body | 复用同一套信封，定义新 type | 不冲突 |
| 接口 | AgentAdapter.start/send/stop | 全部在 start 内部建立命令路由 | 不冲突 |
| 权限 | PermissionModel 布尔开关 | 调用 permission 检查 + 自己加预检 | 不冲突 |
| 数据 | onBlock 统一输出格式 | 输出结构化 status/tool_result block | 不冲突 |
| 角色 | 无 | agent 启动参数 --role（Core 不解析） | 不冲突 |

**三个建议的 Core 扩展（getOpsCapabilities / --role / context 透传）全部是可选的。**
不做，OpsAdapter 也能工作。做了，UI 展示更好看。

---

## 九、完备能力地图：公司级运维的全景

> 假设 Core 已提供角色路由、HTTP API、Session 持久化三条原语。
> 以下是 DeploymentOpsAdapter 在 adapter 层能实现的完整能力集合。

### 9.1 能力总览

```
                    ┌──────────────────────────────────────┐
                    │        DeploymentOpsAdapter           │
                    │        （纯 adapter 层实现）            │
                    └──────────────────────────────────────┘
                                      │
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ 部署引擎  │  │ 发布策略  │  │ 基础设施  │  │ 可观测性  │  │ 应急响应  │
   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
        │              │              │              │              │
   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ 审计合规  │  │ 成本管理  │  │ 容量规划  │  │ 配置中心  │  │ 团队协作  │
   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### 9.2 逐个领域展开

#### 领域 A：部署引擎 — 覆盖度 ★★★★★

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 单机部署 (git pull + build + restart) | adapter spawn 进程 | 否 | 否 |
| 多机顺序部署 (web → worker → db) | relay 序列发送原语 | Core-2 | 否 |
| 回滚到上一版本 | adapter 保留 dist/.next 快照 | 否 | 否 |
| 回滚到指定版本 | adapter 管理版本目录 | 否 | 否 |
| 部署前预检 (8 道门) | adapter 内部 | 否 | 否 |
| 部署后健康验证 | adapter 调用 health.check | 否 | 否 |
| 部署超时/中止 | adapter 管理 context/timeout | 否 | 否 |
| 部署结果通知 (钉钉/企微/Slack) | adapter 调 webhook | 否 | 否 |
| .env 差异检测 (staging vs prod 配错) | adapter diff .env 文件 | 否 | 否 |

**说明：** 部署引擎是 adapter 最擅长的领域——全是本地命令执行和流程编排，完全不依赖外部系统。

#### 领域 B：发布策略 — 覆盖度 ★★★★☆

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 蓝绿发布 | 两套目录切换 + nginx reload | 否 | nginx |
| 金丝雀发布 (10% → 50% → 100%) | nginx upstream weight 调整 | 否 | nginx |
| 灰度发布 (按用户/地域) | 需要外部 LB 配合 | 否 | LB/网关 |
| 分批发布 (先 1 台 → 观察 → 全量) | relay 序列发送 + 等待 | Core-2 | 否 |
| 自动暂停 (金丝雀阶段 error_rate 飙升) | adapter 监听指标 + 自动阻塞 | 否 | 否 |
| 版本标签 (每次发布打 git tag) | adapter git tag | 否 | 否 |
| 发布审批 (需要人确认才能继续) | adapter 发出 block 等待 HTTP callback | Core-2 | 否 |
| 特性开关联动 (发布时打开对应 flag) | adapter 调 GrowthBook/LaunchDarkly API | 否 | 外部 API |

**说明：** 蓝绿/金丝雀的核心是 nginx 配置切换，adapter 写文件 + reload 即可。灰度按用户分流需要 LB/网关层配合。发布审批需要 Core 的 HTTP callback 或 relay 长轮询。

#### 领域 C：基础设施管理 — 覆盖度 ★★★☆☆

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 服务器清单管理 (IP/角色/规格) | adapter 配置文件 | 否 | 否 |
| 系统资源监控 (CPU/内存/磁盘) | adapter 收集 + 上报 | 否 | 否 |
| 进程管理 (PM2 status/restart/logs) | adapter pm2 命令 | 否 | 否 |
| systemd 服务管理 | adapter systemctl | 否 | 否 |
| 证书到期检测与自动续期 | adapter certbot / acme.sh | 否 | 否 |
| 磁盘清理 (旧日志/旧构建) | adapter 定时任务 | 否 | 否 |
| 安全补丁更新提醒 | adapter apt/yum check | 否 | 否 |
| DNS 记录管理 | 需要 Cloud API | 否 | Cloud API |
| CDN 缓存刷新 | 需要 Cloud API | 否 | Cloud API |
| 防火墙规则管理 | adapter ufw/iptables | 否 | 否 |
| 数据库备份与恢复 | adapter pg_dump / 脚本 | 否 | 否 |
| TLS 证书管理 | adapter acme.sh / cert-manager | 否 | 否 |

**说明：** 操作系统层的事情 adapter 都能做（通过 SSH 或本地 shell）。DNS/CDN 等云资源需要外部 API——adapter 可以做 HTTP 调用，只是需要配置凭据。

#### 领域 D：可观测性 — 覆盖度 ★★★☆☆

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 端到端健康检查 | adapter 定时执行 + 上报 | 否 | 否 |
| 日志查询 (tail -n / grep) | adapter 执行 | 否 | 否 |
| 指标采集 (CPU/RPS/错误率) | adapter 采集 + Prometheus push | 否 | Prometheus |
| 告警规则执行 | adapter 定时检查条件 | 否 | 否 |
| 告警通知 (钉钉/企微/Slack/PagerDuty) | adapter webhook | 否 | 否 |
| 告警静默/聚合 (相同告警 1h 内只发一次) | adapter 状态文件去重 | 否 | 否 |
| On-Call 轮值表 | 外部 PagerDuty/OpsGenie | 否 | 外部 |
| 调用链追踪 | 需要 OpenTelemetry 基础设施 | 否 | OTEL |
| 仪表盘 | 需要 Grafana | 否 | Grafana |

**说明：** adapter 能"采集"和"执行"，但不适合做"存储和可视化"。指标存 Prometheus，日志存 Loki/ES，仪表盘用 Grafana。adapter 的角色是数据生产者和告警执行者。

#### 领域 E：应急响应 — 覆盖度 ★★★★☆

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 自动重试 (进程挂了自动重启) | systemd/PM2 | 否 | 否 |
| 自愈脚本 (检测到挂了 → 恢复) | adapter 定时检查 + 修复 | 否 | 否 |
| 一键降级 (关闭非核心功能) | adapter 改 .env + restart | 否 | 否 |
| 流量切换 (挂了一台切走) | nginx upstream disable | 否 | nginx |
| 故障预案 runbook (按步骤执行) | adapter 按步骤执行 + 确认 | 否 | 否 |
| 一键回滚 (整个发布) | adapter 执行 | 否 | 否 |
| 数据回滚 (DB 恢复到某个时间点) | adapter pg_restore | 否 | 否 |
| 通知相关人员 (故障/恢复) | adapter webhook | 否 | 否 |

**说明：** 应急响应核心是"预定义的脚本化操作"，adapter 完美适合——按步骤执行、每步确认、失败暂停。

#### 领域 F：审计合规 — 覆盖度 ★★★★☆

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 操作日志 (谁 + 什么时候 + 做了什么) | adapter 写本地文件 | 否 | 否 |
| 操作回放 (按时间线展示操作序列) | adapter 读取日志展示 | 否 | 否 |
| 部署历史 (每次部署的记录) | adapter 写文件 | 否 | 否 |
| 人员权限 (谁能操作哪台机器) | PermissionModel + adapter 预检 | Core-1 | 否 |
| 变更审批 (重大变更需要第二人确认) | relay HTTP callback 等待 | Core-2 | 否 |
| 合规报告 (周报/月报) | adapter 汇总审计日志 | 否 | 否 |

**说明：** 审计是写文件+读文件，adapter 最简单的能力范畴。唯一需要 Core 的是变更审批的异步等待。

#### 领域 G：成本管理 — 覆盖度 ★★☆☆☆

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 云资源成本展示 | 需要云厂商 API | 否 | Cloud API |
| 闲置资源检测 | adapter 采集 + 分析 | 否 | 否 |
| 成本预算告警 | 外部账单 API | 否 | Cloud API |

**说明：** 成本管理高度依赖云厂商 API，adapter 能调但这不是它的核心价值。

#### 领域 H：配置中心 — 覆盖度 ★★★★☆

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 环境变量管理 (按环境区分) | adapter 管理 .env 文件 | 否 | 否 |
| 配置文件版本化 | adapter git 管理配置 | 否 | 否 |
| 配置差异对比 (staging vs prod) | adapter diff 命令 | 否 | 否 |
| 配置一键同步 (复制到所有机器) | relay 组播 | Core-2 | 否 |
| 密钥/密码管理 | 建议用外部 Vault | 否 | Vault |
| 配置变更审批 | 同发布审批流程 | Core-2 | 否 |

**说明：** 配置管理是文件操作 + 分发，adapter 胜任。密钥管理建议集成外部 Vault。

#### 领域 I：团队协作 — 覆盖度 ★★★☆☆

| 能力 | 实现方式 | 要 Core? | 要外部? |
|------|---------|----------|---------|
| 多人操作锁 (一人操作的机器别人不能动) | session 持久化 + 状态检查 | Core-3 | 否 |
| 操作广播 (有人在操作时通知其他人) | relay 广播消息 | Core-2 | 否 |
| 审批流程 (需要 CTO 确认才能上线) | relay HTTP callback | Core-2 | 否 |
| 操作评论/备注 | adapter 记录 | 否 | 否 |
| 与 IM 集成 (操作通知发到群) | adapter webhook | 否 | 否 |

**说明：** 协作能力高度依赖 SessionBridge 本身的多人支持，这是 Core 层的事情。

### 9.3 覆盖度总结

```
领域               覆盖度    主要依赖
────────────────────────────────────────────────
A 部署引擎         ★★★★★    无外部依赖，纯 adapter
B 发布策略         ★★★★☆    需要 nginx 配合
C 基础设施         ★★★☆☆    本地胜任，云资源需 API
D 可观测性         ★★★☆☆    adapter 采集，外部队列存储
E 应急响应         ★★★★☆    近无外部依赖
F 审计合规         ★★★★☆    变更审批需 Core 原语
G 成本管理         ★★☆☆☆    主要靠云厂商 API
H 配置中心         ★★★★☆    密钥管理需外部 Vault
I 团队协作         ★★★☆☆    多人场景依赖 Core

综合覆盖度：约 80% 的能力可以在 adapter 层实现
            15% 需要 Core 的 transport 原语
             5% 需要外部系统（云 API / Grafana / Vault）
```

### 9.4 真正比别人强的地方

这套架构有几个优势是大多数公司花了大钱也做不到的：

**① 零信任预检链是硬编码的安全门**
大多数公司的运维靠人的经验和纪律——"上线前检查一下"。
你的 adapter 在操作前强制跑 8 道预检，不过就拒绝。这是写进代码的安全策略，不是"下次注意"。

**② 跨机事务一致性**
大多数公司多机部署靠运维脚本挨个 ssh，断了一半就悬着。
你的 relay 序列发送 + 步骤状态追踪 + 回滚能力，比"ssh 循环"强一个量级。

**③ 操作即审计**
大多数公司的审计是事后翻 Bastion 日志。
你的每一步操作都有结构化记录：谁 + 什么时间 + 什么操作 + 结果 + 耗时。审计不是附加功能，是操作本身的一部分。

**④ Adapter 隔离 = 故障隔离**
大多数公司的运维工具是一个大单体——Prometheus 挂了可能会影响部署。
你的架构里，ops adapter 挂了只影响 ops，部署照跑，Claude Code 照用，web 服务不受影响。

### 9.5 做不完的边界

有些东西 SessionBridge 架构本身就不适合做，应该留给专业系统：

| 能力 | 原因 | 替代方案 |
|------|------|---------|
| 日志存储与全文搜索 | 这不是 agent 的事 | ELK/Loki + Grafana |
| 指标长期存储 | adapter 不存历史 | Prometheus + Thanos |
| 网络负载均衡 (L4/L7) | agent 管不了网络层 | Nginx / HAProxy / Cloud LB |
| DNS 权威管理 | 需要在云厂商控制台操作 | 云厂商控制台 / Terraform |
| 数据库主从复制 | 数据库引擎层的事情 | PostgreSQL 流复制 |
| IAM 权限体系 | 组织级身份管理 | 外部 IDP / 云 IAM |

**策略：** adapter 只管"触达"（触发备份、检查状态、执行命令），不管"内部逻辑"（数据库怎么复制、LB 怎么选后端）。

### 9.6 一句话回答

> **这套架构在 adapter 层能覆盖 80% 的公司级运维需求。**
>
> 剩下的 20% 中，15% 来自 Core 的三条 transport 原语（路由/HTTP/持久化），5% 来自外部专有系统（监控存储/云 API）。
>
> 真做得好的地方——**硬编码的安全门、跨机事务、操作即审计、故障隔离**——反而是大多数专业运维工具也做不到的。

---

## 十、与主流公司的真实差距（超越基础设施层面）

> 以下对比不讨论"你没有 Docker/K8s"，而是讨论**即使有了容器化，运维范式的差距**。
> 对标对象：国内中型互联网公司（几百台机器）和海外成熟 SRE 实践。

### 10.1 差距一：操作入口不同——人是"执行者"还是"审批者"

```
主流公司的层级：
  开发者: git push → CI 自动跑 → 自动部署 staging → 申请上线
  SRE:   审批变更 → 观察灰度 → 确认全量
  CI/CD: 是默认操作入口

SessionBridge 的层级：
  运维: 打开 dashboard → 选择机器 → 点击部署 → 输入参数 → 确认
  CI/CD: 需要 HTTP API 桥接（Core 原语 #2）
```

**差距实质：** SessionBridge 的设计心智是"人操作工具"，主流公司的设计心智是"pipeline 驱动，人做监督"。这不是功能缺失，是**操作范式不同**。

**影响：**
- 开发者习惯 "commit 即部署" 的工作流，不愿意打开 dashboard 点按钮
- 运维需要为每个项目写 "从 git push 到 SessionBridge" 的胶水代码
- 频繁部署的团队（一天多次）会感到摩擦

**缩小差距需要：** 确保 HTTP API 是第一等公民，而不是"后来加的扩展"。一个简单的 `curl relay:8080/api/deploy -d '{"ref":"main"}'` 应该是和 UI 点击同等地位的入口。

### 10.2 差距二：环境无法隔离——只有"生产"没有"多环境"

```
主流公司：
  dev（随便搞） → staging（接近真实） → prod（严格管控）
  每套环境有独立配置、独立数据库、独立权限
  发布顺序：dev 自动 → staging 手动审核 → prod 变更委员会

SessionBridge：
  所有 agent 都是"生产环境"
  —role 区分 web/worker/db，但没有环境维度
```

**差距实质：** 运维成熟度模型里，"区分环境"是 Level 2 到 Level 3 的分水岭。没有环境隔离：
- 怎么在 staging 验证一次发布再上生产？
- dev 配置写错了会改到 prod 吗？
- 一个 agent 既是 staging 又是 prod 时预检链怎么编？

**缩小差距需要：** 并不复杂——agent 注册时除了 `--role`，加一个 `--env` 参数就行了：

```bash
session-bridge agent --role web --env staging ...  
session-bridge agent --role web --env production ...

# adapter 在执行前检查：
# "deploy 命令的 target env 是否等于 agent 的 env?"
# "staging 可以部署 main 分支，prod 只能部署 release 分支"
```

Core 只需透传 `env` 字段（类似 `--role`），adapter 拿到后自己做环境规则。

### 10.3 差距三：发布策略缺少"观察-决策"闭环

```
主流公司（以 K8s rollout 为例）：
  1. 启动新版本 Pod（5% 流量）
  2. 等待 2 分钟，观察 error_rate / latency / business_metric
  3. 如果一切正常 → 提升到 30%
  4. 再观察 2 分钟 → 100%
  5. 如果任何指标异常 → 自动回滚

SessionBridge 当前设计：
  1. 切 nginx 权重到新版本
  2. 验证健康检查
  3. 完成
```

**差距实质：** 金丝雀发布的核心不是"流量切换"，而是"**发布过程中的持续验证**"。当前设计只有"部署后一次健康检查"作为验证点。

**影响：**
- 健康检查通过但业务指标异常（比如 500 错误率没涨但转化率跌了），系统不会发现
- 没有"自动暂停"——金丝雀发现有问题时已经切了 50% 流量
- 发布过程中人的注意力是"持续观察"不是"确认一下就下班"

**缩小差距需要：** 在 adapter 的 deploy 步骤中，增加"监控等待"步骤：

```ts
// 理想的金丝雀流程
const steps = [
  { type: 'nginx.weight', value: 5 },           // 5% 流量
  { type: 'monitor.wait', duration: 120,        // 等 2 分钟
    check: ['error_rate < 1%', 'p95 < 500ms'] }, // 持续验证
  { type: 'nginx.weight', value: 30 },
  { type: 'monitor.wait', duration: 120, ... },
  { type: 'nginx.weight', value: 100 },
  { type: 'health.check' },
]
```

这完全在 adapter 层实现——adapter 周期调 monitoring API 检查指标，直到条件满足或超时。

### 10.4 差距四：变更流程——没有"审批"和"时间窗口"

```
主流公司：
  变更流程：RFC（变更申请）→ 影响评估 → 审批 → 排期 → 执行 → 验证 → 关闭
  变更窗口：每周二/四 10:00-11:00（常见于银行/金融）
  风险等级：L1（普通发布）/ L2（架构变更）/ L3（数据库变更）
  分级审批：L1 技术 leader，L2 CTO，L3 变更委员会

SessionBridge：
  预检链（8 道门）→ 通过就执行 → 结束
```

**差距实质：** SessionBridge 的安全模型是**技术门**（"磁盘够不够"、"分支对不对"），公司的安全模型是**组织门**（"CTO 批准了没"）。

**影响：**
- 没有审批，出了事是你操作的问题，不是流程的问题
- 没有变更窗口，"凌晨 3 点 deploy"理论上可以——预检能过
- 风险等级不分，"重启 PM2"和"改数据库 schema"走的流程一样

**缩小差距需要：** 两个层面：

1. **adapter 层加审批步骤**——deploy 前异步等待 HTTP callback：
```ts
await this.waitForApproval({
  type: 'deploy',
  risk: 'high',
  notify: ['dingtalk://group/ops'],
  timeout: '30m',        // 30 分钟没人审批自动取消
  requiredApprovers: 1,
})
```

2. **变更窗口**——adapter 检查当前时间是否允许操作：
```ts
if (!this.inChangeWindow()) {
  return { blockedBy: [{ gate: 'change_window', message: '变更窗口: 周二 14:00-16:00, 周四 14:00-16:00' }] }
}
```

这两层全部在 adapter 层实现，Core 只需提供 HTTP callback 原语。

### 10.5 差距五：熔断与回滚决策——依赖人还是依赖规则

```
主流公司（阿里的 Zuul/Hystrix / 自愈系统）：
  → 金丝雀阶段错误率 > 5% → 自动熔断，流量切回旧版本
  → 发布后 10 分钟 P1 告警 → 自动回滚
  → 整个流程无人参与

SessionBridge：
  → 金丝雀阶段错误率高 → adapter 发现 → 通知人 → 等人决策
```

**差距实质：** 预检链是"操作前防御"，但缺少"操作中自愈"。公司级运维的核心指标是 **MTTR（Mean Time to Recover）** ，自动化的目标是"秒级恢复，无需人参与"。

**影响：**
- 凌晨 3 点发布出问题，要先告警 → 等人醒了看 → 再决定回滚 → 再操作
- 如果真的想"比肩大厂"，自动熔断是门槛

**缩小差距需要：** 在 adapter 的 deploy 步骤中加"自动回滚条件"：

```ts
const deployPlan = {
  steps: [...],
  autoRollback: {
    enabled: true,
    triggers: [
      { metric: 'error_rate', operator: '>', threshold: 5, window: '1m' },
      { metric: 'p95_latency', operator: '>', threshold: 1000, window: '5m' },
    ],
    maxAutoRollbacks: 2,    // 一天自动回滚超过 2 次则锁定，等人工
  }
}
```

adapter 执行时，每步部署完后持续监控指标，达到条件自动触发回滚——和判断逻辑全在 adapter 层。

### 10.6 差距六：容量弹性——PM2 vs K8s HPA

```
主流公司：
  K8s HPA: CPU > 80% → 自动加 Pod；请求量下降 → 自动缩 Pod
  无需人干预

SessionBridge + PM2：
  PM2 cluster mode: 固定数量的进程
  负载高了 → 人工加进程 或 加机器
```

**差距实质：** 这不是"你的设计不好"，这是你选的技术栈的局限。PM2 就没有自动伸缩的能力。

**影响：**
- 突发流量来了，你的系统会响应变慢，然后你收到告警，然后你 ssh 上去加进程
- 流量走了，你忘了缩回来，成本浪费
- 这不是 adapter 能解决的——PM2 不支持自动扩缩

**缩小差距需要：** 
短期：adapter 提供 "扩容/缩容 脚本" 辅助，还是手动
长期：K8s 或至少容器化 + 自动伸缩

Adapter 能做的：提供一个 `capacity.auto-scale` 操作，在 PM2 层面加/减进程数。但真正的弹性需要 K8s 层支持。

### 10.7 差距七：多区域与故障转移——跨 AZ/Region 部署

```
主流公司：
  多可用区（AZ）：同城两机房，一个挂了另一个扛
  异地多活：上海 ➔ 杭州互备
  DNS 流量调度：Region A 挂了切到 Region B

SessionBridge：
  所有 agent 通过一个 relay 管理
  relay 本身是单点
```

**差距实质：** 当前的 relay 架构是"全局单 relay"。如果 relay 挂了呢？所有 agent 失联。如果 relay 在上海，杭州的 agent 延迟高吗？

**影响：**
- Relay 是单点故障（SPOF）
- 跨区域部署需要 relay 集群或 relay 联邦
- 但没有一个简单的解决方案

**缩小差距需要：** 这不是 adapter 能解决的问题，而是 Core 的 relay 架构需要支持：
- Relay 集群（多 relay 共享状态）
- Agent 自动切换 relay（主 relay 挂了连备 relay）
- 跨区域 relay 联邦（Region A relay 和 Region B relay 可以通信）

**在这之前，SessionBridge 更适合"单数据中心"场景。** 多区域是 Core 架构层面的升级。

### 10.8 差距八：工单与流程集成——Jira/飞书/钉钉审批流

```
主流公司：
  发布流程：
  1. 开发在 Jira 提上线申请
  2. Jira 自动通知审批人（通过飞书/钉钉）
  3. 审批人在 IM 里点"同意"
  4. Jira webhook 触发 CI/CD
  5. CI/CD 执行发布
  6. 发布完成自动更新 Jira 状态

SessionBridge：
  所有操作在 SessionBridge Dashboard 里完成
  外部系统集成需要 HTTP API 桥接
```

**差距实质：** 公司里真实的变更入口不是运维工具，而是 Jira、飞书审批、钉钉审批。如果 SessionBridge 不能融入这个流程，它就是一个"另外的工具"——运维多了一个要打开的东西。

**影响：**
- 开发不会为了部署专门打开 SessionBridge
- 审批人在飞书里看不到变更详情，要去 SessionBridge 看
- 审计要查 Jira 和 SessionBridge 两边的记录，对不上

**缩小差距需要：** 这是 adapter 可以发力的地方：
- 部署前 adapter 通过 webhook 创建飞书审批
- 审批通过后飞书 webhook 回调 adapter
- 部署完成 adapter 更新 Jira 状态

不需要改 Core，adapter 做 HTTP 调用即可。

### 10.9 综合差距矩阵

```
维度              主流公司水平              SessionBridge        差距大小  能否用 adapter 缩小
─────────────────────────────────────────────────────────────────────────────────────────
操作入口           pipeline 优先            UI 优先                 大      HTTP API + CI 集成
多环境隔离         dev/staging/prod         只有生产                中      --env 参数 + 规则
发布观察闭环       持续监控+自动暂停         单次健康检查             大      监控等待步骤
变更审批          流程引擎+分级审批          无                      大      HTTP callback 审批
自动熔断/回滚      指标触发自动回滚           依赖人决策              大      autoRollback 配置
容量弹性           HPA 自动扩缩              PM2 固定进程            极大    不可在 adapter 解决
多区域/故障转移    多 AZ 多 Region           单 relay SPOF          极大    不可在 adapter 解决
工单流程集成       Jira/飞书审批流           全部自闭环               大      webhook 桥接
安全合规           SOC2/等保                有预检链无合规框架       中      审计日志模板
混沌工程           Chaos Monkey/Blade       无                      大      可做简单的故障注入
SLO 管理           服务目标+错误预算          无                      大      adapter 可采集
```

### 10.10 那么结论是什么？

**实话实说：**

这些差距里，**大概有一半可以通过 adapter 层补齐**（审批、自动回滚、多环境规则、工单集成、监控等待）。这些是"工作量问题"，不是"架构问题"。

**另一半是架构层或者技术栈本身的局限**：
- **操作入口 pipeline 优先**——需要改变 Core 的设计心智，把 HTTP API 从"扩展"变成"一等公民"
- **单 relay SPOF**——需要 Core 的 relay 架构支持集群/联邦
- **容量弹性**——PM2 做不到，需要 K8s
- **多区域部署**——relay 单点跨越不了 Region

**所以回答你的问题：**

和主流公司的差距不在"功能少"（功能可以 adapter 层慢慢加），在**两个范式差异**：

1. **"人操作" vs "pipeline 驱动"**——SessionBridge 的核心是人在 dashboard 操控机器，而公司级的核心是 pipeline 自动流转、人只做监督和审批。这是设计哲学的不同，不是一两个功能能调的。

2. **"单点 relay" vs "分布式控制平面"**——K8s 的 control plane 是高可用的 etcd + api-server 集群。SessionBridge 的 relay 目前是单进程。只要 relay 挂了或网络分区了，所有 agent 失联。

**如果这两个范式问题你认可并能接受，那 adapter 层能把剩下的所有功能补到你想要的完备程度。**
