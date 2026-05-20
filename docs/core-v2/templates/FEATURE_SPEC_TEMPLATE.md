# SessionNode v2 — 功能规约模板

> 每个功能必须按此模板编写设计文档
> 配套文档：ARCHITECTURE.md、CORE_PROTOCOL.md、PERMISSIONS.md、UX_SURFACES.md

---

## 模板说明

所有功能（包括 system-ui plugin 的内置页面和 feature plugin 的完整功能）都必须按本模板编写。

每节必须填写，不存在的内容标明"无"。模板确保每个功能在实现前已经考虑了所有维度。

---

## 模板正文

```markdown
# 功能名称

> 一句话描述功能

---

## 1. UX

### 入口
- 用户从哪里进入这个功能？
- 菜单项、按钮、命令面板、快捷键？

### 视图状态
- 空状态 (empty) — 没有数据时显示什么？
- 加载状态 (loading) — 数据加载中显示什么？
- 就绪状态 (ready) — 正常显示什么？
- 错误状态 (error) — 加载失败时显示什么？

### 交互元素
- 所有按钮及其行为
- 所有输入框及其校验规则
- 所有右键菜单项
- 拖拽操作
- 快捷键

### 桌面端展示
- 默认在哪个 surface 打开？（main.editor / sidebar / panel.bottom）
- 可拖拽到哪些 surface？
- 是否有独立的弹出窗口模式？

### 移动端展示
- 是否在移动端可用？
- 移动端以 sheet 还是 fullscreen 展示？
- 与桌面端的行为差异

### 失败提示
- 每种失败状态的用户提示
- Toast / Inline Error / Modal 的选择

## 2. UI Surface

### 贡献的 surface 类型
- [ ] main.editor — 主编辑器区域
- [ ] sidebar.left — 左侧边栏
- [ ] sidebar.right — 右侧边栏
- [ ] panel.bottom — 底部面板
- [ ] settings.page — 设置页面
- [ ] plugin.detail — 插件详情页
- [ ] commandPalette — 命令面板
- [ ] contextMenu — 上下文菜单
- [ ] statusBar — 状态栏
- [ ] header.left / center / right — 顶栏
- [ ] notification.center — 通知中心
- [ ] mobile.sheet — 移动端底部弹出
- [ ] mobile.fullscreen — 移动端全屏

### preferredSlot 和 allowedSlots
```
preferredSlot: sidebar.left
allowedSlots: [sidebar.left, panel.bottom, main.editor]
```

### SurfaceRenderContext
```typescript
interface SurfaceRenderContext {
  surfaceId: string;
  surfaceType: "main.editor" | "sidebar.left" | "sidebar.right" | ...;
  pluginId: string;
  viewId?: string;
  panelId?: string;
  tabId?: string;
  sessionId?: string;
  nodeId?: string;
  workspaceId?: string;
  params?: Record<string, unknown>;
}
```

## 3. UI Interface

### React 组件 Props
```typescript
interface MyFeatureViewProps {
  surfaceContext: SurfaceRenderContext;
  // 功能专用 props
}
```

### Core Client 方法
```typescript
// 此功能调用的 Core API 客户端方法
coreClient.createSession(params);
coreClient.streamSubscribe(params);
```

### 数据模型
```typescript
// 前端使用的数据模型
interface MyFeatureData {
  id: string;
  // ...
}
```

### 事件订阅
```typescript
// 订阅哪些 Core events
useEffect(() => {
  const unsub = coreClient.on("session.event", handler);
  return unsub;
}, []);
```

### Loading / Error 状态
```typescript
type ViewState<T> =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: CoreError };
```

## 4. Core Capability

### 调用的 Core 原子能力
| 能力 | 用途 | 必填 |
|------|------|------|
| `session.create` | 创建 session | 是 |
| `stream.subscribe` | 订阅输出 | 是 |
| `fs.read` | 读取文件 | 否 |

## 5. Core Protocol

### HTTP API
```
POST /api/route
Request: { ... }
Response: { ... }
```

### WebSocket 消息
```json
// 请求
{ "type": "...", "requestId": "req_xxx", ... }
// 响应
{ "type": "...", "requestId": "req_xxx", "ok": true, ... }
// 事件推送
{ "type": "...", ... }
```

### 错误形状
```json
{ "code": "ERROR_CODE", "message": "Human readable" }
```

## 6. Permission

### 需要的权限
| 权限 | 理由 | 默认策略 |
|------|------|---------|
| `process.spawn` | 启动进程 | ask |

### 谁能执行
- Web 用户
- CLI 用户
- 远程节点

### Target Node 校验
- 请求转发到目标 node 后，目标 node Core 重新校验权限

## 7. State Ownership

### Core 持久化
- session
- stream
- event log
- 文件操作审计

### System UI 保存
- 布局偏好
- 面板顺序
- 活动的 tabId（仅 UI 会话期间）

### Plugin UI 保存（localStorage）
- 主题偏好
- 最近使用的路径
- 展开/折叠状态

### 禁止
- localStorage 保存 session 列表
- localStorage 作为"已安装"事实

## 8. Logs / Audit

### Core Log
- 记录什么级别的事件

### Audit Log
- 记录什么操作

### Plugin History
- 记录什么

### Session Event
- 哪些 event 类型

## 9. CLI

### 命令
```bash
node <plugin> <command> [args]
```

### 是否插件贡献
- CLI 命令由哪个插件注册

### 调用的 Core API
- CLI handler 调用哪些 Core 能力

## 10. Failure States

| 场景 | 表现 | 恢复方式 |
|------|------|---------|
| target node offline | 错误提示 | 重试 / 选择其他 node |
| permission denied | 错误提示 + 权限申请入口 | 申请权限后重试 |
| dependency missing | 引导安装 | 点安装按钮 |
| install failed | 显示安装日志 | 查看日志后重试 |
| config invalid | 错误提示 | 打开设置页修改 |
| timeout | 超时提示 | 重试 |
| conflict | 冲突提示 | 手动解决 |
| unsupported platform | 不可用提示 | 提示支持平台 |
```

