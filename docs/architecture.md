# SessionBridge — 架构文档

> 最后更新: 2026-05-01

---

## 一、项目定位

SessionBridge 是 **Claude Code 的 Web 前端 + 远程网关**。

不是终端桥接工具，不是 SSH 客户端。目标是在手机浏览器上操作 Claude Code，不管 Claude 跑在哪——VPS 上、家里电脑上、还是两者都有。

---

## 二、部署场景

两种部署模式，`npm start` 同一套代码，区别在于 Claude 跑在哪。

### 场景 A：VPS 本地执行（主要场景）

```
手机浏览器 ──▶ Cloudflare CDN ──▶ VPS :443
                                       nginx
                                       ├─ /* 静态资源 → CDN 缓存
                                       ├─ /api/*  ──▶ relay :8080
                                       └─ /ws     ──▶ relay :8080
                                                            │
                                                            ├─ 提供 Web UI (out/)
                                                            ├─ REST API
                                                            ├─ WebSocket
                                                            └─ 管理 Claude 子进程
```

Claude 直接跑在 VPS 上。手机通过网页操控 VPS 上的 Claude，代码和文件都在 VPS 上。

### 场景 B：远程中继到家里电脑

```
手机浏览器 ──▶ Cloudflare CDN ──▶ VPS :443
                                       nginx
                                       ├─ /agent/ws ◀── 家里电脑 agent 主动连接
                                       ├─ /api/*  ──▶ relay :8080
                                       └─ /ws     ──▶ relay :8080
                                                            │
                                                     InstanceManager
                                                     ├─ [local] VPS 本地实例
                                                     └─ [remote] 家里电脑实例
                                                                            │
                                                              家里电脑 agent
                                                              (主动连上 VPS)
                                                                     │
                                                                  Claude 进程
```

家里电脑主动连上 VPS 的 WebSocket（不需要公网 IP，不需要隧道），VPS 把它注册为一个远程实例。手机在 UI 上切换实例即可选择在哪执行。

### 场景选择

| | 场景 A | 场景 B |
|---|---|---|
| Claude 跑在哪 | VPS 上 | 家里电脑上 |
| 需公网 IP | VPS 需要 | 不需要（agent 主动连出） |
| 延迟 | 低 | 取决于家庭网络 |
| 适用场景 | 代码在 VPS 上 | 要用家里电脑的资源/环境 |

两种场景可以并存——VPS 上可以同时有本地实例和远程实例。

---

## 三、当前架构

```
┌─────────────────────────────────────────────────────────┐
│  relay 服务器 (:8080)                                    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  HTTP 服务器                                        │   │
│  │  ├─ 静态文件 (out/)  ← next build 产物             │   │
│  │  ├─ REST API (文件树/实例/checkpoint)               │   │
│  │  └─ WebSocket                                      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  InstanceManager                                   │   │
│  │  ├─ 管理多个 Claude 实例                          │   │
│  │  ├─ 每个实例有独立的进程/缓冲/checkpoint           │   │
│  │  └─ 支持本地实例 + 远程 agent 实例                │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Claude 实例 (子进程 spawn)                        │   │
│  │  ├─ stdin (stream-json 输入)                      │   │
│  │  ├─ stdout (流式 JSON 解析)                       │   │
│  │  └─ 心跳 + 队列管理                               │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  CheckpointManager                                │   │
│  │  ├─ 每次 tool 调用前创建 checkpoint               │   │
│  │  ├─ 文件级快照 (备份被修改的文件)                 │   │
│  │  └─ 每个实例独立                                  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         │ WebSocket
         ▼
┌─────────────────────────────────────────────────────────┐
│  Web UI (Next.js 静态导出 → out/)                        │
│                                                         │
│  功能:                                                   │
│  ├─ 终端输出 (ANSI 解析)                                │
│  ├─ 工具调用可视化 (文件编辑/bash 等)                    │
│  ├─ 文件树浏览/打开                                     │
│  ├─ 实例管理面板 (切换/创建/删除)                       │
│  ├─ 消息日志                                            │
│  └─ Checkpoint 回滚                                     │
└─────────────────────────────────────────────────────────┘
```

---

## 四、目录结构

