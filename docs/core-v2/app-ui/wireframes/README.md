# SessionNode v2 — App UI Wireframes

> 页面级别的 ASCII 线框图，描述每个页面的布局、组件、交互、状态
> 基于 SYSTEM_UI_PLUGIN.md 和 SYSTEM_UI_FEATURES.md 的设计规范（文件名为历史遗留，概念上指 App UI Plugin / App UI Features）

---

## 目录目的

这个目录为每个 System UI 页面提供**布局级别**的规格说明，包括：

1. 页面的整体结构和区域划分
2. 桌面端和移动端的布局差异
3. 每个页面的状态（loading / empty / ready / error / partial / offline / permission denied）
4. 使用的 system-ui 内置组件
5. 调用的 Core API
6. 插件能否贡献内容到该页面
7. 状态归属（Core 保存什么，UI 保存什么）
8. 失败场景

这些线框图不是视觉设计稿，而是**指导后续实现的布局和交互规格**。

---

## 页面分类

| 分类 | 页面 | Surface | 描述 |
|------|------|---------|------|
| **Overview** | Dashboard | main.editor | 系统总览，健康状态 |
| **Infrastructure** | Node Manager | main.editor | 节点管理 |
| **Infrastructure** | Session Manager | main.editor | 会话管理 |
| **Infrastructure** | Logs & Audit | main.editor | 日志和审计查看 |
| **Plugin** | Plugin Manager | main.editor | 插件列表 |
| **Plugin** | Plugin Detail | plugin.detail | 插件详情 |
| **Plugin** | Plugin Detail Permissions | plugin.detail.permissions | 插件权限 |
| **Plugin** | Plugin Detail Files | plugin.detail.files | 插件文件 |
| **Plugin** | Plugin Detail Cache | plugin.detail.cache | 插件缓存 |
| **Settings** | Settings Shell | settings.page | 设置外壳 |
| **Settings** | Settings General | settings.page | 通用设置 |
| **Settings** | Settings Access Control | settings.page | 访问控制 |
| **Operation** | Approval Center | notification.center | 审批中心 |
| **Mobile** | Mobile Shell | mobile.fullscreen / mobile.sheet | 移动端外壳 |

---

## 文档阅读顺序

```
1. wireframes/README.md          — 通用规范和约定
2. wireframes/DASHBOARD.md       — 总览页面
3. wireframes/NODES.md           — 节点管理
4. wireframes/SESSIONS.md        — 会话管理
5. wireframes/PLUGINS.md         — 插件管理
6. wireframes/SETTINGS.md        — 设置页
7. wireframes/LOGS_AND_AUDIT.md  — 日志和审计
8. wireframes/APPROVALS.md       — 审批中心
9. wireframes/MOBILE.md          — 移动端
```

---

## 通用页面状态定义

System UI 中每个页面都可能有以下状态，在 wireframe 中通过 `## States` 章节描述。

| 状态 | 触发条件 | UI 表现 |
|------|---------|--------|
| `loading` | 首次加载或刷新，Core API 未返回 | Skeleton 骨架屏，不显示空数据 |
| `empty` | Core 返回空数据，没有需要展示的内容 | 空状态插画 + 引导文字 + 操作按钮 |
| `ready` | 数据正常加载完成 | 正常显示页面内容 |
| `partial` | 部分数据加载成功，部分失败 | 正常显示已加载部分 + 错误项标注 + 重试单条 |
| `error` | 数据加载完全失败 | 错误提示 + 重试按钮 + 错误详情 |
| `permission denied` | 当前 Actor 没有查看该页面的权限 | 权限不足提示，不显示数据 |
| `offline` | Core WebSocket 连接断开 | 顶部横幅 + 显示内存中 last-known snapshot（不持久化到 localStorage）+ 自动重连 |

### 状态切换规则

```
offline → (重连成功) → loading → ready
                        loading → error → (重试) → loading
                        ready → partial（部分数据过期）
error → (重试) → loading → ready
permission denied → 不跳转，保持当前页面并显示提示
```

