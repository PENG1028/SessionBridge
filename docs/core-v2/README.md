# SessionNode v2 — 架构文档体系

## 文档分类总览

```
docs/core-v2/
├── README.md
├── overview/
│   └── ARCHITECTURE.md
├── core-kernel/
│   ├── CORE_PROTOCOL.md
│   ├── CAPABILITY_API.md
│   ├── SESSION_AND_STREAM.md
│   └── LOGS_AND_AUDIT.md
├── access-control/
│   ├── PERMISSIONS.md
│   └── ACCESS_CONTROL.md
├── plugin-platform/
│   ├── README.md                         # 插件平台文档总览
│   ├── PLUGIN_DEFINITION.md              # 插件的定义与边界
│   ├── PLUGIN_MANIFEST_SPEC.md           # Manifest 完整格式与校验
│   ├── PLUGIN_CORE_API_CONTRACT.md       # 插件调用 Core 的 capability API
│   ├── PLUGIN_ADAPTERS.md                # systemUi/cli/daemon/webhook 适配器
│   ├── PLUGIN_LIFECYCLE.md               # 发现→注册→安装→启用→禁用→卸载
│   ├── PLUGIN_STORAGE_AND_CACHE.md       # 文件声明、缓存管理、安装侧写
│   ├── PLUGIN_SECURITY_MODEL.md          # 权限模型、pluginId 防伪造、审批
│   ├── PLUGIN_MANAGEMENT.md              # 管理 API、CLI、UI 展示要求
│   ├── CHECKLIST.md                      # 验证/审查清单
│   └── EXAMPLES/                         # 插件示例
│       ├── claude-code.md                # systemUi + cli + daemon
│       ├── terminal.md                   # trusted + 危险能力
│       ├── node-monitor.md               # daemon + webhook 纯后台
│       └── file-browser.md               # systemUi-only 纯 UI
├── cli/
│   ├── README.md                    # CLI 文档总览
│   ├── CLI_ADAPTER_CONTRACT.md      # 声明格式、命令注册、冲突检测
│   ├── COMMAND_ROUTING.md           # 命令路由、actor 身份、target node
│   ├── ARGUMENT_SCHEMA.md           # 参数/选项 schema
│   ├── OUTPUT_FORMATS.md            # 输出格式规范、exit code
│   ├── APPROVAL_AND_AUDIT.md        # 危险能力审批流程
│   └── EXAMPLES.md                  # 完整使用示例
├── system-ui/
│   ├── SYSTEM_UI_PLUGIN.md
│   └── UX_SURFACES.md
├── test-scenarios/
│   ├── PRODUCT_SCENARIOS.md
│   └── CONTROL_PLANE_TEST_CASES.md
└── templates/
    └── FEATURE_SPEC_TEMPLATE.md
```

