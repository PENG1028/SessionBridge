# SessionBridge — 开发指南

## 目录结构

```
sessionBridge/
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   └── development.md
├── src/
│   ├── index.ts                  # CLI 入口
│   ├── bridge/
│   │   ├── index.ts              # Bridge 管理器
│   │   ├── session.ts            # SessionAdapter + PTYSession
│   │   ├── server.ts             # 本地 WS 服务器
│   │   └── relay.ts              # Relay WS 客户端
│   ├── server/
│   │   └── index.ts              # Relay Server
│   └── shared/
│       └── protocol.ts           # 共享类型定义
├── web/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   └── Terminal.tsx
│   │   └── lib/
│   │       └── ws-client.ts
│   ├── package.json
│   └── next.config.js
├── package.json
└── tsconfig.json
```

## 快速开始

### 本地使用 Claude Code

```bash
# 安装依赖
npm install
cd web && npm install && cd ..

# 构建前端
npm run build:web

# 启动 Bridge（会自动打开浏览器）
npm start
# → http://localhost:3000
```

### 远程接入

在 Web UI 中输入：

```
/remote
```

Bridge 会连接 Relay Server，生成二维码，扫码即可从手机操作。

如果没有公共 Relay Server，可以自己部署：

```bash
# 在云服务器上
npm run server
# → ws://your-server:8080
```

### 开发模式

```bash
# 终端 1: Bridge（热重载，3001 避免和 Next.js 冲突）
PORT=3001 npm run dev:bridge

# 终端 2: Web UI（热重载）
npm run dev:web
# → http://localhost:3000

# Web UI 中的 WS 连接地址:
# 开发时: ws://localhost:3001 （bridge）
# 生产时: 同域自动检测
```

## 环境变量

### Bridge

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 本地 HTTP/WS 端口 | `3000` |
| `RELAY_URL` | 启动时自动连接的中继地址 | 空（不自动连接） |
| `COMMAND` | 要启动的 CLI 命令 | `claude` |
| `OPEN_BROWSER` | 是否自动打开浏览器 | `true` |

### Relay Server

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | HTTP/WebSocket 监听端口 | `8080` |

## Web UI 命令

在 Web UI 底部的命令栏输入以下命令：

| 命令 | 说明 |
|------|------|
| `remote` | 连接中继服务器，显示二维码 |
| `disconnect` | 断开远程连接 |
| `help` | 显示命令帮助 |

命令只在 Web UI 底部的命令栏生效，不会发送到 Claude Code。

## 扩展指南

### 添加新终端支持

实现 `SessionAdapter` 接口并在 Bridge 中替换：

```typescript
// src/bridge/session.ts
class SSHSession implements SessionAdapter {
  write(data: string): void { ... }
  resize(cols: number, rows: number): void { ... }
  kill(): void { ... }
  onData(cb: (data: string) => void): void { ... }
  onExit(cb: (result: { exitCode: number; signal?: number }) => void): void { ... }
}
```

### 添加新的内置命令

1. 在 `src/bridge/index.ts` 的 `handleCommand` 中添加分支
2. 在 `web/src/lib/ws-client.ts` 中添加命令发送方法
3. 在 Web UI 中添加触发入口

## 部署 Relay Server

```bash
# 使用 systemd
[Unit]
Description=SessionBridge Relay
After=network.target

[Service]
ExecStart=/usr/bin/npm run server
WorkingDirectory=/opt/session-bridge
Restart=always
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

建议前置 nginx 做 TLS 终止（WSS）：

```nginx
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
    }
}
```