```
sessionBridge/
├── src/
│   ├── index.ts              # CLI 入口
│   ├── relay-server.ts       # 主服务器 (HTTP + WS + Claude 管理)
│   ├── instance-manager.ts   # 多实例管理
│   ├── stream-parser.ts      # Claude stream-json 解析器 (本地/远程共用)
│   ├── checkpoint-manager.ts # 文件级 checkpoint
│   ├── rate-limiter.ts       # API 频率限制
│   ├── agent.ts              # 远程 agent (家里电脑主动连 VPS)
│   ├── protocol.ts           # 消息信封 (v1 信封格式)
│   ├── ansi.ts               # ANSI 转义解析
│   ├── browser.ts            # 跨平台打开浏览器
│   └── i18n.ts               # 多语言
├── app/
│   ├── page.tsx              # Web UI (React/Next.js)
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── ws-client.ts          # WebSocket 客户端封装
│   ├── use-ws.ts             # React hook
│   └── session-store.ts      # IndexedDB 持久化
├── docs/
│   ├── architecture.md       # ← 本文档
│   ├── protocol.md           # 通信协议
│   ├── development.md        # 开发指南
│   ├── design-overview.md    # 设计总览
│   └── todo-plan-implementation.md  # TodoWrite/EnterPlanMode 实现方案
├── tests/
│   ├── unit/                 # 单元测试
│   ├── integration/          # 集成测试
│   ├── cross/                # 跨模块测试
│   └── helpers/              # 测试工具
├── out/                      # next build 产物 (gitignored)
├── content/                  # 会话数据目录
├── package.json
├── next.config.js
├── tsconfig.json
└── tsconfig.server.json
```

---

## 五、核心模块

### relay-server.ts

单一入口，负责所有 HTTP 请求、WebSocket 连接和 Claude 进程管理。

```
请求路由:
  GET  /api/health                  → 健康检查 (含实例/队列/内存详情)
  GET  /api/info                    → 项目信息
  GET  /api/list?dir=               → 文件树
  GET  /api/read-file?path=         → 读取文件
  POST /api/write                   → 写入文件 (checkpoint 回滚用)
  GET  /api/checkpoints             → 列出 checkpoints
  POST /api/rewind                  → 回滚上一个 checkpoint
  POST /api/rewind-all              → 回滚当前 turn 所有 checkpoint
  GET  /api/sessions/search?q=      → 搜索 Claude 历史会话
  GET  /api/sessions/detail?id=     → 会话详情
  GET  /api/sessions/current        → 当前工作区会话
  POST /api/session/switch          → 切换目录 (创建新实例)
  GET  /api/instances               → 实例列表
  POST /api/instances               → 创建实例
  DELETE /api/instances/:id         → 删除实例
  POST /api/instances/:id/activate  → 切换实例
  GET  /api/queue                   → 队列状态
  GET  /api/mode                    → 权限模式 / 思考力度
  POST /api/interrupt               → 中断 + 自动回滚
  /*                                → 静态文件 (out/)
```

### instance-manager.ts

管理多个 Claude 实例，每个实例有独立状态。

```typescript
InstanceData {
  id, dir, label, status     // 基本信息
  process                     // Claude 子进程
  model                       // 当前模型
  thinkingId, toolUseId, ...  // 流式解析状态
  blockBuffer, outputBuffer   // 输出缓存
  checkpointManager           // 独立 checkpoint
  isProcessing, pendingQueue  // 队列状态
}
```

支持扩展远程 agent：只需在 `process` 字段放一个 WS 连接对象代替子进程即可。

### Web UI (app/page.tsx)

单页应用，所有功能在一个页面：

- 左侧: 文件树 / 实例面板 / 操作按钮
- 中间: 终端输出 + 工具调用卡片 + 回滚按钮
- 底部: 消息日志

---

## 六、数据流

```
用户输入 (浏览器)
    ↓
WebSocket → relay-server
    ↓
InstanceManager 路由到目标实例
    ↓
Claude 进程 stdin (stream-json)
    ↓
Claude 进程 stdout (流式 JSON)
    ↓
relay-server 解析 (thinking/tool_use/tool_result/text)
    ↓
WebSocket 推送回浏览器
    ↓
UI 渲染 (终端 / 工具卡片 / 状态更新)
```

---

## 七、通信协议

详见 [protocol.md](./protocol.md)。

核心消息类型：`auth` / `input` / `output` / `block` / `command_result` / `queue_status` / 实例管理消息。

---

## 八、与旧架构的关系

本项目的 v0.1-v0.4 使用 Bridge/PTYSession/node-pty 架构，v0.5 重写为现在的 relay + InstanceManager 架构。

| 旧架构 | 新架构 | 原因 |
|--------|--------|------|
| PTYSession (node-pty) | 直接 spawn Claude 子进程 | 减少依赖，简化流式解析 |
| Bridge 管理器 | relay-server 直接处理 | 去掉抽象层，减少 indirection |
| LocalServer + RelayClient | 统一 relay 服务器 | 单端口部署更方便 |
| `/remote` 命令模式 | 实例选择 + agent 连接 | 支持多实例和远程中继 |
| `web/` 子目录 | `app/` + `lib/` 根目录 | Next.js App Router 约定 |
