# CLI Approval and Audit

> 危险能力在 CLI 中的审批流程、audit 记录

---

## 危险能力清单

CLI 调用以下能力时触发审批流程。完整清单参见 [PLUGIN_SECURITY_MODEL.md](../plugin-platform/PLUGIN_SECURITY_MODEL.md#危险能力清单)。

CLI 特有场景：

| Capability | CLI 触发场景 |
|-----------|-------------|
| `process.spawn` | `shell exec <command>` |
| `fs.write` | `plugin config set <key> <value>` |
| `fs.delete` | `plugin cache clear <id>` |
| `plugin.install.execute` | `plugin install <pluginId>` |
| `plugin.cache.clear.execute` | `plugin cache clear <id> --execute` |
| `plugin.permissions.grant` | `plugin grant <pluginId> <capability>` |

---

## 审批流程

### 交互式审批（TTY）

CLI 在 TTY 模式下可以直接展示审批请求并等待用户响应：

```
$ node plugin claude start ./project

? Claude Code 需要执行以下操作：
  Capability: process.spawn
  命令: claude start ./project
  风险: medium
  目标节点: local

  允许？(Y/n) > y

✓ 已批准
```

### 非交互式审批（--approve）

非 TTY 环境（CI、脚本）使用 `--approve` 标志预先授权：

```bash
# CI 中使用（已知安全的操作）
node plugin claude start ./project --approve

# 跳过所有审批，直接执行
# 需要调用方有足够的权限（Service Token 或管理员）
```

**`--approve` 的安全约束**：

| 条件 | 结果 |
|------|------|
| actor 有该能力的管理权限 | 批准通过，记录 audit |
| actor 无管理权限 | 拒绝，提示使用交互模式 |
| 操作风险 high 且无 TTY | 强制拒绝（即使有 `--approve`） |

### 超时拒绝

审批请求有过期时间（默认 5 分钟）。超时后自动拒绝：

```
$ node plugin claude install some-plugin

? 安装计划需要你确认：
  ...（等待 5 分钟）

✗ 审批超时：请求已过期，请重新执行命令
```

---

## Plan Before Apply

CLI 中所有危险操作遵循 Plan Before Apply 流程：

```
1. 用户发起命令
2. CLI Host 检测到 capability 属于危险清单
3. CLI Host 生成 Plan 并展示给用户：
     {
       capability: "plugin.install.execute",
       steps: ["npm install -g @anthropic-ai/claude-code"],
       risk: "high",
       targetNode: "local"
     }
4. 用户确认（交互式 Y/n 或 --approve）
5. CLI Host 发送 action.request
6. Core 执行，返回结果
7. CLI Host 展示结果
```

---

## 审批状态

| 状态 | 含义 | CLI 行为 |
|------|------|---------|
| pending | 等待用户确认 | 展示 plan，等待输入 |
| approved | 用户批准 | 执行命令 |
| denied | 用户拒绝 | exit code 6，stderr 输出拒绝原因 |
| timeout | 超时未响应 | exit code 6，stderr 输出超时提示 |
| cancelled | 用户 Ctrl+C | exit code 130 |

---

## 非交互式模式的 Plan 预览

非 TTY 环境可以使用 `--dry-run` 预览 Plan 而不执行：

```bash
# 预览安装计划
node plugin install claude-code --dry-run

# 输出（stdout）
Install Plan for claude-code:
  Install ID: inst_20260520_001
  Risk: medium
  Steps:
    1. npm install -g @anthropic-ai/claude-code (requiresApproval: true)
    2. claude --version (verify)

  Use --approve to execute

# exit code 0
```

`--dry-run` 不触发审批，不写 audit log。

---

## Audit 记录

### CLI 调用的 Audit 记录

所有通过 CLI 发起的危险能力调用写入 audit log：

```json
{
  "auditId": "audit_20260520_001",
  "timestamp": 1712345678000,
  "actor": {
    "type": "plugin",
    "pluginId": "claude-code"
  },
  "action": "plugin.install.execute",
  "target": {
    "nodeId": "node_local"
  },
  "result": "success",
  "detail": {
    "cli": true,
    "command": "node plugin install claude-code",
    "approval": "interactive",
    "planId": "plan_001"
  }
}
```

### CLI 特有 audit 字段

| 字段 | 说明 |
|------|------|
| `detail.cli` | `true` 表示来自 CLI 调用 |
| `detail.command` | 完整的 CLI 命令字符串 |
| `detail.approval` | 审批方式：`interactive` / `approve-flag` / `not-required` |
| `detail.planId` | Plan Before Apply 的 plan ID（如有） |