---

## 通用 ASCII 线框图约定

所有 wireframe 使用纯 ASCII 字符绘制，遵循以下规则：

```
符号约定：

  ┌───┐  方框 = 页面区域
  │ A │
  └───┘

  ──────  横线 = 分隔线或导航
  │     竖线 = 侧边或内容边界

  [Button]  方括号 = 按钮
  (radio)   圆括号 = 单选
  [x]       复选框 = 勾选框
  >         箭头 = 可展开或导航
  ###       标题
  ...       省略 = 截断列表

  标签约定：

  [LOADING]     = skeleton 加载状态
  [EMPTY]       = 空状态
  [ERROR]       = 错误状态
  [OFFLINE]     = 离线横幅
  [PERM_DENIED] = 权限不足
  [BADGE]       = 徽章标签

  组件占位：

  [Table]       = DataTable 组件
  [Card]        = 统计卡片
  [List]        = 列表组件
  [Tabs]        = Tab 导航
  [Drawer]      = 侧边滑出面板
  [Modal]       = 模态弹窗
  [Form]        = 表单组件
  [Tree]        = 树形组件
  [Timeline]    = 时间线组件
```

### 桌面端布局模板

```
┌─────────────────────────────────────────────────────────────┐
│  AppHeader [Logo] [Search] [Notification] [Profile]         │
├──────────┬──────────────────────────────────┬───────────────┤
│  Sidebar │  Main Editor                     │  Sidebar      │
│  Left    │  ┌────────────────────────────┐  │  Right        │
│          │  │  [Page Title]  [Actions]   │  │               │
│  [Nav]   │  ├────────────────────────────┤  │  [Panel 1]    │
│          │  │  Content Area              │  │               │
│  [Panel] │  │                            │  │  [Panel 2]    │
│          │  │                            │  │               │
│          │  └────────────────────────────┘  │               │
│          ├──────────────────────────────────┤               │
│          │  Bottom Panel                    │               │
│          │  [Tab1] [Tab2]                   │               │
├──────────┴──────────────────────────────────┴───────────────┤
│  StatusBar [Left Info]                    [Right Info]       │
└─────────────────────────────────────────────────────────────┘
```

### 移动端布局模板

```
┌──────────────────┐
│  Header [←] Title│
├──────────────────┤
│                   │
│  Fullscreen       │
│  Content Area     │
│                   │
│                   │
├──────────────────┤
│  [Home] [Sessions]│
│  [Logs] [Settings]│
└──────────────────┘

或 Sheet（底部滑出）:

┌──────────────────┐
│  Header [Handle] │
│  ─────────────   │
│  Sheet Content   │
│                   │
│                   │
├──────────────────┤
│  [Action]         │
└──────────────────┘
```

---

## 通用字段模板

每个 wireframe 文档使用以下模板：

```
# 页面组名

## Purpose
这个页面组解决什么问题。

## Entry
从哪里进入。

## Desktop Wireframe
ASCII 线框图。

## Mobile Wireframe
ASCII 线框图。

## States
- loading
- empty
- ready
- partial
- error
- permission denied
- offline

## Components
该页面组使用的 system-ui 组件。

## Core API
该页面组调用的 Core API。

## Plugin Contribution
插件能否贡献内容，贡献到哪个 surface。

## State Ownership
Core 保存什么，UI 保存什么。

## Failure States
失败场景和 UI 表达。

## Notes
迁移或实现注意事项。
```

---

## 线框图边界

这些线框图描述的是 **System UI 内置页面**的布局。以下内容不在 wireframe 范围内：

- Feature Plugin 的自定义页面（ClaudeChatView、TerminalView）— 由插件自己设计
- 第三方控制面 — 不依赖 System UI
- 实际的 CSS 样式、颜色、字体 — 由前端实现决定
- 动画、过渡效果 — 不在 ASCII 线框图范围内
