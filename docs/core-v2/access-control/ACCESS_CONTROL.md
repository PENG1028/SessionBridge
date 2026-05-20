# SessionNode v2 — 访问控制模型

## 核心关系图

```
┌──────────────────────────────────────────────────────────┐
│                    访问控制模型总览                        │
│                                                          │
│   User ─── has ───> Role(s) ─── has ───> Policy(ies)    │
│    │                    │                │               │
│    │ belongs            │                │               │
│    └──────> Group(s) ───┘                │               │
│         has Role(s)                      │               │
│                                          ▼               │
│                          Policy 定义允许的 capabilities    │
│                                                          │
│   Service Token ─── 直接声明 capabilities + constraints   │
│        (不经过 Role, 不继承 User 权限)                     │
│                                                          │
│   Plugin Grant ─── 正交于 User/Group/Role                 │
│        Plugin Grant ∩ Actor 权限 = 有效权限                │
│                                                          │
│   最终权限 = Actor 权限 ∩ Plugin Grant ∩ 目标节点策略       │
└──────────────────────────────────────────────────────────┘
```

---

## 一、User

### 定义

User 代表一个自然人操作者。在 SessionNode v2 中，User 是权限评估的起点。

### 属性

```yaml
User:
  id: "u_abc123"
  name: "zhang"
  authMethod: "password" | "publickey" | "oidc"
  roles: ["admin", "operator"]        # 直接绑定的角色
  groups: ["g_devops", "g_ops"]       # 所属组（继承组的角色）
  tokens: ["web_tok_xxx"]             # 登录令牌引用
  status: "active" | "disabled"
```

### 关键约束

- **单用户场景**：默认安装为单用户模式，仅有一个 admin user。多用户是可选的扩展层，不在 Core 基础路径中
- **认证来源**：Web UI 登录 → `web` actor；CLI 登录 → `cli` actor
- **User 不直接拥有权限**：权限通过 Role + Policy 间接赋予

---

## 二、Group

### 定义

Group 是 User 的集合，用于批量分配 Role。

### 属性

```yaml
Group:
  id: "g_devops"
  name: "DevOps"
  members: ["u_abc123", "u_def456"]
  roles: ["operator", "auditor"]
```

### 关键约束

- **Group 嵌套**：不支持嵌套 Group（保持扁平，避免继承环）
- **Group 不是安全边界**：Group 仅用于 Role 聚合，不提供隔离语义
- **空 Group**：允许存在空 Group（预留用途）

---

## 三、Role

### 定义

Role 是 Policy 的命名集合。一个 Role 包含一个或多个 Policy，一个 User/Group 可以绑定一个或多个 Role。

### 属性

```yaml
Role:
  id: "operator"
  name: "Operator"
  description: "日常运维操作角色"
  policies:
    - "session-manage"
    - "fs-read"
    - "fs-write"
    - "plugin-manage"
```

### 内置 Role

| Role | 适用场景 | 典型 Policy | 备注 |
|------|---------|-------------|------|
| `admin` | 初始配置、全局管理 | 全部 | 安装后应禁用或轮换 token |
| `operator` | 日常运维 | session.*, fs.*, plugin.status, log.read | 默认角色 |
| `auditor` | 只读审计 | log.read, session.list, plugin.list | 不可执行变更操作 |
| `observer` | 只读查看 | session.list, node.list | 最受限 |

### 关键约束

- **Role 不可直接包含 capability define**：Role 通过 Policy 间接定义权限，不直接声明 `capabilities`
- **Role 不跨节点**：Role 是本地概念，不自动同步到其他节点
- **无 Role 继承**：不支持 Role 继承另一个 Role（用 Policy 组合替代）

---

## 四、Policy

### 定义

Policy 是对一组 capabilities 的命名访问规则，包含允许/拒绝条件和约束。

### 属性

```yaml
Policy:
  id: "session-manage"
  name: "Session Management"
  rules:
    - effect: "allow"
      capabilities:
        - "session.create"
        - "session.list"
        - "session.get"
        - "session.stop"
    - effect: "deny"
      capabilities:
        - "session.stop"
      condition:
        targetNode: "node-production-*"  # 禁止操作生产节点上的 session
```

### 关键约束

- **Deny 优先**：如果 Policy 中有 `deny` 规则匹配，优先拒绝
- **条件约束**：Policy 可附加条件（targetNode、time range、rate limit）
- **Policy 不可跨节点引用**：Policy 存储在本节点，不自动分发

---

## 五、Service Token

### 定义

Service Token 是 External Client（CI/CD、脚本、k8s operator、Terraform Provider）的身份凭证。它**不绑定 User**，是一个独立的 Actor 类型。

### 属性

