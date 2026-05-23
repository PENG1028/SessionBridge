# SessionNode v2 — Mobile 线框图

---

## Purpose

移动端外壳和交互模式。手机浏览器自适应布局，Surface 映射，触摸交互。

---

## Entry

- 手机浏览器访问 System UI 地址
- 响应式断点 < 768px 自动切换
- 桌面端可手动切换移动预览模式

---

## Mobile Shell

```
┌──────────────────────┐
│  StatusBar           │
│  10:32  WiFi ●●●     │
├──────────────────────┤
│  Header              │
│  [Menu]  Dashboard   │
│  [Notification ● 3]  │
├──────────────────────┤
│                       │
│  Fullscreen           │
│  Content Area         │
│  (Current Page)       │
│                       │
│                       │
│                       │
│                       │
├──────────────────────┤
│  Bottom Navigation    │
│                       │
│  [icon: home] [Sessions]     │
│  [Logs] [Plugins]    │
│  [Settings]           │
└──────────────────────┘
```

---

## Bottom Navigation

```
┌──────────────────────┐
│                       │
│  (active page content)│
│                       │
│                       │
├──────────────────────┤
│  ┌──────┐ ┌──────┐  │
│  │ icon: home    │ │Sess..│  │
│  │      │ │      │  │
│  │Dashbd│ │Session│  │
│  └──────┘ └──────┘  │
│  ┌──────┐ ┌──────┐  │
│  │ icon: scroll-text   │ │ icon: plug   │  │
│  │      │ │      │  │
│  │ Logs │ │Plgins│  │
│  └──────┘ └──────┘  │
│  ┌──────┐           │
│  │ icon: settings   │           │
│  │      │           │
│  │Sett..│           │
│  └──────┘           │
└──────────────────────┘

Tab 定义:

| Tab | Page | 徽章 |
|-----|------|------|
| icon: home Dashboard | 总览 | — |
| Sessions | 会话列表 | 活跃数 |
| Logs | 日志/审计 | 新错误数 |
| Plugins | 插件列表 | 待更新数 |
| icon: settings Settings | 设置 | — |

底部导航为移动端独占，桌面端使用侧边栏。
```

---

## Mobile Surface Mapping

```
Desktop Surface          →  Mobile Surface
─────────────────────────────────────────────
main.editor              →  mobile.fullscreen
main.editor + right drawer →  mobile.fullscreen + bottom sheet
panel.detail             →  mobile.sheet (从底部滑出)
notification.center      →  mobile.fullscreen (全屏)
settings.page            →  mobile.fullscreen (全屏 + 子页导航)
plugin.detail            →  mobile.fullscreen (全屏 tab 页)
plugin.detail.permissions →  mobile.sheet (底部滑出)
modal                    →  mobile.fullscreen (全屏弹窗)
context menu             →  mobile.sheet (底部操作表)
tooltip/hover             →  点击弹出气泡 (touch tooltip)

示例映射流程 (Session Detail on mobile):

桌面端:
  main.editor            +  right drawer
  ┌──────────────────┐   ┌──────────────┐
  │  Session List    │   │  Detail      │
  │  [item] [item]   │   │  ID, status  │
  └──────────────────┘   └──────────────┘

移动端:
  mobile.fullscreen        +  bottom sheet
  ┌──────────────────┐
  │  Session List    │      点击 > 打开
  │  [item]          │
  │     >            │      ┌──────────┐
  │  [item]          │      │ Detail   │
  │     >            │      │ ID, stat │
  │  [item]          │      │ [Close]  │
  │     >            │      └──────────┘
  └──────────────────┘
```

---

## Drawer / Sheet / Fullscreen Patterns

```
Bottom Sheet (详情、权限、文件):

┌──────────────────────┐
│  Session Detail      │
│  ── drag handle ──  │
│                       │
│  ID: sess_abc         │
│  Status: ● running    │
│  Kind: claude-code    │
│                       │
│  ── Streams ──       │
│  stdout   active     │
│  stderr   active     │
│                       │
│  [Close]  [Action]    │
└──────────────────────┘

Fullscreen (主页面、审批详情):

┌──────────────────────┐
│  [←] Plugin Detail   │
├──────────────────────┤
│                       │
│  [Overview] [Env]    │
│  [Perms] [Files]     │
│                       │
│  (tab content)        │
│                       │
│                       │
├──────────────────────┤
│  [Disable] [Repair]   │
└──────────────────────┘

Action Sheet (操作菜单):

┌──────────────────────┐
│                       │
│  Actions for sess_abc │
│                       │
│  ┌──────────────────┐│
│  │  View Stream     ││
│  ├──────────────────┤│
│  │  Stop Session    ││
│  ├──────────────────┤│
│  │  Copy ID         ││
│  ├──────────────────┤│
│  │  View Detail     ││
│  └──────────────────┘│
│                       │
│  [Cancel]             │
└──────────────────────┘
```

---

## Mobile Wireframe — Session Stream

```
┌──────────────────────┐
│  Stream    [←] [icon: pause]  │
├──────────────────────┤
│                       │
│  $ claude -p "explain"│
│  ──────────────────── │
│  I'll analyze code...  │
│                       │
│  [Thinking...]        │
│  ├── processes input  │
│  ├── validates format │
│  └── transforms data  │
│                       │
│  [Tool Use: Read]     │
│  Reading: /src/main.go│
│                       │
│  ■ (live cursor)      │
│                       │
├──────────────────────┤
│ [Stop]  [Input...   ] │
└──────────────────────┘
```

---

