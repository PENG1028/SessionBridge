# Desktop Shell (Electron)

纯壳子，唯一目的是**原生系统通知**。
加载 SessionBridge Web UI，通过 preload 注入 `window.electronAPI`。

## 一键命令

```bash
cd shells/desktop && npm install && npm run dev    # 开发
cd shells/desktop && npm run build                 # 打包
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SB_WEB_URL` | `http://localhost:3000` | Web UI 地址 |
| `SB_WINDOW_WIDTH` | `390` | 窗口宽度 |
| `SB_WINDOW_HEIGHT` | `844` | 窗口高度 |
| `SB_TRAY_ON_CLOSE` | `1` | 关闭→托盘 |

## 通知流程

```
Go Core notify.Manager.SendNotification()
  → WebSocket { type: "notify.event", title, body }
  → Next.js SSE → 浏览器 Web UI
  → NotificationProvider + NotificationBridge
  → window.electronAPI.showNotification({title, body})
  → preload.ts: ipcRenderer.send('sb:notify', ...)
  → main.ts: new Notification(...) → OS 原生通知
```