| 分类 | 包含文档 | owner | 核心职责 |
|------|---------|-------|---------|
| Overview | overview/ARCHITECTURE.md | Core Agent | 顶层架构、分层、关键设计决策 |
| Core Kernel | core-kernel/* | Core Agent | 内核协议、API、会话/流、审计 |
| Access Control | access-control/* | Core Agent | 权限模型、User/Group/Role/Token 体系 |
| Plugin Platform | plugin-platform/* | Plugin Agent | 插件定义、manifest、API 契约、适配器、生命周期、存储缓存、安全管理 |
| CLI | cli/* | CLI Agent | CLI adapter 声明、命令路由、参数 schema、输出规范、审批流程 |
| System UI | system-ui/* | UI Agent | UI 插件系统、Surface/Slot 机制 |
| Test Scenarios | test-scenarios/* | QA Agent | 产品场景、测试用例 |
| 工具 | templates/FEATURE_SPEC_TEMPLATE.md | — | 功能规约模板 |

---

## Overview

### [overview/ARCHITECTURE.md](./overview/ARCHITECTURE.md)

| 字段 | 内容 |
|------|------|
| owner | Core Agent |
| 职责 | 定义系统整体分层、Go Core / TS 扩展 / System UI 的边界、Actor 模型、Desired/Actual 状态 reconcile、Task 生命周期、健康检查与指标 |
| 禁止修改 | 不得将 UI 操作逻辑写入内核架构；不得将 Core 定位为 Web UI 后端；不得引入 ClaudeCode 专用架构决策 |

---

## Core Kernel

Core Kernel 文档由 **Core Agent** 维护，负责 Go Core 的所有协议、API、状态管理。其他 Agent 可以阅读，但**禁止修改**。

### [core-kernel/CORE_PROTOCOL.md](./core-kernel/CORE_PROTOCOL.md)

| 字段 | 内容 |
|------|------|
| owner | Core Agent |
| 职责 | WebSocket 消息格式、消息类型常量、Action Request/Response 流程、认证流程、Task 生命周期消息、健康检查端点 |
| 禁止修改 | 不得引入 UI 专用的消息类型；不得修改 pluginId 的可选性语义；不得让 relay 持有业务状态 |

### [core-kernel/CAPABILITY_API.md](./core-kernel/CAPABILITY_API.md)

| 字段 | 内容 |
|------|------|
| owner | Core Agent |
| 职责 | HTTP REST API 定义：`/api/actions`（所有 Actor 通用）、`/api/plugins/*`（仅 admin Actor）、认证与 Actor 模型、已有插件能力组合示例 |
| 禁止修改 | 不得为 External Client 添加 pluginId 必填要求；不得放宽 admin token 的默认权限（安装后应禁用）；不得在 API 层引入 ClaudeCode 专用端点或参数 |

### [core-kernel/SESSION_AND_STREAM.md](./core-kernel/SESSION_AND_STREAM.md)

| 字段 | 内容 |
|------|------|
| owner | Core Agent |
| 职责 | Session/Stream 生命周期、EventSeq 生成与 Replay、Interrupted/Resumable 状态机、多端同步一致性保证 |
| 禁止修改 | 不得将 Browser 视为 peer 状态源；不得移除 Interrupted 状态的防回退规则 |

### [core-kernel/LOGS_AND_AUDIT.md](./core-kernel/LOGS_AND_AUDIT.md)

| 字段 | 内容 |
|------|------|
| owner | Core Agent |
| 职责 | 审计日志 schema、全局序列号、日志存储策略、Task/Actor/Service Token 审计事件、防回退规则 |
| 禁止修改 | 不得降低审计事件的完整性要求（必须记录所有高危操作）；不得移除全局序号的强制约束 |

---

## Access Control

Access Control 文档由 **Core Agent** 维护，定义谁可以做什么。

### [access-control/PERMISSIONS.md](./access-control/PERMISSIONS.md)

| 字段 | 内容 |
|------|------|
| owner | Core Agent |
| 职责 | 权限系统三层模型（Actor ∩ Plugin Grant ∩ 目标节点策略）、Plugin Grant 生命周期、Plan Before Apply、目标节点独立校验 |
| 禁止修改 | 不得跳过目标节点独立校验；不得赋予 Service Token 默认管理员权限；不得让 relay 代行权限判断 |

### [access-control/ACCESS_CONTROL.md](./access-control/ACCESS_CONTROL.md)

| 字段 | 内容 |
|------|------|
| owner | Core Agent |
| 职责 | User/Group/Role 模型、Service Token 定义、Policy Binding 机制、Plugin Grant 与 RBAC 的关系 |
| 禁止修改 | 不得绕过 Policy Binding 直接赋予权限；不得引入多租户隔离逻辑（base 是单进程单用户）；不得将 Role 设计为全局默认具备高危权限 |

---

## Plugin Platform

Plugin Platform 文档由 **Plugin Agent** 维护，定义插件框架的契约。

### [plugin-platform/README.md](./plugin-platform/README.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | 插件平台文档总览，阅读顺序，核心边界，维护规则 |

### [plugin-platform/PLUGIN_DEFINITION.md](./plugin-platform/PLUGIN_DEFINITION.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | 插件 vs External Client 的边界、一个插件多个 adapter 概念、pluginId 规则 |
| 禁止修改 | 不得模糊插件和 External Client 的边界；不得将 adapter 定义写入插件定义 |

### [plugin-platform/PLUGIN_MANIFEST_SPEC.md](./plugin-platform/PLUGIN_MANIFEST_SPEC.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | Manifest 完整格式（root fields、core section、adapters section）、22 条校验规则、Go 实现类型与函数 |
| 禁止修改 | 不得降低校验规则的严格性；不得为适配器路径放宽相对路径限制 |

### [plugin-platform/PLUGIN_CORE_API_CONTRACT.md](./plugin-platform/PLUGIN_CORE_API_CONTRACT.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | Capability 命名总则、所有命名空间定义（session/stream/process/fs/env/config/logs/audit/plugin/notify/approval/node）、节点路由、危险能力清单 |
| 禁止修改 | 不得允许 payload 中的 pluginId 覆盖连接认证的 pluginId；不得移除目标节点独立校验 |

### [plugin-platform/PLUGIN_ADAPTERS.md](./plugin-platform/PLUGIN_ADAPTERS.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | systemUi/cli/daemon/webhook 四种 adapter 的声明方式、字段定义、执行流程 |
| 禁止修改 | 不得将 adapter 定义与 plugin 核心定义混淆；不得在 systemUi adapter 中定义 Core 协议 |

### [plugin-platform/PLUGIN_LIFECYCLE.md](./plugin-platform/PLUGIN_LIFECYCLE.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | 发现→注册→check→安装→启用→禁用→卸载→更新全流程、16 状态状态机、Desired/Actual 状态 reconcile |
| 禁止修改 | 不得让 Desired State 直接绕过 plan/permission；不得移除 install 的 Plan Before Apply 步骤 |

### [plugin-platform/PLUGIN_STORAGE_AND_CACHE.md](./plugin-platform/PLUGIN_STORAGE_AND_CACHE.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | 9 种存储类型、Manifest 文件声明、缓存散落处理、安装侧写三类记录、下载位置管理、共享依赖引用计数 |
| 禁止修改 | 不得允许插件绕过 Core 操作文件系统；不得移除缓存清理的 Plan Before Apply |

### [plugin-platform/PLUGIN_SECURITY_MODEL.md](./plugin-platform/PLUGIN_SECURITY_MODEL.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | 三层权限交集公式、PluginId 防伪造、Grant 生命周期、危险能力审批、审计日志 |
| 禁止修改 | 不得跳过目标节点独立校验；不得允许 Manifest 声明 = 自动授权 |

### [plugin-platform/PLUGIN_MANAGEMENT.md](./plugin-platform/PLUGIN_MANAGEMENT.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | 插件管理 HTTP API、CLI 命令、UI 展示要求、数据流示例、Registry/PATH/shell profile 管理 |
| 禁止修改 | 不得允许 UI/CLI 绕过 Core 直接判断插件状态；不得允许 Core 在未确认情况下修改系统环境 |

### [plugin-platform/CHECKLIST.md](./plugin-platform/CHECKLIST.md)

| 字段 | 内容 |
|------|------|
| owner | Plugin Agent |
| 职责 | Manifest 校验、权限模型、生命周期、存储缓存、Core API、审计合规、跨节点操作、防回退规则验证 |

---

## CLI

CLI 文档由 **CLI Agent** 维护，定义 CLI adapter 的契约。CLI 是 adapter，不是插件本体。

### [cli/README.md](./cli/README.md)

| 字段 | 内容 |
|------|------|
| owner | CLI Agent |
| 职责 | CLI 文档总览、定位、阅读顺序、与 Plugin Platform 的边界 |

### [cli/CLI_ADAPTER_CONTRACT.md](./cli/CLI_ADAPTER_CONTRACT.md)

| 字段 | 内容 |
|------|------|
| owner | CLI Agent |
| 职责 | CLI 在 manifest 中的声明格式、命令注册流程、全局命令索引、冲突检测规则、保留命令名 |
| 禁止修改 | 不得允许插件使用保留命令名；不得放宽冲突检测规则 |

### [cli/COMMAND_ROUTING.md](./cli/COMMAND_ROUTING.md)

| 字段 | 内容 |
|------|------|
| owner | CLI Agent |
| 职责 | 路由流程、actor 身份（cli-user/service/plugin）、pluginId 注入、targetNodeId 处理、Service Token 调用 |
| 禁止修改 | 不得让 CLI Host 决定 pluginId；不得允许 --target 和 --local 同时使用 |

### [cli/ARGUMENT_SCHEMA.md](./cli/ARGUMENT_SCHEMA.md)

| 字段 | 内容 |
|------|------|
| owner | CLI Agent |
| 职责 | 位置参数 schema、命名选项 schema、boolean flag、validator 规则、短选项冲突检测 |

### [cli/OUTPUT_FORMATS.md](./cli/OUTPUT_FORMATS.md)

| 字段 | 内容 |
|------|------|
| owner | CLI Agent |
| 职责 | text/json/table/stream 四种输出格式、exit code 规范（0-9）、错误输出规范 |
| 禁止修改 | 不得改变 exit code 0 = 成功的语义；不得移除 `--format json` 时的合法 JSON 要求 |

### [cli/APPROVAL_AND_AUDIT.md](./cli/APPROVAL_AND_AUDIT.md)

| 字段 | 内容 |
|------|------|
| owner | CLI Agent |
| 职责 | CLI 中危险能力的审批流程（交互式/非交互式）、Plan Before Apply、`--approve` 安全约束、CLI 特有 audit 字段 |
| 禁止修改 | 不得允许非 TTY 环境绕过审批；不得让 `--approve` 跳过高风险操作的约束 |

### [cli/EXAMPLES.md](./cli/EXAMPLES.md)

| 字段 | 内容 |
|------|------|
| owner | CLI Agent |
| 职责 | CLI 命令完整使用示例：基本命令、参数、输出格式、目标节点、审批、生命周期、缓存、权限、配置、Service Token |

---

## System UI

System UI 文档由 **UI Agent** 维护，定义前端系统的契约。Core Agent 只提供 API，不干涉 UI 实现。

### [system-ui/SYSTEM_UI_PLUGIN.md](./system-ui/SYSTEM_UI_PLUGIN.md)

| 字段 | 内容 |
|------|------|
| owner | UI Agent |
| 职责 | System UI Plugin 架构、UI 插件注册与发现、Panel/Command/Menu/Chrome 贡献机制 |
| 禁止修改 | 不得要求 Core 存储 UI 状态；不得将 UI 插件状态写入 Core 审计日志；不得让 UI 插件直接调用 Core IPC（必须通过 Capability API） |

### [system-ui/UX_SURFACES.md](./system-ui/UX_SURFACES.md)

| 字段 | 内容 |
|------|------|
| owner | UI Agent |
| 职责 | UX Surface / Slot 系统定义、Surface 类型与生命周期、跨节点 Surface 同步机制 |
| 禁止修改 | 不得要求 relay 持久化 Surface 数据（relay 仅转发）；不得让 Browser 成为 Surface 状态的权威来源 |

---

## Test Scenarios

### [test-scenarios/PRODUCT_SCENARIOS.md](./test-scenarios/PRODUCT_SCENARIOS.md)

| 字段 | 内容 |
|------|------|
| owner | QA Agent |
| 职责 | 13 个产品场景（业务价值、涉及模块、API、权限、日志、失败状态、P0 断言） |
| 禁止修改 | 不得移除失败状态表；不得降低 P0 测试的覆盖范围 |

### [test-scenarios/CONTROL_PLANE_TEST_CASES.md](./test-scenarios/CONTROL_PLANE_TEST_CASES.md)

| 字段 | 内容 |
|------|------|
| owner | QA Agent |
| 职责 | 121 个测试用例（P0=56, P1=31, P2=16, 防回退=18），含测试环境要求和阶段实施建议 |
| 禁止修改 | 不得移除 18 条防回退测试用例；不得降低 P0 测试的优先级；不得在未通知 Core Agent 的情况下修改 Phase 1 测试范围 |

---

## 工具

### [templates/FEATURE_SPEC_TEMPLATE.md](./templates/FEATURE_SPEC_TEMPLATE.md)

功能规约模板，用于新增功能时统一格式。任何 Agent 均可使用，修改需所有 Agent 共识。

---

## 文档体系维护规则

1. **分级修改权限**：Core Kernel / Access Control 文档仅 Core Agent 修改；Plugin Platform 文档仅 Plugin Agent 修改；System UI 文档仅 UI Agent 修改
2. **交叉引用**：修改文档时必须同步更新引用它的所有文档的关联章节
3. **防回退规则不可降级**：分散在各文档中的 anti-regression 规则构成文档体系的底线，任何修改不得削弱
4. **新文档准入**：新增文档必须指定 owner 和分类，并更新本 README
5. **废弃文档**：文档废弃时在本 README 中标记 `[废弃]`，保留至少一个版本周期再删除