```yaml
ServiceToken:
  id: "st_ci_deploy"
  name: "CI Deploy Token"
  token: "svc_tok_xxx"           # 哈希存储，不可逆
  capabilities:
    - "session.create"
    - "fs.read"
    - "plugin.status"
  constraints:
    targetNode: "node-staging-*"
    rateLimit: 100/minute
    timeWindow: "09:00-18:00 UTC+8"
  createdBy: "u_admin"
  createdAt: "2026-05-19T00:00:00Z"
  expiresAt: "2026-12-31T23:59:59Z"
  status: "active"
```

### Service Token 与 User 的关系

| 维度 | User | Service Token |
|------|------|---------------|
| 代表 | 自然人 | 自动化程序/脚本 |
| 认证方式 | 密码/SSH/OIDC | 预共享 Token |
| Actor 类型 | `web` / `cli` | `service` |
| 权限来源 | Role → Policy | 直接声明 capabilities |
| 继承 | 可从 Group 继承 Role | 不继承任何权限 |
| 默认管理员 | 初始 admin user 有 | **没有默认权限** |
| 高危能力 | 受 Plan Before Apply 约束 | 受 Plan Before Apply 约束 |
| 约束条件 | 不支持 | 支持（targetNode、rateLimit、timeWindow） |

### 关键约束

- **Service Token 没有默认管理员权限**：必须显式声明每个允许的 capability
- **Service Token 不绑定 User**：审计日志中记录 `actor.type=service`，不关联具体自然人
- **Token 哈希存储**：创建时返回一次原文，之后不可读，只能轮换
- **必须设置过期时间**：不允许永久有效的 Service Token

---

## 六、Plugin Grant

### 定义

Plugin Grant 是 Core 授予特定插件的能力许可，与 User/Group/Role 正交。

### 属性

```yaml
PluginGrant:
  pluginId: "claude-code"
  capability: "session.create"
  mode: "allow" | "deny" | "ask"    # ask = 每次请求需要用户确认
  constraints:
    targetNode: "node-*"
    maxSessions: 5
  grantedAt: "2026-05-19T00:00:00Z"
  grantedBy: "u_admin"
  expiresAt: null                    # null = 不自动过期
```

### Plugin Grant 与 RBAC 的关系

```
                 Actor 层面                          Plugin 层面
        ┌──────────────────────┐          ┌──────────────────────┐
        │  User → Role → Policy │          │  Plugin → Grant      │
        │  (RBAC)              │          │  (Capability 授权)    │
        │                      │          │                      │
        │  Service Token       │          │  Manifest 声明        │
        │  (直接声明)           │          │  (插件需要哪些权限)    │
        └────────┬─────────────┘          └──────────┬───────────┘
                 │                                    │
                 └──────────────┬─────────────────────┘
                                ▼
                   ┌────────────────────────┐
                   │  有效权限 = 两者交集     │
                   │                        │
                   │  Actor 有 session.create│
                   │  && Plugin 有 grant     │
                   │  → 允许                 │
                   │                        │
                   │  Actor 无 session.create│
                   │  → 拒绝 (不管 grant)    │
                   │                        │
                   │  Plugin 无 grant        │
                   │  → 拒绝 (不管 Actor)    │
                   └────────────────────────┘
```

### 关键约束

- **Plugin Grant 不叠加到 User 权限**：User 禁止的 capability，即使 Plugin 有 grant 仍不可执行
- **Plugin Grant 不绕过 Policy**：Policy deny 优先于 grant allow
- **Plugin Grant 需要 Actor 授权**：grant 操作本身需要 `admin` 或 `operator` role

---

## 七、Policy Binding

### 定义

Policy Binding 是将 Policy 关联到 Role 的机制。Core 不直接对 User 或 Group eval policy，而是通过 Role 间接 eval。

### 绑定链

```
User/Group → Role → Policy → rules (capabilities + effect + condition)
```

### Binding 示例

```yaml
bindings:
  - user: "u_abc123"
    roles: ["operator", "auditor"]        # User 直接绑定 Role
  - group: "g_devops"
    roles: ["operator"]                    # Group 绑定 Role
  - role: "operator"
    policies: ["session-manage", "fs-rw"]  # Role 绑定 Policy
  - role: "auditor"
    policies: ["log-read", "session-list"]
```

### 关键约束

- **Binding 是本地配置**：不跨节点同步（每个节点独立 eval）
- **Binding 变更立即生效**：不需要重启 Core
- **Deny Binding 不可被覆盖**：如果一个 Policy 规则为 `deny`，任何其他 allow 规则都不能绕过

---

## 八、访问控制决策流程

### 完整决策链

