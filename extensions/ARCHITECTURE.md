# Remote Agent Console — 架构蓝图

## 本体（Core）是什么

本体是一个**纯通用**的远程实例控制台。它不知道 Claude、不知道 Shell、不知道任何具体 AI。

```
                         ┌─────────────────────────┐
                         │   Remote Agent Console   │
                         │                         │
                         │  • Machine 管理          │
                         │  • Instance 生命周期      │
                         │  • WebSocket 协议路由     │
                         │  • 文件树 / 终端 / 日志   │
                         │  • 消息持久化            │
                         │  • 布局 + UI Shell       │
                         │                         │
                         │  ← 这 3000 行是本体       │
                         └──────────┬──────────────┘
                                    │
                      Adapter 接口（唯一的桥）
                      ┌─────────────┴─────────────┐
                      │  start()    → 启动进程      │
                      │  stop()     → 停止进程      │
                      │  send()     → 发送输入      │
                      │  onBlock()  → 输出事件流    │
                      │  getView()  → UI 组件       │
                      │  getCaps()  → 能力声明      │
                      └─────────────┬─────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        ClaudeCode            ShellAdapter          小龙虾Adapter
       (800 行插件)           (150 行插件)          (300 行插件)
```

**Core 不包含**：
- 任何 Claude 特定的 stream-json 解析
- 任何 tool_use / thinking 的概念（这些是 OutputBlock 的 type 字段，Core 只负责渲染）
- checkpoint / rewind（这是 adapter 能力声明，Core 提供存储）

**Core 只负责**：
- 连接管理（WebSocket/HTTP）
- 进程生命周期（spawn/kill/monitor）
- 消息路由（谁发的 → 发给哪个 instance → 哪个 adapter 处理）
- UI 容器（左/中/右三栏，tab 切换，文件树，终端面板）
- 持久化（保存/加载 instance 状态）

---

## 插件能多灵活

### 插件必须实现什么（最小接口）

```ts
interface AgentAdapter {
  id: string;               // "claude-code" | "shell" | "xiaolongxia"
  name: string;             // 显示名
  detect(): Promise<boolean>;  // 我能在这台机器上跑吗？
  start(input): Promise<InstanceHandle>;  // 启动！
  getCapabilities(): AdapterCapabilities;  // 我能做什么？
  getView(): ComponentType;  // 我的 UI
}
```

### 能力声明决定 UI 行为

```ts
type AdapterCapabilities = {
  terminal: boolean;          // → Core 要不要显示终端面板
  fileContext: boolean;       // → Core 要不要显示文件树
  structuredEvents: boolean;  // → Core 用时间线还是纯文本
  approvals: boolean;         // → Core 要不要拦截确认弹窗
  modes: boolean;             // → Core 要不要显示模式切换
  timeline: boolean;          // → Core 要不要渲染时间线
  tasks: boolean;             // → Core 要不要显示任务面板
};
```

**同一个 Core，不同的 adapter 看到完全不同的 UI**：

```
ClaudeCode (全能力)              ShellAdapter (只有 terminal)
┌ left ──┐ ┌ main ────┐      ┌ left ──┐ ┌ main ──────┐
│ Files   │ │ Timeline │      │ Files   │ │             │
│ Tasks   │ │ ● Read   │      │         │ │  raw xterm  │
│         │ │ ● Bash   │      │         │ │  terminal   │
│         │ │ ● Text   │      │         │ │             │
└─────────┘ └──────────┘      └─────────┘ └─────────────┘
```

---

## 理论案例：接入"小龙虾"

假设小龙虾是一个 Python 工作流引擎，CLI 形式：

```bash
$ xlx run --dir ./project --task "回测 BTC 跨月策略"
{"type": "step_start", "name": "加载数据", "step": 1, "total": 5}
{"type": "log", "text": "读取 2025-01.parquet ..."}
{"type": "step_done", "name": "加载数据", "duration_ms": 3400}
{"type": "step_start", "name": "因子计算", "step": 2, "total": 5}
...
{"type": "result", "sharpe": 2.1, "returns": 0.18, "max_dd": -0.08}
```

### 接入需要写什么

