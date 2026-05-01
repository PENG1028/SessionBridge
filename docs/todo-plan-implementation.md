# TodoWrite & EnterPlanMode 实现方案

> 最后更新: 2026-05-01
> 状态: **待实现** — 本文档为实施方案，代码尚未实现

## 一、背景

VS Code 版的 Claude Code 有两个 UI 交互功能在终端版中被埋没了：

1. **TodoWrite** — 让 Claude 在开始实现之前列出一个任务清单，每完成一项自动勾选，用户能实时看到进度。
2. **EnterPlanMode** — Claude 向用户展示一个问题 + 多个选项，用户选择后继续执行。

这两个功能本质上是 **Claude 的工具调用（tool_use）**，和 Edit/Write/Read 等工具是同级概念。但因为终端版 Web UI 没有识别它们，它们混在普通 tool_use 卡片里显示，没有特殊 UI。

---

## 二、TodoWrite 详解

### 2.1 协议层面

TodoWrite 是一个标准的 Claude tool_use，出现在 stream-json 的 content_block_start 事件中：

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "content_block": {
      "type": "tool_use",
      "name": "TodoWrite",
      "input": {
        "todos": [
          { "content": "Set up project structure", "status": "in_progress", "activeForm": "Setting up project structure" },
          { "content": "Implement core logic", "status": "pending", "activeForm": "Implementing core logic" },
          { "content": "Write tests", "status": "pending", "activeForm": "Writing tests" },
          { "content": "Update documentation", "status": "pending", "activeForm": "Updating documentation" }
        ]
      }
    }
  }
}
```

**关键识别点：**
- `cb.type === "tool_use"` 且 `cb.name === "TodoWrite"`
- `cb.input.todos` 是一个数组，每个元素有 `content`、`status`、`activeForm`

### 2.2 更新机制

Claude 会在任务推进时**再次调用 TodoWrite**，更新 todos 数组中某些项的 status：

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "content_block": {
      "type": "tool_use",
      "name": "TodoWrite",
      "input": {
        "todos": [
          { "content": "Set up project structure", "status": "completed", "activeForm": "Setting up project structure" },
          { "content": "Implement core logic", "status": "in_progress", "activeForm": "Implementing core logic" }
        ]
      }
    }
  }
}
```

可能的状态值：`pending` | `in_progress` | `completed`

### 2.3 与 Checkpoint 的关系

TodoWrite **不应该触发文件快照**。它的 input 里没有 file_path，不需要回滚。

---

## 三、EnterPlanMode 详解

### 3.1 协议层面

EnterPlanMode 也是一个 tool_use，包含一个问题 + 多个选项：

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "content_block": {
      "type": "tool_use",
      "name": "EnterPlanMode",
      "input": {
        "question": "Which testing framework should we use?",
        "options": [
          { "label": "Vitest (Recommended)", "description": "Fastest option, native ESM support" },
          { "label": "Jest", "description": "Most widely used, more community resources" },
          { "label": "Mocha", "description": "Lightweight, flexible configuration" }
        ]
      }
    }
  }
}
```

**关键识别点：**
- `cb.type === "tool_use"` 且 `cb.name === "EnterPlanMode"`
- `cb.input.question` 是字符串
- `cb.input.options` 是数组，每个元素有 `label` 和 `description`

### 3.2 VS Code 插件的工作方式

VS Code 插件拦截了这个 tool_use，不把它当作普通工具执行，而是：

1. 检测到 EnterPlanMode → 不发送 tool_result
2. 弹出一个选择框（Quick Pick），显示 options 列表
3. 用户选中一项后，构造 tool_result 返回给 Claude
4. Claude 收到选择结果，继续执行

tool_result 的格式：

```json
{
  "type": "tool_result",
  "tool_use_id": "工具调用的ID",
  "content": "Vitest (Recommended)"  // 用户选中的 label
}
```

### 3.3 与 Checkpoint 的关系

EnterPlanMode **不应该触发文件快照**。它没有 file_path。

---

## 四、实现方案

### 4.1 检测层（stream-parser.ts）

在 `processStreamLine` 函数的 `content_block_start` → `tool_use` 分支中，添加两个新的识别分支：

```
// 现有逻辑（≈第96行）：
if (cb.name === "Edit" || cb.name === "Write") → 创建 checkpoint

// 新增分支 1：
if (cb.name === "TodoWrite") → 广播 todos_updated 事件

// 新增分支 2：
if (cb.name === "EnterPlanMode") → 广播 plan_question 事件
              → 阻塞实例队列，等待用户选择