## Mobile Wireframe — Approval Flow

```
Step 1: Notification arrives
┌──────────────────────┐
│  icon: bell                   │
│  claude-code needs   │
│  approval: execute   │
│  rm -rf /data        │
│                       │
│  [Approve] [Deny]    │
└──────────────────────┘

Step 2: Open fullscreen detail
┌──────────────────────┐
│  [←] Approval Detail │
├──────────────────────┤
│  Plugin: claude-code │
│  Session: sess_abc   │
│  剩余: 32s           │
│                       │
│  执行命令:             │
│  rm -rf /data         │
│                       │
│  icon: alert 风险: 高风险       │
│  递归删除 /data       │
│  不可撤销              │
│                       │
│  ── Context ──       │
│  CWD:  /data         │
│  Node: node-main     │
│                       │
│  [Deny]  [Approve]   │
└──────────────────────┘
```

---

## Mobile Wireframe — Settings Navigation

```
┌──────────────────────┐
│  Settings     [←]    │
├──────────────────────┤
│                       │
│  > General            │
│  > Core               │
│  > Node               │
│  > Plugins            │
│  > Access Control     │
│                       │
├──────────────────────┤
│ [Home] [...] [Sett..] │
└──────────────────────┘

点击某项进入子页:

┌──────────────────────┐
│  Core         [←]    │
├──────────────────────┤
│                       │
│  host.name            │
│  [node-main    ]     │
│                       │
│  host.port            │
│  [8080         ]     │
│                       │
│  log.level            │
│  [info ▾]            │
│                       │
│  ── Advanced ──      │
│  crypto.enabled       │
│  [x]                  │
│                       │
│  [Reset]  [Save]      │
└──────────────────────┘
```

---

## Touch Ergonomics

```
触摸友好设计规则:

1. 按钮/可点击区域 ≥ 44x44px
   ┌──────────────┐
   │  44px         │
   │  [Approve]   │
   │               │
   └──────────────┘

2. 列表项左滑显示操作
   ┌──────────────────┐
   │  sess_abc        │
   │  claude-code      │ ← swipe left
   ├──────────────────┤
   │  [Stop] [Copy]   │ ← revealed actions
   └──────────────────┘

3. 底部 sheet 半屏拉起
   ┌──────────────────┐
   │  ↑ Drag up       │
   │  ──────────────  │ ← drag handle
   │  Sheet Content   │
   │  scrollable      │
   └──────────────────┘

4. 长按显示上下文菜单
   ┌──────────────────┐
   │  sess_abc        │ ← long press
   ├──────────────────┤
   │  ┌──────────┐   │
   │  │ Copy ID  │   │ ← context menu
   │  │ Stop     │   │
   │  │ Detail   │   │
   │  └──────────┘   │
   └──────────────────┘
```

---

## States

- **loading**: 页面 skeleton
- **empty**: 空状态 + 引导（桌面版相同内容，但更紧凑）
- **ready**: 正常显示
- **error**: 全屏错误 + 重试
- **offline**: [OFFLINE] 横幅 + 显示内存中 last-known snapshot
- **touch pending**: 触摸操作等待响应（显示触摸涟漪 + loading）

---

## Components

| 组件 | 用途 |
|------|------|
| MobileShell | 移动端外壳（StatusBar + Header + Content + BottomNav） |
| BottomNavigation | 底部导航栏（5 tab，带徽章） |
| MobileSheet | 底部滑出面板（带 drag handle） |
| MobileActionSheet | 底部操作表 |
| MobileFullscreenPage | 全屏页面容器（带 [←] 导航） |
| TouchTooltip | 点击弹出气泡（替代 hover tooltip） |
| SwipeableRow | 可左滑显示操作的行 |
| LongPressMenu | 长按上下文菜单 |

---

## Core API

与桌面端完全一致。移动端是 UI 层适配，不改变 API 调用方式。

| 注意 | 说明 |
|------|------|
| WebSocket | 移动端同样使用 WebSocket，断线重连逻辑相同 |
| 批量操作 | 移动端不支持批量操作（如批量停止 session） |
| 大文件上传 | 移动端不支持（UI 隐藏相关按钮） |
| 认证 | 使用相同 Token 认证 |

---

## Plugin Contribution

- 插件贡献的 view/panel 自动适配移动端
- `custom-react` 组件需自行处理移动端布局
- `host-rendered` 组件由 System UI 自动适配
- 插件可通过 manifest 声明 `mobile.exclude: true` 不在移动端显示
- 插件可通过 `contributes.mobile.bottomNav` 自定义底部导航（v2.1+）
- 插件不能修改 Mobile Shell 布局

---

## State Ownership

| 数据 | 归属 | 说明 |
|------|------|------|
| 当前页面 | UI | React state，URL hash 同步 |
| Sheet 开合状态 | UI | React state |
| 底部 Sheet 展开比例 | UI | React state（半屏/全屏） |
| 触摸交互状态 | UI | React state |
| 所有业务数据 | Core | 与桌面端共享同一 Core |

---

## Failure States

| 场景 | UI 表达 |
|------|--------|
| 屏幕旋转 | 自动重排，不丢失状态 |
| 网络切换 (WiFi → 4G) | WebSocket 自动重连 |
| 触摸误操作 | 危险操作需二次确认弹窗 |
| 性能不足 (低端机) | 虚拟列表 + 限制渲染行数 |
| 横屏模式 | 显示 "请竖屏使用" 提示或自适应布局 |
| 通知权限拒绝 | 引导开启通知或轮询模式 |
