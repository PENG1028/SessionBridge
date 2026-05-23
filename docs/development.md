# SessionBridge — 开发指南

---

## 启动方式

### 开发模式（热重载）

```bash
# 同时启动 Go Core + Next.js dev server
npm run dev
# → Go Core: ws://127.0.0.1:8080
# → Next.js: http://localhost:3000
```

```bash
# 仅 Go Core（go run 热重载）
npm run dev:core
# → ws://127.0.0.1:8080
```

```bash
# 仅前端（Next.js dev server）
npm run dev:web
# → http://localhost:3000
```

### 生产 / 本地模式

```bash
# 构建全部
npm run build
# → build:web (Next.js production build → .next/) + build:core (Go binary)

# 启动 Go Core（默认）
npm start
# → ws://127.0.0.1:8080
```

---

## 架构分层

当前项目分为三层：

| 层 | 路径 | 状态 | 说明 |
|----|------|------|------|
| **Go Core** | `go-core/` | **主运行时** | 节点身份、session/stream 生命周期、权限、路由、日志/审计 |
| **App UI** | `app/` | **官方 UI** | Next.js React SPA，通过 WebSocket/HTTP 连接 Go Core |
| **Plugins** | `plugins/` | **插件声明源** | `plugin.yaml` 声明能力、权限、UI/CLI 贡献 |
| **Legacy Node relay** | `src/` | **已废弃** | 旧 Node.js relay server |
| **Legacy extensions** | (已删除) | **已删除** | 旧的扩展/适配器系统，已被 plugins/ 替代 |
| **Legacy agent-core** | (已删除) | Go Core 是唯一运行时 |

### Go Core 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LISTEN_ADDR` | `127.0.0.1:8080` | HTTP + WebSocket 监听地址 |
| `SESSIONNODE_CONFIG` | `~/.sessionnode/config.json` | 配置文件路径 |
| `SESSIONNODE_DATA_DIR` | `~/.sessionnode` | 数据目录（日志、会话） |
| `SESSIONNODE_TOKEN` | 空（dev mode） | 认证令牌，空 = 无认证 |
| `SESSIONNODE_PLUGIN_DIRS` | `./plugins/` | 插件目录 |
| `NODE_ID` | `node_local` | 节点 ID |

### npm scripts 全集

| 命令 | 说明 |
|------|------|
| `npm run dev` | Go Core + Next.js 开发模式 |
| `npm run dev:core` | Go Core 开发（`go run`） |
| `npm run dev:web` | Next.js 前端开发 |
| `npm run dev:all` | 同 `dev` |
| `npm start` | 启动 Go Core（默认运行时） |
| `npm run start:core` | 同 `npm start`，显式启动 Go Core |
| `npm run start:core` | 生产启动 Go Core |
| `npm run start:web` | 生产启动 Next.js |
| `npm run build` | 构建前端 + Go Core |
| `npm run build:web` | 构建前端静态文件 |
| `npm run build:core` | 构建 Go Core 二进制 |
| `npm run typecheck` | TypeScript 类型检查 |

---

## 目录结构

```
go-core/                    # Go Core 运行时（主 Core）
├── cmd/node/main.go        # 入口点
├── internal/               # 内部实现
│   ├── server/             # HTTP + WebSocket 服务器
│   ├── dispatcher/         # 能力分发
│   ├── session/            # Session 管理
│   ├── process/            # 进程管理（PTY）
│   ├── fs/                 # 文件系统操作
│   ├── env/                # 环境变量/系统信息
│   ├── config/             # 配置管理
│   ├── logs/               # 日志/审计
│   ├── notify/             # 通知/审批
│   ├── permission/         # 权限校验
│   ├── pluginmanifest/     # 插件清单解析
│   ├── mesh/               # Mesh 网络身份
│   └── topology/           # 节点拓扑
└── pkg/                    # 公共类型/协议

plugins/                    # 插件声明（plugin.yaml）
├── sessionnode-core/       # 内置核心插件
├── shell/                  # Shell 终端插件
├── claude-code/            # Claude Code 插件
└── ...

app/                        # Next.js Web UI
├── page.tsx                # 入口页
├── console/                # 控制台 UI
│   ├── core/               # CoreClient 通信层
│   ├── shell/              # 终端组件
│   └── system-pages/       # 系统管理页面
└── ...

lib/                        # 客户端库
├── ws-client.ts            # WebSocket 客户端封装
├── use-ws.ts               # React hook（WebSocket）
└── ...

src/                        # (已删除 — Go Core 是唯一运行时)

scripts/                    # 构建/启动脚本
├── start-core.js           # 启动 Go Core
├── build-core.js           # 构建 Go Core 二进制
├── dev-all.js              # 开发模式（Core + Next.js）
└── ...

bin/bridge.js               # 统一启动入口
```

---

## 测试

```bash
npx vitest run            # 跑全部测试
npx vitest                # watch 模式
npx tsc --noEmit          # 类型检查
go test ./...             # Go 测试
go vet ./...              # Go 静态分析
```

---

## VPS 部署

```bash
# 1. 装依赖
npm install

# 2. 构建全部
npm run build

# 3. 启动 Go Core
npm run start:core
# → ws://127.0.0.1:8080

# 4. 配合 nginx 反向代理（TLS + WebSocket）
```