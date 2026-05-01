# SessionBridge — 系统架构文档

## 产品定位

SessionBridge 是 **Claude Code 的增强 shell**。

不是通用终端桥接工具，而是：

> 给 Claude Code 包一层更好的交互界面，让本地和远程都能用上它。

未来在此基础上扩展对其他终端类型的支持（SSH、Docker 等），但第一优先永远是 Claude Code 的使用体验。

---

## 核心设计理念

### 1. Web UI 是主要界面

不是"本地终端 + 远程网页"，而是：

```
无论本地还是远程，用户都通过 Web UI 操作 Claude Code
```

本地使用时浏览器打开 `localhost`，远程时手机扫码，**用的是同一套界面**。

### 2. 不破坏 Claude Code 原生能力

- slash commands (`/help` `/config` 等) 全部透传
- 不解析、不修改、不拦截 agent 逻辑
- 只在输入输出层做代理

### 3. Claude Code 优先，但架构可扩展

- 默认就是 `session-bridge` → 启动 Claude Code
- SessionAdapter 抽象保证未来能接入 SSH、Docker、tmux
- 但所有设计从 Claude Code 的使用场景出发

---

## 架构图

```
                         ┌──────────────────────────────────────┐
                         │        手机 / 远程浏览器              │
                         │   Web UI (xterm.js)                   │
                         └──────────────┬───────────────────────┘
                                        │ WebSocket (wss://)
                                        ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Relay Server (可选)                             │
│                    会话路由: token → Bridge                       │
└──────────────────────────────────┬───────────────────────────────┘
                                   │ WebSocket (ws://)
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  session-bridge (本机 CLI)                                      │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  本地 HTTP + WebSocket 服务器 (:3000)                     │    │
│  │  ├── 提供 Web UI (Next.js 静态页面)                      │    │
│  │  ├── WebSocket 端点供浏览器连接                          │    │
│  │  └── /remote 时连接 Relay Server                         │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                    │
│  ┌──────────────────────────┴──────────────────────────────┐    │
│  │  SessionAdapter (抽象接口)                               │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │  PTYSession (node-pty)                           │   │    │
│  │  │     ↓ spawn                                      │   │    │
│  │  │  Claude Code CLI                                 │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  浏览器自动打开 → http://localhost:3000                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 两条使用路径

| 场景 | 路径 | 说明 |
|------|------|------|
| 本地使用 | 浏览器 → localhost:3000 → Bridge WS → PTY → Claude Code | 默认方式，打开即用 |
| 远程接入 | 手机 → Relay Server → Bridge WS Client → PTY → Claude Code | Web UI 中输入 `/remote` |

---

## 数据流

### 本地模式

```
用户键盘输入
    ↓
Web UI (xterm.js.onData)
    ↓ JSON { type: "input", data: "npm test\n" }
