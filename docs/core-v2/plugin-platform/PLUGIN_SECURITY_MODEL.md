# SessionNode v2 — 插件安全模型

> 权限声明、Grant、PluginId 防伪造、危险能力审批、审计日志

---

## 权限模型：三层交集

### 公式

```
有效权限 = Actor 权限 ∩ Plugin Grant ∩ 目标节点策略
```

- **Actor 权限** — 该 Actor 类型被允许的能力范围（Core 认证时确定）
- **Plugin Grant** — 用户授予该插件的 Grant（存 config.yaml）
- **目标节点策略** — 目标节点上的本地策略（trustLevel + 本地 Grant）

### 示例

```
场景: claude-code 尝试 fs.read /home/user/project/main.go

Actor 权限:
  - plugin 类型允许调用 Manifest 声明的能力

Plugin Grant:
  - fs.read: allow, path: ["${workspace}/**"]

目标节点策略:
  - node_vps 信任列表包含发起节点

结果:
  ✓ 三层交集非空 → 允许
```

```
场景: 外部程序（无 pluginId）尝试 plugin.install

Actor 权限:
  - external-app 类型没有 plugin.install 权限

结果:
  ✗ Actor 权限中不含 plugin.install → PERMISSION_DENIED
```

### 无默认管理员权限

| 规则 | 说明 |
|------|------|
| Service Token 必须显式声明权限 | 每个 token 有明确能力范围 |
| Plugin 必须经过用户 Grant | Manifest 声明不等于自动授权 |
| External App 必须预先注册授权范围 | 按 app 注册时的授权范围 |
| system-ui 是唯一自动授予管理权限的 Actor | 内置控制面，不可禁用 |

---

## PluginId 防伪造

### 认证流程

```
Core 在认证阶段验证 Actor 类型的合法性:

  - system-ui: 仅 Core 内部可声明，外部请求无法伪造
  - cli-user: 仅本地 IPC 通道可声明，远程请求无法伪造
  - plugin: PluginId 必须来自已注册插件，Core 验证 token 关联
  - service: 按 token 表中的类型映射，不可自定义
  - node-peer: 仅已认证的 relay/leaf 连接可声明
  - external-app: 必须预先注册 appId + token
```

### 禁止规则

| # | 规则 |
|---|------|
| 1 | 任何外部请求直接指定 actor.type |
| 2 | 插件 A 以插件 B 的 pluginId 调用 Core API |
| 3 | 未注册的 pluginId 被 Dispatcher 拒绝前先通过 |
| 4 | UI/CLI adapter 绕过 Core 权限校验 |
| 5 | 插件组件通过 CoreClient 调用时伪造 pluginId |

### PluginId 注入链

```
Manifest 注册 → Core Registry 记录 pluginId
WebSocket 连接认证 → Core 确定 actor.pluginId
CoreClient 实例化 → Plugin Host 注入 pluginId
action.request → Core 用连接认证的 pluginId，不是 payload 中的
```

---

## 权限声明与 Grant

### Manifest 权限声明

插件在 `core.permissions` 中声明需要哪些权限：

```yaml
core:
  permissions:
    - id: workspace.readwrite
      label: "读写工作目录文件"
      capabilities:
        - fs.read
        - fs.write
      constraints:
        path:
          allow: ["${workspace}/**"]
          deny: ["**/.env"]
```

### Grant 类型

| Grant 级别 | 含义 | 使用方式 |
|-----------|------|---------|
| `allow` | 允许，不询问 | 常用、安全的能力 |
| `deny` | 拒绝 | 用户不同意授权 |
| `ask` | 每次询问 | 敏感能力，每次调用前请求确认 |

### Grant 存储

```yaml
# ~/.sessionnode/config.yaml
plugins:
  grants:
    claude-code:
      fs.read:
        mode: allow
        constraints:
          path:
            allow: ["${workspace}/**"]
      process.spawn:
        mode: ask
```