```ts
// adapters/xiaolongxia/index.ts

export class XiaolongxiaAdapter implements AgentAdapter {
  id = 'xiaolongxia';
  name = 'xiaolongxia';
  
  async detect(runtime: RuntimeInfo): Promise<boolean> {
    // 检查 xlx 命令是否存在
    try {
      execSync('xlx --version', { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }

  async start(input: StartInstanceInput): Promise<InstanceHandle> {
    const proc = spawn('xlx', ['run', '--dir', input.directory, ...]);
    
    const blocks: OutputBlock[] = [];
    
    // ─── 核心：把小龙虾的输出翻译成统一的 OutputBlock ───
    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        const evt = JSON.parse(line);
        
        switch (evt.type) {
          case 'step_start':
            blocks.push({
              id: `step_${evt.step}`,
              type: 'tool_use',
              name: evt.name,
              status: 'running',
              meta: { step: evt.step, total: evt.total }
            });
            break;
          case 'step_done':
            blocks.push({
              id: `step_${evt.step}`,
              type: 'tool_use',
              name: evt.name,
              status: 'done',
              output: `耗时 ${evt.duration_ms}ms`,
              meta: { duration_ms: evt.duration_ms }
            });
            break;
          case 'log':
            blocks.push({
              id: genId(),
              type: 'text',
              text: evt.text,
              status: 'done'
            });
            break;
          case 'result':
            blocks.push({
              id: 'result',
              type: 'text',
              text: `夏普 ${evt.sharpe}, 收益 ${evt.returns}, 最大回撤 ${evt.max_dd}`,
              status: 'done'
            });
            break;
        }
      }
      onBlock(blocks);
    });
    
    return { instance, send, stop, onBlock };
  }

  getCapabilities(): AdapterCapabilities {
    return {
      terminal: false,      // 不需要终端
      fileContext: true,     // 需要文件树（选回测目录）
      structuredEvents: true, // 有 step_start/step_done
      approvals: false,
      modes: false,
      timeline: true,        // 工作流步骤适合时间线展示
      tasks: false,
    };
  }

  getView(): ComponentType<AdapterViewProps> {
    // 复用的同一个时间线 UI！不需要写新 UI
    return TimelineView;  // ← Core 提供通用时间线组件
  }
}
```

### 接入量

```
新建文件：
  adapters/xiaolongxia/index.ts    ← 约 120 行

修改文件：
  无（注册自动完成）

UI 开发：
  0 行（复用了 Core 的 TimelineView）
  
总工作量：30 分钟
```

---

## 最终干净到什么程度

```
                        ┌──────────────────────┐
                        │       Core           │
                        │  (纯通用，零 AI 依赖) │
                        │       ~2000 行       │
                        └──────────────────────┘
                                  │
                    Adapter 接口（150 行 TS）
                                  │
        ┌─────────────┬───────────┼───────────┬─────────────┐
        ▼             ▼           ▼           ▼             ▼
    ClaudeCode     Shell      Codex CLI   小龙虾      自定义 Agent
    ~800 行       ~150 行    ~300 行     ~120 行      ~100 行
    (第一方)      (第一方)   (社区)      (你自己)    (任何人)
```

**Core 的职责明确**：
- 我不认识 "Claude"，我只知道 "OutputBlock"
- 我不会 parse stream-json，那是 adapter 的事
- 我不会写 Claude 特定的 UI，那是 adapter.getView() 返回的

**插件的自由**：
- 你的进程只要能被 spawn，就能接入
- 你的输出格式无所谓，adapter 内部翻译成 OutputBlock
- 你可以用 Core 的通用 TimelineView，也可以写自己的 View
- 你可以声明能力，Core 自动调整 UI 布局

**这就是最终状态**。现在离这个状态还差 relay-server 的 refactor（把 spawnClaude 收敛到 ClaudeCodeAdapter 内部）。

---

## 扩展能力：项目扫描 / 记忆文件 / 特殊格式

你提的场景全部是 adapter 层的天然扩展，Core 只需要加 3 个可选接口方法：

### 1. 环境检测 + 自动安装

```ts
interface AgentAdapter {
  // ...已有方法...

  /** 检查运行环境，返回缺失项 */
  checkPrerequisites(runtime: RuntimeInfo): Promise<Prerequisite[]>;
}

interface Prerequisite {
  name: string;           // "claude" | "python" | "xlx"
  status: 'ok' | 'missing' | 'outdated';
  installHint: string;    // "npm install -g @anthropic-ai/claude-code"
  autoInstall?: () => Promise<void>;  // adapter 自己的安装逻辑
}
```

**流程**：
```
用户打开项目 → Core 遍历已注册 adapter → 调用 checkPrerequisites()
  ├─ ClaudeCode: claude ✓  python ✓  → 可用
  ├─ Shell:      bash ✓              → 可用  
  └─ 小龙虾:     xlx ✗              → UI 显示 "xlx 未安装，点击安装"
                                    → 用户点一下 → autoInstall() → 可用
```

