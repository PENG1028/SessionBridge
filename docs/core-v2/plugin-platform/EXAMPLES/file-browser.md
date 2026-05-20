# Example: File Browser 插件

> 文件浏览器插件 — 展示 systemUi-only adapter、路径约束权限、缓存声明的典型用法

---

## 概述

File Browser 是一个纯 UI 插件，仅通过 systemUi adapter 提供文件浏览视图。它没有 CLI 也没有 daemon 任务，展示了插件可以只贡献 UI 而不注册 CLI 命令或后台任务。

## Manifest

```yaml
manifestVersion: "1"
id: file-browser
name: File Browser
version: 1.0.0
type: plugin
trusted: false
description: Browse and preview workspace files

core:
  permissions:
    - id: file-browser.read
      description: Read workspace files for preview
      capabilities:
        - fs.read
        - fs.list
        - fs.stat
        - fs.exists
      default: allow
      constraints:
        paths:
          allow:
            - "${workspace}/**"
          deny:
            - "**/.env"
            - "**/node_modules/**"
            - "**/.git/**"

    - id: file-browser.search
      description: Search file contents
      capabilities:
        - fs.read
      default: ask
      constraints:
        paths:
          allow:
            - "${workspace}/src/**"
            - "${workspace}/docs/**"

  environment:
    checks:
      - id: workspace-exists
        type: env
        env: BRIDGE_WORKSPACE_ROOT

  files:
    cache: "${plugin.cacheDir}"
    declarations:
      - id: thumbnail-cache
        path: "${plugin.cacheDir}/thumbnails"
        description: "File thumbnail/image cache"
        clearable: true
        risk: low
      - id: file-metadata
        path: "${plugin.cacheDir}/metadata.json"
        description: "Directory listing metadata cache"
        clearable: true
        risk: low

  caches:
    - id: thumbnail-cache
      paths:
        - "${plugin.cacheDir}/thumbnails"
      clearable: true
      clearMode: delete-path
      risk: low
      owner: plugin

    - id: metadata-cache
      paths:
        - "${plugin.cacheDir}/metadata.json"
      clearable: true
      clearMode: delete-path
      risk: low
      owner: plugin

  history:
    defaultPolicy: memory

adapters:
  systemUi:
    views:
      - id: file-browser.explorer
        surface: main.sidebar
        type: custom-react
        entry: ./web/ExplorerView.tsx
        title: "Files"

      - id: file-browser.preview
        surface: main.editor
        type: custom-react
        entry: ./web/PreviewView.tsx
        title: "Preview"

    panels:
      - id: file-browser.properties
        surface: main.editor.bottom
        type: custom-react
        entry: ./web/PropertiesPanel.tsx
        title: "Properties"

    configuration:
      - id: file-browser.hidden-files
        title: "Show Hidden Files"
        description: "Display dotfiles in file tree"
        type: boolean
        default: false
      - id: file-browser.file-limit
        title: "File Listing Limit"
        description: "Max files per directory listing"
        type: number
        default: 1000

    commands:
      - id: file-browser.reveal
        title: "Reveal in File Browser"
        command: file-browser.explorer.reveal
      - id: file-browser.search-files
        title: "Search Files"
        command: file-browser.search
        keys: "ctrl+shift+f"

    menus:
      - id: file-browser.editor-tab-context
        title: "File Browser"
        items:
          - command: file-browser.reveal
            label: "Reveal in Sidebar"
            when: "editor.hasFocus"
```

## 核心设计

### systemUi-only 插件特征

| 特性 | 说明 |
|------|------|
| 无 adapters.cli | 不注册任何 CLI 命令 |
| 无 adapters.daemon | 没有后台任务 |
| 无 adapters.webhook | 没有外部 HTTP 入口 |
| 有 adapters.systemUi | Explorer 视图、Preview、Properties 面板 |

这使得 File Browser 的安装和运行非常轻量：Core 只需校验 manifest、登记文件路径，无需管理后台进程。

### 路径约束

```
paths:
  allow: ["${workspace}/**"]
  deny:
    - "**/.env"          # 禁止读取环境变量文件
    - "**/node_modules/**"  # 禁止浏览依赖目录
    - "**/.git/**"       # 禁止暴露 Git 元数据
```

路径约束在 manifest 声明后，Core 权限系统在每次 `fs.read` 调用时校验：
- 允许读取 `${workspace}/src/main.ts` → 通过
- 允许读取 `${workspace}/.env` → 被 deny 规则拦截
- 尝试读取 `/etc/passwd` → 不在 allow 范围内，拦截

### 搜索权限

`file-browser.search` 使用 `default: ask`，因为搜索涉及读取文件内容（即使只是 src 和 docs 目录）。用户每次搜索时 Core 询问确认。

### 缓存策略

两个独立缓存：
- **thumbnail-cache**：文件缩略图，delete-path 安全清理
- **metadata-cache**：目录元数据，delete-path 安全清理

两者都是 `risk: low` + `owner: plugin`，Core 可以安全地自动清理。

### 为什么没有 daemon

File Browser 是事件驱动的：文件浏览发生在用户操作时。不需要后台轮询。如果将来需要文件变更监听，可以添加 daemon task 使用 `fs.watch` 能力。

---

## 验证要点

- [ ] Manifest 校验：路径约束格式正确，无危险能力声明
- [ ] 权限校验：`fs.read` 调用受 path allow/deny 约束
- [ ] 禁止读取 `.env`：实际测试确认被拦截
- [ ] 禁止读取 `node_modules`：实际测试确认被拦截
- [ ] 搜索权限：每次搜索触发 ask 确认
- [ ] System UI 渲染：Explorer 在 sidebar 正确显示
- [ ] Preview 视图：文件点击后正确预览
- [ ] 缓存清理：thumbnail-cache / metadata-cache 可安全清理
- [ ] 无 CLI 命令：`file-browser` 不在 CLI 命令列表中
- [ ] 无 daemon 进程：ps 确认无后台进程
