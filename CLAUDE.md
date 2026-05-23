# SessionBridge CLAUDE.md

## Architecture Layers

```
go-core/          — Go Core 运行时（主 Core）
  → HTTP + WebSocket server, session/stream 管理, 权限校验, 日志/审计
  → app/ 通过 CoreClient (WebSocket/HTTP) 调用，不可直接 import

app/              — 客户端 UI (Next.js React)
  → 不可 import go-core/ 的服务端代码
  → 仅通过 CoreClient (WebSocket/HTTP) 与 Go Core 通信
  → 可通过 lib/ 引入共享工具

plugins/          — 插件声明（plugin.yaml）
  → 每个子目录一个 plugin.yaml，声明能力、权限、UI/CLI 贡献

lib/              — 客户端共享工具
docs/             — 设计文档和决策记录
```

Legacy directories (all deleted — Go Core is the sole runtime):
- `src/` — 旧 Node.js relay server（已删除）
- `agent-core/` — 旧 extension 运行时（已删除）
- `extensions/` — 旧 extension 目录 + sb-extension.json（已删除）

## 核心原则

### 1. 插件功能走 plugin.yaml

新增插件能力时，通过 `plugins/<name>/plugin.yaml` 声明。插件功能的全部代码应落在：

- `plugins/` — 插件声明（plugin.yaml）
- `app/` — UI 表现（通过 manifest 贡献到注册表，不硬编码）
- `docs/` — 文档

### 2. Manifest 契约优先

插件的功能声明优先放在 `plugin.yaml` 而非硬编码在 `app/` 中：

- Panel/View → `contributes.views`
- Command → `contributes.commands`
- Menu → `contributes.menus`
- Chrome 贡献 → `contributes.chrome`
- 配置项 → `contributes.configuration`（key 必须 namespace 化）
- 通知 → `contributes.notifications`

### 3. 不修改 Go Core 行为

UI/部署/打包链变更不得修改 `go-core/` 下的 Go 代码，除非是启动链验证发现的必须修正。

## 开发流程

1. 判断修改范围：是插件功能还是基础设施？
2. 如果是插件功能 → 只改 `plugins/` + `app/`（UI）+ `docs/`
3. 如果是 Core 功能 → 改 `go-core/`
4. 重要变更写 `docs/` 记录决策理由

## 本地开发启动方式

两个开发服务：

| 服务 | 端口 | 命令 | 用途 |
|------|------|------|------|
| Go Core | 8080 | `npm run dev` | Go Core + Next.js dev 同时启动 |
| Next.js Dev | 3000 | `npm run dev:web` | 前端 UI 开发服务器，仅开发时使用 |

**开发时**：浏览器访问 `http://localhost:3000`，API 请求通过 rewrites 代理到 Go Core。
**生产构建**：`npm run build` 生成 `dist/go-core/sessionnode` + `.next/`（Next.js 生产构建，通过 `next start` 启动）。

### `next.config.ts` 的 `output: 'export'` 规则

`output: 'export'` 只在 `BRIDGE_EXPORT=1` 时启用（`npm run build:web` 自动设置）。
`npm run dev` / `npm run dev:web` 不设置此变量，正常使用 dev server。

```bash
# 从生产模式切回开发模式
rm -rf .next out
npm run dev       # 终端 1 — Go Core + Next.js
npm run dev:web   # 终端 2 — 仅前端
```

## 访问模型

两种模式：**本地管理面板**（`localhost` 绕过 auth）、**远程访问**（需登录认证）。
浏览器不是网络 peer，peer 列表只描述 agent 间的拓扑关系。详见 [`docs/access-model.md`](docs/access-model.md)。

## 已知踩坑

### 源码修改后浏览器看到旧代码

**症状**：改了 `app/` 下的 `.tsx`，源码确认已修改，换浏览器/清缓存/强制刷新都看到旧内容。

**根因**：
1. `out/` 或 `.next` 目录残留（上次 `npm run build` 产物）→ dev server 可能 serve 旧静态文件
2. 或者 `.next` 缓存损坏

**修复**：
```bash
rm -rf .next out
# 重启 dev:web
npm run dev:web
```

### Go Core 修改后不生效

Go Core 用 `go run` 启动（dev 模式）。修改 `go-core/` 后需重启 `npm run dev` 或 `npm run dev:core`。
