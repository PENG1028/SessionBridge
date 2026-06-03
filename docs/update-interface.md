# SessionBridge 对外自动更新标准接口

> 设计版本: v2
> 更新日期: 2026-06-02
> 状态: 草案

---

这个文档分两层：

1. **平台接口层** — 通用的、在任何项目都可以复用的自动更新标准
2. **本项目映射层** — 上述标准在 SessionBridge (Go Core + App UI) 上的具体落地

---

## 一、平台接口层 (Universal Platform Interface)

这是不依赖任何具体项目的抽象标准。只要实现了这组契约，任何系统都可以称为"支持标准自动更新"。

### 1.1 核心概念

整个自动更新可以归纳为**两个核心概念**：

```
更新清单 (Manifest)    →  描述"有什么版本可以更新"
更新操作 (Operations)  →  定义"如何执行一次更新"

Manifest 是数据契约，Operations 是行为契约。
```

### 1.2 Manifest — 数据契约

任何更新源应当返回一个标准化的 Manifest，描述一个可用的版本。

```json
{
  "version": "1.2.3",
  "publishedAt": "2026-06-01T12:00:00Z",
  "releaseNotes": "https://example.com/releases/v1.2.3",
  "severity": "recommended",
  "assets": [
    {
      "platform": "linux/amd64",
      "url": "https://example.com/pkg-v1.2.3-linux-amd64.tar.gz",
      "size": 52428800,
      "sha256": "abcdef...",
      "signature": "base64-ed25519-sig..."
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `version` | 更新后的版本号，遵循 semver |
| `assets[].platform` | Go 风格的 platform triplet: `os/arch` |
| `assets[].url` | 下载链接 (HTTPS required) |
| `assets[].sha256` | 完整性校验 |
| `assets[].signature` | 发布者签名，可选，用于防篡改 |

**为什么不定义更多字段？** 因为 manifest 的核心职责只有一条：**告诉客户端"有一个新版本，这是下载链接和验证方式"**。任何扩展字段（changelog, severity, dependencies...）都只是锦上添花，不改变契约本质。

> Manifest 可以是 JSON、YAML、Protocol Buffers 甚至 TOML。**标准的是其语义字段，不是序列化格式。**

### 1.3 Operations — 行为契约

更新操作遵循一条有限状态机：

```
IDLE ──[check]──→ CHECKING ──→ UPDATE_AVAILABLE ──→ IDLE (无更新)
                                  │
                                  ↓
                             DOWNLOADING ──→ DOWNLOADED
                                  │
                                  ↓
                              PREPARING ──→ READY
                                  │
                                  ↓
                             APPLYING ──→ (重启/热加载)
                                  │
                                  ↓
                                IDLE (新版本)
```

在任何错误状态下，都可以回滚到上一个版本。

抽象 API 接口（5 个操作，不依赖任何传输协议）：

```
操作          说明
────────────────────────────────────────────────────
check()       查询是否有新版本 → 返回 version或null
download()    下载匹配当前平台的 asset → 返回进度流
prepare()     校验 → 备份 → 解压 → 准备好切换
activate()    执行切换 (停止旧版本，启动新版本)
rollback()    回滚到上一个版本
status()      查询当前状态 (版本、阶段、进度)
```

**这 6 个操作就是自动更新标准接口的全部。**

它们可以用任何协议暴露：

| 协议 | check() 的映射 |
|------|---------------|
| HTTP | `GET /api/update/check` |
| gRPC | `rpc Check(Empty) → (UpdateStatus)` |
| WS/JSON | `{"capability": "update.check"}` |
| CLI | `myapp update check` |
| Unix Socket | `check\n` → `{"version": "..."}` |

### 1.4 状态报告契约

任何实现必须提供标准化的状态报告，包含：

```json
{
  "currentVersion": "1.2.2",
  "targetVersion": "1.2.3",
  "phase": "idle|checking|available|downloading|ready|applying|rollback|error",
  "progress": { "total": 52428800, "done": 23592960, "speed": 1048576 },
  "error": null
}
```

---

## 二、本项目的接口设计 (SessionBridge 映射)

### 2.1 双组件更新

SessionBridge 只有两个需要更新的组件：

| 组件 | 类型 | 更新方式 |
|------|------|----------|
| **Go Core** | 原生二进制 | 下载 → 替换 → 重启 |
| **App UI (Next.js)** | 静态资源 + Node.js server | 随 Core 一起打包在同一个 ZIP 中 |

两者**捆绑发布、一并更新**。Release 产出一个 ZIP 包同时包含 Core 二进制和 `.next/` 构建产物。

### 2.2 Go Core 对外暴露的接口

Go Core 作为常驻进程，是整个系统的更新入口。它对外暴露两组接口：

#### A. WebSocket 能力命令 (给 App UI)

| 命令 | 映射到平台操作 |
|------|---------------|
| `update.status` | status() |
| `update.check` | check() |
| `update.manifest` | 获取完整 manifest 内容 |
| `update.download` | download() |
| `update.download.cancel` | 取消下载 |
| `update.stage` | prepare() |
| `update.apply` | activate() |
| `update.rollback` | rollback() |
| `update.source.set` | 配置更新源 |
| `update.policy.set` | 配置策略 (自动检查间隔等) |

使用现有的 WebSocket 能力机制，不需要引入新协议。

#### B. HTTP REST 端点 (给外部 CLI / curl / 脚本)

| 方法 | 路径 | 映射 |
|------|------|------|
| `GET` | `/api/update/status` | status() |
| `GET` | `/api/update/check` | check() |
| `POST` | `/api/update/download` | download() |
| `POST` | `/api/update/download/cancel` | 取消 |
| `GET` | `/api/update/download/progress` | SSE 下载进度流 |
| `POST` | `/api/update/prepare` | prepare() |
| `POST` | `/api/update/activate` | activate() |
| `POST` | `/api/update/rollback` | rollback() |
| `PUT` | `/api/update/config` | 配置更新源 |

**认证**: 使用现有的 `SESSIONNODE_TOKEN` (Bearer token)

### 2.3 更新源配置

用户通过 `update.source.set` 或 `PUT /api/update/config` 配置更新源：

```json
// 方式 A: GitHub Releases (最常用)
{ "type": "github", "owner": "PENG1028", "repo": "SessionBridge" }

