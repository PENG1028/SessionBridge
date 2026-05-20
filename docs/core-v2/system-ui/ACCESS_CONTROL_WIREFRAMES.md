# SessionNode v2 — Access Control 线框图

> 独立的访问控制管理页面。覆盖 Users、Groups、Roles、Policy Bindings、Service Tokens、Plugin Grants、Audit of Permission Changes。

---

## Purpose

管理谁（用户/组/插件/服务）能做什么（角色/策略），审计权限变更。

---

## Entry

- Settings → Access Control（独立分类，不再是 Settings 的一个子段）
- 侧边栏导航「Access Control」（v2.1+，高权限用户可见）
- Dashboard 安全卡片（v2.1+）

---

## Desktop Wireframe — Access Control Shell

```
┌──────────────────────────────────────────────────────────────────┐
│  Access Control                                  [Audit Log] [>] │
│                                                                   │
│  ┌──────────────┬────────────────────────────────────────────┐  │
│  │  Users        │  ┌─ Content Area ───────────────────────┐ │  │
│  │  Groups       │  │                                       │ │  │
│  │  Roles        │  │  (selected category's content)        │ │  │
│  │  Policy       │  │                                       │ │  │
│  │  Bindings     │  │                                       │ │  │
│  │  Service      │  │                                       │ │  │
│  │  Tokens       │  │                                       │ │  │
│  │  Plugin       │  └───────────────────────────────────────┘ │  │
│  │  Grants       │                                            │  │
│  └──────────────┴────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Users

```
┌──────────────────────────────────────────────────────────────────┐
│  Users                                           [+ Add] [Refresh]│
│                                                                   │
│  [Search...           ] [All ▾]                                  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  user_abc  Alice    ● active   admin    last 2m          │    │
│  │  [Edit] [Disable] [Copy ID]                               │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  user_def  Bob      ● active   operator last 15m         │    │
│  │  [Edit] [Disable] [Copy ID]                               │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  user_ghi  Charlie  ○ inactive viewer  last 2d           │    │
│  │  [Edit] [Enable] [Copy ID]                                │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 3 users]                                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — User Detail Drawer

```
┌──────────────────────────────────────────────────────────────────┐
│                                                         [Close X]│
│  ┌────────────────────────────────────────────────────────┐      │
│  │ User Detail                                   [Drawer] │      │
│  │                                                        │      │
│  │  Username:   alice                                      │      │
│  │  User ID:    user_abc                                   │      │
│  │  Status:     ● active                                   │      │
│  │  Created:    2026-01-15                                 │      │
│  │  Last Seen:  2m ago                                     │      │
│  │                                                        │      │
│  │  ── Assigned Roles ──                                 │      │
│  │  [admin] [operator]                                     │      │
│  │  [+ Add Role]                                           │      │
│  │                                                        │      │
│  │  ── Groups ──                                         │      │
│  │  [group_admins] [group_devops]                         │      │
│  │                                                        │      │
│  │  ── Active Sessions ──                                │      │
│  │  browser_xxx  (this device)    now                     │      │
│  │  browser_yyy  (other)          10m ago                 │      │
│  │                                                        │      │
│  │  [Disable User] [Reset Token] [View Audit]             │      │
│  └────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Groups

```
┌──────────────────────────────────────────────────────────────────┐
│  Groups                                         [+ Add] [Refresh]│
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  group_admins    5 members   admin, operator             │    │
│  │  [View] [Edit]                                           │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  group_devops    12 members  operator, viewer            │    │
│  │  [View] [Edit]                                           │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  group_readonly  20 members  viewer                      │    │
│  │  [View] [Edit]                                           │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 3 groups]                                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Roles

```
┌──────────────────────────────────────────────────────────────────┐
│  Roles                                           [+ Add] [Refresh]│
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  admin         Full access to all resources              │    │
│  │  [View] [Edit] [Clone]                                   │    │
│  │  Policies: node.*, session.*, plugin.*, config.*, audit.*│    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  operator      Manage sessions and plugins               │    │
│  │  [View] [Edit] [Clone]                                   │    │
│  │  Policies: session.*, plugin.read, plugin.enable         │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  viewer        Read-only access                          │    │
│  │  [View] [Edit] [Clone]                                   │    │
│  │  Policies: node.read, session.read, plugin.read, logs.read│    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 3 roles]                                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Role Detail / Policy Editor

```
┌──────────────────────────────────────────────────────────────────┐
│  Edit Role: operator                             [Save] [Cancel]  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Role Name: [operator                      ]              │    │
│  │  Description: [Manage sessions and plugins         ]     │    │
│  │                                                          │    │
│  │  ── Policies ──                                         │    │
│  │                                                          │    │
│  │  ┌────────────────────────────────────────────────────┐ │    │
│  │  │  Resource          Effect    Constraints            │ │    │
│  │  │  node.*            Allow     —                      │ │    │
│  │  │  session.*         Allow     —                      │ │    │
│  │  │  plugin.read       Allow     —                      │ │    │
│  │  │  plugin.enable     Allow     —                      │ │    │
│  │  │  plugin.disable    Allow     —                      │ │    │
│  │  │  plugin.install    Deny      —                      │ │    │
│  │  │  config.*          Deny      —                      │ │    │
│  │  │  audit.*           Deny      —                      │ │    │
│  │  └────────────────────────────────────────────────────┘ │    │
│  │                                                          │    │
│  │  [+ Add Policy]                                          │    │
│  │                                                          │    │
│  │  ── Effective Members (12) ──                           │    │
│  │  alice (group_admins), bob (group_devops), ...          │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Policy Bindings