```
请求 (Actor, PluginID?, Capability, TargetNode)
  │
  ├─ [1] 认证 ─── Actor 身份是否有效？
  │    ├─ 无效 → 401 Unauthenticated
  │    └─ 有效 → 继续
  │
  ├─ [2] Actor 权限 ─── Actor 是否有权执行此 capability？
  │    ├─ User/Web/CLI ── 查 User → Role → Policy
  │    ├─ Service Token ── 查 token 声明的 capabilities
  │    ├─ Plugin Actor ─── 查插件自身 capabilities（不是 grant）
  │    ├─ Node ─────────── 按节点间信任模型
  │    │
  │    ├─ 无权限 → 403 ActorForbidden
  │    └─ 有权限 → 继续
  │
  ├─ [3] Plugin Grant ─── 如果请求来自插件，有 grant 吗？
  │    ├─ 不是插件请求 → 跳过
  │    ├─ grant mode=deny → 403 PluginDenied
  │    ├─ grant mode=ask → 触发审批流程
  │    ├─ 无 grant → 403 PluginNotGranted
  │    └─ grant mode=allow → 继续
  │
  ├─ [4] 目标节点策略 ─── 目标节点本地是否允许？
  │    ├─ trustLevel=full → 信任来源节点决策
  │    ├─ trustLevel=capability → 只信任能力校验，重检 constraints
  │    ├─ trustLevel=routing-only → 仅转发，完全重检
  │    │
  │    ├─ 拒绝 → 403 NodePolicyDenied
  │    └─ 允许 → 继续
  │
  └─ [5] 高危操作检查 ─── 是否属于 Plan Before Apply 范围？
       ├─ 是 → 生成 Plan → 等待用户确认 → 执行
       └─ 否 → 直接执行
```

### 决策结果速查

| 阶段 | 失败代码 | 含义 | 日志级别 |
|------|---------|------|---------|
| 认证 | 401 | token 无效/过期 | warn |
| Actor 权限 | 403 ActorForbidden | Actor 无此 capability | warn |
| Plugin Grant | 403 PluginDenied | grant 明确拒绝 | info |
| Plugin Grant | 403 PluginNotGranted | 未授权此插件 | info |
| 目标节点策略 | 403 NodePolicyDenied | 目标节点拒绝 | warn |
| 高危操作 | — | 生成 plan，等待审批 | info |

---

## 九、配置示例

### 单用户模式（默认安装）

```yaml
# ~/.sessionnode/config.yaml
core:
  auth:
    enabled: true
    adminToken: "ntf8_2kD..."        # 首次安装生成，建议安装后禁用
    # 单用户模式：所有 web/cli 登录自动获得 admin role
    defaultRole: "operator"
    session:
      timeout: 3600                  # 会话超时（秒）
    webTokens:
      - "web_tok_abc"
```

### 多用户模式（扩展）

```yaml
core:
  auth:
    enabled: true
    adminToken: ""                   # 安装后已禁用
    defaultRole: "observer"
    oidc:
      provider: "https://oidc.example.com"
      clientId: "sessionnode"
      allowedDomains: ["example.com"]
    users:
      - id: "u_zhang"
        name: "zhang"
        roles: ["admin"]
      - id: "u_li"
        name: "li"
        roles: ["operator"]
    serviceTokens:
      - name: "ci-deploy"
        token: "svc_tok_xxx"
        capabilities: ["session.create", "fs.read", "plugin.status"]
        constraints:
          targetNode: "node-staging-*"
```

---

## 十、审计与日志

所有访问控制决策必须记录审计事件：

| 事件 | 触发条件 | 记录内容 |
|------|---------|---------|
| `access.granted` | 权限检查通过 | actor, capability, targetNode, pluginId?, 决策路径 |
| `access.denied` | 权限检查被拒 | actor, capability, targetNode, 拒绝阶段, 原因 |
| `token.created` | Service Token 创建 | token name, capabilities, constraints, 创建者 |
| `token.revoked` | Service Token 吊销 | token name, 吊销者 |
| `role.changed` | User/Group 的 Role 变更 | 变更对象, 旧角色列表, 新角色列表, 操作者 |
| `policy.updated` | Policy 新增/修改/删除 | policy id, 变更类型, 操作者 |

详见 [LOGS_AND_AUDIT.md](../core-kernel/LOGS_AND_AUDIT.md) 的 Service Token 审计章节。

---

## 十一、防回退规则

1. **Service Token 不可拥有默认管理员权限**：每个 token 必须显式声明 capabilities
2. **Policy Deny 不可被覆盖**：deny 规则在任何 allow 之上优先
3. **Plugin Grant 不可叠加 Actor 权限**：Actor 没有的权限，grant 不能赋予
4. **User 不直接拥有权限**：必须通过 Role → Policy 间接赋予
5. **Role 不跨节点自动同步**：每个节点独立 eval 本地配置
6. **Binding 变更立即生效**：无缓存窗口，不可延迟
7. **Token 必须设置过期时间**：不允许永久有效的 Service Token
8. **高危操作必须 Plan Before Apply**：不因 Actor 是 admin 而跳过
