# SessionBridge 设计总览

> 最后更新: 2026-04-28

---

## 一、项目定义

### 是什么

SessionBridge 是 **Claude Code 的增强 Shell**。给 Claude Code CLI 包一层 Web UI，让本地和远程都能用上它。

### 核心主张

- **Claude Code 优先** — 默认就是启动 `claude` CLI，不重写 agent，不破坏 slash commands
- **Web UI 即界面** — 不论本地还是远程，用户都在同一个 Web 终端操作
- **不入侵 PTY 层** — 只代理输入输出，不解析、不拦截、不修改 agent 逻辑

### 要解决的问题

| 问题 | 解法 |
|------|------|
| Claude Code 长时间任务无法观测 | Web 终端实时看输出，随时可以打断 |
| 离开电脑后无法继续对话 | 手机扫码接入正在运行的会话 |
| Remote Control 官方方案不够可控 | 自建 relay，纯 WebSocket，流式无延迟 |

### 非目标（MVP 不做的）

- 多会话管理
- AI 调度器
- 文件浏览器
- 用户/权限系统
- 通用终端桥接（SSH/Docker 等未来再做）

---

## 二、使用效果（Implementation Effects）

### 本地使用

```
$ npm start
```

1. 终端输出：`Bridge 启动 → Claude Code 在 PTY 中启动`
2. 浏览器自动打开：`http://localhost:3000`
3. 看到 Web 终端界面：
   - 顶部状态栏：绿点 + "Connected"
   - 中间区域：xterm.js 终端，显示 Claude Code 输出
   - 底部命令栏：`>` 输入框 + `[QR]` `[?]` 按钮
4. 可以直接在网页里打字与 Claude 交互
5. 原生终端（启动 bridge 的那个窗口）也同步显示所有输出

### 远程接入

在 Web UI 底部的命令栏输入 `remote`：

1. Bridge 连接到 Relay Server
2. Web UI 弹出 QR 码浮层（"Scan with phone"）
3. 手机扫码 → 打开网页 → 自动认证
4. 手机上看到同样的终端界面，可以实时输入
5. 远程断开后，本地会话继续运行不受影响

### 交互细节

| 元素 | 行为 |
|------|------|
| 终端区 | 点击聚焦，手机触发虚拟键盘 |
| 命令栏 `>` | 输入 `remote/disconnect/help`，发送内置命令而非 PTY |
| 状态栏绿点 | 连接中黄色，已连接绿色，断开红色 |
| 终端输出 | 流式写入，ANSI 颜色/光标正常 |
| 终端尺寸 | 自动跟随窗口变化，移动端跟随键盘弹出调整 |

### 远程模式的两种视角

```
本地浏览器（localhost:3000）         手机浏览器（relay-server）
┌─────────────────────────┐        ┌─────────────────────────┐
│ ● Connected  SessionBridge│       │ ● Connected  [REMOTE]   │
│ ┌─────────────────────┐ │        │ ┌─────────────────────┐ │
│ │ Claude Code 输出    │ │        │ │ Claude Code 输出    │ │
│ │ 显示完全相同内容     │ │        │ │ 显示完全相同内容     │ │
│ └─────────────────────┘ │        │ └─────────────────────┘ │
│ > remote      [QR][?]  │        │ >                [QR][?] │
└─────────────────────────┘        └─────────────────────────┘
```

---

## 三、技术架构

### 整体拓扑

```
┌─────────────────────────────────────────────────────────────────────┐
│                          本机 (Windows/Linux/Mac)                    │
│                                                                     │
│  session-bridge CLI                                                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Bridge                                                        │   │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │   │
│  │  │ LocalServer  │    │ RelayClient  │    │ PTYSession   │   │   │
│  │  │ (HTTP+WS)    │    │ (WS Client)  │    │ (node-pty)   │   │   │
│  │  │ port 3000    │    │ → relay:8080 │    │ → claude     │   │   │
│  │  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘   │   │
│  │         │                  │                    │           │   │
│  │         └──────────────────┴────────────────────┘           │   │
│  │              broadcast / handleMessage 统一路由              │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                                    │
         │ 同域 WS                            │ WS
         ▼                                    ▼
┌─────────────────────┐        ┌───────────────────────────────┐
│ 本地浏览器            │        │ Relay Server (云服务器)       │
│ localhost:3000       │        │ ws://your-server:8080        │
│ Next.js + xterm.js   │        │ ┌─────────────────────────┐ │
│                      │        │ │ HTTP + WS Server        │ │
│ 访问方式：            │        │ │ 会话路由: token → Bridge │ │
│ 自动打开浏览器         │        │ │ 内存存储，无数据库       │ │
│ 或手动输入地址         │        │ └─────────────────────────┘ │
└─────────────────────┘        └──────────────┬────────────────┘
                                              │ WS
                                              ▼
                                   ┌───────────────────────┐
                                   │ 手机浏览器              │
                                   │ WebSocket + xterm.js   │
                                   │ 扫码认证 → 实时操作     │
                                   └───────────────────────┘
```

