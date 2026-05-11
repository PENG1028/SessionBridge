# Adapters / Extensions

SessionBridge 的扩展系统。每个 adapter 是一个自包含的插件，有自己的 `sb-extension.json` manifest 和实现代码。

## 目录结构

```
adapters/
  README.md                              ← 本文件：扩展系统概述
  EXTENSION-AUTHORING.md                 ← 插件开发指南
  EXTENSION-CAPABILITY-BENCHMARKS.md     ← 未来能力规划（北向案例库）
  PLUGIN-SYSTEM-DESIGN.md                ← 插件系统设计文档（历史存档）
  ARCHITECTURE.md                        ← adapter 架构说明

  claude-code/                           ← Claude Code 适配器
  shell/                                 ← Shell 终端适配器
  system-info/                           ← 系统信息面板适配器
  deployment-ops/                        ← 部署运维文档

  types.ts                               ← 共享类型定义
  registry.ts                            ← 适配器注册表
  protocol.ts                            ← 通信协议
  semver.ts                              ← 版本比较工具
  client-index.ts                        ← 客户端入口
```

## 核心原则

- 每个 adapter 声明自己的 `sb-extension.json` manifest
- 扩展功能开发不修改 `src/`（服务端基础设施）
- 贡献点优先通过 manifest 声明，而非硬编码
- 详见 [EXTENSION-AUTHORING.md](EXTENSION-AUTHORING.md)

## 现有扩展

| Adapter | ExtensionKind | 功能 |
|---------|--------------|------|
| claude-code | adapter, visual, configuration-only | Claude Code CLI 集成 |
| shell | adapter, visual, configuration-only | 终端模拟器 |
| system-info | visual, configuration-only | 系统监控面板 |
| kitchen-sink (examples/) | visual, configuration-only, integration | 插件开发示例 |
