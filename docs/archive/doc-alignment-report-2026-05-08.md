# 文档对齐小报告

> 日期: 2026-05-08
> 范围: 只对齐文档，不修改实现代码。

## 这次对齐了什么

1. **端口模型**

   当前实现不是“一个 `8080` 端口承载所有东西”。`NodeRuntime` 默认会启动两个服务：

   - Relay: `8080`，负责 HTTP/API/WebSocket 中继。
   - Dashboard: `9843`，负责本地管理面板。

   已同步更新 `README.md`、`docs/development.md`、`docs/architecture.md`、`flutter_app/README.md` 中把 Dashboard 写成 `localhost:8080` 或 `Web UI :8080` 的地方。`design-overview.md` 后续已并入主架构文档。

2. **对外访问能力**

   之前文档把“面板一键对外暴露、本机和远程节点均可操作”写成了完成态。当前代码实际状态是：

   - 本机 `/api/node/external` 已存在，可做网络检测并切换 `dashboardBind`。
   - `node.external.inspect/set/status` 协议与 relay 转发已存在。
   - 完整前端入口、远程节点端到端体验和状态展示仍在收口中。

   已把相关表述改成“部分实现 / 开发中”，避免读者误以为这是稳定能力。

3. **Flutter 客户端状态**

   之前 `flutter_app/README.md` 仍混有旧的直接 WebSocket 客户端依赖和完成态描述。当前 Flutter 代码更接近“本地 Node 服务 + WebView Dashboard”的迁移中状态：

   - WebView、设置页、通知服务骨架已存在。
   - 桌面端会尝试启动外部 relay/dashboard 二进制。
   - 移动端内嵌 Node runtime 尚未真正接入。

   已更新依赖列表和功能描述，去掉已经删除的 `web_socket_channel`、`cryptography` 等旧路径表述。

4. **会话恢复语义**

   `SessionPersistence` 的设计语义是：进程重启后恢复出的实例应视为 `stopped`，因为原 OS 进程已经退出。但当前 `NodeRelayServer.start()` 会把恢复实例标成 `running`。

   文档现在明确标出这是“已知不一致”，而不是把它描述成完全完成的恢复能力。

## 仍建议后续处理

- 修正恢复实例被标记为 `running` 的实现，否则 UI 会出现“假活着”的实例。
- 为 Flutter 启动链路增加健康检查，而不是依赖 stdout 文案判断 ready。
- 把 `node.external.*` 的前端入口、请求/响应状态和错误路径补齐后，再把对外访问文档从“开发中”改成“已完成”。
- 如果继续保留 Dashboard 代理未知 `/api/*` 到 Relay 的模式，建议在架构文档里补一张更精确的数据流图。
