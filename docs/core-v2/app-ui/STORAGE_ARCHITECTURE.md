# 存储架构：UI 与 Core 的状态分界

> 当前版本 — 2026-06-06

---

## 核心原则

| 维度 | Core (`~/.sessionnode/`) | UI Server (`~/.sessionbridge/`) | Browser (`localStorage`) |
|------|-------------------------|-------------------------------|-------------------------|
| 谁管理 | Go Core 进程 | Next.js 服务端 | 浏览器 |
| 依赖 Core 运行 | 自身 | 不依赖（Core 启动前可读写） | 不依赖 |
| 跨浏览器持久 | ✅ | ✅ | ❌ 清缓存丢失 |
| 服务端可读写 | ✅ | ✅ | ❌ |
| 作用域 | 机器级 | 机器级 / 用户级 | 浏览器实例级 |

---

## 目录结构

```
~/.sessionnode/                        ← Go Core 管理
├── config.json                        Core 自身配置（listenAddr, node.mode, plugin.permissions...）
├── trusted_peers.json                 信任节点（ed25519）
├── sessions/                          Session 历史
├── downloads/                         下载工件
└── plugins/{id}/                      各插件数据/状态/日志

~/.sessionbridge/                      ← Next.js 服务端管理
├── server-state.json                  机器级：Core binary 路径、最后端口等
├── installed-apps.json                机器级：插件安装软件追踪
├── install-history.json               机器级：安装操作日志
├── app-ui-auth.json                   机器级：认证配置
└── users/
    └── system/                        ← 当前单用户（"system"），多用户时加 users/{id}/
        └── app-state.json             用户级：插件启用/禁用、权限授予

localStorage                           浏览器
├── sb-instance-layouts                工作区布局
├── sb-path-bookmarks-*                文件书签
├── bridge-runtime-policies            运行时策略
├── bridge-messages                    消息缓存
└── ...                                纯 UI 偏好
```

---

## 文件归属判断

判断一个状态应该放哪，按以下优先级问：

1. **Core 没启动时需要读到吗？**
   - 需要 → `~/.sessionbridge/`（UI Server）
   - 不需要 → 看第 2 问

2. **是机器级还是用户级？**
   - 机器级（二进制路径、已安装软件、认证）→ `~/.sessionbridge/` 根目录
   - 用户级（插件启用/权限、连接偏好）→ `~/.sessionbridge/users/{id}/`

3. **是显示偏好，且不需要服务端读到？**
   - 是 → `localStorage`
   - 否 → 回到第 1 问

---

## 多用户扩展

当前 `users/system/` 下的内容，未来按此结构拆分：

```
~/.sessionbridge/
└── users/
    ├── system/                         ← 现在的默认用户（向后兼容）
    │   └── app-state.json
    ├── admin/                          ← 未来多用户例子
    │   └── app-state.json
    └── zhangsan/
        └── app-state.json
```

只需要增加 `users/{id}/` 目录和对应的 API，无需改动机器级文件。

---

## 避免踩坑

| 坑 | 原因 | 当前状态 |
|----|------|---------|
| `app-state.json` 放在机器级根目录 | 权限授予是用户级的，不是全系统共享 | ✅ 已迁移到 `users/system/` |
| `.sessionbridge/` 放项目根目录 | 随部署可能会被清空，无法持久化 | ✅ 已迁移到 `~/.sessionbridge/` |
| `localStorage` 存权威状态 | 清缓存丢失，且服务端无法读取 | ✅ 已有 data-boundary.test.ts 约束 |
| Core binary 路径存 `localStorage` | 服务端 spawn Core 时读不到 | ✅ 存 `server-state.json` |