---

## 使用示例：简化版

以 Terminal 功能为例，展示模板的部分填充：

```markdown
# Terminal

---

## 1. UX

### 入口
- 命令面板 "Terminal: New Terminal"
- 底部面板 "+" 按钮
- 快捷键 Ctrl+Shift+`

### 视图状态
- empty: 无 session 时显示"打开新终端"
- loading: session 创建中显示 spinner
- ready: 显示终端模拟器（xterm.js）
- error: 显示错误信息 + "重试"按钮

### 移动端
- 移动端不可用（依赖 pty，需要桌面环境）

## 2. UI Surface
- surface: panel.bottom
- preferredSlot: panel.bottom
- allowedSlots: [panel.bottom, main.editor]

## 3. UI Interface
- 组件: TerminalView
- Props: { sessionId, streamIds }
- 订阅: session.event, stream.chunk

## 4. Core Capability
- session.create { kind: "process", command: "bash"|"powershell"|"zsh" }
- stream.subscribe { sessionId, streamType: "stdout" }
- stream.write { sessionId, streamType: "stdin", data }
- process.resize { sessionId, rows, cols }
- session.stop { sessionId }

## 5. Core Protocol
```json
// 创建
→ { "type": "session.create", "pluginId": "shell", "payload": { "kind": "process", "command": "bash" } }
← { "type": "session.created", "sessionId": "sess_xxx", "streamIds": { "stdout": "...", "stderr": "..." } }

// 订阅
→ { "type": "stream.subscribe", "sessionId": "sess_xxx", "streamType": "stdout", "fromSeq": 0 }
← { "type": "stream.subscribed" }
← { "type": "stream.chunk", "sessionId": "sess_xxx", "streamType": "stdout", "eventSeq": 1, "data": "base64..." }

// 写入
→ { "type": "stream.write", "sessionId": "sess_xxx", "streamType": "stdin", "data": "base64..." }
```

## 6. Permission
- process.spawn: 启动 shell 进程
- 默认策略: allow（shell 是基础能力）

## 7. State Ownership
- Core: session, stream, event log
- System UI: 面板展开/折叠状态
- localStorage: 上次使用的目录

## 8. Logs/Audit
- core log: session create/destroy
- audit log: process.spawn 记录
- session event: stdin, stdout, stderr, resize

## 9. CLI
```bash
node shell open [--target node]
node shell exec <command> [--target node]
```

## 10. Failure States
- node offline: "目标节点不可达"
- shell not found: "找不到 shell，请检查 PATH"
- permission denied: "无权限启动进程"
```
```

---

## 模板使用规则

1. **每个功能都必须写** — 不存在"功能太小不需要写"的情况。小功能可以简写。
2. **不存在的内容标"无"** — 不跳过。
3. **保持与现有文档一致** — 引用已有的 Core Protocol、Permission、Surface 定义。
4. **实现者以模板为准** — 如果实现时发现模板有遗漏，更新模板。
5. **模板本身持续演进** — 当发现新的维度时，更新模板。
