# 术语与端口审计报告

审计日期：2026-05-12
审计范围：docs/*.md、README.md、CLAUDE.md、src/、app/、agent-core/、extensions/

---

## 一、端口清单

| 端口 | 用途 | 启动方式 | 说明 |
|------|------|----------|------|
| **8080** | 节点主入口（HTTP + WebSocket） | `npm run dev` → `tsx src/index.ts` → NodeRuntime 内部启动 | **单端口全能**：WebSocket + REST API + 静态文件（Next.js 构建产物 `out/`）+ 管理路由（认证、状态 API、临时 shell）。生产环境也使用此端口。这是唯一需要对外暴露的端口 |
| **3000** | Next.js 前端开发服务器 | `npm run dev:web` → `next dev` | **仅开发时使用**。生产环境由 relay server 直接 serve `out/` 静态文件 |

> ~~9843~~ 已合并到 8080。原独立 Dashboard 端口 (9843) 于 2026-05-12 移除，所有管理路由整合到 relay server。

### 端口合并说明

9843 端口（Dashboard 独立服务）已在 2026-05-12 的端口合并中**完全移除**。原来的功能：

- 认证系统 → `src/admin-auth.ts` + `src/admin-routes.ts` 认证路由
- 状态/系统/权限/通知 API → `src/admin-routes.ts`
- 临时 Shell 执行 → `src/admin-routes.ts` shell 路由
- 静态文件服务 → 已由 relay server 直接处理
- QR 页面 → `src/admin-routes.ts` `/qr` 路由

所有功能直接在 relay server 的 HTTP 请求处理管线中注册，不再需要代理转发或独立端口。

### Config 相关

- `agent-core/config.ts` — `dashboardPort` / `dashboardBind` 标记为 `@deprecated`
- `src/configuration/host-config.ts` — `dashboardPort` / `dashboardBind` 标记为 `@deprecated`
- `src/index.ts` `--dashboard-port` CLI 参数标记为 `@deprecated`

### 文档需修正（已修正 ✓）

- ~~**CLAUDE.md** — 端口表缺 dashboard (9843) + 8080 描述不全~~ → 已修正：增加 dashboard 行，8080 改为完整描述
- **docs/architecture.md**: Section 1 "双端口职责清晰" → 已改为 "单端口为主，内部微服务为辅"
- **docs/architecture.md**: Section 8 Dashboard 描述 → 已更新为完整的能力表格 + 与 relay 的关系说明
- **docs/GLOSSARY.md**: Relay 定义 → 已修正为 "Node 内部的一个组件"
- **docs/GLOSSARY.md**: Dashboard 定义 → 已修正为 "内部 Web UI"
- **docs/terminology-audit.md**: 端口表已修正，新增端口重叠说明

---

## 二、核心术语问题

### 2.1 "Adapter" vs "Extension"（高优先级）

项目目录叫 `extensions/`，但核心类型叫 `Adapter`，文档混用四个词：

| 术语 | 出现位置 | 问题 |
|------|----------|------|
| **Adapter** | `extensions/types.ts` 核心类型 `AgentAdapter` | 核心接口，但活在 `extensions/` 目录下 |
| **Extension** | `extensions/` 目录名 | 目录名，但内部文件标题仍是 "Adapter" |
| **Plugin** | `extensions/PLUGIN-SYSTEM-DESIGN.md` | 第三个词，与目录名不一致 |
| **Bridge**（概念） | `extensions/ARCHITECTURE.md` "唯一的桥" | 第四个词，中文翻译 |

**根因**：项目从 v0.5 的 "Adapter 体系" 演进到 v0.6 时目录改名为 `extensions/`，但类型定义和文档未同步。

**需修改的文件**：

| 文件 | 问题 |
|------|------|
| `extensions/README.md:1` | 标题 "Adapters / Extensions" — 应统一为 "Extensions" |
| `extensions/ARCHITECTURE.md` | 多处使用 "Adapter" 指代 extension |
| `extensions/PLUGIN-SYSTEM-DESIGN.md:1` | 使用 "Plugin System" — 第三个词 |
| `docs/GLOSSARY.md:15,42-51,64` | 混用 Plugin、Adapter、Extension |
| `docs/architecture.md:21, Section 4` | "Adapter 插件体系" — 混合两个词 |
| `CLAUDE.md:15,27` | "扩展/适配器层"、"新增 adapter、extension manifest" — 同一句混用 |
| `docs/api/*.md` | action-api.md, shared-ui-api.md, workbench-state-api.md, client-device-api.md 中多处使用 "adapter" |

### 2.2 "Relay" vs "Node" vs "Instance"（中优先级）

三个概念的关系：

- **Node**（节点）：基本单位。`src/index.ts` 第一行定义 *"Every installation is a node"*。一台机器跑一个 `NodeRuntime`，包含 relay server、dashboard、adapter registry、instance manager 等组件。
- **Relay**（中继）：Node 内部的一个角色/组件。当 Node 允许外来连接时启动 `NodeRelayServer`（`src/relay-server.ts`:8080），提供 WebSocket + HTTP + 静态文件服务。**Relay 不是独立概念——它是 Node 的一部分。**
- **Instance**（实例）：Node 管理的一个运行中进程（`src/instance-manager.ts`）。每个 instance 绑定工作目录、adapter、输出缓冲。实例可以是本地的（直接 spawn）或远程的（另一台机器的 agent 注册过来）。

| 文件 | 问题 |
|------|------|
| `docs/GLOSSARY.md:10` | "面板显示 relay 已知实例" → 已改为 "本节点已知的实例列表" |
| `docs/GLOSSARY.md:11` | Relay 定义已修正，强调是 Node 内部组件 |
| `docs/architecture.md` | Section 1 "Relay 默认使用 8080" 措辞 → 已改为以 Node 为主体描述 |
| `docs/architecture.md` | Section 1 "Adapter 插件体系" → 已改为 "Extension 插件体系" |
| `CLAUDE.md:82` | 端口表第一行 "Relay Server \| 8080" — 可以接受，因为 relay 是 Node 内的具体组件名 |

### 2.3 "agent" 角色混淆（低优先级）

"Agent" 在代码中有两个含义：
1. **NodeRuntime 内部的 agent 连接** — 通过 `RelayConnection` 注册到自己的 relay，loopback
2. **远程 agent** — 另一台机器上的 node 连过来

Peer 列表过滤掉 loopback 后，只剩远程 agent，不再混淆。

---

## 三、代码中的术语不一致

### 3.1 "bridge" 缩写

`package.json:25` 二进制名 `bridge`，环境变量 `BRIDGE_CONFIG`、`BRIDGE_TOKEN` 等。这是标准模式（项目名 SessionBridge，二进制名 bridge），不需修改。

### 3.2 "adapterRegistry" vs extension 目录

`extensions/registry.ts` 输出 `adapterRegistry` — 如果决定统一用 "extension"，需要改：
- `extensions/registry.ts` 导出名
- `extensions/types.ts` 类型名
- 所有 `import { adapterRegistry }` 的地方

这些改造成本很高，且没功能收益。建议保留 "Adapter" 作为类型名，文档统一用 "Extension"。

---

## 四、修改计划

按依赖顺序排列：

### Step 1: 端口文档修正

| 文件 | 修改内容 |
|------|----------|
| `CLAUDE.md:83` | 3000 行加注 "仅开发时使用" |

### Step 2: "Adapter/Extension" 文档统一

决定：**Extension 为顶层概念，Adapter 是其子类型**（运行时代理类型）。按此修正文档：

| 文件 | 修改内容 |
|------|----------|
| `extensions/README.md:1` | 标题 "Adapters / Extensions" → "Extensions" |
| `extensions/ARCHITECTURE.md` | "适配器接口" → "Extension 接口" |
| `extensions/PLUGIN-SYSTEM-DESIGN.md:1` | "插件系统" → "Extension 系统" |
| `docs/GLOSSARY.md` | Plugin → Extension，统一措辞 |
| `docs/architecture.md:21, Section 4` | "Adapter 插件体系" → "Extension 体系" |
| `CLAUDE.md:15,27` | "扩展/适配器" → 统一用 "Extension" |
| `docs/api/*.md` | "adapter" → "extension" 文档描述 |

### Step 3: "relay" 措辞修正

| 文件 | 修改内容 |
|------|----------|
| `docs/GLOSSARY.md:10` | "relay 已知实例" → "节点网络中的已知实例" |

### Step 4: 代码不改（建议）

`adapterRegistry`、`AgentAdapter` 等类型名不改，因为：
- 改造成本极高（全仓数百处引用）
- 无功能收益
- 文档统一后，Adapter 作为 "Extension 的一种" 可以接受

---

## 五、验证方式

1. `npx tsc --noEmit` 通过（确保文档修改不影响类型检查）
2. 目视确认每个文件修改正确
