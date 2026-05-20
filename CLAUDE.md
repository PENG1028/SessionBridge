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
  agent-core/relay-connection.ts  → src/crypto-stream
  agent-core/relay-connection.ts  → src/crypto-layer
  agent-core/relay-connection.ts  → src/identity-manager
  agent-core/node-runtime.ts      → src/relay-server (dynamic import)
  agent-core/node-runtime.ts      → src/admin-auth (dynamic import)
  agent-core/node-runtime.ts      → src/configuration/host-config (dynamic import)
  agent-core/node-runtime.ts      → src/configuration/registry (dynamic import)
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

## 本地开发启动方式

项目只有一个服务端端口：

| 服务 | 端口 | 命令 | 用途 |
|------|------|------|------|
| Relay Server | 8080 | `npm run dev` | **唯一对外入口**：WebSocket + REST API + 静态文件 + 管理后台（认证、状态 API、临时 shell）。**开发时** `out/` 不存在所以没有前端页面；生产构建后 serve `out/` 静态文件。管理路由直接在 relay 内处理，不再需要独立 dashboard 端口 |
| Next.js Dev | 3000 | `npm run dev:web` | 前端 UI 开发服务器。**仅开发时使用**，生产环境不启动 |

**开发时**：浏览器访问 `http://localhost:3000`，API 请求通过 rewrites 代理到 `localhost:8080`。
**生产构建**：`npm run build` 生成静态文件到 `out/`，由 relay server 直接 serve。

### `next.config.ts` 的 `output: 'export'` 规则

`output: 'export'` **只在生产构建时需要**（`npm run build`）。运行 `next dev` 时必须禁用，否则 Turbopack 不会正常编译和 HMR。

通过在 `next.config.ts` 中检查 `BRIDGE_EXPORT=1` 环境变量自动控制：
- `npm run build` 会自动设置 `BRIDGE_EXPORT=1`，生成 `out/`
- `npm run dev` / `npm run dev:web` 不设置此变量，正常使用 dev server
- 如果刚刚 build 过，`out/` 目录必须一并删除再切回 dev 模式

```bash
# 从生产模式切回开发模式
# 1. 删掉构建产物
rm -rf .next out
# 2. 启动
npm run dev       # 终端 1 — relay
npm run dev:web   # 终端 2 — 前端
```

## 访问模型

两种模式：**本地管理面板**（`localhost` 绕过 auth）、**远程访问**（需登录认证）。
浏览器不是网络 peer，peer 列表只描述 agent 间的拓扑关系。详见 [`docs/access-model.md`](docs/access-model.md)。

## 已知踩坑

### 源码修改后浏览器看到旧代码

**症状**：改了 `app/` 下的 `.tsx`，源码确认已修改，换浏览器/清缓存/强制刷新都看到旧内容。

**根因**：
1. `out/` 目录残留（上次 `npm run build` 产物）→ dev server 直接 serve 旧静态文件
2. 或者 `.next` 缓存损坏

**修复**：
```bash
rm -rf .next out
# 重启 dev:web
npm run dev:web
```

### 修改 relay server (src/) 后不生效

Relay server 用 `tsx watch` 启动，改 `src/` 会自动重启。如果没生效 → 手动 Ctrl+C 重跑 `npm run dev`。
