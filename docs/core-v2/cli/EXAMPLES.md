# CLI Examples

> CLI 命令的完整使用示例

---

## 基本命令

```bash
# 查看帮助
node plugin --help
node plugin claude --help

# 列出插件
node plugin list
node plugin list --json

# 插件详情
node plugin show claude-code
```

## 带参数的命令

```bash
# 位置参数
node plugin claude start ./project

# 命名选项
node plugin claude start --target node_vps

# 多个参数 + 选项
node plugin claude query ./src --limit 50 --format json --target node_vps
```

## 输出格式

```bash
# 默认 text
node plugin claude list

# JSON
node plugin claude list --format json

# Table
node plugin claude list --format table

# 流式输出
node plugin claude start ./project
```

## 目标节点

```bash
# 本机（默认）
node plugin claude start ./project

# 显式本机
node plugin claude start ./project --local

# 远程节点
node plugin claude start ./project --target node_vps
```

## 危险操作与审批

```bash
# 交互式审批（TTY）
node plugin claude start ./project

# 脚本中使用（预先批准）
node plugin claude start ./project --approve

# 预览 plan 不执行
node plugin install claude-code --dry-run

# 非 TTY + 无 --approve → 被拒绝
# 在 CI 中运行：
node plugin cache clear claude-code --entry plugin-cache
# → Error: Approval required. Use --approve to proceed
```

## 插件生命周期

```bash
# 环境检测
node plugin check claude-code
node plugin check claude-code --target vps

# 安装（Plan Before Apply）
node plugin install claude-code              # 生成 plan → 确认 → 执行
node plugin install claude-code --dry-run    # 只生成 plan，不执行
node plugin install claude-code --target vps # 远程安装

# 安装历史
node plugin history claude-code
node plugin history claude-code --verbose
node plugin logs claude-code --install inst_001

# 启用/禁用
node plugin enable claude-code
node plugin disable shell
```

## 缓存管理

```bash
# 查看缓存
node plugin cache claude-code
node plugin cache claude-code --category cache
node plugin cache claude-code --category shared

# 清理（Plan Before Apply）
node plugin cache clear claude-code                       # 生成 plan → 确认
node plugin cache clear claude-code --dry-run             # 只预览
node plugin cache clear claude-code --entry plugin-cache  # 指定缓存

# 高风险清理（共享依赖）
node plugin cache clear claude-code --category shared --risk high
```

## 权限管理

```bash
# 查看权限
node plugin permissions claude-code

# 授权（危险操作，需审批）
node plugin grant claude-code fs.read
node plugin grant claude-code fs.write --path '${workspace}/**'
node plugin grant claude-code process.spawn --mode ask

# 撤销
node plugin revoke claude-code fs.write
```

## 配置管理

```bash
# 读取配置
node plugin config get claude-code
node plugin config get claude-code defaultModel

# 写入配置
node plugin config set claude-code defaultModel sonnet
```

## Service Token 调用

```bash
# 以 Service Token 身份调用
node --token s3cr3t plugin list
node --token s3cr3t api call capability "session.list" '{}'

# Token 限制：不能调插件管理 API
node --token s3cr3t plugin install claude-code
# → Error: Service token does not have plugin.install permission
```

## 组合示例

### 完整工作流：安装并配置 Claude Code

```bash
# 1. 检查环境
node plugin check claude-code
# → missing: claude CLI

# 2. 安装（Plan → Approve → Execute）
node plugin install claude-code
# → Plan: npm install -g @anthropic-ai/claude-code (risk: medium)
# → 确认？y
# → Installing... done

# 3. 授权权限
node plugin grant claude-code process.spawn

# 4. 启用
node plugin enable claude-code

# 5. 启动
node plugin claude start ./project
```

### 远程操作

```bash
# 在 VPS 上检查插件
node plugin check claude-code --target node_vps

# 在 VPS 上安装
node plugin install claude-code --target node_vps --dry-run
node plugin install claude-code --target node_vps

# 在 VPS 上启动
node plugin claude start ./project --target node_vps
```
