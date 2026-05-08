# SessionBridge 术语表

> 最后更新: 2026-05-06

## 一、术语定义

| 中文 | English | 代码映射 | 定义 |
|------|---------|----------|------|
| 节点 | **Node** | `NodeRuntime` (`adapters/agent-core/node-runtime.ts`) | 一台运行 SessionBridge 的设备（PC/手机/服务器）。所有 Node 运行相同的核心代码，每个 Node 提供仅供本地使用的 Dashboard 面板 |
| 面板 | **Dashboard** | `dashboard-server.ts` + Next.js UI | 每个 Node 在 `127.0.0.1:9843` 提供的统一 Web UI。默认仅供本地使用；当前实现包含本机网络检测与 `dashboardBind` 切换接口，远程节点的一键对外访问仍在收口中。面板显示 relay 已知实例，可直接操控已连接远程 Node 上的进程 |
| 中继 | **Relay** | `NodeRelayServer` (`src/relay-server.ts`) | 一种 Node 角色，提供 WebSocket 中继服务。Node 之间通过 Relay 通信，但 Relay 本身对上层透明 |
| 显示区 | **Stage** | `app/page.tsx` `<main>` 区域 | 浏览器主视口中央的固定区域。容纳多个 Scene 以 Tab 形式组织。支持全屏/行列/网格布局 |
| 场景 | **Scene** | `activeInstanceId` → `adapterToViewId` → View Component | Stage 内的一个 Tab。绑定到一个 Instance，可拖拽分屏、切换布局模式 |
| 面板 | **Panel** | `LeftSidebar` / `RightSidebar` / 底部抽屉 / 悬浮窗 | 外围配置区域。位置由插件声明：左/右/底部/悬浮/长按菜单 |
| 插件 | **Plugin** | `adapters/` 目录 | 定义：① Stage 里的显示组件（View）；② 专属配置面板列表（Panels） |
| 实例 | **Instance** | `InstanceData` (`src/instance-manager.ts`) | 一个运行中的进程。每个 Scene 背后有一个 Instance |
| 终端 | **Terminal** | `ShellAdapter` + `TerminalView` | 运行 bash/pwsh 的交互式命令行。插件的一种，最通用的内置插件 |
| 工作区 | **Workspace** | 目录路径 | Instance 绑定的工作目录 |

## 二、用户视角 ↔ 代码映射

```
用户看到           → 代码在哪里
─────────────────────────────────────
浏览器页面         → next.js 渲染 app/page.tsx
Stage 主显示区     → <main> 元素（page.tsx ~行 1000+）
Scene Tab 切换     → InstanceTabBar 组件（click 触发 activateInstance）
面板（侧栏）       → LeftSidebar / RightSidebar 组件
右键菜单           → ContextMenu 组件（handleCtx 函数生成条目）
用户输入           → enqueueInput() → 队列 → sendStdin() → 进程 stdin
用户看到输出       → shell.output 给 ShellTerminal / instance.block 给聊天
页面底部状态栏     → StatusBar 组件
手机侧栏（抽屉）   → MobileSidebar 组件
```

## 三、相关文件

架构拓扑、节点关系和访问方式统一维护在 [architecture.md](./architecture.md)，避免术语表和架构文档重复漂移。

| 文件 | 说明 |
|------|------|
| `adapters/types.ts` | 核心类型定义（Adapter/Instance/Panel/Scene） |
| `adapters/registry.ts` | 适配器注册表 |
| `app/console/main/view-registry.ts` | adapterId → view 组件映射 |
| `app/console/main/adapter-view.tsx` | 根据 viewId 渲染对应的 View |
| `app/console/sidebar/left-sidebar.tsx` | 左侧面板 |
| `app/console/sidebar/right-sidebar.tsx` | 右侧面板 |
| `app/console/sidebar/mobile-sidebar.tsx` | 移动端侧栏 |
| `src/instance-manager.ts` | 实例管理器 |
| `adapters/shell/index.ts` | Shell 适配器实现 |
| `adapters/claude-code/` | Claude Code 适配器 |
