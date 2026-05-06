# SessionBridge 实践分析

> 从真实场景出发，评估架构在实际使用中的能力边界与潜在问题。
> 不讨论"代码好不好"，只讨论"用起来会怎样"。

---

## 一、场景映射：现有架构能覆盖什么

### 场景 1：单人远程开发

```
你在家 → 打开浏览器 → 连上 VPS 的 relay → 操作 Claude Code
```

**能跑通吗：** ✅
**实际情况：**
- WebSocket hello/welcome 握手 → ✅
- 启动 Claude Code session → ✅
- 终端交互 → ✅
- 文件浏览 → ✅

**此时暴露的问题：**
- 无鉴权，只要知道 relay 地址就能连
- 断线重连后 session 丢失，Claude 在后台跑完了但你看不到结果

### 场景 2：多人同时操作一台机器

```
你: 看日志 tail -f
同事: git pull 部署

→ 两条命令先后进同一个 shell 进程
```

**能跑通吗：** ⚠️ 能，但不可控
**实际问题：**
- shell 是共享的，输出会交错
- 你敲 Ctrl+C 可能中断同事的操作
- 没有"操作锁"，没有"操作属于谁"的概念

**当前架构处理不了但实际需要：**

```
期望行为：
  你: 开一个只读终端 → "只看不碰"
  同事: 开一个操作终端 → 独占执行权
  Core 确保: 同时间只有一个人在执行写操作
```

### 场景 3：机器离线、网络不稳定

```
Agent 在 VPS 跑着，你在咖啡厅用笔记本控制
→ 网络断了又连，反复 5 次
```

**能跑通吗：** ⚠️ 跑通，但有数据丢失
**当前行为：**
- Agent 侧有指数退避重连（1000ms → 30000ms） ✅
- 重连后重新注册，拿新 instanceId ✅
- 但之前的 session 不在了，shell 进程变成孤儿 ❌

**实际损失场景：**
```
Agent 正在执行 deploy:
  Step 1/3: git pull         → 完成
  Step 2/3: pnpm build       → 正在进行
  ↑ 此时网络断了

30s 后重连成功：
  → 浏览器看到空的 dashboard
  → build 还在跑（进程还在），但看不到输出了
  → 你不知道到哪一步了，只能猜
  → 重跑 deploy 可能冲突，不重跑可能卡在那
```

### 场景 4：Claude Code 生产出大量输出

```
你让 Claude 分析日志: "cat access.log | grep error"
→ 输出 10 万行
```

**能跑通吗：** ❌ 会崩
**实际问题：**
- `capability-host.ts` 里 stdout 通过 `on('data')` 回调直接转发
- 没有背压控制，数据进来多少就发多少
- 输出量超过 WebSocket 单帧限制（约 1MB）时连接断开
- Browser 端收到的数据不完整，无法继续对话

### 场景 5：Ops 发现问题 → 转给 Claude 诊断

```
DeploymentOpsAdapter 发现 worker OOM
→ 想把 error log 传给 Claude Code adapter 分析原因
```

**能跑通吗：** ❌ 跨 adapter 通信无路径
**实际问题：**
- Core 没有 message bus 或 pub/sub
- 两个 adapter 彼此不知道对方存在
- 只能用文件系统传（Ops 写到文件，Claude 读文件），但路径/权限/时序都要自己管

### 场景 6：生产环境滚动升级

```
3 台机器:
  web → 需要升级
  worker → 需要升级
  db → 不需要升级

操作:
  1. 锁定 web 的 nginx（切流量到备用）
  2. git pull && pnpm build && pm2 restart
  3. 验证健康
  4. 解锁 nginx
```

**能跑通吗：** ❌ 核心能力缺失
**当前具备：** agent 能在每台机器上跑
**当前不具备：**
- 没有"操作计划"概念（Step 1→2→3→4）
- 没有"全部成功才生效"的事务语义
- 没有"步骤失败时回滚"
- 没有"某个操作要在指定角色的机器上执行"

### 场景 7：第三方接入

```
你想写一个 CI/CD 脚本，通过 SessionBridge API 做部署：
  curl -X POST relay:8080/api/deploy
```

**能跑通吗：** ❌ 无 HTTP API
**现状：**
- relay 只有 WebSocket 协议
- dashboard 有 HTTP 端口，但只是本地 localhost 的调试页面
- 没有 REST/gRPC API 可供外部程序调用

### 场景 8：审计与回溯

```
出故障了，你想看:
  "昨天下午 3 点谁在 worker 上执行了什么命令?"
```

**能跑通吗：** ❌ 无审计日志
**现状：**
- 所有操作都是 WebSocket 消息，处理完就丢弃
- shell 输出只在浏览器内存里，关了就没了
- 没有操作日志、没有操作人记录、没有时间线

