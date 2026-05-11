# SessionBridge CLAUDE.md

## Architecture Layers

```
src/              — 服务端基础设施 (relay server, API, instance manager, config system)
  → 可被 app/ 通过 WebSocket/HTTP 调用，不可直接 import
  → 可从 extensions/types.ts import 类型，不可 import 适配器实现

app/              — 客户端 UI (Next.js React)
  → 不可 import src/ 或 extensions/ 的服务端代码
  → 仅通过 WebSocket/HTTP 与 src/ 通信
  → 可通过 lib/ 引入共享工具

extensions/         — 扩展/适配器层 (extension host, runtime, manifests)
  → 应尽量避免 import src/ (现有例外: detectNetwork, crypto 工具)
  → extensions/types.ts 是类型桥梁，供所有层使用

lib/              — 客户端共享工具
docs/             — 设计文档和决策记录
```

## 核心原则

### 1. 扩展功能不动基础设施

开发插件功能时（新增 adapter、extension manifest、panel、command、menu、chrome 贡献），**不允许修改 `src/` 目录下的任何文件**。插件功能的全部代码应落在：

- `extensions/` — 扩展实现
- `app/` — UI 表现（仅通过 manifest 贡献，不硬编码）
- `docs/` — 文档

### 2. 必须修改基础设施时的耦合检查流程

如果某个修改确实需要触及 `src/`（例如新增 API 端点、修改配置系统），改完**必须验证**：

- 新增的 API 端点是否遵循了已有的 `ApiContext` 模式？（`api-routes.ts`）
- 是否在 `src/` 中引用了 adapter 的实现（而不仅是 types）？
- 新的配置/secret key 是否可被 manifest 声明而不是硬编码？
- 修改后的 `src/` 是否依然可以脱离任何特定 adapter 启动？

验证方式：`npx tsc --noEmit` 通过 + 目视确认没有从 `src/` import adapter 实现。

### 3. 当前已知的耦合点（需警惕）

```
extensions/ → src/ 的反向依赖（不应增加新实例）:
  agent-core/node-runtime.ts      → src/network-detect
  agent-core/dashboard-server.ts  → src/network-detect
  agent-core/relay-connection.ts  → src/crypto-stream
  agent-core/relay-connection.ts  → src/crypto-layer
  agent-core/relay-connection.ts  → src/identity-manager
```

这些都是工具/加密类依赖，不算架构违规，但新增类似 import 时需要论证合理性。

### 4. Manifest 契约优先

extension 的功能声明优先放在 `sb-extension.json` 而非硬编码在 `src/` 或 `app/` 中：

- Panel/View → `contributes.views`
- Command → `contributes.commands`
- Menu → `contributes.menus`
- Chrome 贡献 → `contributes.chrome`
- 配置项 → `contributes.configuration`（key 必须 namespace 化）
- 通知 → `contributes.notifications`

## 开发流程

1. 判断修改范围：是插件功能还是基础设施？
2. 如果是插件功能 → 只改 `extensions/` + `app/`（UI）+ `docs/`
3. 如果是基础设施 → 先评估是否真的需要，改后执行耦合检查
4. 插件功能如需新增 API → 在 `src/api-routes.ts` 加，保持 `ApiContext` 模式
5. 重要变更写 `docs/` 记录决策理由