```
┌──────────────────────────────────────────────────────────────────┐
│  Policy Bindings                                [+ Add] [Refresh] │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Subject          Role       Scope             Status    │    │
│  │──────────────────────────────────────────────────────────│    │
│  │  user:alice       admin      cluster            ● active │    │
│  │  group:devops     operator   cluster            ● active │    │
│  │  group:readonly   viewer     cluster            ● active │    │
│  │  service:ci-bot   operator   node:node-main     ● active │    │
│  │  user:charlie     viewer     cluster            ○ inactive│    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  [Showing 5 bindings]                                     │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Service Tokens

```
┌──────────────────────────────────────────────────────────────────┐
│  Service Tokens                                [+ Generate] [>]  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Token Name        Role       Created     Last Used      │    │
│  │──────────────────────────────────────────────────────────│    │
│  │  ci-deploy-token   operator   2026-05-01  2026-05-19     │    │
│  │  [Revoke] [Copy]                                         │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  monitor-bot      viewer     2026-04-15  2026-05-18     │    │
│  │  [Revoke] [Copy]                                         │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  backup-script    operator   2026-03-01  2026-05-10     │    │
│  │  [Revoke] [Copy]                                         │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌── Generate Token ─────────────────────────────────────────┐   │
│  │  Name:        [deploy-token-2                      ]     │   │
│  │  Role:        [operator ▾]                               │   │
│  │  Expires:     [90 days ▾]                                │   │
│  │                                                          │   │
│  │  [Generate]                                               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌── New Token (copy now) ──────────────────────────────────┐   │
│  │  sn_t_abc123def456...                                     │   │
│  │  [Copy] [Close]                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Plugin Grants

```
┌──────────────────────────────────────────────────────────────────┐
│  Plugin Grants                                 [Refresh] [>]     │
│                                                                   │
│  [All Plugins ▾] [All Status ▾]                                 │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  claude-code     v1.0.0       12 grants    4 pending     │    │
│  │  [View Grants] [View Requests]                            │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  shell           v1.0.0       3 grants     0 pending     │    │
│  │  [View Grants] [View Requests]                            │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │  file-explorer   v0.5.0       2 grants     0 pending     │    │
│  │  [View Grants] [View Requests]                            │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌── Plugin: claude-code (expanded) ─────────────────────────┐   │
│  │  Permission          Level     Path Constraint   Status   │   │
│  │──────────────────────────────────────────────────────────│   │
│  │  process.spawn       Allow     —                 grant   │   │
│  │  process.stdin       Allow     —                 grant   │   │
│  │  fs.read             Allow     /repo/**          grant   │   │
│  │  fs.write            Ask       /repo/**          grant   │   │
│  │  network.connect     Ask       —                 grant   │   │
│  │  env.read            Allow     —                 grant   │   │
│  │  config.read         Allow     claude-code.*     grant   │   │
│  │  session.list        Allow     —                 grant   │   │
│  │  process.kill        Deny      —                 grant   │   │
│  │  fs.write            Pending   /etc/**           request │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Desktop Wireframe — Permission Audit Log

```
┌──────────────────────────────────────────────────────────────────┐
│  Permission Audit Log                         [Export] [Refresh] │
│                                                                   │
│  [Last 7 days ▾] [All Types ▾]                                  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Time            Type              Actor     Detail      │    │
│  │──────────────────────────────────────────────────────────│    │
│  │  10:32:15   role.bound           admin     alice →      │    │
│  │                                        operator role     │    │
│  │  10:28:03   plugin.grant         admin     claude-code:  │    │
│  │                                        fs.write Allow   │    │
│  │  10:25:44   token.generated      admin     ci-deploy-    │    │
│  │                                        token created    │    │
│  │  10:20:00   role.created         admin     operator role │    │
│  │  10:15:22   user.disabled        admin     user:charlie  │    │
│  │  10:10:00   plugin.permission    system    claude-code   │    │
│  │              .request                      requested     │    │
│  │                                        fs.write /etc/   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Showing 6 of 45 entries]    < 1 2 3 ... 8 >                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Mobile Wireframe