---

## 二、按场景看架构缺陷汇总

| 缺陷 | 涉及场景 | 根因 | 影响程度 |
|------|----------|------|----------|
| 无网络层鉴权 | 1, 2 | relay 没有 token 验证 | 🔴 任何知道地址的人都能连 |
| 无操作人概念 | 2, 8 | 消息没有"发送者身份"字段 | 🟡 多人场景不可用 |
| 无操作锁 | 2, 6 | shell/控制是共享的 | 🟡 多人导致冲突 |
| 无会话持久化 | 1, 3, 8 | session 只有内存态 | 🟡 断线即丢失 |
| 无孤儿进程管理 | 3 | agent 不追踪子进程生命周期 | 🔴 断线后产生僵尸 |
| 无背压控制 | 4 | stdout 直接转发 | 🔴 大输出导致 OOM 或断连 |
| 无消息分片 | 4 | WebSocket 单帧无上限但网络层有限 | 🔴 大帧会断连 |
| 无跨 adapter 通信 | 5 | adapter 完全隔离 | 🔵 无法编排 |
| 无操作计划 | 6 | 只有即时命令 | 🔴 不能做多步部署 |
| 无事务回滚 | 6 | 没有步骤状态追踪 | 🟡 失败后状态不确定 |
| 无角色感知 | 6 | 机器没有"我是 web"的概念 | 🔵 操作只能手动选机 |
| 无 HTTP API | 7 | 只有 WebSocket 协议 | 🟡 不能被脚本/CI 调用 |
| 无审计日志 | 8 | 消息不留存 | 🟡 事后追溯困难 |

---

## 三、实际可能发生的故障案例

以下不是"理论上可能出问题"，而是**真实线上会遇到**的场景：

### 案例 A：断线后重复部署

```
1. 你执行 deploy: git pull + pnpm build + pm2 restart
2. 在 pnpm build 阶段网络断了
3. Agent 重连，但你不知道 build 还在跑
4. 你重新执行 deploy → git pull 时和正在进行的 build 冲突
5. 两个 build 同时写 dist/ → 文件损坏 → 服务挂了
```

**根因链：** 无孤儿进程追踪 → 无 session 持久化 → 无操作锁

### 案例 B：大日志拖垮浏览器

```
1. Claude Code: "cat /var/log/nginx/access.log | grep 5xx"
2. 输出 5MB 日志 → WebSocket 单帧超限 → 断连
3. Browser 重连 → 但 Claude 还在输出 → 又断
4. 反复重连断开 → 浏览器卡死
```

**根因链：** 无背压 → 无分片 → 无输出截断策略

### 案例 C：两个浏览器互相干扰

```
1. 浏览器 A：tail -f logs/error.log（持续输出）
2. 浏览器 B：cd /home/deploy && git pull
3. git pull 的输出混在 tail -f 的流里
4. B 看不到 git pull 的结果 → 以为没执行 → 又敲一次
5. 两个 git pull 冲突
```

**根因链：** 无会话隔离 → 无操作人标识 → 全局共享 shell

### 案例 D：agent 被 kill 后恢复

```
1. VPS OOM killer 把 agent 进程杀了
2. relay 端显示 "agent 离线"
3. 但 agent 管理的 Claude Code / 部署进程还在（孤儿）
4. Agent 自动重启（systemd/PM2）→ 注册到 relay
5. 新 agent 不知道旧进程存在 → 再 spawn 一个 Claude
6. 两个 Claude 在同一个目录操作 → 数据竞争
```

**根因链：** 无进程组管理 → 无启动前清除

---

## 四、跨领域缺失

### 4.1 状态机与恢复

当前只有消息流，没有**状态机**。真实场景需要：

```
一个操作的全生命周期：
  PENDING → RUNNING → SUCCEEDED / FAILED / ROLLED_BACK
                                              ↓
                                           ROLLING_BACK → ROLLED_BACK

断线重连后：
  → Agent 说 "我正在 RUNNING"
  → Browser 说 "我从 ROLLING_BACK 开始"
  → 两边协商出当前实际状态
```

### 4.2 流量控制（多层级的背压）

输出量大的场景不是"加个 maxBuffer"能解决的，需要分层策略：

```
Agent 进程 stdout → [背压策略] → WebSocket → [背压策略] → Browser
                     ↑                          ↑
                 策略可选:                   策略可选:
                 • 截断 (只保留 1000 行)      • 分页
                 • 采样 (每 10 行取 1)        • 懒加载
                 • 压缩                       • 搜索过滤
                 • 分片传输
```

### 4.3 操作人的身份透传

