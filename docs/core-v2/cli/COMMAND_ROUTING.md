# CLI Command Routing

> CLI 命令如何路由到 Core capability、actor 身份、target node 处理

---

## 路由流程

```
用户输入
    │
    ▼
CLI Host 解析
    │  ├── 命令名 → 查找全局命令索引 → 确定 pluginId + capability
    │  ├── 参数 → 按 ARGUMENT_SCHEMA 校验
    │  └── 选项 → 按 ARGUMENT_SCHEMA 校验
    │
    ▼
构造 action.request
    │  └── targetNodeId 决定路由目标
    │
    ▼
Core Dispatcher
    │  ├── 校验 actor 身份
    │  ├── 校验权限（三层交集）
    │  ├── targetNodeId 为空 → 本机执行
    │  └── targetNodeId 有值 → 路由到目标节点
    │
    ▼
结果返回 → CLI Host 格式化输出
```

---

## Actor 身份

CLI 调用 Core API 时的 actor 身份由 CLI Host 在连接时确定：

| 场景 | Actor 类型 | pluginId | 认证方式 |
|------|-----------|----------|---------|
| 本地 IPC 调用 | `cli-user` | `""`（无） | 本地 socket 信任 |
| Service Token 调用 | `service` | `""`（无） | Token 认证 |
| 插件 CLI 命令 | `plugin` | 命令所属 pluginId | Core 认证时注入 |

### pluginId 注入

```
CLI Host 不决定 pluginId。
pluginId 由 Core 在连接认证时确定：
  - 本地 IPC → cli-user（不指定 pluginId）
  - Service Token → service（token 中声明 scope）
  - 插件 CLI → plugin（对应插件注册时的 pluginId）
```

### action.request 示例

```json
{
  "type": "action.request",
  "requestId": "req_cli_001",
  "pluginId": "claude-code",
  "capability": "claude-code.start",
  "targetNodeId": "",
  "payload": {
    "dir": "./project"
  },
  "timestamp": 1712345678000,
  "actor": {
    "type": "plugin",
    "pluginId": "claude-code"
  }
}
```

---

## Target Node 处理

### 目标节点选项

CLI 命令通过 `--target <nodeId>` 或 `--local` 控制目标节点：

```bash
# 本机执行（默认）
node plugin claude start ./project

# 指定远程节点
node plugin claude start ./project --target node_vps

# 显式本机（等价于省略 --target）
node plugin claude start ./project --local
```

### 路由规则

```yaml
CLI 输入:
  node plugin <name> [args...] [--target <nodeId>] [--local]

路由逻辑:
  1.  --target node_vps 存在 → targetNodeId = "node_vps"
  2.  --local 或两者都没有 → targetNodeId = ""（本机）
  3.  --target 和 --local 同时出现 → 报错（互斥）
```

### 路由流程

```
--target node_vps → targetNodeId: "node_vps"
    │
    ▼
本地 Dispatcher
    │
    ├── 1. 校验 actor 有跨节点调用权限
    ├── 2. 转发请求到 node_vps
    ├── 3. node_vps 独立校验权限（不信任发起方）
    └── 4. 结果返回本地 CLI
```

### 权限校验

远程执行时，权限在目标节点独立校验。详见 [PLUGIN_SECURITY_MODEL.md](../plugin-platform/PLUGIN_SECURITY_MODEL.md#权限模型三层交集)。

---

## Service Token 调用

CLI 也支持直接用 Service Token 调用，绕过插件绑定：

```bash
# 以 Service Token 身份调用（无 pluginId）
node --token <token> api call capability "session.list" '{}'

# 以 Service Token 身份调用插件命令
node --token <token> plugin claude start ./project
```

Service Token 调用时：

| 字段 | 值 |
|------|-----|
| actor.type | `service` |
| pluginId | `""`（空，不注入） |
| 权限范围 | Token 声明时指定的 scope |
| audit 记录 | 按 Service Token label 记录 |

Service Token 没有 pluginId，不能调用需要 pluginId 的插件管理 API。
