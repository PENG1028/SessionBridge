# SessionNode v2 — CLI 文档

> CLI 是 adapter，不是插件本体。插件只有一个 manifest，CLI 只消费 `adapters.cli`。
> 配套文档：[CLI_ADAPTER_CONTRACT.md](./CLI_ADAPTER_CONTRACT.md) | [PLUGIN_ADAPTERS.md](../plugin-platform/PLUGIN_ADAPTERS.md)

---

## CLI 的定位

```
CLI = Core 的另一个控制面，与 Web UI 平级

Web UI 通过 adapters.systemUi 消费插件
CLI    通过 adapters.cli 消费插件

两者:
  - 共享同一份 manifest（插件不分别声明 Web 和 CLI 两份定义）
  - 共享同一套 Capability API
  - 共享同一个 pluginId
  - 不能绕过 Core 权限校验
  - 不能伪造 actor 身份
```

### 核心原则

| # | 规则 |
|---|------|
| 1 | CLI 是 adapter，定义"如何适配终端用户"，不定义"插件是什么" |
| 2 | 插件只需要一个 manifest，`adapters.cli` 是可选的声明块 |
| 3 | CLI 命令最终通过 Core capability 执行，不直接操作文件系统或进程 |
| 4 | CLI 不维护独立状态 — 所有状态读写通过 Core API |
| 5 | CLI 只能调用 `core.permissions` 中声明的能力，不能额外声明 |

---

## 文档阅读顺序

```
1. CLI_ADAPTER_CONTRACT.md     — CLI 在 manifest 中的声明格式、命令注册与冲突检测
2. COMMAND_ROUTING.md          — CLI 命令如何路由到 Core capability、actor 身份、target node
3. ARGUMENT_SCHEMA.md           — 参数/选项/flag 的 schema 定义
4. OUTPUT_FORMATS.md           — stdout/stderr/json/table/stream 输出规范、exit code
5. APPROVAL_AND_AUDIT.md       — 危险能力在 CLI 中的审批流程、audit 记录
6. EXAMPLES.md                  — 完整 CLI 使用示例
```

---

## 与 Plugin Platform 的边界

| 概念 | 定义在 | CLI 文档职责 |
|------|--------|-------------|
| Manifest 格式 | [PLUGIN_MANIFEST_SPEC.md](../plugin-platform/PLUGIN_MANIFEST_SPEC.md) | 引用，不重复定义 |
| Capability API | [PLUGIN_CORE_API_CONTRACT.md](../plugin-platform/PLUGIN_CORE_API_CONTRACT.md) | 引用 `action.request` 格式 |
| 权限模型 | [PLUGIN_SECURITY_MODEL.md](../plugin-platform/PLUGIN_SECURITY_MODEL.md) | 引用三层权限模型 |
| Adapter 概览 | [PLUGIN_ADAPTERS.md](../plugin-platform/PLUGIN_ADAPTERS.md#cli-adapter) | CLI 概览，跳转至此 |
| CLI 详细规则 | 本文档 | **在此定义** |

---

## 文档维护规则

- CLI 命令名注册与冲突检测规则以 `CLI_ADAPTER_CONTRACT.md` 为准
- 参数 schema 定义以 `ARGUMENT_SCHEMA.md` 为准
- 输出格式规范以 `OUTPUT_FORMATS.md` 为准
- approval 流程引用 `PLUGIN_SECURITY_MODEL.md`，CLI 特定行为在 `APPROVAL_AND_AUDIT.md`
