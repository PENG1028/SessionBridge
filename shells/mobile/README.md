# Mobile Shell (Capacitor)

纯壳子，唯一目的是在手机上提供**原生系统通知**。
WebView 加载 SessionBridge Web UI，通过 `@capacitor/local-notifications` 弹通知。

## 前置依赖

需要 Android SDK 命令行工具（不需要 Android Studio IDE）：

```bash
# 确认 SDK 已装
%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager --list
```

如果没装，下载 [commandlinetools-win](https://developer.android.com/studio#command-line-tools-only)。

## 一键命令

```bash
cd shells/mobile && npm install     # 首次：装依赖
npx cap add android                # 首次：生成 android/ 项目
npm run build                      # 打包 → android/app/build/outputs/apk/debug/app-debug.apk
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SB_WEB_URL` | `http://localhost:3000` | Web UI 地址（开发用 localhost，真机用局域网 IP） |

## 通知流程

```
Go Core notify.Manager.SendNotification()
  → WebSocket { type: "notify.event", title, body }
  → Next.js SSE → 浏览器 Web UI
  → NotificationProvider + NotificationBridge
  → Capacitor LocalNotifications.schedule(...)
  → Android/iOS 原生通知栏
```

## Capacitor 和 Electron 对比

| | Electron | Capacitor |
|------|----------|-----------|
| 内部引擎 | Chromium | 系统 WebView |
| 产出 | .exe / .dmg / .AppImage | .apk |
| 通知 API | Electron Notification | @capacitor/local-notifications |
| 不需要 IDE | ✅ | ✅ |
| 跨平台源码 | 同一套 TypeScript | 同一套 TypeScript |
