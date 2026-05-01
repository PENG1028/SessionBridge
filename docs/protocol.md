# SessionBridge — 通信协议

所有消息均为 JSON 格式，通过 WebSocket 传输。

---

## 1. 本地模式（Client → Bridge）

### 键盘输入

```json
{ "type": "input", "data": "npm test\n" }
```

### 尺寸变更

```json
{ "type": "resize", "cols": 80, "rows": 24 }
```

### 内置命令

```json
{ "type": "command", "name": "remote", "args": { "relay": "ws://example.com:8080" } }
```

当前支持的命令：

| 命令 | 参数 | 说明 |
|------|------|------|
| `remote` | relay (可选) | 启用远程接入，生成二维码 |

## 2. 本地模式（Bridge → Client）

### 输出

```json
{ "type": "output", "data": "[32mHello[0m\n" }
```

### 命令结果

```json
{
  "type": "command_result",
  "name": "remote",
  "success": true,
  "data": {
    "token": "a1b2c3d4e5f6...",
    "webUrl": "http://example.com:8080/?token=a1b2c3d4e5f6..."
  }
}
```

### 错误

```json
{ "type": "error", "message": "Failed to connect to relay" }
```

## 3. 远程模式（Bridge ↔ Relay）

### 注册

```json
{ "type": "register" }
```

### 注册成功

```json
{
  "type": "registered",
  "sessionId": "a1b2c3",
  "token": "a1b2c3d4e5f6...",
  "webUrl": "http://relay-server:8080/?token=a1b2c3d4e5f6..."
}
```

### 输入转发（Phone → Relay → Bridge）

```json
{ "type": "input", "data": "/help\n" }
```

### 输出转发（Bridge → Relay → Phone）

```json
{ "type": "output", "data": "[32mHelp[0m\n" }
```

## 4. 远程模式（Phone ↔ Relay）

### 认证

```json
{ "type": "auth", "token": "a1b2c3d4e5f6..." }
```

### 认证结果

```json
{ "type": "auth_result", "success": true, "sessionId": "a1b2c3" }
```

### 输入/输出

与本地模式相同 — `input` 和 `output` 格式完全一致。

## 消息分类

| 类别 | 消息类型 | 可靠性 | 说明 |
|------|----------|--------|------|
| 控制 | register, auth, command | 可靠 | 单次，影响状态 |
| 数据 | input, output | 允许丢 | 持续流式，重传无意义 |
| 通知 | command_result, auth_result, error | 可靠 | 单次响应 |
| 配置 | resize | 允许丢 | 按需发送，最终一致 |

## 生命周期

```
本地浏览器                  Bridge                    Relay Server              手机
    │                        │                          │                       │
    │── WebSocket 连接 ─────→│                          │                       │
    │←─ output (PTY 输出) ───│                          │                       │
    │── input (键盘) ───────→│                          │                       │
    │── command: remote ────→│── register ─────────────→│                       │
    │                        │←─ registered (token) ────│                       │
    │←─ command_result ──────│                          │                       │
    │  (含 token + URL)      │                          │ 扫码                   │
    │                        │                          │←── auth(token) ───────│
    │                        │                          │── auth_result ───────→│
    │                        │←── input ────────────────│←── input ────────────│
    │                        │── output ───────────────→│── output ────────────→│
```
