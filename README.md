# SessionBridge — Remote Agent Console

> 在任何设备上操控你的远程终端和 AI 代理。

SessionBridge 是一个**多端远程控制台**。启动一个服务端进程，浏览器打开就能连接——控制 Shell 终端、Claude Code 等 AI 代理，全部通过 WebSocket 实时通信。

```
手机浏览器 → VPS 上的 SessionBridge → Claude Code / Shell 终端
```

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 构建前端 + 启动服务
npm start
# → 浏览器打开 http://localhost:8080
```

就这么简单。不需要数据库，不需要 Docker，不需要配置文件。

### 前置条件

- **Node.js** ≥ 18
- **Claude Code**（可选）— 需要 AI 对话能力时安装：`npm install -g @anthropic-ai/claude-code`

---

## 使用场景

| 场景 | 说明 |
|------|------|
| **本地调试** | `npm start` → `localhost:8080`，浏览器里操作终端 + Claude |
| **VPS 远程操控** | 部署到服务器，手机/笔记本浏览器打开页面，远程执行命令 |
| **家庭电脑中转** | VPS 做 relay，家里电脑主动连接，从手机操控家里电脑上的 Claude |
| **多机运维** | 多台服务器注册为 agent，统一管理 |

---

## 架构概要

```
Browser / Web UI           Relay Server                   Agent Node
┌──────────┐    WS         ┌──────────────────┐    WS    ┌──────────┐
│  app/     │ ◀──────────▶ │  relay-server.ts │ ◀──────▶ │ Node     │
│  page.tsx │              │  ├─ HTTP :8080    │         │  ├─ Shell│
│  Terminal │              │  ├─ WebSocket     │         │  ├─ Claude│
│  Chat UI  │              │  ├─ InstanceMgr   │         │  └─ 扩展  │
│  Sidebars │              │  ├─ AuditLog      │         └──────────┘
└──────────┘               │  └─ SessionStore  │
                            └──────────────────┘
```

**核心概念：**

- **Instance** — 一个运行中的进程（Shell 终端 / Claude Code 等），每个有独立工作目录
- **Adapter** — 插件式后端，当前内置 Shell、Claude Code、System Info 三种
- **Stage** — 浏览器主区域，可多标签分屏
- **Panel** — 侧边栏，插件声明自己的面板

详细架构见 [docs/architecture.md](docs/architecture.md)。

---

## 配置

全部可选，不用改也能跑。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | 服务端口 |
| `TOKEN` / `BRIDGE_TOKEN` | 空 | **远程访问必设**，WebSocket 连接认证 |
| `DASHBOARD_PORT` | `9843` | 本地管理页面端口 |
| `NTFY_TOPIC` | 空 | ntfy.sh 通知主题 |

### CLI 参数

```bash
npx tsx src/index.ts --port 8080 --token mytoken
```

> 完整参数列表见 [docs/development.md](docs/development.md) 或运行 `npx tsx src/index.ts --help`。

---

## 开发

```bash
npm run dev          # 后端热重载开发
npm run dev:web      # 前端热重载（Next.js :3000）
npx vitest run       # 跑全部测试
npx tsc --noEmit     # 类型检查
```

目录结构：

```
src/                 # 后端（relay 服务器、实例管理、审计日志）
adapters/            # 插件体系（类型定义、Shell、Claude Code、System Info）
app/                 # 前端（Next.js App Router）
lib/                 # 客户端工具库（WebSocket、IndexedDB）
docs/                # 详细文档
```

---

## 项目文档

| 文档 | 说明 |
|------|------|
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | 术语表（Stage / Scene / Panel / Instance） |
| [docs/architecture.md](docs/architecture.md) | 完整架构文档（模块、数据流、安全） |
| [docs/design-overview.md](docs/design-overview.md) | 设计总览与路线图 |
| [docs/protocol.md](docs/protocol.md) | WebSocket 通信协议参考 |
| [docs/development.md](docs/development.md) | 开发指南、部署、环境变量 |
| [adapters/ARCHITECTURE.md](adapters/ARCHITECTURE.md) | Adapter 插件体系设计蓝图 |

---

## 许可

MIT
