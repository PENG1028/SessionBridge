# SessionBridge — 设计总览

> 最后更新: 2026-05-01

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

### 之前为什么有误解

因为文档和代码脱节了。旧文档描述的是 Bridge/PTY/node-pty 的架构（v0.4），现在的代码已经是 relay + InstanceManager（v0.5），两回事。

---

## 二、设计原则

### 1. 一个端口干所有事

不拆分前端和后端端口。relay 服务器同时提供页面、API、WebSocket，部署简单。

### 2. Claude 是子进程，不是服务

不用 Docker、不用 systemd 服务化 Claude。relay 直接 spawn 子进程，通过 stdin/stdout 通信，生命周期由 relay 管理。

### 3. 实例=执行上下文

每个实例是一个 Claude 进程 + 独立目录。InstanceManager 管理多个实例，UI 上可以切换。后期扩展远程 agent，只需把 agent 连接注册为一个实例。

### 4. 不入侵 Claude

不过滤、不修改、不解析 Claude 内部逻辑。所有 slash command 透传。只在 I/O 层做代理。

---

## 三、架构总览

```
┌──────────┐   HTTPS/WS   ┌──────────────────────────────────┐
│ 手机浏览器  │ ──────────▶ │  relay 服务器                      │
│           │              │  ├─ 提供 Web UI (out/)           │
│           │              │  ├─ REST API                    │
│           │              │  ├─ WebSocket 通信               │
│           │              │  └─ 管理 Claude 实例             │
└──────────┘              └──────────────────────────────────┘
                                          │
                               ┌──────────┴──────────┐
                               ▼                      ▼
                         Claude 子进程             远程 agent
                         (VPS 本地)             (家里电脑)
```

## 四、当前状态与路线

### ✅ 已实现

- [x] relay 服务器（HTTP + WS + API）
- [x] InstanceManager（多实例 CRUD）
- [x] Claude 子进程 spawn / kill / 流式解析
- [x] Web UI（终端 / 工具卡片 / 文件树 / 实例面板）
- [x] Checkpoint / 回滚
- [x] API（文件系统 / 队列 / 会话）
- [x] 静态文件服务（out/）
- [x] 单元测试 + 集成测试（72 项）

### 🔜 下一步

- [ ] 远程 agent 支持（家里电脑连 VPS）
- [ ] Cloudflare Tunnel 集成
- [ ] 认证系统（访问令牌）
- [ ] 文件上传/下载