```
┌──────────────────────┐
│  Access Control      │
├──────────────────────┤
│                       │
│  > Users              │
│  > Groups             │
│  > Roles              │
│  > Policy Bindings    │
│  > Service Tokens     │
│  > Plugin Grants      │
│                       │
├──────────────────────┤
│ [Settings] [...] [AC] │
└──────────────────────┘

User list (mobile):

┌──────────────────────┐
│  Users        [+Add] │
├──────────────────────┤
│  [Search...]          │
│                       │
│  alice    ● admin     │
│  >                     │
│                       │
│  bob      ● operator  │
│  >                     │
│                       │
│  charlie  ○ viewer    │
│  >                     │
│                       │
├──────────────────────┤
│ [Back]                │
└──────────────────────┘

User detail (mobile):

┌──────────────────────┐
│  alice        [←]    │
├──────────────────────┤
│                       │
│  Status: ● active     │
│  ID: user_abc        │
│                       │
│  Roles:               │
│  [admin] [operator]  │
│                       │
│  Groups:              │
│  [group_admins]      │
│                       │
│  Last: 2m ago        │
│                       │
│  [Disable] [Audit]    │
└──────────────────────┘
```

---

## States

- **loading**: 列表 skeleton
- **empty**: "没有配置任何用户/角色/策略" + 引导
- **ready**: 正常显示
- **error**: "无法加载访问控制数据" + 重试
- **permission denied**: "需要 admin 权限"（此页面本身就需要高权限）
- **conflict**: 策略冲突检测，显示 "策略冲突" 警告
- **dirty**: 策略编辑中未保存，显示 unsaved badge

---

## Components

| 组件 | 用途 |
|------|------|
| AccessControlShell | 左导航 + 右内容区布局 |
| UserList | 用户列表 |
| UserDetailPanel | 用户详情抽屉（角色、组、session、操作） |
| GroupList | 组列表 |
| GroupDetailPanel | 组详情 |
| RoleList | 角色列表 |
| RoleDetailPanel | 角色详情 + 策略编辑器 |
| PolicyBindingList | 策略绑定列表 |
| PolicyBindingForm | 策略绑定表单（Subject + Role + Scope） |
| ServiceTokenList | Service Token 列表 |
| ServiceTokenGenerator | Token 生成表单 + 一次性展示 |
| PluginGrantList | 插件权限授予概览（按插件聚合） |
| PluginGrantExpanded | 单插件的权限明细 |
| PermissionAuditTable | 权限变更审计表 |
| PermissionAuditDetail | 审计变更详情 |

---

## Core API

| API | 用途 |
|-----|------|
| `auth.users.list` | 用户列表 |
| `auth.users.get` | 用户详情 |
| `auth.users.create` | 创建用户 |
| `auth.users.disable` | 禁用用户 |
| `auth.users.enable` | 启用用户 |
| `auth.groups.list` | 组列表 |
| `auth.groups.get` | 组详情 |
| `auth.groups.create` | 创建组 |
| `auth.roles.list` | 角色列表 |
| `auth.roles.get` | 角色详情 |
| `auth.roles.create` | 创建角色 |
| `auth.roles.update` | 更新角色策略 |
| `auth.policies.list` | 策略绑定列表 |
| `auth.policies.bind` | 绑定策略 |
| `auth.policies.unbind` | 解绑策略 |
| `auth.tokens.list` | Service Token 列表 |
| `auth.tokens.generate` | 生成 Token |
| `auth.tokens.revoke` | 撤销 Token |
| `auth.audit.list` | 权限变更审计 |
| `plugin.permissions.list` | 插件权限授予 |
| `plugin.permissions.grant` | 修改插件权限 |
| `plugin.permissions.revoke` | 撤销插件权限 |

---

## Plugin Contribution

- 插件不能贡献到 Access Control 管理页面
- 插件权限通过 `plugin.permissions.*` 管理，在 Plugin Detail 中展示
- Plugin Grants 页是 Access Control 对插件权限的聚合视图
- 插件不能绕过 `auth.*` 系统

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| 用户/组/角色定义 | Core | 持久化到 config.yaml |
| 策略绑定 | Core | 持久化，不可缓存 |
| Service Token | Core | 生成后仅展示一次明文 |
| 插件权限授予 | Core | 每个插件的独立权限记录 |
| 权限审计日志 | Core | append-only，不可删除 |
| 当前选中项 | UI | React state |
| 策略编辑表单 | UI | React state（dirty 标记） |
| 搜索/过滤 | UI | localStorage 偏好 |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| 权限不足 | 整个页面显示 "需要 admin 权限" |
| 用户不存在 | 编辑时显示 "用户已不存在" + 刷新列表 |
| 策略冲突 | 保存时显示 "策略冲突" + 冲突详情 |
| Token 生成后未复制 | 提示 "Token 仅显示一次，请立即复制" |
| 角色被引用无法删除 | 显示 "此角色仍有 N 个绑定，请先解绑" |
| 并发策略编辑 | 乐观锁：后提交的显示 "策略已被修改，请刷新" |
| 绑定循环 | 检测并提示 "不能将角色授予自身" |
| 审计日志不可篡改 | 只读列表，无编辑操作 |
