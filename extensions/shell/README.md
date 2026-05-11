# Shell Terminal Adapter

SessionBridge 的终端模拟器适配器。

## 功能

- 基于 PTY 的终端会话
- 进程列表与进程管理
- 清除、中止等控制命令

## Manifest

详见 [sb-extension.json](sb-extension.json)。

## 配置项

| Key | 类型 | 说明 |
|-----|------|------|
| `shell.defaultShell` | string | 默认 shell 类型 (bash, zsh, fish, powershell) |
