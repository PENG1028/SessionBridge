# CLI Adapter Contract

> CLI 在 manifest 中的声明格式、命令注册、冲突检测
> 概览参见 [PLUGIN_ADAPTERS.md](../plugin-platform/PLUGIN_ADAPTERS.md#cli-adapter)

---

## 声明格式

```yaml
adapters:
  cli:
    commands:
      - name: start                              # 命令名，插件内唯一
        description: "Start Claude Code session"  # 帮助文本
        usage: "claude start [dir] [--target <node>]"
        args:                                     # 位置参数
          - name: dir
            type: string
            description: "Working directory"
            optional: true
            position: 0
        options:                                  # 命名选项
          - name: target
            type: string
            description: "Target node ID"
            short: t
        capability: claude-code.start             # 对应的 Core capability
        output:                                   # 输出格式
          format: stream                          # stream | json | table | text
        examples:
          - "claude start ./project"
          - "claude start --target vps"
```

## 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 命令名，插件内唯一，见冲突检测 |
| `description` | string | 否 | 命令说明，用于 `--help` |
| `usage` | string | 否 | 用法示例 |
| `args` | array | 否 | 位置参数，见 [ARGUMENT_SCHEMA.md](./ARGUMENT_SCHEMA.md) |
| `options` | array | 否 | 命名选项，见 [ARGUMENT_SCHEMA.md](./ARGUMENT_SCHEMA.md) |
| `capability` | string | 是 | 对应的 Core capability（`命名空间.动词`） |
| `output` | object | 否 | 输出格式配置，见 [OUTPUT_FORMATS.md](./OUTPUT_FORMATS.md) |
| `examples` | array | 否 | 使用示例 |

---

## 命令注册

### 注册流程

```
1. 插件注册 → Core 扫描 manifest → 提取 adapters.cli.commands
2. CLI Host 收集所有已注册插件的命令
3. 按 name 建立全局命令索引（flat，不嵌套）
4. 冲突检测 → 有冲突则拒绝注册
5. 注册成功 → 命令可用
```

### 全局命令索引

所有插件的 CLI 命令共享一个全局 flat 命名空间：

```
全局命令索引:
  claude start       → pluginId: claude-code, capability: claude-code.start
  claude history     → pluginId: claude-code, capability: claude-code.history
  shell exec         → pluginId: shell,       capability: shell.process
  shell sessions     → pluginId: shell,       capability: shell.session
```

### CLI 执行入口

```
用户输入: node plugin <name> [args...]

例如:
  node plugin claude start ./project
  node plugin shell exec "ls -la"
```

---

## 冲突检测

### 冲突规则

| 场景 | 结果 | 说明 |
|------|------|------|
| 同一插件内命令名重复 | 拒绝注册 | `DUPLICATE_COMMAND` |
| 不同插件命令名重复 | 拒绝注册 | `COMMAND_CONFLICT`，返回冲突的插件 ID |
| 命令名与保留名冲突 | 拒绝注册 | `RESERVED_COMMAND` |

### 保留命令名

以下名称被 CLI Host 保留，插件不可使用：

```
help, version, exit, quit, clear
plugin, node, session, config, log
```

### 冲突示例

```yaml
# 插件 A
adapters:
  cli:
    commands:
      - name: start
        capability: plugin-a.start

# 插件 B（冲突）
adapters:
  cli:
    commands:
      - name: start          # ← 冲突！COMMAND_CONFLICT
        capability: plugin-b.start
```

### 命名建议

为避免冲突，建议命令名使用有区分度的名称：

```yaml
# 好的命名
name: claude start        # 以插件主题前缀
name: shell exec          # 以插件主题前缀
name: node-monitor check  # 以插件主题前缀

# 避免的命名（容易冲突）
name: start               # 太通用
name: run                 # 太通用
name: check               # 太通用
```

---

## Capability 映射约束

### 必填约束

- `capability` 字段为必填：每个 CLI 命令必须声明对应的 Core capability
- 声明的 capability 必须在 `core.permissions` 中存在

### 正确示例

```yaml
core:
  permissions:
    - id: my-plugin.start
      capabilities:
        - session.create

adapters:
  cli:
    commands:
      - name: start
        capability: session.create        # ✓ 在 permissions 中声明
```

### 错误示例

```yaml
core:
  permissions:
    - id: my-plugin.read
      capabilities:
        - fs.read

adapters:
  cli:
    commands:
      - name: delete
        capability: fs.delete             # ✗ 未在 permissions 中声明
```

---

## CLI Host 实现要求

CLI Host 在收到用户输入后：

```
1. 解析命令名 → 查找全局命令索引
2. 解析参数/选项 → 按 ARGUMENT_SCHEMA.md 校验
3. 构造 action.request:
     capability: 命令声明中的 capability
     pluginId: 命令所属插件的 pluginId
     payload: 命令参数解析结果
4. 确定 actor 身份（见 COMMAND_ROUTING.md）
5. 发送到 Core Dispatcher
6. 接收结果 → 按 OUTPUT_FORMATS.md 格式化输出
```

CLI Host 不：
- 绕过 Core 权限校验
- 缓存插件状态
- 修改 actor 身份