### 两条数据路径

```
本地路径:
  键盘 → xterm.onData → WS → LocalServer → Bridge.handleMessage → PTY.write → Claude
  Claude → PTY.onData → Bridge.broadcast → LocalServer.broadcast → WS → xterm.write → 屏幕

远程路径:
  手机键盘 → xterm.onData → WS → Relay Server → RelayClient → Bridge.handleMessage → PTY.write → Claude
  Claude → PTY.onData → Bridge.broadcast → RelayClient.send → Relay Server → WS → xterm.write → 手机屏幕
```

两条路径的 **输入最终写入同一个 PTY**，输出也从 **同一个 PTY 广播给所有客户端**。本地终端（bridge 控制台）也同步输出。

### 核心模块

#### 1. Bridge 管理器 (`src/bridge/index.ts`)

Bridge 是系统的核心。它持有三个子模块：

| 子模块 | 职责 | 
|--------|------|
| `PTYSession` | 管理 Claude Code 进程的 PTY 生命周期 |
| `LocalServer` | 本地 HTTP + WS 服务器，服务 Web UI 和本地浏览器连接 |
| `RelayClient` | 可选的 WS 客户端，连接远程 Relay Server |

Bridge 的核心逻辑在 `handleMessage()` — 所有来源的消息（本地 WS / 远程 Relay）统一路由到 PTY：

```
收到消息 → msg.type === 'input' → PTY.write(msg.data)
        → msg.type === 'resize' → PTY.resize(cols, rows)
        → msg.type === 'command' → handleCommand(name, args)
```

命令（如 `remote`）在 Bridge 侧处理，不会发送到 Claude Code。

#### 2. SessionAdapter 接口 (`src/bridge/session.ts`)

```typescript
interface SessionAdapter {
  write(data: string): void;                                  // 写入输入
  resize(cols: number, rows: number): void;                   // 调整终端尺寸
  kill(): void;                                               // 终止会话
  onData(cb: (data: string) => void): void;                   // 注册输出回调
  onExit(cb: (result: { exitCode: number; signal?: number }) => void): void;  // 退出回调
}
```

**当前实现**：`PTYSession` — 使用 `node-pty` spawn 本地进程（默认 `claude`）。

**未来实现**：只需实现同一个接口，Bridge 和 Web UI 完全不需要改动：

| 实现 | 适用场景 | 依赖 |
|------|---------|------|
| `PTYSession` ✅ | 本地进程（Claude Code / shell） | node-pty |
| `SSHSession` 🔜 | 远程服务器 SSH 管理 | ssh2 |
| `DockerSession` 🔜 | Docker exec 到容器 | dockerode |
| `TmuxSession` 🔜 | 接入 tmux 的 session | tmux |

#### 3. LocalServer (`src/bridge/server.ts`)

- 基于 Node.js `http` 模块
- 静态文件服务（Next.js 静态导出 + `public/` fallback）
- WebSocket Server（`ws`）同端口
- 维护 `Set<WebSocket>` 连接的浏览器客户端
- `broadcast()` 方法推送给所有客户端

#### 4. RelayClient (`src/bridge/relay.ts`)

- 封装 `ws` 的 WebSocket 客户端
- 连接 Relay Server → `register` → 获得 `sessionId + token + webUrl`
- 自动处理断线（callback 通知上层）
- 暴露 `send()` 和 `onMessage()` 接口

#### 5. Relay Server (`src/server/index.ts`)

- HTTP + WS 同端口服务
- 内存 `Map<token, Session>` 存储
- 会话生命周期：

```
Bridge 连接 → register → 创建 Session(token)
Phone 连接 → auth(token) → 验证成功 → 绑定到 Session
Bridge 断连 → 通知 Phone，删除 Session
Phone 断连 → 释放客户端槽位，Bridge 继续运行
```

- 消息路由很简单：按 `role`（bridge/client）区分方向纯转发

#### 6. Web UI (`web/`)

使用 Next.js 14 静态导出 + TailwindCSS：

| 组件 | 文件 | 职责 |
|------|------|------|
| RootLayout | `layout.tsx` | HTML 结构 + 全局样式 + viewport 适配 |
| Page | `page.tsx` | 路由分发：有 token → Terminal 视图，无 token → Landing 页 |
| Terminal | `components/Terminal.tsx` | xterm.js 实例 + 状态栏 + 命令栏 + QR/Help 浮层 |
| WSClient | `lib/ws-client.ts` | WebSocket 连接管理 + 自动重连 + 消息路由 |