Core 不需要知道怎么装 Claude。它只负责**展示检测结果**和**提供安装按钮**。

### 2. 项目文件 / 记忆文件

```ts
interface AgentAdapter {
  // ...已有方法...

  /** 返回本项目下该 adapter 管理的特殊文件 */
  getProjectFiles(workspaceDir: string): Promise<AdapterFile[]>;
}

interface AdapterFile {
  path: string;          // ".claude/projects/sessionBridge/memory.md"
  label: string;         // "Memory"
  icon: string;          // "brain" | "file-text" | "database"
  category: 'memory' | 'config' | 'session' | 'data';
  preview?: string;      // 前 200 字符
  actions?: FileAction[]; // "查看" / "编辑" / "删除"
}
```

**效果**：
```
文件树左侧出现：
  📁 project/
  ├── 📄 package.json
  ├── 🧠 Memory          ← ClaudeCode 的 .claude/projects/.../memory.md
  ├── ⚙ Config           ← ClaudeCode 的 config.json
  ├── 📊 Sessions (5)    ← ClaudeCode 的 .jsonl session 文件
  └── 📈 Results         ← 小龙虾的回测输出 .parquet
```

每个 adapter 声明自己的文件映射，Core 统一显示。Core 不需要知道什么叫 "memory"——标签是 adapter 给的。

### 3. 特殊文件格式识别

```ts
interface AgentAdapter {
  // ...已有方法...

  /** 注册能打开的文件类型 */
  registerFileTypes(): FileTypeHandler[];
}

interface FileTypeHandler {
  extension: string;     // ".jsonl" | ".parquet" | ".md"
  label: string;         // "Session Log" | "Backtest Result"
  icon: string;
  /** 返回自定义查看器组件，不返回则用 Core 默认 */
  viewer?: ComponentType<{ path: string; content: string }>;
  /** 是否该 adapter 来处理这个文件 */
  canHandle(path: string): boolean;
}
```

**效果**：
```
点击 .jsonl → ClaudeCode adapter 说 "我能处理" → 用它的 SessionViewer 打开
点击 .parquet → 小龙虾 adapter 说 "我能处理" → 用它的 TableViewer 打开
点击 .tsx → 没有 adapter 声称 → Core 默认文本查看器
```

### 架构不冲突的证明

```
                         Core（依然不变）
                    ┌────────────────────────┐
                    │ 不知道 Claude          │
                    │ 不知道 .jsonl          │
                    │ 不知道 "memory"        │
                    │                        │
                    │ 只知道：               │
                    │ • Prerequisite[] → 渲染检测面板  │
                    │ • AdapterFile[] → 渲染文件列表   │
                    │ • FileTypeHandler → 路由打开方式 │
                    └────────┬───────────────┘
                             │
                    Adapter 接口（新增 3 个可选方法）
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
  ClaudeCode              小龙虾              你的下一个插件
  checkPrerequisites:    checkPrerequisites:    checkPrerequisites:
    claude --version        xlx --version         ...
  getProjectFiles:       getProjectFiles:       getProjectFiles:
    .claude/projects/*      output/*.parquet       ...
    memory.md               config/*.yaml
  registerFileTypes:     registerFileTypes:
    .jsonl → SessionView    .parquet → TableView
    .md → MarkdownView
```

**关键原则**：Core 依然是"不知道任何具体东西"。它只是多暴露了三个能力——"告诉我你需要什么环境"、"告诉我你有哪些项目文件"、"告诉我你能打开什么格式"。每个 adapter 各自回答。

---

**这就是最终状态**。relay-server 的 refactor（去硬编码，纯 adapterRegistry 访问）已在 P2 中完成。

---

### 后续补充（v0.6）

自本文档撰写以来新增的基础设施（不改变 Core 设计理念）：

- **RelayEventBus**（`adapters/agent-core/event-bus.ts`）：类型化发布/订阅，支持通配符 `*`，emit 时自动注入 `nodeId`
- **节点身份**（`NodeConfig.nodeId`）：每个节点启动时自动生成并持久化，用于事件溯源和未来路由
- **SystemToast**（`adapters/types.ts`）：结构化通知消息，带 severity/targetScope/duration/actions，供未来节点间路由使用
- **操作状态机**（`src/instance-manager.ts`）：操作生命周期 pending→running→succeeded/failed/cancelled，通过 EventBus 广播事件
- **ConfigSync**（`adapters/agent-core/config-sync.ts`）：relay 统一下发配置给 agent，含键验证和重启必需键保护

以上全部与 Core 保持正交——不引入领域逻辑，仅扩展基础设施原语。
