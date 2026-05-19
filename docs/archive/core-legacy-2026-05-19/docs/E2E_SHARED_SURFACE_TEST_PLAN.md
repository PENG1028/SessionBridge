# E2E Shared Surface Test Plan

> Playwright 端到端测试计划：两台浏览器进入同一 node，验证 terminal tab 的跨设备同步。
> 目标：防止"协议测试 pass 但 UI 没效果"的回归。

---

## 前置条件

- 本地 Relay Server 已启动（`npm run dev`）
- Next.js dev server 已启动（`npm run dev:web`）
- 至少一个 agent 已注册（本机 node 即可）
- Playwright 已安装

## 测试架构

```
Browser A (Playwright Page A) ──WebSocket──┐
                                            Relay Server (localhost:8080)
Browser B (Playwright Page B) ──WebSocket──┘
```

两个 Page 共享同一个 Playwright context（共享 localStorage），模拟两个独立设备连接到同一 relay。

---

## Step 1: 启动 relay 并确认健康

```
GET /api/health
Expect: 200 OK, instances.length >= 1
```

验证点：
- relay 正常运行
- 至少有一个 agent node 已注册

## Step 2: Browser A 打开应用

```
Page A → http://localhost:3000
Wait for: WebSocket connected (status bar shows "CONNECTED")
Wait for: NodeBar shows at least one peer
```

验证点：
- WS 连接成功
- welcome 消息已接收
- peer list 已加载
- NodeBar 显示可用节点

## Step 3: Browser A 进入 node

```
Page A → Click node in NodeBar
Wait for: workbench layout appears
Wait for: "New" empty tab visible
```

验证点：
- `workbench.subscribe` 已发送
- `surface.subscribeNode` 已发送
- `workbench.tabs` 响应已处理
- `surface.list` 响应已处理
- 工作台布局已渲染（至少有一个 pane）

## Step 4: Browser A 创建 Terminal tab

```
Page A → Click "New" tab dropdown → Select "Terminal"
Wait for: Terminal view appears
Wait for: "Shell ready — type below" in terminal
```

验证点：
- `createInstance` HTTP POST 成功
- `bindCurrentTabInstance` dispatch SET_TAB_VIEW
- `publishSurfaceForTab` 发送 `surface.publish`
- `surface.published` 回执已收到
- tab 带有 `_surfaceId` 和 `_operationId`
- terminal 显示 "Shell ready"

## Step 5: Browser A 在 terminal 中输入文本

```
Page A → Focus terminal
Page A → Type: echo "hello from A"
Wait for: output appears in terminal
```

验证点：
- 输入通过 `operation.input` 发送（带 operationId）
- `runtime.output` 回显到 terminal
- terminal buffer 包含 "hello from A"

## Step 6: Browser B 打开应用并进入同一 node

```
Page B → http://localhost:3000?debugSurface=1
Wait for: WebSocket connected
Page B → Click same node in NodeBar
Wait for: workbench layout appears
```

验证点：
- debugSurface logging 在控制台可见
- `[debugSurface] RECEIVED surface.list` 日志出现
- `[debugSurface] RECEIVED surface.published` 日志出现（如果 surface 在 B 连接后发布）

## Step 7: Browser B 看到 Browser A 的 Terminal tab

```
Wait for: Terminal tab visible in Browser B's workbench
```

验证点：
- tab 标题为 "Terminal"
- tab 带有正确的 instanceId
- tab 的 `_surfaceId` 已设置
- 无重复 tab（同一 surfaceId 不会创建两次）
- 无 empty placeholder tab 残留

## Step 8: Browser B 的 Terminal 显示历史输出

```
Page B → Click Terminal tab
Wait for: terminal displays "hello from A"
```

验证点：
- ShellTerminal 走了 surface 路径（_surfaceId 非空）
- `surface.subscribe` 已发送
- `runtime.replay` 已接收
- "hello from A" 在 terminal buffer 中可见
- ANSI 颜色代码正确渲染

## Step 9: Browser B 在 terminal 中输入

```
Page B → Type: echo "hello from B"
Wait for: output appears in Browser B terminal
```

验证点：
- 输入通过 `operation.input` 发送
- Browser B terminal 显示 "hello from B"

## Step 10: Browser A 看到 Browser B 的输出（live sync）

```
Page A → Check terminal output
Expect: Browser A terminal shows "hello from B"
```

验证点：
- `runtime.output` live broadcast 到达 Browser A
- Browser A terminal buffer 包含 "hello from B"
- 两个浏览器的 terminal 内容一致

## Step 11: Browser A 关闭 Terminal tab

```
Page A → Click close (×) on Terminal tab
Wait for: tab disappears from Browser A
```

