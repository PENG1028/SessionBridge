# 下载平台设计

> 个人自托管下载/更新平台
> 更新日期: 2026-06-02

---

## 一、定位

一个轻量服务，托管你所有项目的 release artifact，对外输出标准更新 Manifest。

```
角色                       职责
──────────────────────────────────────────────────────
下载平台 (server)          接受上传 → 管理版本 → 输出 Manifest
更新客户端 (Go Core/app)   拉取 Manifest → 下载 → 升级
CI/CD (GitHub Actions)     构建后自动上传到平台
管理员 (你)                 CLI/Web 管理发布
```

### 不是什么

- 不是包管理器 (npm/pip/apk)
- 不是容器仓库 (Docker Hub/GHCR)
- 不是对象存储 (S3/MinIO) — 虽然可以用这些做后端
- 只是一个 **Release 托管 + Manifest 生成器**

---

## 二、数据模型

三个实体，非常薄：

```
Project              Release              Asset
┌──────────┐         ┌────────────┐       ┌──────────────────┐
│ id       │ 1──N→   │ version    │ 1──N→ │ filename         │
│ name     │         │ semver     │       │ platform         │
│ createdAt│         │ channel    │       │ size             │
└──────────┘         │ prerelease │       │ sha256           │
                     │ notes      │       │ storage_path     │
                     │ createdAt  │       └──────────────────┘
                     └────────────┘
```

**Channel**: `stable` / `beta` / `canary`，决定客户端拉到哪个版本。

```
stable → 最高非 prerelease 的版本
beta   → 最高版本（含 prerelease）
canary → 最新上传的版本（哪怕没正式发布）
```

---

## 三、API 设计

### 3.1 公共 API — 供更新客户端调用

```
GET  /{project}/manifest.json                       → 最新 stable manifest
GET  /{project}/manifest.json?channel=beta          → 指定 channel
GET  /{project}/v{version}/manifest.json            → 指定版本
GET  /{project}/download/{asset_id}                 → 下载文件 → 302 或直接流
```

返回的 manifest 格式即之前定义的平台标准：

```json
{
  "version": "0.7.0",
  "publishedAt": "2026-06-01T12:00:00Z",
  "severity": "recommended",
  "releaseNotes": "https://github.com/.../releases/tag/v0.7.0",
  "changelog": "修复了什么...\n新增了什么...",
  "assets": [
    {
      "id": "1",
      "platform": "linux/amd64",
      "url": "https://update.example.com/sessionbridge/download/1",
      "size": 52428800,
      "sha256": "abcdef..."
    }
  ]
}
```

**客户端只需要配一个 base URL 就行了：**

```json
{ "type": "http", "url": "https://update.example.com/sessionbridge/manifest.json" }
```

### 3.2 管理 API — 供 CI/CLI 上传

```
# Projects
POST   /admin/projects                          → 创建项目
GET    /admin/projects                           → 列表
DELETE /admin/projects/{project}                 → 删除

# Releases
POST   /admin/{project}/releases                 → 创建 release
GET    /admin/{project}/releases                  → 列表
GET    /admin/{project}/releases/{version}        → 详情
DELETE /admin/{project}/releases/{version}        → 删除
PUT    /admin/{project}/releases/{version}/channel → 改 channel

# Assets (文件上传)
POST   /admin/{project}/releases/{version}/assets ← multipart upload
DELETE /admin/{project}/releases/{version}/assets/{id}
```

**创建 release 的请求体：**

```json
{
  "version": "0.7.0",
  "channel": "stable",
  "prerelease": false,
  "notes": "修复了 X，新增了 Y",
  "assets": [
    {
      "platform": "linux/amd64",
      "filename": "sessionbridge-v0.7.0-linux-amd64.zip",
      "size": 52428800,
      "sha256": "abcdef..."
    }
  ]
}
```

> 文件上传走 `multipart/form-data`，把 metadata (JSON) 和 binary 一起上传。

