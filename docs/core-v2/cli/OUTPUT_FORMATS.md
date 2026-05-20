# CLI Output Formats

> stdout/stderr/json/table/stream 输出规范、exit code

---

## 输出模型

```
CLI 输出分层:
  stdout: 业务输出（命令结果）
  stderr: 诊断输出（日志、警告、错误）
  exit code: 执行结果（0 = 成功，非 0 = 错误）
```

---

## 输出格式

CLI 支持四种格式，通过 `--format` 或命令声明的 `output.format` 控制。

### 1. text（默认）

人类可读的文本输出。适用于短结果。

```bash
# 命令
node plugin claude history --limit 3

# 输出（stdout）
Session     Status    Started              Duration
sess_001    success   2026-05-19 10:00     2m30s
sess_002    failed    2026-05-19 11:00     0m45s
sess_003    running   2026-05-19 11:30     15m20s
```

### 2. json

JSON 输出。适用于程序化调用。

```bash
# 命令
node plugin claude history --limit 1 --format json

# 输出（stdout）
[
  {
    "sessionId": "sess_001",
    "status": "success",
    "startedAt": "2026-05-19T10:00:00Z",
    "duration": "2m30s"
  }
]
```

### 3. table

表格输出。适用于结构化数据的展示。

```bash
# 命令
node plugin claude list --format table

# 输出（stdout）
┌────────────┬──────────┬──────────────────────┬──────────┐
│ Session ID │ Status   │ Started              │ Duration │
├────────────┼──────────┼──────────────────────┼──────────┤
│ sess_001   │ success  │ 2026-05-19 10:00     │ 2m30s    │
│ sess_002   │ failed   │ 2026-05-19 11:00     │ 0m45s    │
└────────────┴──────────┴──────────────────────┴──────────┘
```

### 4. stream

流式输出。适用于实时 stdout/stderr。

```bash
# 命令
node plugin claude start ./project

# 输出（stdout，实时流）
[10:00:01] Starting Claude Code...
[10:00:02] Loading workspace context...
[10:00:05] Ready. Type "/help" for commands.
>
```

---

## 输出声明

命令在 manifest 中声明默认输出格式：

```yaml
adapters:
  cli:
    commands:
      - name: list
        output:
          format: table            # 默认格式
          allowedFormats:          # 用户可用 --format 切换
            - table
            - json
          headers:
            - "Session ID"
            - "Status"
            - "Started"
            - "Duration"
```

`output` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `format` | string | 否 | 默认输出格式：`text` / `json` / `table` / `stream` |
| `allowedFormats` | array | 否 | 用户可切换的格式列表 |
| `headers` | array | 否 | table 格式的表头 |

未声明时默认 `format: text`。

---

## Exit Code

### 标准 exit code

| Code | 含义 | 说明 |
|------|------|------|
| `0` | 成功 | 命令正常完成 |
| `1` | 通用错误 | 执行失败，未知原因 |
| `2` | 参数错误 | 参数解析失败、参数校验不通过 |
| `3` | 权限拒绝 | Core 返回 PERMISSION_DENIED |
| `4` | 资源不存在 | 插件、session、文件等未找到 |
| `5` | 超时 | 命令执行超时 |
| `6` | 审批拒绝 | 用户拒绝了 approval 请求 |
| `7` | 插件未启用 | 目标插件已禁用或未安装 |
| `8` | 目标节点不可达 | 远程节点无响应 |
| `9` | 命令冲突 | 插件命令名冲突 |

### 错误输出规范

exit code 非 0 时，错误信息写入 stderr：

```bash
# 命令失败
node plugin claude start ./invalid

# stderr
Error: Working directory not found: ./invalid
Context: dir=./invalid, cwd=/home/user/project
Hint: Use --help to see usage

# exit code 1
```

### JSON 格式下的错误输出

```json
{
  "error": {
    "code": 1,
    "message": "Working directory not found: ./invalid",
    "details": {
      "dir": "./invalid",
      "cwd": "/home/user/project"
    },
    "hint": "Use --help to see usage"
  }
}
```

---

## 输出行为规则

| # | 规则 |
|---|------|
| 1 | stdout 只输出命令结果，不输出日志 |
| 2 | stderr 输出诊断信息（日志、警告、错误） |
| 3 | exit code 0 表示成功，非 0 表示错误 |
| 4 | `--format json` 时 stdout 为合法 JSON |
| 5 | `--format json` + 错误时，错误为 JSON 格式写入 stderr |
| 6 | `--quiet` / `-q` 抑制 stderr 输出 |
| 7 | `--verbose` / `-v` 增加 stderr 详细度 |
| 8 | stream 格式的输出不能被 `--format` 更改 |
