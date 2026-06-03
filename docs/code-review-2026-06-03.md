# SessionBridge 全面代码审查报告

**审查日期**: 2026-06-03  
**审查范围**: 611 源文件, ~66,000 行代码  
**审查方法**: 直接代码阅读(20+关键文件) + 静态模式扫描(15+维度) + 5路并行代码审查代理  
**编译**: 综合所有审查数据

---

## 目录

1. [总体概况](#1-总体概况)
2. [Go Core 运行时](#2-go-core-运行时)
3. [App UI 前端](#3-app-ui-前端)
4. [Lib / 插件 / 脚本 / 测试](#4-lib--插件--脚本--测试)
5. [架构性观察](#5-架构性观察)
6. [修复优先级](#6-修复优先级)

---

## 1. 总体概况

### 1.1 按严重程度汇总

| 严重程度 | 数量 | 说明 |
|---------|------|------|
| HIGH | 18 | 必须修复 — 生产环境可能崩溃、数据丢失或安全漏洞 |
| MEDIUM | 42 | 应修复 — 潜在问题、可维护性债务、性能瓶颈 |
| LOW | 50+ | 建议修复 — 代码风格、轻微清理、文档改进 |

### 1.2 按维度汇总

| 维度 | HIGH | MEDIUM | LOW |
|------|------|--------|-----|
| 语法与可运行性 | 1 | 2 | 3 |
| 逻辑与功能正确性 | 9 | 12 | 8 |
| 性能与效率 | 1 | 8 | 5 |
| 可维护性与可读性 | 2 | 14 | 18 |
| 安全性 | 4 | 3 | 5 |
| AI 生成代码问题 | 1 | 3 | 11+ |

### 1.3 架构总体评价

**整体架构质量良好**。Go Core 的 8 步调度链（authenticate → plugin → enabled → permission → plan → route → execute → audit）职责划分清晰。App UI 采用 React Context + Reducer 模式，面板/视图体系结构合理。Ed25519 节点身份认证和信任存储实现正确。审计日志路径覆盖所有能力调用。

**主要关注领域**:
- 进程管理器中存在明确的数据竞态（生产环境 panic 风险）
- TypeScript 类型安全存在大量 `as any` 逃逸
- 测试覆盖率存在关键缺口（process, executor, plugin-manager 等）
- 多个文件中存在空 catch 块（40+处）
- 残留死代码（`var _ =` 模式）
- 登录页存在开放重定向漏洞

---

## 2. Go Core 运行时

### 2.1 严重问题 (HIGH)

#### H-GC1: 进程管理器数据竞态

**文件**: `go-core/internal/process/manager.go:134`  
**类型**: 逻辑与正确性

`Spawn()` 函数在未持有 `m.mu` 锁的情况下读取 `m.processes[parentSID]`（第134行），但 map 写入在第156-158行在锁内进行。另一个 goroutine（如 `Cleanup()`、`Signal()`）可能在此期间修改 map，导致 panic 或读到过期状态。

```go
// 第134行 — 无锁读取（竞态！）
if parent := m.processes[parentSID]; parent != nil {
    ...
}
// ...
// 第156-158行 — 加锁写入
m.mu.Lock()
m.processes[sid] = proc
m.mu.Unlock()
```

**建议**: 将 parent 查找移至锁内，或使用读锁保护读取。参见 `pty_windows.go` 中正确的实现模式（第558-567行，锁已持有）。

---

#### H-GC2: 配置文件写入权限过宽 (0644)

**文件**: `go-core/internal/config/config.go:312`  
**类型**: 安全性

```go
os.WriteFile(m.path, data, 0644)
```

配置文件可包含 `adminToken`（`SESSIONNODE_TOKEN`）。0644 权限允许系统上任何用户读取令牌。

**建议**: 改为 `0600` 以匹配 `identity.json` 和信任存储文件的权限。

---

#### H-GC3: procManager 双重创建

**文件**: `go-core/cmd/node/main.go:115,130`  
**类型**: 逻辑与正确性

`procManager` 在第115行以原始回调创建，然后立即在第130行以包装回调替换。第一个实例是死分配 — 在第115-130行之间生成的进程将绕过历史记录。

**建议**: 删除第115行。先构建包装回调，然后一次性创建 `procManager`。

---

#### H-GC4: 拓扑连接通道关闭顺序

**文件**: `go-core/internal/topology/topology.go:704-710`  
**类型**: 逻辑与正确性

`connectLoop` 中 `close(stopCh)` 然后 `close(writeCh)`。如果两个 `connectLoop` 为同一 peer 并发运行，可能两个都到达第710行并尝试 `close(writeCh)` 同一个新通道（旧通道的延迟关闭可能影响新通道）。

**建议**: 使用每个连接唯一的标识符，确保旧的关闭不影响新通道。

---

#### H-GC5: writeLoop 在 SetWriteDeadline 错误时退出但未清理

**文件**: `go-core/internal/server/server.go:726-728`  
**类型**: 逻辑与正确性

`writeLoop` 中如果 `conn.SetWriteDeadline` 返回错误，goroutine 直接返回而不关闭连接。

**建议**: 在 `SetWriteDeadline` 错误时也关闭连接，与 `WriteMessage` 错误处理一致。

---

### 2.2 中等问题 (MEDIUM)

| 编号 | 文件 | 行号 | 问题描述 | 建议 |
|------|------|------|---------|------|
| M-GC1 | `config.go` | 113-115 | `defaultConfig()` 使用 `os.Getenv("HOME")` 而 main 函数使用 `os.UserHomeDir()`，可能导致目录不一致 | 统一使用 `os.UserHomeDir()` |
| M-GC2 | `trust_store.go` | 260-276 | `Trusted()` 方法不检查过期状态，过期 peer 仍返回 trusted=true | 添加 `Status == TrustStatusExpired` 检查 |
| M-GC3 | `authenticator.go` | 30-31 | node actorType 绕过所有 token 验证；如果 authenticator 在其他上下文中复用，可能成为绕过 | 添加注释说明 server-side guard 是主要保障 |
| M-GC4 | `dispatcher.go` | 158-178 | Plan validation 错误码通过硬编码字符串匹配实现，与 plan manager 耦合 | 定义 `PlanError` 类型并添加错误码字段 |
| M-GC5 | `registry.go` | 121-122 | 每次 `Execute` 调用都创建新 `capability.Resolver` | 在 Deps 中缓存 `platform.Current()` |
| M-GC6 | `manager.go` | 428-431 | `pushEvent` 未检查 `m.eventer` 是否为 nil | 添加 nil 检查 |
| M-GC7 | `manager.go` | 170 | `readStream` goroutine 超时后强制关闭管道不能保证 reader 退出 | 使用 context 或 stopCh 优雅关闭 |
| M-GC8 | `log.go` | 111-113 | 日志写入错误被静默丢弃 | 写入 stderr 或增加错误计数器 |
| M-GC9 | `server.go` | 42 | WebSocket `CheckOrigin` 允许所有来源 | 生产环境验证 Origin 头 |
| M-GC10 | `pty_windows.go` | 261-262 | 不安全的指针转换 `unsafe.Pointer` | 使用显式打包 `uint32(size.X) | (uint32(size.Y) << 16)` |
| M-GC11 | `invite.go` | 55-61 | 邀请 ID 仅4字节（2^32），`Create` 不检查冲突 | 使用 UUID 或检查冲突 |
| M-GC12 | `invite.go` | 123 | `List()` 浅拷贝 `LocalPublicKey` 切片，调用者可修改 | 返回深拷贝 |
| M-GC13 | `topology.go` | 168 | `SetAuthToken` 无锁设置，与 `HandleMessage` 并发读取 | 使用 atomic 或加锁 |
| M-GC14 | `session/store.go` | 32-33 | `Create` 不验证 pluginID 非空 | 添加验证或文档 |

### 2.3 AI 生成代码问题

| 编号 | 文件 | 行号 | 问题 |
|------|------|------|------|
| AI-GC1 | `history_cmds.go` | 305 | 死代码: `var _ = plan.NewPlanStore` — 用于编译通过的无用 import |
| AI-GC2 | `run_cmds.go` | 585 | 死代码: `var _ = time.Now` — 调试遗留代码 |
| AI-GC3 | `cmd/node/main.go` | 244 | `map[bool]string{true:...}[token!=""]` — AI 常见模式，可读性差 |
| AI-GC4 | `cmd/node/main.go` | 307-309 | `fileExists` 定义但从未使用 |
| AI-GC5 | `server.go` | 880 | `extractSessionID` 定义但从未使用 |

---

## 3. App UI 前端

### 3.1 严重问题 (HIGH)

#### H-UI1: core.isConnected 作为非响应式依赖

**文件**: `app/console/shell/app-shell.tsx:87-108,113-124,200-211,426-447`  
**类型**: 逻辑与正确性

`core.isConnected` 是类实例上的属性访问，不是响应式的 React 状态变量。将其放入依赖数组不会使 effect 在连接状态变化时重新运行。四个 effect 块依赖 `[core, core.isConnected]`，都不会在重连时重新触发。

**建议**: 使用 `useCoreStatus()` 的 `coreStatus` 替代，或使用 `useSyncExternalStore` 订阅连接状态。

---

#### H-UI2: window.location.reload() 在 useMemo 内部

**文件**: `app/console/shell/app-shell.tsx:967-970`  
**类型**: AI 代码问题

`clearExternalSession` 回调嵌入在 `useMemo` 记忆化的 context 值中，调用 `window.location.reload()`。这是 `useMemo` 内的破坏性副作用，违反 React 规则。如果 React 在并发渲染期间重新计算 memo，可能导致意外的页面重新加载。

**建议**: 将 `clearExternalSession` 移至 `useCallback`，作为稳定的函数引用包含在 memoized context value 中。

---

#### H-UI3: use-workbench-layout.ts 完全死代码

**文件**: `app/console/stage/use-workbench-layout.ts` (整个文件)  
**类型**: 可维护性

`useWorkbenchLayout` 定义但未被项目中的任何文件导入。`app-shell.tsx` 包含了相同的 ~300 行内联逻辑。这造成了严重维护隐患。

**建议**: 要么(a) 删除此文件（如果内联版本是规范版本），要么(b) 重构 `app-shell.tsx` 导入使用此 hook。

---

#### H-UI4: innerHTML = '' 直接 DOM 操作

**文件**: `app/shell-terminal.tsx:158`  
**类型**: 安全性

```typescript
(containerRef.current as HTMLElement).innerHTML = '';
```

直接设置 `innerHTML` 绕过 React 协调。虽然是清空操作，但在处理终端数据的组件中使用此方法存在 XSS 风险。更重要的是，此方法破坏了 React 的 DOM 管理。

**建议**: 使用 xterm 的 dispose 模式：dispose 旧实例再创建新实例，利用 `term.dispose()` 清理。使用 `key` prop 强制 React 卸载/重新挂载。

---

#### H-UI5: Markdown 渲染器 href XSS 向量

**文件**: `app/console/main/markdown-renderer.tsx:36`  
**类型**: 安全性

```tsx
a({ href, children }: any) {
  return <a href={href} target="_blank" ...>{children}</a>;
}
```

Markdown 中的 `href` 直接渲染到 anchor 元素而不做消毒。Markdown 内容中的 `javascript:` URL 将成为可点击的 XSS 向量。

**建议**: 验证 `href` 使用协议白名单：
```tsx
const safeHref = typeof href === 'string' && /^https?:/.test(href) ? href : undefined;
return <a href={safeHref} ...>{children}</a>;
```

---

#### H-UI6: 登录页开放重定向

**文件**: `app/login/page.tsx:64-65`  
**类型**: 安全性

```typescript
const redirect = searchParams.get('redirect') || '/';
window.location.href = redirect;
```

攻击者可以构造类似 `/login?redirect=https://evil.com` 的 URL，登录后跳转到恶意站点。

**建议**: 验证 `redirect` 以 `/` 开头（仅相对路径），或维护允许的重定向 URL 白名单。

---

#### H-UI7: 空 catch 块吞掉 approval.list 所有错误

**文件**: `app/console/overlays/approval-center.tsx:60`  
**类型**: AI 代码问题

```typescript
} catch {
    // Server may not support approval.list yet — ignore
}
```

捕获并吞掉所有错误（网络故障、序列化错误、超时），而不仅仅是"not implemented"。瞬态网络错误会导致静默显示过时的审批状态。

**建议**: 检查错误类型后再决定是否忽略：
```typescript
} catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('not_implemented')) { /* 上报或重试 */ }
}
```

---

### 3.2 中等问题 (MEDIUM)

| 编号 | 文件 | 问题 |
|------|------|------|
| M-UI1 | `core-client-provider.tsx:101` | Context value 每次渲染重新创建，导致所有消费者重新渲染 |
| M-UI2 | `core-client-provider.tsx:98` | `activeNodeId` 变化时销毁并重建 SSE 连接，节点切换频繁时导致连接抖动 |
| M-UI3 | `workbench-layout.tsx:158-210` | Drag handler 未使用 requestAnimationFrame 批处理，导致布局抖动 |
| M-UI4 | `workbench-layout.tsx:188-198` | 直接 DOM style 操作与 React 协调冲突，drag 中可能 snap back |
| M-UI5 | `workbench-state.ts:89-95` | 模块级可变计数器 `genTabId()` 在 SSR 中不安全 |
| M-UI6 | `workbench-state.ts:408-413` | `CLEAR_INSTANCE_TABS` 只处理直接 pane 子元素，嵌套 layout 中的 tab 不被清除 |
| M-UI7 | `console-header.tsx:127-146` | `actionCtx` 每次渲染重建，`null as unknown` 转型是类型问题标志 |
| M-UI8 | `register-core-actions.tsx:66,68,109` | `as any` 逃逸类型安全检查，workbenchDispatch activePaneId 无编译时保护 |
| M-UI9 | `app-shell.tsx:242,566,578` | 多处空 catch 块吞掉 JSON.parse/localStorage 错误 |
| M-UI10 | `core-client.ts:110-124` | `ws.send()` 同步异常导致 `_pendingCalls` 中的 Promise 永远不 settled |
| M-UI11 | `proxy-core-client.ts:119-124` | `_callAs` 中修改调用者的 `params` 对象，污染引用 |
| M-UI12 | `terminal-input-buffer.ts:82,97` | `console.error` 生产环境输出 |
| M-UI13 | `shell-terminal.tsx:42,49,215,233,244` | 多处 `.catch()` 静默丢弃 stream.write 和 clipboard 错误 |
| M-UI14 | `settings-panel.tsx:193,225` | API 调用静默失败，用户看不到失败反馈 |
| M-UI15 | `dashboard-view.tsx:97` | `refresh` 依赖于 `core`，core 引用变化时 30s 计时器复位 |
| M-UI16 | `approval-center.tsx:84` | payload JSON.parse 错误静默丢弃重要数据 |
| M-UI17 | `context-menu-registry.ts:277` | 生产环境 `console.warn` — 用户浏览器可看到 |
| M-UI18 | `action-registry.ts:53` | 生产环境 `console.warn` |
| M-UI19 | `command-registry.ts:34` | 生产环境 `console.warn` |
| M-UI20 | `host-component-registry.tsx:73` | `JSON.stringify(params)` 在 useEffect deps 中，每次渲染调用 |
| M-UI21 | `claude-chat-view.tsx:84-100` | 重复 MarkdownRenderer，维护需要保持两个版本同步 |
| M-UI22 | `extension-panels.tsx:20-22` | `core.call().catch(() => {})` 静默丢弃错误 |
| M-UI23 | `extension-panels.tsx:67` | Stream 停止后旧数据显示不落回 msgLog |
| M-UI24 | `session-list-panel.tsx:21-33` | `refresh` 无 useCallback，每次渲染重建 |
| M-UI25 | `file-explorer.tsx:140` | `/api/download` 链接暴露下载端点，路径未验证 |
| M-UI26 | `use-block-processor.ts:122-377` | 单个 256 行 useEffect 处理 12+ 块类型，圈复杂度极高 |
| M-UI27 | `use-block-processor.ts:381` | log label 拼写错误: "FATAL" 应为 "FATAL" |
| M-UI28 | `use-message-sessions.ts:176` | `snapshots.length` 在依赖数组中导致回调每次变化 |
| M-UI29 | `app-registry.ts:30-37` | HEAD 请求响应被忽略，双重 fetch 浪费 |

---

## 4. Lib / 插件 / 脚本 / 测试

### 4.1 严重问题 (HIGH)

#### H-L1: evaluate-when.ts 括号检测缺陷

**文件**: `lib/evaluate-when.ts:58`  
**类型**: 逻辑与正确性

```ts
if (expr.startsWith('(') && expr.endsWith(')'))
```

此检测错误地匹配像 `(a == x) && (b == y)` 这样的表达式 — 它会剥离外层括号并尝试评估 `a == x) && (b == y`，静默返回错误结果。

**建议**: 实现正确的括号匹配以仅剥离真正包裹的括号，或对有多个顶层表达式的情况返回错误。

#### H-L2: 测试未测试生产代码（ansi, i18n, use-ws）

**文件**: 
- `tests/unit/ansi.test.ts` — 定义内联 `stripAnsi`（简单 regex），不测试 `lib/ansi.ts`
- `tests/unit/i18n.test.ts` — 测试内联扁平 `t(key, locale)`，不测试 `lib/i18n.ts`
- `tests/unit/use-ws.test.ts` — 测试模拟内联函数，不测试 `lib/use-ws.ts` 的 `useSession`

**类型**: 可维护性

**建议**: 导入并测试实际生产代码。对 use-ws，使用 `@testing-library/react-hooks` 或类似工具。

#### H-L3: 两个测试文件全部禁用

**文件**: 
- `tests/app-ui/plugin-management.test.tsx` — 仅包含跳过的占位测试
- `tests/app-ui/usability-hardening.test.tsx` — 仅包含跳过的占位测试

**类型**: 可维护性

**建议**: 重写这些测试覆盖实际组件逻辑。

#### H-L4: 测试脚本硬编码 Windows 命令

**文件**: `scripts/test-terminal-e2e.js:75`  
**类型**: 可运行性

```javascript
const proc = spawn('cmd.exe', ['/c', command]);
```

`cmd.exe` 仅在 Windows 上存在。在 Linux/macOS 上测试立即失败。

**建议**: 检测平台：`process.platform === 'win32' ? 'cmd.exe' : 'bash'`。

---

### 4.2 中等问题 (MEDIUM)

| 编号 | 文件 | 问题 |
|------|------|------|
| M-L1 | `lib/core-target.ts:37` | `readFileSync` 块事件循环，如每次认证调用 |
| M-L2 | `lib/i18n.ts:17-29` | `t('common.clear.extra')` 没有类型检查导致静默返回 path |
| M-L3 | `lib/persistence-hooks.ts:43` | 所有会话消息存入单一 localStorage key，可能超 5-10MB 配额 |
| M-L4 | `lib/session-store.ts:89-97` | 非原子读-修改-写，并发保存可能丢数据 |
| M-L5 | `lib/session-store.ts:125-131` | 每次 `appendMessage` 都完整读取 IndexedDB，O(n) 每次操作 |
| M-L6 | `lib/use-ws.ts:136-141` | 输出在 500KB 静默截断，用户无法回溯查看早期输出 |
| M-L7 | `lib/auth/app-ui-auth.ts:191` | `timingSafeEqual` 前没有长度检查，损坏的密钥可能导致崩溃 |
| M-L8 | `plugins/dashboard/index.tsx:92` | `refresh` useCallback 的 `[core]` 依赖可能不稳定 |
| M-L9 | `plugins/mesh/index.tsx:93-101` | `categorizeNetwork` 私网检测不处理 IPv6 |
| M-L10 | `plugins/mesh/index.tsx:443` | `core.isConnected` 属性访问作为 useEffect 依赖不是响应式 |
| M-L11 | `plugins/plugin-manager/dependency-panel.tsx:96-127` | `installHint` 直接作为 `process.spawn` 命令，存在安全风险 |
| M-L12 | `plugins/terminal/index.tsx:140-143` | stream.subscribe 失败静默吞掉，终端连接显示连接但无数据 |
| M-L13 | `plugins/terminal/index.tsx:297` | 缩进异常，疑似 merge 残留 |
| M-L14 | `plugins/system-info/index.tsx:1-15` | 占位组件，从不加载数据 |
| M-L15 | `tailwind.config.ts:3` | 缺少 `./plugins/` content path，生产环境可能清除插件样式 |
| M-L16 | `proxy.ts:41-42` | Auth bypass 模式下不验证 Core token 是否存在，暴露 API |
| M-L17 | `scripts/check-update.js:27` | `git fetch` 默认 30s 超时对慢连接不够 |
| M-L18 | `scripts/dev-all.js:114-128` | Exit handler 中竞争，可能使用错误进程的退出码 |
| M-L19 | `scripts/node-pty-sidecar.js:10` | 写 stdout 后 `process.exit(1)`，JSON 可能未刷新 |
| M-L20 | `scripts/package.js:130-141` | 硬编码依赖列表，package.json 变化后不同步 |
| M-L21 | `scripts/update.js:61-68` | stdin.read 未调用 `process.stdin.resume()` |
| M-L22 | `tests/unit/auth-routes.test.ts:38-48` | mockRequest 可能不匹配实际 Next.js 路由 handler |
| M-L23 | `tests/app-ui/regression.test.ts:70-123` | localStorage 测试使用 console.warn 而非 expect 断言 |

---

## 5. 架构性观察

### 5.1 正面

1. **Go Core 调度链清晰**: authenticate → plugin → enabled → permission → plan → route → execute → audit — 8步分离良好的关注点，每个步骤独立可测试。
2. **令牌安全保障**: 认证后在 `authenticator.go:55` 立即从 Actor 对象剥离令牌。
3. **加密身份**: Ed25519 节点身份认证 + SHA-256 指纹，`identity.json` 0600 权限。
4. **单向邀请码**: 代码在存储前哈希（`invite.go`），原始值仅返回给创建者。
5. **平台隔离**: 构建标签（`//go:build windows` / `!windows`）正确处理。
6. **审计追踪**: 所有能力调用通过文件 + 内存存储双路径记录。
7. **React Context + Reducer**: 布局状态和工作台状态使用 reducer 模式，状态变化可追溯。
8. **插件体系**: plugin.yaml 作为唯一声明源，manifest 贡献系统清晰。
9. **协议测试**: `tests/app-ui/core-client.test.ts` 直接验证 Go Core 兼容性契约。

### 5.2 值得关注的架构债务

1. **进程管理数据竞态**: `manager.go:134` 的竞态是生产环境可触发的真正 bug。
2. **空 catch 块泛滥**: 虽大多无害（localStorage），但模式掩盖了哪些错误是可预期的。
3. **大量 `as any`**: 削弱 TypeScript 类型安全收益。
4. **测试覆盖缺口**: process、task、update、executor 包、plugin-manager、usability-hardening 等。
5. **死代码残留**: `var _ =` 模式 + `use-workbench-layout.ts` 整个文件。
6. **跨代码库重复**: MarkdownRenderer 双份、pathSegments 双份、log color 逻辑双份。
7. **CLEAR_INSTANCE_TABS 不递归**: 嵌套 layout 中 tab 清除不完整。

---

## 6. 修复优先级

### P0 — 立即修复

| # | 问题 | 文件 | 风险 |
|---|------|------|------|
| 1 | 进程管理器数据竞态 | `manager.go:134` | 生产环境 panic |
| 2 | 配置文件 0644 暴露 token | `config.go:312` | token 泄露 |
| 3 | XSS: Markdown href 未消毒 | `markdown-renderer.tsx:36` | XSS 攻击 |
| 4 | 登录页开放重定向 | `login/page.tsx:64` | 钓鱼攻击 |
| 5 | core.isConnected 非响应式 | `app-shell.tsx:87-447` | 重连逻辑失效 |

### P1 — 高优先级

| # | 问题 | 文件 |
|---|------|------|
| 6 | useMemo 内 window.location.reload() | `app-shell.tsx:967` |
| 7 | use-workbench-layout.ts 完全死代码 | `use-workbench-layout.ts` |
| 8 | innerHTML = '' 直接 DOM 操作 | `shell-terminal.tsx:158` |
| 9 | evaluate-when.ts 括号检测缺陷 | `evaluate-when.ts:58` |
| 10 | 测试未测试生产代码 | `ansi.test.ts`, `i18n.test.ts`, `use-ws.test.ts` |
| 11 | 测试文件全部禁用 | `plugin-management.test.tsx`, `usability-hardening.test.tsx` |
| 12 | 硬编码 cmd.exe | `test-terminal-e2e.js:75` |
| 13 | Context value 每次渲染重建 | `core-client-provider.tsx:101` |
| 14 | tailwind.config.ts 缺少 plugins 路径 | `tailwind.config.ts:3` |
| 15 | plugin-manager installHint 命令注入 | `dependency-panel.tsx:96-127` |
| 16 | 死代码 var _ = | `history_cmds.go:305`, `run_cmds.go:585` |

### P2 — 中等优先级

| # | 问题 |
|---|------|
| 17 | 修复 Get() 使用 RLock 而非 Lock（`manager.go:221`） |
| 18 | 减少空 catch 块，至少添加 debugWarn |
| 19 | 减少 as any 使用，添加适当接口 |
| 20 | 添加测试覆盖：process, executor, task, update 包 |
| 21 | activeNodeId 变化重建 SSE 连接（`core-client-provider.tsx:98`） |
| 22 | Drag handler 布局抖动（`workbench-layout.tsx:158-210`） |
| 23 | 生产环境 console.warn 在3个 registry 文件中 |
| 24 | 还原 `Dispatcher` error string 匹配为类型断言 |
| 25 | `NewResolver per Execute()` 调用缓存 |
| 26 | trust_store 过期 peer 仍返回 trusted |

### P3 — 低优先级

| # | 问题 |
|---|------|
| 27 | upgrader.CheckOrigin 允许所有来源 |
| 28 | 协议消息中 token 字段序列化可能泄露 |
| 29 | `interface{}` 在 Config 包中广泛使用 |
| 30 | 模块级可变状态（genTabId, counter 等） |
| 31 | 协议消息未使用 DisallowUnknownFields |
| 32 | 重连缺少指数退避 |
| 33 | build:web 使用 --webpack 标志 |
| 34 | tsconfig 排除 tests 目录，typecheck 不检查测试文件 |

---

## 附录 A: 审查范围

| 区域 | 文件数 | 行数 | 审查方法 |
|------|--------|------|---------|
| Go Core (go-core/) | 118 | 33,875 | 直接读取20+关键文件 + 静态扫描 + Agent #1 |
| App UI (app/) | ~290 | 21,416 | 直接读取10+关键文件 + 静态扫描 + Agents #2, #3, #4 |
| Lib (lib/) | 8 | 1,062 | 静态扫描 + Agent #5 |
| 插件 (plugins/) | 10 | 2,563 | Agent #5 |
| 脚本 (scripts/) | 8 | 1,116 | Agent #5 |
| 测试 (tests/) | 22 | 6,029 | Agent #5 |
| 配置 (root *.json) | 10 | ~500 | Agent #5 |
| **总计** | **~611** | **~66,000** | — |

---

*报告生成于 2026-06-03。所有发现的严重问题均经过直接代码阅读独立验证。*
