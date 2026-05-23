# SessionBridge — 节点式远程控制网络

> 在任何设备上操控你的远程终端和 AI 代理。

SessionBridge 是一个**节点式远程控制网络**。每台设备（PC、手机、服务器）都是一个 **Node**，运行相同的核心代码，提供相同的操作面板。Node 之间通过 WebSocket 加密连接，形成网状网络——从任何一个 Node 的面板，都能操控整个网络中的所有实例。

```
┌──────────────┐   加密 WebSocket     ┌──────────────┐    加密 WebSocket    ┌──────────────┐
│ 手机 Node     │◀══════════════════▶│ VPS Relay     │◀══════════════════▶│ PC Node       │
│ (Flutter)    │                     │ (公网)       │                     │ (家里电脑)    │
│              │                     │              │                     │               │
│ 内置 WebView ─── 加载本地面板          │ 无 GUI，不查看               │ EXE 打开 ─── 本地面板│
│ 看自己的面板  │                     │ 自己的面板   │                     │ 看自己的面板   │
└──────────────┘                     └──────────────┘                     └──────────────┘
       │                                    │                                   │
       └────────────────────────────────────┼───────────────────────────────────┘
                                            ▼
                              每个面板显示全网所有实例
                              从自己节点面板即可操控所有节点
```

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 构建前端 + Go Core
npm run build

# 3. 启动 Go Core（默认运行时）
npm start
# → HTTP + WebSocket 监听 ws://127.0.0.1:8080
```

开发模式（热重载）：
```bash
npm run dev          # Go Core + Next.js 同时启动
npm run dev:core     # 仅 Go Core
npm run dev:web      # 仅 Next.js 前端（:3000）
```

| 命令 | 说明 |
|------|------|
| `npm start` | 启动 Go Core（默认） |
| `npm run dev` | Go Core + Next.js 开发模式 |
| `npm run build` | 构建前端 + Go Core 二进制 |
| `npm run legacy:relay` | 启动旧版 Node relay（已废弃，仅用于兼容） |

### 前置条件

- **Node.js** ≥ 18
- **Go** ≥ 1.21（用于构建 Go Core 二进制）
- **Claude Code**（可选）— 需要 AI 对话能力时安装：`npm install -g @anthropic-ai/claude-code`

---

## 使用场景

| 场景 | 说明 |
|------|------|
| **本地调试** | `npm start` → 浏览器打开 `127.0.0.1:8080`，管理页面 + 操作终端 |
| **VPS 远程操控** | PC 和手机都作为 Node 连到 VPS Relay，从任意 Node 的 Dashboard 操作全网实例 |
| **多机运维** | 多台服务器分别运行 Node，通过 Relay 互通，在任意一台的 Dashboard 统一管理 |
| **手机操控** | Flutter APK 作为手机 Node，WebView 加载 Dashboard + 后台通知服务 |
| **跨 Relay** | Node 通过多个 Relay 链式连接：手机 → Relay A → Relay B → 目标 PC |

---

## 架构概要

```
Node A (PC)                          Node B (VPS/Relay)                Node C (手机)
┌─────────────────────┐   加密 WS    ┌─────────────────────┐   加密 WS   ┌─────────────────────┐
│ NodeRuntime         │◀══════════▶│ NodeRuntime          │◀══════════▶│ NodeRuntime          │
│  ├─ 本地面板        │             │  ├─ 本地面板          │             │  ├─ 内置 WebView     │
│  ├─ Adapter: Shell  │             │  ├─ RelayServer:8080 │             │  └─ 通知 Service     │
│  ├─ Adapter: Claude │             │  ├─ InstanceMgr      │             └─────────────────────┘
│  └─ RelayConnection │             │  ├─ AuditLog         │
└─────────────────────┘             │  └─ SessionStore     │
                                     └─────────────────────┘
                                               │
                                               ▼
                                      ┌─────────────────────┐
                                      │ Node D (办公室 PC)    │
                                      │  ├─ 本地面板         │
                                      │  ├─ Adapter: Shell   │
                                      │  └─ RelayConnection  │
                                      └─────────────────────┘
```

**核心概念：**

- **Node** — 一台运行 SessionBridge 的设备（PC / 手机 / 服务器）。每个 Node 运行相同的 `NodeRuntime`。
- **本地面板** — 每个 Node 启动时通过 `http://127.0.0.1:8080` 访问的统一 Web UI（管理路由整合在 relay server 中）。默认仅限本机使用。当前实现已包含网络环境检测与外部访问切换接口。
- **Instance** — 一个运行中的进程（Shell 终端 / Claude Code 等）。本地面板显示**全网所有节点**的 Instance，可以直接操控远程节点上的进程——不需要打开远程节点的面板。
- **Relay** — 一种 Node 角色，提供 WebSocket 中继服务。Node 之间通过 Relay 通信，但 Relay 本身对上层透明——你不需要关心哪个 Node 是 Relay。
- **Adapter** — 插件式后端，当前内置 Shell、Claude Code、System Info 三种。

详细架构见 [docs/architecture.md](docs/architecture.md)。

---

## 配置

全部可选，不用改也能跑。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BRIDGE_CONFIG` | 自动 | 配置文件路径 |
| `NTFY_TOPIC` | 空 | ntfy.sh 通知主题 |

端口和 token 当前主要通过 CLI 参数或配置文件控制：`--relay-port`、`--relay-token`、`--dashboard-port`、`--upstream`。

### 环境变量（Go Core）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LISTEN_ADDR` | `127.0.0.1:8080` | HTTP + WebSocket 监听地址 |
| `SESSIONNODE_DATA_DIR` | `~/.sessionnode` | 数据目录 |
| `SESSIONNODE_TOKEN` | 空（dev mode） | 认证令牌 |
| `SESSIONNODE_PLUGIN_DIRS` | `./plugins/` | 插件目录 |

Legacy Node relay 参数见 `node bin/bridge.js legacy-relay --help`。

---

## 开发

```bash
npm run dev          # Go Core + Next.js 开发模式
npm run dev:web      # 前端热重载（Next.js :3000）
npm run dev:core     # Go Core 开发模式（go run）
npx vitest run       # 跑全部测试
npx tsc --noEmit     # 类型检查
```

目录结构：

```
go-core/             # Go Core 运行时（主 Core）
  cmd/node/          # 入口点
  internal/          # 内部实现
plugins/             # 插件声明（plugin.yaml）
app/                 # 前端 UI（Next.js App Router）
lib/                 # 客户端工具库（WebSocket、IndexedDB）
src/                 # Legacy Node relay（已废弃，保留用于兼容）
  relay-server.ts    # 旧 relay 服务器
  instance-manager.ts
agent-core/          # Legacy 扩展运行时（已废弃）
extensions/          # Legacy 扩展目录（已废弃）
docs/                # 详细文档
```

---

## 项目文档

| 文档 | 说明 |
|------|------|
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | 术语表（Node / Stage / Scene / Panel / Instance） |
| [docs/architecture.md](docs/architecture.md) | 完整架构文档（设计原则、节点拓扑、模块、数据流、安全、路线） |
| [docs/protocol.md](docs/protocol.md) | WebSocket 通信协议参考 |
| [docs/development.md](docs/development.md) | 开发指南、部署、环境变量 |
| [docs/plugin-system-design.md](docs/plugin-system-design.md) | 插件系统专项设计 |
| [extensions/ARCHITECTURE.md](extensions/ARCHITECTURE.md) | Adapter 插件体系设计蓝图 |

---

## 许可

MIT