多人场景下，一条消息应从 Browser 端携带身份，一直透传到 Agent 端执行：

```
Browser A: { type: "shell.input", data: "git pull", user: "zhp" }
  → Relay: { type: "agent.stdin", data: "git pull", user: "zhp" }
    → Agent: 记录 "zhp 执行了 git pull"
    → 审计日志: { time, user, action, result }
```

当前协议没有 `user` 字段，也无法扩展（因为 Core 不解析 body）。

### 4.4 项目级配置管理

一个 Agent 启动时需要知道的不仅仅是 "relay 地址和工作目录"，在真实部署中：

```
Agent 的配置比当前模型复杂得多:
{
  relayUrl: "ws://vps:8080",
  project: "AurumScout",
  role: "web",                    // 当前没有
  env: { V2_ENABLED: "1" },       // 当前没有
  schedule: {                      // 当前没有
    healthCheck: "*/5 * * * *",
    autoReconnect: true
  },
  limits: {                        // 当前没有
    maxOutputMB: 10,
    maxSessionAge: "24h"
  }
}
```

这些配置应该由 relay 下发，而不是每个 agent 各自声明。否则 3 台机器要手动配 3 份，且不一致时无法发现。

---

## 五、设计建议优先级

```
现在不改一定会出事：
──────────────────────────────────
  P0  网络层鉴权               relay 加 token
  P0  WebSocket 大帧处理       消息层分片/压缩
  P0  孤儿进程管理             agent 启动时清理旧进程

应该在 P0 修完后优先做：
──────────────────────────────────
  P1  操作锁机制               session 级别锁
  P1  会话持久化               写到文件，断线可恢复
  P1  背压控制                 stdout 流策略

设计阶段留接口，但不急于实现：
──────────────────────────────────
  P2  跨 adapter 通信          Core 加简单 EventBus
  P2  操作计划 + 回滚          ops adapter 层实现
  P2  HTTP API                 relay 加 REST 端点
  P2  审计日志                 消息持久化策略
  P2  身份透传                 协议加 user 字段

长期演进：
──────────────────────────────────
  P3  状态机                   操作生命周期
  P3  配置中心                 relay 统一下发配置
  P3  多环境管理                dev/staging/production
```

---

## 六、与 AurumScout 的对应关系

```
SessionBridge 问题         对 AurumScout 3 机部署的实际影响
────────────────────────────────────────────────────────────
无鉴权                     Relay 端口暴露 → 任何人能连你的运维 console
无会话持久化               排查到一半断线 → 重连后发现上下文全丢
无孤儿进程管理              Worker 机器上 deploy 断线 → 残留进程冲突
无背压/大帧               `pm2 logs` 或 `tail -f` 输出太大 → WebSocket 断
无操作锁                   你和同事同时操作 worker → 命令交错
无操作计划                 "更新 web 服务器" 要手动 4 步，没有一键
无角色感知                 web/worker/db 三台机器手动切，dashboard 看不出谁是谁
无审计日志                 出了故障不知道谁做了什么
```

---

这份文档不是批评架构不好，而是把**真实环境的使用成本和风险暴露出来**。你的 adapter 设计、relay 协议、权限模型都是对的，缺的是上面这些"真实世界会咬人的细节"。

---

## 七、Core 必须预留的三个基础设施原语

分析完所有场景后，有一个结论反复出现：**不是 Core 要懂运维领域逻辑，而是 Core 缺少三层通用的 transport 原语。**

这三层全部是消息路由 / 协议转换 / 状态管理层面的能力——与运维无关，是任何多机远程操作场景都需要的基础设施。

### 7.1 消息路由原语：单播 → 组播

当前 Core 的 relay 是纯透传：`Brower → Relay → Agent`，一对一。

多机场景需要一组通用的路由能力：

```
当前（一对一）:
  Browser → Relay → Agent-A
                    Agent-B  ← 看不到这条消息

需要:
  Browser → Relay ─→ Agent-A      (角色寻址: "发给所有 web")
                   ─→ Agent-B
                   ─→ Agent-C     (组播/广播)

  Browser → Relay → [Agent-A, Agent-B] → 按顺序执行 → Agent-C  (序列编排)
```

**Core 需要提供——但不解析内容——的消息原语：**

```ts
// 原语 1：角色路由
relay.sendToRole('web', msg)           // 发给所有 web 角色
relay.sendToRole('worker', msg)        // 发给所有 worker 角色

// 原语 2：组播
relay.sendTo(['agent-a', 'agent-b'], msg)  // 发给指定多个 agent

// 原语 3：序列发送
relay.sendSequence([
  { to: 'agent-a', msg: deployWeb },
  { waitFor: 'healthy' },              // 等待前一个确认
  { to: 'agent-b', msg: deployWeb },
  { to: 'agent-c', msg: deployWorker },
])
```

