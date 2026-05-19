# Claude Code Adapter

SessionBridge 的 Claude Code 集成适配器。

## 功能

- Claude Code CLI 包装，支持 stream-json 输出格式解析
- 会话管理（启动、停止、历史记录）
- 思维链、工具调用、文本输出的结构化渲染
- 权限审批流（plan / acceptEdits / 默认模式）
- 会话持久化与搜索

## Manifest

详见 [sb-extension.json](sb-extension.json)。

## 配置项

| Key | 类型 | 说明 |
|-----|------|------|
| `claude-code.maxThinkingTokens` | integer | 最大 thinking token 数 |
| `claude-code.defaultPermissionMode` | string | 默认权限模式 |

## 依赖

- Claude Code CLI (`claude --version` 可检测)
