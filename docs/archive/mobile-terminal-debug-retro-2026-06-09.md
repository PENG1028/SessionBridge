# 移动端终端触摸滚动调试全记录

> 2026-06-09，累计 40+ 次提交 + 一整天诊断，最终定位并修复。

## 问题

移动端终端（xterm.js v6.0.0 + DOM 渲染器）无法正常触摸滚动。用户滚上去后，第二次触摸屏幕时视口瞬间跳回底部。

## 根因

**`scrollToLine()` 在触摸事件中调用时，触发了 xterm.js v6 内部的"确保光标可见"逻辑。** 光标在 shell prompt（底部）那行，所以 xterm 把视口重置回底部。整个过程中不经过 `scrollToBottom()` 也不经过 `scrollLines()`，不走任何可拦截的 JS API——它直接在 xterm 渲染器内部操作视口偏移。

## 修复

两处改动：

1. **`scrollToLine()` → `scrollLines()` + 累积 delta 追踪**
   `scrollLines` 是相对量，只改变视口位置，不触发光标可见性检查。

2. **`touchend` 后 `blur()` textarea**
   阻止滚动手势结束后手机键盘意外弹出。

文件：`app/console/chrome/use-mobile-terminal.ts`，改动 ~30 行。

## 为什么之前 40+ 次提交全失败了

### 历史回顾（按时间顺序）

| 阶段 | 提交数 | 尝试了什么 | 为什么失败 |
|------|--------|-----------|-----------|
| 原生滚动 | 2 | 删掉所有自定义触摸，让浏览器原生处理 xterm viewport 滚动 | xterm v6 viewport 不支持浏览器原生触摸滚动 |
| 手动触摸滚动 | 3 | textarea 1px hack + touch-action:none + scrollToLine | textarea 1px 导致 Android 键盘异常 |
| 调试期 | ~10 | 各种 scrollToLine/scrollLines/scrollTop 组合 | 一直在操作层面尝试，不知道 xterm 内部在重置 |
| Hook 重构 | 2 | 提取到 useMobileTerminal | 只是代码组织，没改逻辑 |
| 基线锁定 | 1 | db5fc7a：直接键盘检测 + 跳过触摸时焦点 | 还是依赖 scrollToLine |
| 事件拦截期 | ~8 | pointerdown 拦截、anyTouchMove、touchend 阻止 | 拦错了事件——真正触发是 xterm 内部，不经过 DOM 事件链 |
| Monkey-patch 期 | ~5 | 拦截 scrollToBottom、focus、textarea.focus、__touchActive 全局标记 | 真正修改视口的方法不是这些——xterm 用内部渲染器 API 直接操作 |
| 全面接管 | 1 | "ONE system"——xterm 收不到任何触摸/指针事件 | 也没用，因为 scrollToLine 自己就是触发源 |
| 回退 | 1 | 回到 db5fc7a | 和之前一样的问题 |
| **今天** | ~6 | 诊断→二分法→blur→scrollLines | **定位到 scrollToLine 内部副作用并替换** |

### 所有死胡同

1. **怀疑 `scrollToBottom()`** → monkey-patch 证明它只在键盘弹/收时调用，触摸时从不触发
2. **怀疑 `pointerdown`** → document 级 capture + stopImmediatePropagation 全拦截也没用
3. **怀疑 `touchstart`** → xterm 内部 handler 不走 DOM 事件，拦截 touch 事件无效
4. **怀疑 Canvas 渲染器** → 根本没加载，用的就是 DOM 渲染器
5. **怀疑 `baseY` 读取错误** → 诊断证实 baseY/startBaseY/targetLine 全部正确
6. **怀疑 `viewport.scrollTop` 被直接改** → 50ms 轮询从未检测到变化
7. **怀疑键盘弹出导致 ResizeObserver → scrollToBottom** → 键盘是症状不是根因
8. **怀疑 `refresh()` 能修复渲染** → 没用
9. **怀疑 DOM scrollTop 直接赋值** → xterm 渲染和 DOM 滚动完全分离

## 教训

### 1. 先诊断，不要猜

前 40 个提交全在猜——"pointerdown 是根因"、"touch-action:none 有问题"、"需要 monkey-patch 内部方法"。没有一个提交配上验证手段。

今天的做法完全不同：先拦截 xterm **所有**能改变视口的 JS API（scrollToBottom、scrollToLine、scrollLines、scrollPages）和**所有**能改变 DOM scrollTop 的路径，加计数器。然后再二分法缩小范围。

### 2. 利用二分法，一层一层砍

测试 A 到 F：从完整功能开始，逐层删除代码，看问题在哪一层消失。测试 F 砍到只剩事件拦截 + 手动 focus，锁定了键盘弹出来源。然后加 touchend blur 消除键盘干扰。最后只剩 scrollToLine 和 scrollLines 的差别——换一个方法就解决了。

### 3. xterm.js v6 有两个关键特性

- **`scrollToLine()` 触发"确保光标可见"逻辑**——相对方法 `scrollLines()` 不触发
- **viewport DOM 滚动和内部渲染完全分离**——不要试图操作 DOM scrollTop
- **移动端不支持浏览器原生触摸滚动**——`touch-action:none` + 自定义处理是必须的

### 4. 不要用全局状态做模块通信

`lib/input-router.ts` 的 `_inputHandler`、`_ctrlActive` 全局变量在存在时一直导致多 tab 冲突。已删除。

### 5. 诊断工具要自包含、可手机直接使用

`?debug` URL 参数 + triple-tap toggle + `sessionStorage` 持久化 + `window.__xxx` 全局变量暴露内部状态。不依赖电脑连接、不需要 Chrome DevTools。这是今天唯一能高效定位的原因。

## 当前代码状态

`use-mobile-terminal.ts` 的核心逻辑：

```typescript
// touchstart: 记录 startY, 重置 lastAppliedDelta
// touchmove: 过了 5px 死区后，scrollLines(帧间增量)
//   - scrollLines 是相对量，不触发 xterm 光标可见逻辑
// touchend: blur textarea 防键盘弹出
//   - 纯 tap 场景由 xterm 自己的指针事件处理（键盘正常弹）
```

`scrollLines` 用累积 delta 追踪确保帧间增量正确：

```typescript
const totalDelta = Math.round(totalPxDelta / lineH);
const frameDelta = totalDelta - lastAppliedDelta;
if (frameDelta !== 0) {
    term.scrollLines(frameDelta);
    lastAppliedDelta = totalDelta;
}
```

## 剩余问题

1. 滚动条交互未优化（xterm v6 自定义 scrollbar 的指针事件处理）
2. scrollbar 区域检测逻辑需简化（当前 `isScrollbarTouch` 同时用 `elementFromPoint` 和坐标检测）
3. textarea 1px hack 仍在（不影响功能但应清理）
4. ResizeObserver 中的 `scrollToBottom` 应加 400ms 延迟避免键盘动画期间的跳转

## 验证清单

- [x] 触摸滚上去不会跳回底部
- [x] 滚动后松手不会弹出键盘
- [x] 纯 tap 终端正常弹出键盘
- [x] 滚动方向正确（手指上滑→内容上滑→看旧内容）
- [x] 桌面端鼠标交互不受影响
- [x] TypeScript 编译通过
- [x] `npm run build` 通过
