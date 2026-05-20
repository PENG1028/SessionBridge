# CLI Argument Schema

> 位置参数、命名选项、flag 的 schema 定义与校验规则

---

## 位置参数 (args)

### 声明格式

```yaml
args:
  - name: dir                       # 参数名
    type: string                    # string | number | boolean | path
    description: "Working directory"
    optional: true                  # true = 可选，false = 必填
    position: 0                     # 位置索引（从 0 开始）
    default: "."                    # 默认值（仅 optional 时有效）
    validator:                      # 校验规则
      pattern: "^[a-zA-Z0-9_/.-]+$"
      minLength: 1
      maxLength: 1024
```

### 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 参数名，用于文档和错误提示 |
| `type` | string | 是 | 参数类型：`string` / `number` / `boolean` / `path` |
| `description` | string | 否 | 参数说明，用于 `--help` |
| `optional` | bool | 否 | 默认 `false`（必填） |
| `position` | int | 是 | 位置索引，从 0 开始，不能跳跃 |
| `default` | any | 否 | 默认值（仅 optional 时有效） |
| `validator` | object | 否 | 校验规则 |

### 校验规则 (validator)

| 字段 | 类型 | 适用 type | 说明 |
|------|------|-----------|------|
| `pattern` | string | string | 正则校验 |
| `minLength` | int | string | 最小长度 |
| `maxLength` | int | string | 最大长度 |
| `min` | int | number | 最小值 |
| `max` | int | number | 最大值 |
| `enum` | array | string/number | 枚举值 |

### 示例

```yaml
# 两个位置参数：dir（必填）+ limit（可选）
args:
  - name: dir
    type: path
    description: "Working directory"
    position: 0
    optional: false

  - name: limit
    type: number
    description: "Max results"
    position: 1
    optional: true
    default: 10
    validator:
      min: 1
      max: 1000
```

---

## 命名选项 (options)

### 声明格式

```yaml
options:
  - name: target                    # 选项名（长版本 --target）
    type: string                    # string | number | boolean
    description: "Target node ID"
    short: t                        # 短版本 -t（可选）
    required: false                 # true = 必填
    default: ""                     # 默认值
    validator:                      # 校验规则
      enum:
        - node_vps
        - node_local
```

### 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 长选项名（自动加 `--` 前缀） |
| `type` | string | 是 | 选项值类型：`string` / `number` / `boolean` |
| `description` | string | 否 | 说明，用于 `--help` |
| `short` | string | 否 | 短选项名（单字符，自动加 `-` 前缀） |
| `required` | bool | 否 | 默认 `false` |
| `default` | any | 否 | 默认值 |
| `validator` | object | 否 | 校验规则 |

### Boolean flag

```yaml
# flag 选项（不需要值）
options:
  - name: verbose
    type: boolean
    description: "Verbose output"
    short: v
    default: false

  - name: json
    type: boolean
    description: "JSON output"
    default: false
```

### 短选项冲突检测

短选项在所有插件命令中全局唯一：

```yaml
# 插件 A
options:
  - name: target
    short: t              # 占用 -t

# 插件 B（冲突）
options:
  - name: timeout
    short: t              # ← 冲突！SHORT_OPTION_CONFLICT
```

---

## 完整示例

```yaml
adapters:
  cli:
    commands:
      - name: query
        description: "Query session history"
        usage: "claude query [dir] [--limit N] [--format <format>] [--target <node>]"
        args:
          - name: dir
            type: path
            description: "Working directory"
            position: 0
            optional: true
            default: "."
        options:
          - name: limit
            type: number
            description: "Max results"
            short: n
            default: 10
          - name: format
            type: string
            description: "Output format"
            default: "table"
            validator:
              enum: [table, json, text]
          - name: target
            type: string
            description: "Target node"
            short: t
        capability: claude-code.query
```

### 用法

```bash
# 默认值
node plugin claude query

# 指定参数
node plugin claude query ./src --limit 50 --format json

# 远程
node plugin claude query --target node_vps
```
