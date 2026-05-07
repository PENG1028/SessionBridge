# SessionBridge — 设计总览

> 最后更新: 2026-05-06

---

## 一、要解决什么问题

### 核心场景

你在手机上打开浏览器，连到 VPS 上的 SessionBridge，操控 Claude Code 干活。

```
手机浏览器 → VPS 上的 relay 服务器 → Claude 进程
```

### 三种具体用法

**场景 A：Claude 跑在 VPS 上**
手机操控 VPS 上的 Claude，代码在 VPS 上，适合服务器端开发任务。

**场景 B：Claude 跑在家里电脑上**
VPS 做中继，家里电脑主动连上 VPS，手机操控家里的 Claude。适合需要本地环境/资源的任务。

**场景 C：本地开浏览器**
`npm start` 后开 `localhost:8080`，本地调试用。和前两个场景界面完全一样。

### 现已更新

v0.6 已统一为节点拓扑：每个部署实例运行相同的 `NodeRuntime` 二进制，角色自动检测（relay/leaf），节点间对等通信。

---

## 二、设计原则

### 1. 一个端口干所有事

不拆分前端和后端端口。relay 服务器同时提供页面、API、WebSocket，部署简单。

### 2. 节点即平台

每个节点运行相同的 `NodeRuntime`。角色（relay/leaf）自动检测，也可以手动指定。节点可以控制其他节点，也可以被控制——所有节点是对等的。

### 3. 实例=执行上下文

每个实例是一个子进程 + 独立目录。InstanceManager 管理多个实例，支持本地进程和远程 agent 连接。操作状态机跟踪每个实例的操作生命周期（pending→running→succeeded/failed/cancelled）。

### 4. Adapter 插件体系

核心（Core）不依赖任何特定 AI 引擎。通过 `AgentAdapter` 接口接入 Claude Code、Shell、或其他自定义后端。Adapter 声明自己的能力和 UI 组件。

---

## 三、架构总览

```
┌──────────┐   HTTP/WS + AES-256-GCM   ┌──────────────────────────────────────┐
│ Flutter   │ ◀══════════════════════▶  │  NodeRuntime 节点                      │
│ APK/手机  │   (可选 TLS 叠加)         │                                      │
│ (任何设备)│                           │  ├─ 提供 Web UI (out/)               │
│           │                           │  ├─ REST API (8 端点)                │
│           │                           │  ├─ CryptoStream 加密层              │
│           │                           │  ├─ WebSocket 通信 (分片/背压/锁)     │
│           │                           │  ├─ RelayEventBus (跨适配器通信)      │
│           │                           │  ├─ InstanceManager + 状态机          │
│           │                           │  ├─ SessionPersistence               │
│           │                           │  ├─ AuditLogger                      │
│           │                           │  └─ 管理 adapter 实例                │
└──────────┘                           └──────────────────────────────────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    ▼                            ▼                            ▼
              Claude Code                    Shell 终端                   远程节点 (加密)
              (claude-code                   (shell                        (通过 WebSocket +
               adapter)                       adapter)                      AES-256-GCM 连接)
```

## 四、当前状态与路线

### ✅ 已实现（v0.6）

- [x] NodeRuntime 统一节点运行时（自动检测角色 relay/leaf）
- [x] 节点身份系统（nodeId 自动生成 + 持久化）
- [x] relay 服务器（HTTP + WS + API）
- [x] InstanceManager（多实例 CRUD + 操作状态机）
- [x] Claude 子进程 spawn / kill / 流式解析
- [x] Web UI（终端 / 工具卡片 / 文件树 / 实例面板）
- [x] Checkpoint / 回滚
- [x] API（文件系统 / 队列 / 会话）
- [x] 静态文件服务（out/）
- [x] 远程 agent 支持（对等节点连接）
- [x] 源锁定队列（多窗口防冲突）
- [x] 会话搜索 / 历史浏览
- [x] 独立 Shell 终端（含写锁协议）
- [x] 权限模式切换（default / acceptEdits / plan）
- [x] 思考力度控制（low / medium / high）
- [x] WebSocket 大帧分片（64KB 帧 + seq/total 重组）
- [x] Stdout 背压控制（Readable.pause/resume）
- [x] 网络层鉴权（relayToken）
- [x] 应用层 AES-256-GCM 加密（ECDH 握手 + 每连接会话密钥）
- [x] 节点身份密钥（Ed25519，首次启动自动生成）
- [x] 加密/非加密客户端共存（feature 协商）
- [x] 孤儿进程清理（PID 文件追踪）
- [x] 会话持久化（断线 60s 重连恢复）
- [x] HTTP REST API（8 端点，src/api-routes.ts）
- [x] 跨适配器 EventBus（RelayEventBus，自动注入 nodeId）
- [x] 审计日志（JSONL 格式，按日轮转）
- [x] 配置推送（relay → agent，含键验证）
- [x] 结构化通知（SystemToast）
- [x] NodeConfig.extensions 扩展袋
- [x] Adapter 插件体系（AgentAdapter 接口，3 个已注册适配器）

### 🔜 下一步

- [ ] Flutter APK（WebView + 后台通知 Service + WebSocket 加密连接）
- [ ] Cloudflare Tunnel 集成
- [ ] 文件上传/下载
- [ ] TodoWrite / EnterPlanMode UI 实现（协议识别已就绪，见 [todo-plan-implementation.md](./todo-plan-implementation.md)）
- [ ] 消息路由原语（角色寻址 / 组播 / 序列发送）
- [ ] 多身份/权限分层（节点级角色与访问控制）
- [ ] 适配器市场 / 自动更新机制