// 方式 B: 自建更新服务器
{ "type": "http", "url": "https://updates.example.com/myapp/manifest.json" }

// 方式 C: 本地 Manifest (离线更新)
{ "type": "file", "path": "/path/to/manifest.json" }

// 方式 D: Git (开发环境，只读)
{ "type": "git", "remote": "origin", "branch": "main" }
```

Git 模式保留现有行为：`check()` 比较 commit hash，`download()`/`prepare()`/`activate()` 不可用。

### 2.4 更新生命周期 (端到端)

```
  App UI                      Go Core                    GitHub
    │                           │                          │
    ├──update.check─────────────┤                          │
    │                           ├──GET /releases/latest────┤
    │                           │←──manifest───────────────┤
    │←──{version: "0.7.0"}─────┤                          │
    │                           │                          │
    ├──update.download──────────┤                          │
    │                           ├──GET asset.zip───────────┤
    │←──progress SSE/WS─────────┤                          │
    │   (percent: 45, 72, 100)  │                          │
    │                           │                          │
    ├──update.stage─────────────┤                          │
    │                           │  SHA256校验               │
    │                           │  备份当前版本              │
    │                           │  解压到暂存目录             │
    │←──{phase: "ready"}───────┤                          │
    │                           │                          │
    ├──update.apply─────────────┤                          │
    │                           │  替换二进制                │
    │                           │  重启 Core               │
    │  [连接断开]               │  [Core 以 v0.7.0 启动]    │
    │  [重新连接]                │                          │
    │←──{version: "0.7.0"}─────┤                          │
```

### 2.5 需要改动的地方

| 改动 | 说明 |
|------|------|
| **Go Core 注入版本号** | `go build -ldflags "-X main.Version=0.6.0"`，当前 Core 对自己的版本一无所知 |
| **新增 release 源类型** | 当前只有 `git` 源类型，新增 `github` / `http` / `file` |
| **新增 Manifest 解析** | 解析标准 Manifest、缓存、对比版本号 |
| **新增 HTTP 下载器** | 带断点续传的下载、SHA256 校验 |
| **新增 Stage 管理器** | 备份当前版本、解压新版本、验证完整性 |
| **新增 Apply/Rollback** | 替换二进制、快照回滚 |
| **新增 HTTP REST 端点** | 在 server.go 中注册 `/api/update/*` |
| **App UI 更新面板** | 显示版本号、更新可用性、进度条、操作按钮 |

---

## 三、总结

**标准接口只有 6 个操作 + 1 个 Manifest 格式：**

```
check()    download()    prepare()    activate()    rollback()    status()

Manifest = { version, assets[{ platform, url, sha256 }] }
```

**在 SessionBridge 上的映射：**

```
平台操作              WS 命令                  HTTP 端点
─────────────────────────────────────────────────────────────
check()        →  update.check          →  GET  /api/update/check
download()     →  update.download       →  POST /api/update/download
prepare()      →  update.stage          →  POST /api/update/prepare
activate()     →  update.apply          →  POST /api/update/activate
rollback()     →  update.rollback       →  POST /api/update/rollback
status()       →  update.status         →  GET  /api/update/status
```

Manifest 更新源支持三种：`github` | `http` | `file`，与现有 `git` 模式共存。