**Core 不做什么：**
- 不解析 `msg` 的内容
- 不关心 `deploy` 是什么
- 不做编排决策（只按序列投递，成功/失败交给调用方）

**为什么这是通用原语而非运维领域逻辑：**
- 角色寻址 = 消息队列的 routing key
- 组播 = pub/sub 的基础模式
- 序列发送 = 消息系统的工作流/编排原语

**如果不做**，所有多机编排都必须在 Browser 侧手写，且断线后状态全丢。

### 7.2 HTTP API 层：让 CI/CD 能调用

当前只有 WebSocket 协议，意味着：
- CI 工具（GitHub Actions, GitLab CI）无法触发操作
- 定时任务（cron）只能通过 agent 本地触发
- 第三方系统（告警、PagerDuty）无法集成

**Core 需要 HTTP 端点，但不是 RESTful API 设计——只是协议转换：**

```
HTTP Request                     Relay
─────────────────────────────────────────────
POST /api/execute                ─→ 转换为 WS 消息发给 agent
  { cmd: "deploy", target: "web" }   ← 收集结果返回 HTTP response

GET /api/status                  ─→ 查询所有 agent 状态
GET /api/agents                  ─→ 列出在线 agent

Webhook 回掉：
  → 操作完成时 POST 到指定 URL（给 CI 用）
```

**Core 不做什么：**
- 不验证 `cmd` 是否合法（交给 adapter）
- 不提供业务级别的 API 文档（由 ops adapter 定义）
- 只做 `HTTP ↔ WS` 的协议桥接

**实现方式**：在 relay 或 dashboard server 上绑几个路由——不修改 Core 的消息模型。

如果不做，SessionBridge 永远是"手动工具"，无法融入自动化流水线。

### 7.3 Session 持久化：断线恢复与操作锁

运维操作是长时间操作（`pnpm build` 要几分钟），当前全内存的 session 模型在多机运维场景下直接失效：

```
场景：你 deploy 到一半断线

当前行为：
  agent 还在跑 build（进程还在）
  relay 侧 session 已销毁
  重连后：空的 dashboard，不知道 build 到哪一步了
  结果：要么重跑（冲突），要么等（不确定）

需要的行为：
  重连后：
    → "Agent-A 的上次操作: deploy(web)，步骤 3/6 build，已运行 82s"
    → 你可以选择：[重连输出] [中止] [忽略]
```

**Core 需要 session 持久化，但不是全量持久化——只存状态快照：**

```ts
interface SessionSnapshot {
  instanceId: string;
  role?: string;              // agent 角色（Core 不解析，透传）
  status: 'idle' | 'running' | 'error';
  runningOp?: {               // 当前操作（如果有）
    id: string;
    cmd: string;              // Core 不解析
    startedAt: number;
    step?: number;
    stepName?: string;
  };
  lastActivity: number;
}
```

持久化策略：
- **状态快照**：agent 每次 step 变更时上报（秒级）
- **输出流**：仅保留最近 N 行（文件轮转），非全量
- **存储后端**：内存（默认）→ 文件/Redis（可选），Core 只依赖 `save/load` 接口

**为什么是 Core 的职责：**
- Adapter 不应该自己管持久化（否则每个 adapter 写一套文件管理）
- 重连恢复是 relay 层的职责——relay 要把正确的 session 还给重连的 client
- 操作锁依赖持久化状态：`agent 说“我在忙”，其他人不能抢`

**如果不做**，SessionBridge 在断网环境下不可用，而公司级运维不假设网络永远稳定。

### 7.4 与 Core 的关系总结

```
Core（纯通用，不引入领域逻辑）
  │
  ├── Relay 扩展     ← 消息路由原语（角色/组播/序列），非运维逻辑
  ├── HTTP 端点      ← 协议桥接（HTTP ↔ WS），非运维逻辑
  └── Session 持久化  ← 状态管理，非运维逻辑
        │
        ▼
  DeploymentOpsAdapter（纯粹的领域逻辑，全部在 adapter 层）
    ├── 预检链、部署、回滚 ✓
    ├── 进程管理、健康检查 ✓
    └── 灰度、蓝绿、金丝雀 ✓  ← 只要路由原语到位，这些全能在 adapter 层实现
```

**三条原语全部与运维无关。** 即使 SessionBridge 只用来做多机 Claude Code，也需要这三条：
- 给某台机器发命令 → 单播已有
- 发给所有机器 → 角色路由/组播
- 换个姿势重连 → 会话持久化

做好了，不只是撑运维，是撑所有多机场景。