Terminal 组件状态：

```
Connecting → Connected ↔ Disconnected → (auto reconnect)
          ↘ Error
```

### 通信协议

所有消息 JSON 格式，WebSocket 传输。

**本地模式**（浏览器 ↔ Bridge）：

| 方向 | 类型 | 说明 |
|------|------|------|
| Client → Bridge | `input` | 键盘输入（含 ANSI 控制序列） |
| Client → Bridge | `resize` | 终端尺寸变更 |
| Client → Bridge | `command` | 内置命令（`remote`/`disconnect`） |
| Bridge → Client | `output` | PTY 原始输出 |
| Bridge → Client | `command_result` | 命令执行结果（含 token/QR data URL） |
| Bridge → Client | `error` | 错误消息 |

**远程模式**（Bridge ↔ Relay ↔ Phone）：

Bridge 与 Relay 之间用 `register`/`registered`/`input`/`output`
Phone 与 Relay 之间用 `auth`/`auth_result`/`input`/`output`

输入输出格式与本地模式完全一致。详见 [protocol.md](./protocol.md)。

### 鉴权设计

**本地模式**：无鉴权。`localhost` 本身就是安全边界。

**远程模式**：一次性 Token。
```
Bridge → Relay: register
Relay: 生成随机 token（48 hex chars），创建 Session(token)
Relay → Bridge: { sessionId, token, webUrl }

Bridge → Web UI: command_result { qrDataUrl, webUrl }
Web UI: 显示二维码（含 token）

手机扫码 → 打开 webUrl → auth(token)
Relay: 校验 token 存在且未被使用 → 绑定会话
```

- token 在第一个 client 认证后变为 "已使用"
- client 断开后 token 不重新开放（简化状态管理）
- 无用户系统，无数据库

### 部署方案

**部署 Relay Server**（云服务器）：

```bash
# 需要:
# - Node.js 18+
# - npm install
#
# 不需要:
# - 数据库
# - Redis
# - 任何外部依赖

PORT=8080 npm run server
```

前置 nginx 做 TLS 终止（WSS）后，手机可以通过 `wss://your-domain.com` 安全连接。

**本机运行 Bridge**：

```bash
npm start
# 或带中继:
RELAY_URL=ws://your-server:8080 npm start
# 或在 Web UI 中输入 remote 命令
```

---

## 四、目录结构

```
sessionBridge/
├── src/                          # 后端 TypeScript
│   ├── index.ts                  # CLI 入口: bridge (默认) / server
│   ├── bridge/
│   │   ├── index.ts              # Bridge 管理器
│   │   ├── session.ts            # SessionAdapter + PTYSession
│   │   ├── server.ts             # 本地 HTTP + WS 服务器
│   │   └── relay.ts              # Relay WS 客户端
│   ├── server/
│   │   └── index.ts              # Relay Server
│   └── shared/
│       ├── protocol.ts           # 消息类型定义
│       └── browser.ts            # 打开浏览器工具
├── web/                          # 前端 Next.js 应用
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   └── Terminal.tsx
│   │   └── lib/
│   │       └── ws-client.ts
│   ├── out/                      # 静态导出产物
│   ├── package.json
│   ├── next.config.js
│   └── tailwind.config.ts
├── public/                       # 静态文件 fallback
├── docs/
│   ├── architecture.md
│   ├── design-overview.md        # ← 当前文档
│   ├── development.md
│   └── protocol.md
├── memory/
│   └── project-sessionbridge.md
├── package.json
└── tsconfig.json
```

---

## 五、当前状态与下一步

### ✅ 已完成

- [x] Bridge 管理器 — PTY 生命周期、消息路由、命令处理
- [x] PTYSession — node-pty 实现，本地进程管理
- [x] LocalServer — HTTP + WS 同端口，静态文件 + WebSocket
- [x] RelayClient — 远程连接、自动重连、消息转发
- [x] Relay Server — 会话管理、Token 鉴权、消息路由
- [x] Web UI — Next.js、xterm.js 终端、状态栏、命令栏、QR 浮层
- [x] 通信协议 — JSON 消息、本地/远程统一
- [x] 文档 — 架构、开发、协议

### ❓ 待确认/需要验证

- [ ] node-pty 在 Windows 上的原生编译是否通过
- [ ] xterm.js 在手机浏览器上的触控和键盘行为
- [ ] 断开重连场景下的会话一致性
- [ ] Relay Server 的 WSS 配置（nginx 前置）
- [ ] 远程模式 token 用完即弃的体验是否够用
- [ ] 错误处理和用户可见的错误消息
