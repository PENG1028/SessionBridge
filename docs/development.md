# SessionBridge — 开发指南

---

## 启动方式

```bash
# 生产模式（一步到位）
npm start
# → next build → tsx src/index.ts
# → 浏览器打开 http://localhost:8080
```

```bash
# 开发模式（后端热重载）
npm run dev
# → next build → tsx watch src/index.ts
# → 浏览器打开 http://localhost:8080
```

```bash
# 前端开发（需要热重载时单独起 next）
npm run dev:web          # Next.js :3000
npm run dev              # relay :8080
# 浏览器打开 http://localhost:3000（前端）
# 前端 JS 连 ws://localhost:8080（API/WS）
```

## 目录结构

```
src/
├── index.ts              # CLI 入口（解析参数 + 启动 relay）
├── relay-server.ts       # 主服务器（HTTP + WS + Claude 管理）
├── instance-manager.ts   # 多实例管理
├── checkpoint-manager.ts # 文件级 checkpoint
├── rate-limiter.ts       # API 频率限制
├── ansi.ts               # ANSI 解析
└── i18n.ts               # 多语言

app/
├── page.tsx              # Web UI（~3000 行单页应用）
├── layout.tsx
└── globals.css

lib/
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

# 2. 构建前端
npx next build

# 3. 启动（systemd 推荐）
PORT=8080 nohup tsx src/index.ts &

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
| `PORT` | `8080` | 服务器端口 |
| `TOKEN` | 空 | 访问令牌（远程认证用） |