WebSocket (ws://localhost:3000)
    ↓
Bridge 本地 WS 服务器
    ↓
PTYSession.write("npm test\n")
    ↓
Claude Code ⬅ 收到输入

Claude Code 输出
    ↓
PTY.onData → "[32mHello[0m\n"
    ↓
Bridge 广播给所有连接的 WS 客户端
    ↓ JSON { type: "output", data: "[32mHello[0m\n" }
Web UI xterm.write()
```

### 远程模式（`/remote` 后）

```
用户手机键盘输入
    ↓
Web UI (xterm.js)
    ↓ JSON { type: "input", data: "npm test\n" }
WebSocket (wss://relay-server)
    ↓
Relay Server (按 token 路由)
    ↓ JSON { type: "input", data: "npm test\n" }
Bridge 的 Relay WS Client
    ↓
PTYSession.write("npm test\n")
    ↓
Claude Code ⬅ 收到输入
```

两条路径的输入最终写入同一个 PTY，输出也从同一个 PTY 广播给所有客户端。

---

## 核心模块

### 1. CLI 入口 (`src/index.ts`)

```bash
session-bridge           # 默认: 启动本地服务器 + Claude Code
session-bridge server    # 启动中继服务器 (Relay Server)
session-bridge --relay ws://host:8080  # 启动并连接远程中继
```

### 2. Bridge (`src/bridge/`)

| 文件 | 职责 |
|------|------|
| `session.ts` | `SessionAdapter` 接口 + `PTYSession` 实现 |
| `server.ts` | 本地 WS 服务器（接受浏览器连接） |
| `client.ts` | WS 客户端（连接 Relay Server，用于远程）|
| `index.ts` | Bridge 管理器 — 整合 PTY + 本地 WS + 可选远程 WS |

### 3. Relay Server (`src/server/`)

职责：消息路由中心，维护 Bridge 与 Client 之间的连接映射。

- 纯 WebSocket 服务（+ HTTP 静态文件托管作为 convenience）
- 内存会话存储，无数据库

### 4. Web Client (`web/`)

| 文件 | 职责 |
|------|------|
| `page.tsx` | 主页面，token 校验 + 终端加载 |
| `components/Terminal.tsx` | xterm.js 终端 + 状态栏 + 命令面板 |
| `lib/ws-client.ts` | WebSocket 客户端封装 |

---

## SessionAdapter 接口

```typescript
interface SessionAdapter {
  write(data: string): void;           // 写入输入
  resize(cols: number, rows: number): void; // 调整终端尺寸
  kill(): void;                         // 终止会话
  onData(cb: (data: string) => void): void;  // 注册输出回调
  onExit(cb: (result: { exitCode: number; signal?: number }) => void): void;
}
```

| 实现 | 用途 | 依赖 |
|------|------|------|
| `PTYSession` | Claude Code / 本地进程 | node-pty |
| `SSHSession` (未来) | 远程服务器 | ssh2 |
| `DockerSession` (未来) | 容器 exec | dockerode |
| `TmuxSession` (未来) | tmux 会话 | tmux |

---

## Bridge 内部设计

```typescript
class Bridge {
  private pty: SessionAdapter;           // Claude Code 进程
  private localServer: LocalServer;      // 本地 WS 服务器
  private relayClient: RelayClient | null; // 远程连接

  async start(port: number): Promise<void> {
    // 1. 启动 Claude Code
    this.pty = new PTYSession('claude', []);
    
    // 2. 启动本地服务器
    this.localServer = new LocalServer(port);
    this.localServer.onConnection((ws) => {
      ws.on('message', (msg) => this.handleMessage(msg));
    });
    
    // 3. PTY 输出 → 广播给所有客户端
    this.pty.onData((data) => this.broadcast(data));
    
    // 4. 打开浏览器
    openBrowser(`http://localhost:${port}`);
  }

  async enableRemote(relayUrl: string): Promise<RemoteInfo> {
    // 连接中继服务器，返回 token + URL
    this.relayClient = new RelayClient(relayUrl);
    const info = await this.relayClient.register();
    
    // Relay 消息也路由到同一个 PTY
    this.relayClient.onMessage((msg) => this.handleMessage(msg));
    
    return info; // { token, webUrl }
  }

  private broadcast(data: string) {
    // 同时发给本地客户端 + 远程中继
    this.localServer.broadcast({ type: 'output', data });
    this.relayClient?.send({ type: 'output', data });
  }

  private handleMessage(msg: Message) {
    // 统一处理输入（不管来自本地还是远程）
    if (msg.type === 'input') this.pty.write(msg.data);
    if (msg.type === 'resize') this.pty.resize(msg.cols, msg.rows);
    if (msg.type === 'command') this.handleCommand(msg);
  }

  private async handleCommand(msg: CommandMessage) {
    if (msg.name === 'remote') {
      const info = await this.enableRemote(msg.args.relay ?? DEFAULT_RELAY);
      this.localServer.broadcast({
        type: 'command_result',
        name: 'remote',
        data: { token: info.token, webUrl: info.webUrl },
      });
    }
  }
}
```

---

## 通信协议

### 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| `input` | Client → Bridge | 键盘输入 |
| `output` | Bridge → Client | PTY 输出 |
| `resize` | Client → Bridge | 终端尺寸变更 |
| `command` | Client → Bridge | 内置命令 (`/remote`) |
| `command_result` | Bridge → Client | 命令结果 |
| `register` | Bridge → Relay | 注册会话 |
| `registered` | Relay → Bridge | 注册成功，含 token |
| `auth` | Phone → Relay | 认证 |
| `auth_result` | Relay → Phone | 认证结果 |

详见 [protocol.md](./protocol.md)。

---

## 鉴权

### 本地模式
无鉴权。`localhost` 本身就是安全边界。

### 远程模式
```
Bridge → Relay: register → 获得 token
Web UI: 显示二维码（含 token 的 URL）
手机: 扫码 → WebSocket 连接 → auth(token)
Relay: 校验 token → 绑定会话
```

- token 一次性使用
- 无用户系统，无数据库

---

## 启动方式

```bash
# 本地使用 Claude Code（推荐）
npm start
# → 启动 Claude Code + 本地服务器
# → 自动打开浏览器 http://localhost:3000

# 需要远程接入时，在 Web UI 中输入 /remote
# → 扫码即可从手机操作

# 启动 Relay Server（云服务器）
npm run server

# 开发模式
npm run dev:bridge    # Bridge 热重载
npm run dev:web       # Next.js 开发服务器 (localhost:3000)
npm run dev:server    # Relay 热重载
```

---

## 未来扩展路线

### Phase 1: Claude Code Shell ✅（当前）
- Web UI 作为主要界面
- 本地 + 远程接入
- `/remote` 命令

### Phase 2: 输出结构化
- 解析 Claude Code 输出
- 代码块语法高亮
- 文件 diff 可视化
- 对话历史记录

### Phase 3: 多终端支持
- SSH 会话接入（管理远程服务器）
- Docker 容器接入
- tmux 会话接入
- 同一套 Web UI 管理所有终端类型

### Phase 4: AI 调度
- 多会话管理
- 智能路由（根据输入选择目标会话）
- 自动化任务编排