### 3.3 认证

管理 API 需要认证。最简单的方案：

```bash
Authorization: Bearer <平台管理员 Token>
```

Token 在启动时通过环境变量或配置文件设置。

---

## 四、存储设计

### 4.1 元数据 — SQLite

单文件数据库，零配置。表结构：

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    version TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'stable',
    prerelease INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(project_id, version)
);

CREATE TABLE assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id INTEGER NOT NULL REFERENCES releases(id),
    filename TEXT NOT NULL,
    platform TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_path TEXT NOT NULL  -- 文件系统路径或 S3 key
);
```

### 4.2 文件 — 文件系统或 S3

```
# 文件系统路径模式
data/
├── db.sqlite
└── files/
    ├── sessionbridge/
    │   ├── 0.6.0/
    │   │   └── sessionbridge-v0.6.0-linux-amd64.zip
    │   └── 0.7.0/
    │       └── sessionbridge-v0.7.0-linux-amd64.zip
    └── other-app/
        └── ...
```

可配置 `storage.driver = local | s3`。

---

## 五、部署方式

### 单二进制 (推荐)

```yaml
# config.yaml
server:
  addr: ":8080"
  admin_token: "your-token-here"

storage:
  driver: local
  path: ./data

# 也支持 S3:
# driver: s3
# bucket: my-update-files
# region: us-east-1
```

```bash
# 启动
./download-platform -config config.yaml
```

### Docker

```yaml
# docker-compose.yml
services:
  update-srv:
    image: download-platform
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    environment:
      ADMIN_TOKEN: "xxx"
```

---

## 六、CLI 工具 (release-cli)

```bash
# 创建一个项目
release-cli project create sessionbridge

# 推送一个 release
release-cli push sessionbridge v0.7.0 \
  --channel stable \
  --notes "Bug fixes and performance improvements" \
  --asset linux/amd64=./dist/sessionbridge-v0.7.0-linux-amd64.zip
  --asset windows/amd64=./dist/sessionbridge-v0.7.0-windows-amd64.zip

# 推送到 beta channel（预发布）
release-cli push sessionbridge v0.8.0-beta.1 \
  --channel beta \
  --prerelease \
  --asset linux/amd64=./build/sessionbridge-linux-amd64.zip

# 列出 release
release-cli list sessionbridge

# 改 channel
release-cli channel set sessionbridge v0.8.0 stable

# 删除
release-cli delete sessionbridge v0.7.0

# 认证
export UPDATE_PLATFORM_TOKEN="xxx"
export UPDATE_PLATFORM_URL="https://update.example.com"
```

---

## 七、跟 CI/CD 的配合

```
GitHub Actions → npm run build → release-cli push → 平台对外服务
```

```yaml
# .github/workflows/release.yml (简化)
steps:
  - run: npm run build
  - run: release-cli push sessionbridge v${{ github.ref_name }} \
      --channel stable \
      --asset linux/amd64=./dist/sessionbridge-v${{ github.ref_name }}-linux-amd64.zip
    env:
      UPDATE_PLATFORM_TOKEN: ${{ secrets.UPDATE_PLATFORM_TOKEN }}
      UPDATE_PLATFORM_URL: ${{ secrets.UPDATE_PLATFORM_URL }}
```

---

## 八、跟 SessionBridge 的关系

```
下载平台                 ← 新项目，独立部署
├── sessionbridge/       ← 一个 project
│   ├── v0.6.0           ← release
│   └── v0.7.0           ← release
├── looam/               ← 其他项目
└── nexorastack/
    └── ...

Go Core (update client)  ← 消费 Manifest
├── 配更新源: { type: "http", url: "https://update.example.com/sessionbridge/" }
├── update.check → GET /sessionbridge/manifest.json
└── update.download → GET /sessionbridge/download/{asset_id}
```

平台专注于一件事：**收文件 → 吐 Manifest**。不管客户端怎么更新、怎么回滚、怎么重启。