### Grant 生命周期

```
1. 插件安装后 → 检查是否需要 Grant
2. 需要 Grant → 向用户展示权限申请
3. 用户选择 allow/deny/ask → Grant 写入 config.yaml
4. 运行时权限校验 → 读取 Grant
5. 用户可随时撤销 Grant
```

---

## 危险能力与审批

### 危险能力清单

以下能力需要 Plan Before Apply + 用户确认 + Audit：

| 能力 | 风险等级 | 原因 |
|------|---------|------|
| `plugin.install` | high | 执行安装命令，修改系统 |
| `plugin.repair` | high | 执行命令 |
| `plugin.uninstall` | high | 删除文件 |
| `plugin.cache.clear` | high | 删除文件（高危模式） |
| `plugin.permissions.grant` | high | 权限提升 |
| `session.stop`（远程） | medium | 中断远程 session |
| `node.disconnect` | high | 断开节点 |
| `config.write`（敏感 key） | medium | 修改安全配置 |
| `process.spawn`（敏感命令） | medium | 执行子进程 |
| `fs.delete`（敏感路径） | medium | 删除文件 |

### 审批流程

```
1. 插件发起高危能力调用
2. Core 检测到需要审批
3. Core 生成 Plan（包含操作描述、风险等级、预计影响）
4. Plan 发送到通知中心
5. 用户审阅 Plan → 批准/拒绝
6. 批准 → Core 执行，记录 audit
7. 拒绝 → Core 返回拒绝，记录 audit
```

### 审批超时

- 审批请求有过期时间（默认 5 分钟）
- 超时后自动拒绝
- 插件需重新发起请求

---

## 审计日志

### 记录范围

| 事件类型 | 始终记录 | 条件记录 |
|---------|---------|---------|
| 能力调用 | ✓ | |
| 权限 Grant/Revoke | ✓ | |
| 插件安装/卸载 | ✓ | |
| 配置修改 | ✓ | |
| 缓存清理 | ✓ | |
| 文件访问 | | ✓（通过 fs API 的路径级记录） |
| 通知发送 | | ✓（可选，按配置） |

### 审计日志格式

```json
{
  "auditId": "audit_20260519_001",
  "timestamp": 1712345678000,
  "actor": {
    "type": "plugin",
    "pluginId": "claude-code"
  },
  "action": "plugin.install.execute",
  "target": {
    "pluginId": "claude-code",
    "nodeId": "node_local"
  },
  "result": "success",
  "detail": {
    "planId": "plan_001",
    "steps": 4
  }
}
```

---

## 与外部 Client 的安全边界

External Client 直接调用 Core API 但不走插件生命周期：

| 安全规则 | 说明 |
|---------|------|
| 没有 pluginId | Core 用 Service Token label 记录 |
| 不能调 Plugin Management API | 只有 system-ui / cli-user 可调 |
| 不能获得插件资源归属 | 文件、缓存、历史不被 Core 跟踪 |
| 不能声明 adapter | 没有 manifest |
| 每次调用写 audit | 按 Service Token 记录 |

---

## 防回退规则

| # | 规则 | 后果 |
|---|------|------|
| 1 | Manifest 声明能力 ≠ 自动获得授权 | Grant 由用户单独授予 |
| 2 | PluginId 必须来自已注册插件 | 外部请求不可伪造 |
| 3 | Actor 类型由 Core 认证后填充 | 客户端不可指定 |
| 4 | 高危操作必须有 Plan Before Apply | 无 Plan 直接执行被拒绝 |
| 5 | External Client 不能使用 pluginId | 用 Service Token 认证 |
| 6 | Service Token 没有默认管理员权限 | 每个 token 必须显式声明 |
| 7 | UI/CLI adapter 不绕过 Core 权限 | 所有路径走 Dispatcher |
| 8 | 目标节点独立校验权限 | relay 不代行 |
