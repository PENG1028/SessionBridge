# SessionBridge — Flutter 手机节点

SessionBridge 的移动/桌面 Flutter 客户端。当前代码正在从“直接 WebSocket 终端客户端”迁移到“本地 Node 服务 + WebView Dashboard”模式。

> 当前状态：Flutter 壳、WebView、设置页和通知服务骨架已存在；桌面端会尝试启动外部 relay/dashboard 二进制；移动端内嵌 Node 运行时尚未真正接入，仍属于开发中能力。

## 功能

- **内置 WebView 加载本地面板** — Flutter 内置 WebView，目标是加载本机 Dashboard，与 PC/服务器使用相同 UI
- **本地 Node 服务管理** — 桌面端当前通过外部 `relay-server`/`relay-server.exe` 二进制启动本地服务；移动端仍需接入真正的内嵌 Node runtime
- **本地通知服务** — 已接入 `flutter_local_notifications` 作为通知骨架

## 架构

目标形态下，手机节点会成为 SessionBridge 节点网络中的一等公民，与 PC、服务器节点运行相同的核心逻辑。当前 Flutter 代码还处在迁移阶段，移动端本机 NodeRuntime 尚未完成接入。

```
┌─────────────────────────────┐
│       VPS Relay Node        │
│  NodeRuntime                │
│  ├─ Relay HTTP/WS :8080     │
│  ├─ Dashboard :9843         │
│  └─ WS 中继服务             │
└─────────────────────────────┘
          ║          ║
          ║ WS+Crypto║
          ║          ║
┌──────────────────┐  ┌──────────────────┐
│  PC Node          │  │  手机 Flutter Node│
│  NodeRuntime      │  │  NodeRuntime      │
│  ├─ 本地面板      │  │  ├─ 内置 WebView │
│  ├─ Shell/Claude  │  │  └─ 通知服务     │
│  └─ RelayConnect  │  │  └─ RelayConnect │
└──────────────────┘  └──────────────────┘
```

目标体验是：手机通过内置 WebView 加载自己的本地面板，面板上显示 PC 节点上的 Shell/Claude 实例，并直接操控远程终端。当前这条链路仍需要补齐移动端 Node 启动、健康检查和端到端验证。

## 构建

```bash
flutter build apk --debug
# 产物: build/app/outputs/flutter-apk/app-debug.apk

flutter build apk --release
# 产物: build/app/outputs/flutter-apk/app-release.apk
```

## 开发

```bash
flutter run          # 连接模拟器或真机运行
flutter test         # 运行测试
```

## 依赖

| 包 | 用途 |
|----|------|
| `webview_flutter` | 内置 WebView 加载本地面板 |
| `webview_flutter_wkwebview` | iOS/macOS WebView 实现 |
| `flutter_local_notifications` | 本地通知推送 |
| `shared_preferences` | 设置持久化 |
| `path_provider` | 应用支持目录与本地二进制定位 |
