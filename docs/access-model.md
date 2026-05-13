# Access Model — 访问模式

## 两种访问方式

| 方式 | 连接方式 | 是否需要 auth | 说明 |
|------|---------|-------------|------|
| **本地管理面板** | 本机浏览器 `http://localhost:8080` | 否（localhost 绕过） | 等同管理员控制台 |
| **远程访问** | 浏览器打开远程服务器 `http://<ip>:8080` | 是 | 需认证，认证后全功能 |

browser 不是网络 peer。peer 列表只描述网络节点（agent）之间的拓扑关系。

## 详细说明

### 本地管理面板

- HTTP 来源 IP 为 `127.0.0.1` / `::1` / `localhost`
- 绕过所有 auth 检查
- 本机无 `bridge` 进程时仅能看 UI，操作需要本机 relay

### 远程访问

- 浏览器打开远程服务器 IP + 端口
- 需要 admin auth：
  - **首次访问无密码节点**：要求设置访问密钥（页面 `/setup`）
  - **后续访问**：需要输入密钥登录（页面 `/login`）
- 认证通过后可操作远程节点（Enter、shell 等）
- 未来可做细粒度权限限制

## 身份标记

| 字段 | 值 | 含义 |
|------|----|------|
| `type` | `agent` | bridge 进程连接，网络节点 |
| `type` | `browser` | 浏览器连接（仅作传输通道，非网络 peer） |
| `role` | `relay` | 中继节点，有公网地址 |
| `role` | `leaf` | 叶子节点，无公网，向上连 relay |

**浏览器不是网络 peer。** peer 列表只描述网络节点（agent）之间的拓扑关系；浏览器连接仅用于 HTTP/WebSocket 传输层，不在网络拓扑中表示。

## 组合示例

| 场景 | 你本机 | 远程服务器 | 本机身份 | 能做什么 |
|------|--------|-----------|---------|---------|
| 本机浏览器打开 localhost:8080 | 跑着 bridge --relay | — | 本地管理员 | 一切 |
| 手机浏览器打开远程 IP:8080 | 未启动 bridge | 跑着 bridge --relay | 远程访问 | 需登录，登录后全功能 |
| 本机 bridge --upstream 连远程 | 跑着 bridge | 跑着 bridge --relay | Node (leaf) | 本机 node 面板操作远程节点 |
| 本机浏览器 + bridge --upstream | 跑着 bridge | 跑着 bridge --relay | 本地管理员 + Node | 通过本机 node 面板操作远程 |
