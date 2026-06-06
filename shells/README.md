# SessionBridge Shells

原生壳子层，加载同一个 Web UI，绑定原生通知能力。

| 壳子 | 目录 | 工具 | 产出 | 平台 |
|------|------|------|------|------|
| Desktop | `desktop/` | Electron | .exe / .dmg / .AppImage | Windows / macOS / Linux |
| Mobile | `mobile/` | Capacitor | .apk / .ipa | Android / iOS |

## 共用原则

两个壳子：
- 加载 **同一个 Web UI**（`SB_WEB_URL` 配置）
- 暴露 **同名 API**（`window.electronAPI` / Capacitor 插件），NotificationBridge 自动适配
- **各自独立 `package.json`**，互不污染
- **各自独立 `npm install` / `npm run build`**

## 通知桥接

Web UI 侧 `app/console/shared/notification-bridge.ts` 检测当前运行环境：
- `window.electronAPI` 存在 → Electron 原生通知
- Capacitor 插件存在 → `@capacitor/local-notifications`
- 浏览器支持 → Web Notification API
- 都不支持 → 静默跳过（Toast 仍然在 UI 内显示）