验证点：
- `surface.close` 已发送
- `surface.closed` 广播到达 Browser B
- Browser B 的对应 tab 也自动关闭
- `workbench.tabs` 更新（兼容投影也移除）

## Step 12: 验证 debugSurface 诊断端点

```
GET http://localhost:8080/api/debug/surfaces
Expect: JSON with surfaceDebug, workbenchTabs, instances
```

验证点：
- `surfaceDebug.surfaces` 反映当前 surface 状态
- `surfaceDebug.events` 包含完整的 surface 生命周期事件
- `surface.publish.created` 事件存在
- `surface.close` 事件存在
- `runtime.replay` 事件存在
- `workbenchTabs` 与 surfaces 一致

---

## 额外场景

### 场景 B: Late join（A 发布 surface 后 B 才连接）

```
1. Browser A 创建 terminal 并输入文本
2. Browser A 断开（但 surface 保留在 relay）
3. Browser B 连接 → 进入 node
4. Browser B 应该看到 A 创建的 terminal tab + 历史输出
```

### 场景 C: 双 terminal 同步

```
1. Browser A 创建 Terminal-1
2. Browser A 创建 Terminal-2
3. Browser B 进入 node → 两个 terminal tab 都出现
4. A 在两个 terminal 分别输入 → B 在两个 tab 都看到对应输出
```

### 场景 D: 空客户端（B 在 A 发布前就订阅了 node）

```
1. Browser B 先进入 node（此时无 surface）
2. Browser A 在另一个设备创建 terminal
3. Browser B 自动收到 surface.published push
4. Terminal tab 自动出现在 Browser B 的工作台
```

---

## Playwright 实现建议

```ts
// tests/e2e/shared-terminal.spec.ts
import { test, expect } from '@playwright/test';

const RELAY_URL = 'http://localhost:8080';
const APP_URL = 'http://localhost:3000';

test.describe('Shared Surface E2E', () => {
  test('terminal sync between two browsers', async ({ browser }) => {
    // Create two isolated contexts (模拟两个独立设备)
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Step 1: Verify relay health
    const health = await pageA.request.get(`${RELAY_URL}/api/health`);
    expect(health.ok()).toBeTruthy();

    // Step 2: Browser A opens app
    await pageA.goto(APP_URL);
    await pageA.waitForSelector('text=CONNECTED', { timeout: 10000 });

    // Step 3: Browser A enters node
    const nodeButton = pageA.locator('[data-testid="node-bar-peer"]').first();
    await nodeButton.click();
    await pageA.waitForSelector('text=WORKBENCH', { timeout: 5000 });

    // Step 4: Browser A creates terminal
    // Click the empty tab's "New" dropdown → select Terminal
    // ...

    // Step 5: Type in terminal
    const terminalA = pageA.locator('.xterm-helper-textarea').first();
    await terminalA.focus();
    await terminalA.type('echo "hello from A"\n');
    await pageA.waitForSelector('text=hello from A', { timeout: 5000 });

    // Step 6-7: Browser B enters same node, sees terminal tab
    await pageB.goto(APP_URL);
    // ... repeat node entry, verify terminal tab appears
    const terminalTabB = pageB.locator('[data-testid="tab"]:has-text("Terminal")');
    await expect(terminalTabB).toBeVisible({ timeout: 10000 });

    // Step 8: Browser B clicks terminal tab, sees history
    await terminalTabB.click();
    await pageB.waitForSelector('text=hello from A', { timeout: 10000 });

    // Step 9-10: Cross input
    const terminalB = pageB.locator('.xterm-helper-textarea').first();
    await terminalB.focus();
    await terminalB.type('echo "hello from B"\n');
    await pageA.waitForSelector('text=hello from B', { timeout: 10000 });

    // Cleanup
    await ctxA.close();
    await ctxB.close();
  });
});
```

---

## 失败诊断流程

如果 E2E 测试失败，按以下顺序排查：

1. **检查 relay 状态**: `curl http://localhost:8080/api/debug/surfaces | jq .`
2. **检查 browser A 控制台**: 过滤 `[debugSurface]` — 确认 `surface.publish` 被发送且 `surface.published` 被接收
3. **检查 browser B 控制台**: 过滤 `[debugSurface]` — 确认 `surface.list` 被接收，surface 数据完整
4. **检查 ShellTerminal 路径**: 确认 `[debugSurface] ShellTerminal: connecting via SURFACE protocol` 日志出现
5. **检查 input 路由**: 确认 `[debugSurface] ShellTerminal input routing: operation.input (surface path)` 日志出现
6. **检查 UI contract**: `node tests/integration/ui-surface-real-path-contract.test.mjs`
7. **检查协议层**: `node tests/integration/shared-surface-terminal-replay.test.mjs`
