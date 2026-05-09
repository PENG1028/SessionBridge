# Terminal Execution — Test Plan

> Phase 4A: 权限检查收口验收 — 2026-05-09

## A. 静态检查

### A.1 TypeScript 类型检查

```bash
npm run typecheck
# 或
npx tsc --noEmit
```

预期：无类型错误。

### A.2 权限检查点确认

确认 dashboard-server `/api/shell/run` 有权限检查：

```bash
grep -n "permissions.check.*shellAccess" adapters/agent-core/dashboard-server.ts
```

预期：在 `/api/shell/run` handler 中，`spawn()` 之前有 `permissions.check('shellAccess', { command })`。

确认 node-runtime `spawnShell()` 有权限检查：

```bash
grep -n "permissions.check.*shellAccess" adapters/agent-core/node-runtime.ts
```

预期：在 `spawnShell()` 中，`spawn()` 之前有 `this.permissions.check('shellAccess')`。

### A.3 硬编码 adapter fallback 检查

```bash
# 不应新增硬编码 adapter fallback
grep -rn "|| 'shell'" adapters/ --include="*.ts"
grep -rn "?? 'shell'" adapters/ --include="*.ts"
grep -rn "adapterRegistry.get('shell')" adapters/ --include="*.ts"
```

预期：不命中（仅允许已有的已知用途）。

---

## B. Browser Terminal 手动测试

### B.1 Shell 启动

1. 启动项目（`npm run dev` 或项目对应启动命令）。
2. 打开浏览器，进入 Console 页面。
3. 确认 Terminal 面板可见。
4. 确认 shell 自动启动（提示符出现，如 `$` 或 `PS>`）。
5. 确认没有重复启动（ps 中只有一个 shell 进程）。

### B.2 基本命令

1. 在 Terminal 中输入 `echo hello` 并回车。
2. 确认输出显示 `hello`。
3. 输入 `pwd`，确认输出当前工作目录。
4. 输入 `cd .. && pwd`，确认工作目录变化正确。

### B.3 窗口 Resize

1. 调整浏览器窗口大小。
2. 确认 terminal 不崩溃，输出不异常。
3. 持续输入命令，确认 resize 后仍正常。

### B.4 重连

1. Terminal 正常运行时，刷新页面。
2. 确认重连后不会创建重复 shell 进程。
3. 确认基本输出能正常展示（提示符、日志等）。

### B.5 关闭/停止

1. 关闭 Terminal 面板或点击停止按钮。
2. 确认 shell 进程退出（OS 级别确认：`ps aux | grep shell` 或任务管理器）。
3. 确认没有僵尸进程残留。

### B.6 Escape / Interrupt

1. 正在执行命令时（如长时间运行的任务），按 Escape。
2. 确认有 interrupt 反馈，命令被终止。

---

## C. dashboard-server /api/shell/run 测试

### C.1 默认权限——命令执行成功

```bash
curl -s -X POST http://127.0.0.1:9843/api/shell/run \
  -H 'Content-Type: application/json' \
  -d '{"command":"echo hello"}'
```

预期：返回 `200`，包含 `instanceId` 和 `pid`。

确认输出：

```bash
# 用返回的 instanceId 替换 <id>
curl -s http://127.0.0.1:9843/api/shell/stream?id=<id>
```

预期：stream 中返回 `{"stream":"stdout","data":"hello\n"}`，最终有 `{"type":"exit","code":0}`。

### C.2 shellAccess=false——返回 403

```bash
# 设置 shellAccess 为 false
curl -s -X POST http://127.0.0.1:9843/api/permissions \
  -H 'Content-Type: application/json' \
  -d '{"category":"shellAccess","value":false}'

# 再次执行命令
curl -s -X POST http://127.0.0.1:9843/api/shell/run \
  -H 'Content-Type: application/json' \
  -d '{"command":"echo hello"}'
```

预期：返回 `403`，包含 `error` 字段描述权限拒绝。

确认没有进程被创建：

```bash
# 检查日志
curl -s http://127.0.0.1:9843/api/logs | grep -i shell
```

预期：日志中有权限拒绝记录，无 spawn 记录。

### C.3 恢复权限

```bash
curl -s -X POST http://127.0.0.1:9843/api/permissions \
  -H 'Content-Type: application/json' \
  -d '{"category":"shellAccess","value":true}'
```

预期：返回 `{"ok":true}`，后续 `/api/shell/run` 恢复正常。

---

## D. node-runtime spawnShell 测试

node-runtime 的 spawnShell 在上游 relay 注册成功后自动触发，不可直接通过 HTTP 调用。测试方式：

### D.1 shellAccess=true——spawn 正常

1. 配置 `config.permissions.shellAccess: true`（默认）。
2. 启动 agent，并连接到 relay。
3. 确认 agent 注册成功时 spawnShell 被调用。
4. 确认日志中出现 `[node] Shell spawned: ...`。
5. 确认 shell 进程在 OS 级别可见。

### D.2 shellAccess=false——spawn 被阻止

1. 配置 `config.permissions.shellAccess: false`。
2. 启动 agent，并连接到 relay。
3. 确认 agent 注册成功。
4. 确认日志中出现 `[node] Shell spawn blocked: Permission denied: shellAccess`。
5. 确认没有 shell 进程被创建（OS 级别确认）。
6. 确认 agent 其他功能不受影响（dashboard、relay 正常）。

### D.3 动态变更权限

1. agent 运行中，通过 dashboard API 设置 `shellAccess: false`。
2. 重新连接 relay（触发 spawnShell）。
3. 确认 spawn 被阻止，有日志记录。

---

## E. 回归测试

### E.1 Claude Code adapter

1. 确认 claude-code adapter 正常加载。
2. 确认 structured event 解析正常。

### E.2 Kitchen-sink extension

1. 确认 kitchen-sink extension 正常激活。
2. 确认其面板和命令可用。

### E.3 Session / History API

1. 确认 session 列表可加载。
2. 确认 history 可搜索。

### E.4 app/page.tsx Console

1. 确认主 Console 页面能加载。
2. 确认 sidebar panels 正常渲染。
3. 确认 terminal 面板在 Console 中正常打开。

### E.5 Build

```bash
npm run build
# 或
next build
```

预期：构建通过，无类型错误、无构建警告。

---

## F. 验收清单

| 编号 | 测试项 | 结果 | 备注 |
|---|---|---|---|
| A.1 | TypeScript 类型检查 | ⬜ | |
| A.2 | 权限检查点确认 | ⬜ | |
| A.3 | 无硬编码 fallback | ⬜ | |
| B.1 | Shell 启动 | ⬜ | |
| B.2 | 基本命令 | ⬜ | |
| B.3 | 窗口 Resize | ⬜ | |
| B.4 | 重连 | ⬜ | |
| B.5 | 关闭/停止 | ⬜ | |
| B.6 | Escape Interrupt | ⬜ | |
| C.1 | /api/shell/run 默认权限 | ⬜ | |
| C.2 | /api/shell/run shellAccess=false | ⬜ | |
| C.3 | 恢复权限 | ⬜ | |
| D.1 | spawnShell shellAccess=true | ⬜ | |
| D.2 | spawnShell shellAccess=false | ⬜ | |
| D.3 | 动态权限变更 | ⬜ | |
| E.1 | Claude Code adapter | ⬜ | |
| E.2 | Kitchen-sink extension | ⬜ | |
| E.3 | Session/History API | ⬜ | |
| E.4 | Console 页面 | ⬜ | |
| E.5 | Build 通过 | ⬜ | |
