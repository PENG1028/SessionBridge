# Example: Node Monitor 插件

> 纯后台监控插件 — 展示 daemon-only adapter、跨节点检查、共享依赖保护

---

## 概述

Node Monitor 是一个纯后台插件，**没有 UI 也没有 CLI**。它通过 daemon adapter 定期执行节点健康检查，通过 Webhook adapter 接收外部告警推送。展示了"零 UI 插件"的完整生命周期。

## Manifest

```yaml
manifestVersion: "1"
id: node-monitor
name: Node Monitor
version: 1.0.0
type: plugin
trusted: false
description: Multi-node health monitoring with alerting

core:
  permissions:
    - id: node-monitor.read
      description: Read node health metrics
      capabilities:
        - node.list
        - node.get
        - node.health
      default: allow

    - id: node-monitor.alert
      description: Send notifications on threshold breach
      capabilities:
        - notify.list
      default: allow

    - id: node-monitor.remote-check
      description: Execute health checks on remote nodes
      capabilities:
        - node.health
      default: ask
      constraints:
        targetNodes:
          - node_vps

  environment:
    checks:
      - id: curl
        type: binary
        required: true
        command: curl
      - id: jq
        type: binary
        required: false
        command: jq

  files:
    data: "${plugin.dataDir}"
    logs: "${plugin.logsDir}"
    declarations:
      - id: check-results
        path: "${plugin.dataDir}/checks"
        description: "Health check result history"
        clearable: true
        risk: low
      - id: alert-state
        path: "${plugin.dataDir}/alerts.json"
        description: "Current alert state"
        clearable: false

  caches:
    - id: metrics-cache
      paths:
        - "${plugin.cacheDir}/metrics"
      clearable: true
      clearMode: delete-path
      risk: low
      owner: plugin

  tasks:
    - id: node-monitor.health-check
      capability: plugin.check
      planRequired: false
      risk: low
    - id: node-monitor.install-deps
      capability: plugin.install.execute
      planRequired: true
      risk: medium

  history:
    defaultPolicy: disk

adapters:
  daemon:
    tasks:
      - id: node-monitor.check-local
        interval: "5m"
        capability: node.health
        timeout: "10s"
        onFailure: notify

      - id: node-monitor.check-vps
        interval: "5m"
        capability: node.health
        payload:
          nodeId: node_vps
        timeout: "15s"
        onFailure: notify

      - id: node-monitor.cache-cleanup
        interval: "6h"
        capability: plugin.cache.clear.plan
        payload:
          pluginId: node-monitor
          cacheId: metrics-cache
        timeout: "30s"
        onFailure: notify

  webhook:
    endpoints:
      - path: "/webhooks/node-monitor/alert"
        method: POST
        capability: node-monitor.alert
        auth:
          type: token
      - path: "/webhooks/node-monitor/status"
        method: GET
        capability: node.health
        auth:
          type: token
```

## 核心设计

### 纯后台插件的特点

| 特性 | 说明 |
|------|------|
| 无 adapters.systemUi | 不在 System UI 注册任何视图/面板/命令 |
| 无 adapters.cli | 不在 CLI 注册任何命令 |
| 有 adapters.daemon | Core 调度两个定期任务（local + VPS 各 5 分钟） |
| 有 adapters.webhook | 外部监控系统可通过 Webhook 推送告警 |

### 跨节点健康检查

插件利用 Core 的节点路由能力，对 local 和 VPS 分别配置 daemon task：

```
node-monitor.check-local → capability: node.health → targetNodeId: "" (本机)
node-monitor.check-vps   → capability: node.health → targetNodeId: "node_vps"
```

两个任务各自独立超时和失败策略：
- Local 检查超时 10s，失败后 notify
- VPS 检查超时 15s（网络延迟补偿），失败后 notify

### 权限最小化

| Permission | Default | 理由 |
|-----------|---------|------|
| `node-monitor.read` | allow | 读节点指标是核心功能，不需要每次询问 |
| `node-monitor.alert` | allow | 发送通知无风险 |
| `node-monitor.remote-check` | ask | 跨节点操作需要用户知情 |

### 共享依赖保护

插件使用 `curl` 和 `jq`，这两个是系统工具而非插件安装的依赖：
- Core 不尝试卸载它们
- `curl` 标记为 required，安装前如果缺失提示用户安装
- `jq` 标记为 optional，缺失时降级运行

### 缓存自动清理

`node-monitor.cache-cleanup` daemon task 每 6 小时自动清理 metrics 缓存。清理走 `plugin.cache.clear.plan` 流程，Core 生成计划后执行。

---

## 验证要点

- [ ] Manifest 校验：daemon + webhook 声明格式正确
- [ ] 环境检测：curl 存在性检查，jq 缺失时降级
- [ ] 权限 Grant：remote-check 权限在 VPS 上独立校验
- [ ] Daemon 任务调度：check-local / check-vps 每 5 分钟执行
- [ ] Daemon 超时：VPS 检查 15s 超时机制生效
- [ ] Daemon 失败处理：超时后 notify 发送
- [ ] Webhook 端点：POST /webhooks/node-monitor/alert 可访问
- [ ] 缓存清理：6 小时定时清理 metrics-cache
- [ ] 卸载安全：没有共享依赖被误删
