# Terminal Usability — Test Plan

> Phase 4H Terminal Usability (P0) — 2026-05-09
> Covers the Phase 4F+ terminal flow: no auto-spawn, explicit create, attach existing, reconnect persistence.

## A. Static Checks

### A.1 TypeScript Type Check

```bash
npm run typecheck
# 或
npx tsc --noEmit
```

预期：无类型错误。

### A.2 Build

```bash
npm run build
```

预期：构建通过，无类型错误、无构建警告。

---

## B. Browser Terminal 手动测试

### B.1 Empty State

1. 启动项目（`npm run dev`），打开浏览器进入 Console 页面。
2. 在 sidebar 中点击 Terminal tab（或打开 Terminal view）。
3. 确认看到 empty state：
   - "No terminal instance attached" 文字
   - "Attach an existing instance or create a new one" 提示
   - "Create New Terminal" 按钮
4. 确认没有实例自动创建（没有 shell 进程自动启动）。

### B.2 Create New Terminal

1. 在 Terminal empty state 中点击 "Create New Terminal"。
2. 等待实例创建完成。
3. 确认 terminal 出现，有 shell 提示符（如 `$`、`PS>` 等）。
4. 确认没有重复实例（只有一个 shell 进程）。

### B.3 Basic Commands

1. 在 Terminal 中输入 `echo hello` 并回车。
2. 确认输出显示 `hello`。
3. 输入 `pwd`，确认输出当前工作目录。
4. 输入 `cd .. && pwd`，确认工作目录变化正确。

### B.4 Window Resize

1. 调整浏览器窗口大小。
2. 确认 terminal 不崩溃，输出不异常。
3. 持续输入命令，确认 resize 后仍正常。

### B.5 Refresh / Reconnect (clientToken)

1. Terminal 正常运行时（已输入一些命令，看到输出），刷新页面。
2. 等待页面重新加载。
3. 确认 terminal tab 自动恢复（不是 empty state）。
4. 确认终端内容可继续输入（如输入 `echo still-alive`，能看到输出）。
5. 确认没有创建重复的 shell 进程。

### B.6 Attach Existing

1. 在 Terminal B.5 的基础上（已有 running shell instance）。
2. 在 pane tab bar 中点击 "+" 或打开 "New Tab" 选择 Terminal view。
3. 新的 Terminal tab 显示 empty state。
4. 确认 "ATTACH EXISTING" 下列出了之前创建的 shell 实例（状态显示 running）。
5. 点击该实例。
6. 确认 tab 绑定到该实例，显示 terminal 内容。
7. 确认可继续输入命令。

### B.7 Multiple Terminal Tabs

1. 创建两个 terminal tabs，分别绑定到不同的 shell 实例。
2. 在每个 tab 中输入不同命令。
3. 切换 tabs，确认每个 terminal 状态独立、内容正确。

### B.8 Kill Instance

1. Terminal 正常运行时，在 InstanceList 或 context menu 中 kill 该实例。
2. 确认 tab 变为 empty 状态（不隐式创建新实例）。
3. 确认 "No terminal instance attached" 显示。
4. 确认实例已从实例列表中消失。

### B.9 Create After Kill

1. 在 B.8 的 empty tab 中，点击 "Create New Terminal"。
2. 确认新 shell 实例创建成功，terminal 能正常使用。

### B.10 Context Menu

1. 在 Terminal view 区域右键。
2. 确认 context menu 中：
   - 显示 "New Shell"（创建新实例）
   - 显示 "Kill Instance"（kill 当前实例）
   - 不显示 "Clear Terminal"（已移除 no-op 条目）

### B.11 Escape / Interrupt

1. 在正在执行命令时（如长时间运行），按 Escape。
2. 确认有 interrupt 反馈，命令被终止。

---

## C. 验收清单

| 编号 | 测试项 | 结果 | 备注 |
|---|---|---|---|
| A.1 | TypeScript 类型检查 | ⬜ | |
| A.2 | Build 通过 | ⬜ | |
| B.1 | Empty state（无自动创建） | ⬜ | |
| B.2 | Create New Terminal | ⬜ | |
| B.3 | 基本命令 | ⬜ | |
| B.4 | 窗口 Resize | ⬜ | |
| B.5 | 刷新重连（clientToken） | ⬜ | |
| B.6 | Attach Existing | ⬜ | |
| B.7 | 多 Terminal tab | ⬜ | |
| B.8 | Kill Instance → empty state | ⬜ | |
| B.9 | Kill 后重新创建 | ⬜ | |
| B.10 | Context Menu（无 Clear Terminal） | ⬜ | |
| B.11 | Escape Interrupt | ⬜ | |
