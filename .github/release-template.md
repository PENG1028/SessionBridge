## 下载

| 平台 | 文件 | 说明 |
|------|------|------|
| Linux x64 | `sessionbridge-*.zip` | 便携包，内含 Go Core 二进制 + Next.js 构建 (.next/)，需要 Node.js >= 18 |

## 更新

```bash
# 自动检查并更新
bridge update

# 或手动
npm run update
```

## 使用

```bash
# 解压后
node bin/bridge.js          # 启动 Go Core

# 启动 Web UI（Next.js production）
node bin/bridge.js web      # → http://localhost:3000

# 环境变量
# LISTEN_ADDR=0.0.0.0:8080  (默认 127.0.0.1:8080)
# SESSIONNODE_TOKEN=         (空 = dev mode, 无认证)
```

---

> Go Core 是唯一运行时。旧 Node relay 已退役。
> 详细更新日志见下方自动生成的 Release Notes。