```

**为什么在 stream-parser 里处理？**
- stream-parser 是唯一能访问 `cb.input` 的地方
- `content_block_start` 事件在工具执行前触发，可以拦截
- 与 checkpoint 的检测逻辑在同一个 switch 分支，代码组织一致

### 4.2 广播协议（relay → Web UI）

**todos_updated 事件**：

```json
{
  "type": "todos_updated",
  "instanceId": "inst_1_m0abc",
  "todos": [
    { "content": "...", "status": "in_progress", "activeForm": "..." }
  ]
}
```

**plan_question 事件**：

```json
{
  "type": "plan_question",
  "instanceId": "inst_1_m0abc",
  "question": "Which testing framework?",
  "options": [
    { "label": "Vitest", "description": "..." }
  ],
  "toolUseId": "toolu_abc123"
}
```

### 4.3 Web UI 处理（page.tsx）

**TodoWrite → TodoPanel 组件**

- 监听 `todos_updated` 事件，更新 `todos` 状态
- 渲染一个可勾选的 checklist：
  - `pending` → 空心圆 ○ + 灰色文字
  - `in_progress` → 旋转动画 ↻ + 高亮
  - `completed` → 勾选符号 ✓ + 绿色删除线
- 多个 TodoWrite 调用之间保持状态合并（新调用会覆盖旧的 todos 列表）

**EnterPlanMode → PlanVoter 组件**

- 监听 `plan_question` 事件
- 渲染一个模态/弹层：
  - 显示 question 文字
  - 每个 option 是一个按钮，显示 label + description
- 用户点击选项后：
  - 发送 `plan_choice` 命令到 relay

### 4.4 结果回写（relay 端）

用户选择后的处理流程：

1. Web UI 发送 `plan_choice` 命令到 relay
2. relay 收到后，构造 tool_result 消息
3. 通过 Claude 的 stdin 写入
4. Claude 收到 tool_result，继续执行

**plan_choice 命令格式**（Web UI → relay）：

```json
{
  "type": "plan_choice",
  "instanceId": "inst_1_m0abc",
  "toolUseId": "toolu_abc123",
  "selected": "Vitest (Recommended)"
}
```

**relay 的 tool_result 注入逻辑**（relay-server.ts）：

```typescript
// 当收到 plan_choice 命令时
function handlePlanChoice(ws, msg) {
  const i = instanceManager.get(msg.instanceId);
  if (!i) return;
  
  // 构造 tool_result JSON
  const toolResult = JSON.stringify({
    type: "tool_result",
    tool_use_id: msg.toolUseId,
    content: msg.selected
  }) + "\n";
  
  // 写入 Claude stdin
  if (i.process?.stdin?.writable) {
    i.process.stdin.write(toolResult);
  }
}
```

### 4.5 实例队列阻塞

当 EnterPlanMode 触发时，该实例应进入"等待用户选择"状态：

- `InstanceData` 新增字段：`waitingForPlanChoice: boolean`
- 在广播 plan_question 的同时，设置 `waitingForPlanChoice = true`
- 在 `processQueueForInstance` 中检查该字段，如果为 true 则跳过队列处理
- 收到 plan_choice 后，设置 `waitingForPlanChoice = false`，恢复队列处理

---

## 五、实施步骤

### Phase 1: 检测 + 广播（stream-parser.ts）

1. 在 `content_block_start` → `tool_use` 分支中，在 checkpoint 逻辑之后添加两个 if 分支
2. `TodoWrite` → 调用 `deps.broadcast()` 发送 `todos_updated`
3. `EnterPlanMode` → 调用 `deps.broadcast()` 发送 `plan_question`
4. `StreamParserDeps` 可能需要补充方法（如果广播需要额外参数）

### Phase 2: 队列阻塞（relay-server.ts + instance-manager.ts）

1. `InstanceData` 添加 `waitingForPlanChoice` 字段
2. `processQueueForInstance` 检查该字段
3. 构造 tool_result 并写入 stdin 的处理函数

### Phase 3: Web UI 组件（page.tsx）

1. 添加 `todos` 状态（`useState<TodoItem[]>([])`）
2. 添加 `planQuestion` 状态（`useState<PlanQuestion | null>(null)`）
3. 监听 WS `todos_updated` 事件 → 更新 todos
4. 监听 WS `plan_question` 事件 → 显示 PlanVoter
5. 实现 TodoPanel 组件（task list UI）
6. 实现 PlanVoter 组件（选项弹窗 UI）
7. 选项点击后发送 `plan_choice` WS 命令

---

## 六、测试要点

1. **TodoWrite 完整流程**：启动一个会调用 TodoWrite 的 prompt（如"帮我规划并实现一个计数器功能"），确认 todos 正确显示和更新
2. **EnterPlanMode 完整流程**：启动一个会调用 EnterPlanMode 的 prompt（如"帮我重构这个函数，选择合适的方案"），确认选项弹窗出现，选择后 Claude 继续执行
3. **多实例场景**：两个实例分别触发 TodoWrite/EnterPlanMode，确认事件只会广播到正确实例
4. **重连恢复**：WebSocket 重连后，blockBuffer 中的 TodoWrite/EnterPlanMode 事件需要正确重放
5. **EnterPlanMode 队列阻塞**：用户不选择时，队列不应继续处理该实例的消息；选择后应恢复
