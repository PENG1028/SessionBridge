# SessionBridge — 开发指南

---

## 启动方式

```bash
# 生产模式（一步到位）
npm start
# → node bin/bridge.js
# → Dashboard: http://127.0.0.1:9843
# → Relay: ws://127.0.0.1:8080
```

```bash
# 开发模式（后端热重载）
npm run dev
# → tsx watch src/index.ts
# → Dashboard: http://127.0.0.1:9843
# → Relay: ws://127.0.0.1:8080
```

```bash
# 前端开发（需要热重载时单独起 next）
npm run dev:web          # Next.js :3000
npm run dev              # NodeRuntime: relay :8080 + dashboard :9843
# 浏览器打开 http://localhost:3000（前端）
# 前端 JS 连 ws://localhost:8080（API/WS）
```

## 目录结构

```
src/
├── index.ts              # CLI 入口（解析参数 + 启动 relay）
├── relay-server.ts       # 主服务器（HTTP + WS + 核心集成枢纽）
├── api-routes.ts         # REST API 路由（8 端点）
├── audit-log.ts          # JSONL 审计日志
├── session-persistence.ts # 会话快照持久化
├── instance-manager.ts   # 多实例管理 + 操作状态机
├── stream-parser.ts      # Claude stream-json 解析器
├── checkpoint-manager.ts # 文件级 checkpoint
├── rate-limiter.ts       # API 频率限制
├── agent.ts              # 远程 agent 连接
├── protocol.ts           # 消息信封格式
├── ansi.ts               # ANSI 解析
├── browser.ts            # 跨平台打开浏览器
└── i18n.ts               # 多语言

extensions/
├── types.ts              # 核心类型定义（AgentAdapter, OutputBlock 等）
├── ARCHITECTURE.md       # Adapter 体系架构蓝图
├── registry.ts           # Adapter 注册中心
├── agent-core/           # 核心运行时
│   ├── config.ts         # NodeConfig（支持 CLI/env/文件配置）
│   ├── node-runtime.ts   # NodeRuntime 统一节点运行时
│   ├── event-bus.ts      # RelayEventBus（跨适配器通信）
│   ├── config-sync.ts    # 配置推送（relay ↔ agent）
│   ├── relay-connection.ts # WebSocket 客户端封装
│   ├── permissions.ts    # 权限模型
│   ├── notifications.ts  # 通知模型
│   ├── capability-host.ts # 能力宿主（fs/process/terminal）
│   └── dashboard-server.ts # Dashboard HTTP 服务
├── shell/                # Shell 适配器
├── claude-code/          # Claude Code 适配器
└── system-info/          # 系统信息适配器

app/                      # Next.js Web UI
├── page.tsx              # 单页应用
├── layout.tsx
└── globals.css

lib/                      # 客户端库
├── ws-client.ts          # WebSocket 客户端封装
├── use-ws.ts             # React hook
└── session-store.ts      # IndexedDB 持久化
```

## 测试

```bash
npx vitest run            # 跑全部测试
npx vitest                # watch 模式
npx tsc --noEmit          # 类型检查
```

## VPS 部署

```bash
# 1. 装依赖
npm install

# 2. 构建前端 + 后端
npm run build

# 3. 启动（systemd 推荐）
nohup node bin/bridge.js --relay-port 8080 --dashboard-port 9843 &

# 4. nginx 反向代理（TLS + WebSocket）
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BRIDGE_CONFIG` | 自动 | 配置文件路径（默认 `~/.sessionbridge/agent.json`） |
| `NTFY_TOPIC` | 空 | ntfy 通知主题 |

端口、上游 relay 与 token 当前主要通过 CLI 参数或配置文件控制。

## CLI 参数

NodeRuntime 启动时接受以下参数（优先级高于环境变量）：

```bash
npx tsx src/index.ts --relay-port 8080 --relay-token mytoken --dashboard-port 9843
```

| 参数 | 对应环境变量 | 说明 |
|------|-------------|------|
| `--relay-port` | 配置文件 `relayPort` | Relay 端口 |
| `--relay-token` | 配置文件 `relayToken` | 访问令牌 |
| `--dashboard-port` | 配置文件 `dashboardPort` | Dashboard 端口 |
| `--upstream` | 配置文件 `upstreamRelay` | 上游 relay 地址 |
| `--role` | — | 角色（auto / relay / leaf） |
| `--node-id` | — | 节点 ID（自动生成，通常无需指定） |
