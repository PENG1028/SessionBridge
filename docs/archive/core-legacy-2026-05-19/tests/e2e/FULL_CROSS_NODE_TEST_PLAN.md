# 完整双节点端到端测试方案

## 拓扑

```
┌─────────────────────────────────────────────────────┐
│                 本地机器 (PENGSPC)                    │
│                                                      │
│  ┌──────────────┐          ┌──────────────┐          │
│  │  浏览器 Tab A  │          │  浏览器 Tab B  │          │
│  │  localhost:14400│         │  localhost:14400│         │
│  └──────┬───────┘          └──────┬───────┘          │
│         │                         │                   │
│         ▼                         ▼                   │
│  ┌──────────────────────────────────────┐            │
│  │        本地 Relay (:14400)            │            │
│  │  NodeBar: PENGSPC | VM-0-15-ubuntu   │            │
│  └──────────────┬───────────────────────┘            │
│                 │ upstream                          │
│                 ▼                                    │
│  ┌──────────────────────────────────────┐            │
│  │  SSH Tunnel :18080 → VPS :8080       │            │
│  └──────────────────────────────────────┘            │
└─────────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│             VPS Relay (VM-0-15-ubuntu, :8080)        │
│  NodeBar: PENGSPC | VM-0-15-ubuntu                   │
└──────────────────────────────────────────────────────┘
```

**两个浏览器 Tab 都连接到本地 Relay (:14400)**，通过 NodeBar 切换进入不同节点的工作区间。

---

## 测试场景

### 场景 0：前置条件校验

| # | 检查项 | 方法 |
|---|--------|------|
| 0.1 | 本地 Relay 可访问 | HTTP GET /api/health → status=ok |
| 0.2 | VPS Relay 可访问（通过 SSH 隧道） | HTTP GET localhost:18080/api/health → status=ok |
| 0.3 | 本地 Relay NodeBar 显示两个节点 | DOM 检查：PENGSPC + VM-0-15-ubuntu |
| 0.4 | 本地 Relay 已注册到 VPS | GET /api/debug/statebus → 找到 source=remote, label=PENGSPC 的实例 |
| 0.5 | 两个 Relay 版本一致 | /api/status → version 字段相等 |

---

### 场景 1：Tab A 在 PENGSPC 工作区间 — 创建 → 写入 → 同步 → 删除

**操作路径：**
1. Tab A 打开 localhost:14400
2. 在 NodeBar 点击 PENGSPC → 进入 PENGSPC 工作区间
3. 点击 "Add view" → 选择 "Terminal" → 等待终端创建
4. 在终端输入 `echo HELLO_FROM_A_LOCAL` → 回车

**验证项：**
| # | 验证 | 方法 |
|---|------|------|
| 1.1 | Tab A 进入 PENGSPC 工作区间后，标题栏显示 "WORKBENCH" | DOM: `span:has-text("WORKBENCH")` |
| 1.2 | 终端创建成功，Tab Bar 出现 "Terminal" tab | `getWorkbenchTabTitles()` → includes 'Terminal' |
| 1.3 | CWD 显示正确路径（Windows: `C:\Users\ZHP` 或 `F:\`） | `getTerminalCwd()` → 匹配 Windows 盘符 |
| 1.4 | 输入 `echo HELLO_FROM_A_LOCAL` 后，终端输出包含该文本 | 等待终端 DOM 出现 output |
| 1.5 | **【新BUG检查】输入不回传**：输入过程中没有收到重复的字符 | 监控 terminal textarea 内容变化 |
| 1.6 | 关闭 Terminal tab → tab 从工作区消失 | `getWorkbenchTabTitles()` → 不再包含 'Terminal' |
| 1.7 | 关闭后 surface 在 relay 层也被移除 | GET /api/debug/surfaces → 对应 surfaceId 不存在 |

**BUG 监控点：**
- 输入字符是否在本地回显后又出现一次（loop）
- 终端输出是否出现重复行

---

### 场景 2：Tab A 在 VM-0-15-ubuntu (VPS) 工作区间 — 创建 → 写入 → 同步 → 删除

**操作路径：**
1. Tab A 在 NodeBar 点击 VM-0-15-ubuntu → 进入 VPS 工作区间
2. 创建 Terminal
3. 输入 `echo HELLO_FROM_A_VPS` → 回车
4. 输入 `pwd` → 检查输出路径
5. 关闭 Terminal

**验证项：**
| # | 验证 | 方法 |
|---|------|------|
| 2.1 | CWD 显示 Linux 路径（`/home/ubuntu`） | `getTerminalCwd()` → 匹配 `/home/` |
| 2.2 | `pwd` 输出显示 Linux home | 等待 output 包含 `/home/ubuntu` |
| 2.3 | 文件树根部显示 Linux 路径 | `getFileTreeRoot()` → 匹配 `/home/` 或 `/` |
| 2.4 | 关闭后 tab 消失 | `getWorkbenchTabTitles()` → 不包含 'Terminal' |

**关键验证：** VPS 的 CWD 必须是 Linux 路径，绝不能出现 Windows 路径。路径必须反映终端实际运行的机器。

---

### 场景 3：Tab B 在 PENGSPC 工作区间 — 跨页面独立验证

**操作路径：**
1. Tab B 打开 localhost:14400
2. 进入 PENGSPC 工作区间
3. 创建 Terminal
4. 输入 `echo HELLO_FROM_B_LOCAL` → 回车
5. 输入 `cd /tmp`（Windows 用 `cd C:\`）→ 检查 CWD 变化
6. 关闭 Terminal

**验证项：**
| # | 验证 | 方法 |
|---|------|------|
| 3.1 | Tab B 能独立创建终端，不受 Tab A 影响 | Tab A 的终端和 Tab B 的终端各自独立存在 |
| 3.2 | CWD 初始为 Windows home | `getTerminalCwd()` → Windows 路径 |
| 3.3 | `cd` 后 CWD 更新 | 执行 `cd` → CWD 从原本路径变为目标路径 |
| 3.4 | **【新BUG检查】两个 Tab 的输入不互相干扰** | Tab A 的内容不会出现在 Tab B 的终端中 |

**BUG 监控点：**
- Tab B 的终端是否错误显示 Tab A 输入的内容
- Tab A 创建终端时，Tab B 不应该自动出现该终端（除非在同一个 node 下观察同一个工作区间）

---

### 场景 4：Tab B 在 VM-0-15-ubuntu (VPS) 工作区间 — 跨页面独立验证

**操作路径：**
1. Tab B 在 NodeBar 点击 VM-0-15-ubuntu
2. 创建 Terminal
3. 输入 `echo HELLO_FROM_B_VPS` → 回车
4. 验证 CWD
5. 关闭

**验证项：**
| # | 验证 | 方法 |
|---|------|------|
| 4.1 | CWD 为 `/home/ubuntu` | `getTerminalCwd()` |
| 4.2 | 终端输出显示正确 | output 包含 HELLO_FROM_B_VPS |
| 4.3 | **【新BUG检查】Tab 身份隔离**：VPS 工作区间不应显示 PENGSPC 的 tab | Tab B 在 VPS workspace 中只看到 VPS 的终端，看不到 PENGSPC 的 |

---

### 场景 5：跨页面 Tab 同步验证

**关键问题：** 当 Tab A 在 PENGSPC 工作区间创建终端后：
- Tab B **也打开 PENGSPC 工作区间** → 应该能看到 Tab A 创建的终端
- Tab B **打开 VPS 工作区间** → 不应该看到 Tab A 的终端

| # | 验证 | 方法 |
|---|------|------|
| 5.1 | Tab A 在 PENGSPC 创建终端 → Tab B 进入 PENGSPC → 看到该终端 | Tab B 的 tab list 包含来自 Tab A 的 Terminal |
| 5.2 | Tab A 在 PENGSPC 创建终端 → Tab B 进入 VPS → **看不到**该终端 | Tab B 在 VPS 的 tab list 不应包含 PENGSPC 的 tab |
| 5.3 | **【新BUG检查】Tab 所属 Node 正确**：每个 tab 只出现在它所属的 node 工作区间 | tab.list[nodeId] 正确按 nodeId 隔离 |
| 5.4 | **【新BUG检查】Node 切换时 tab list 正确切换** | 从 PENGSPC 切换到 VPS → tab list 全部刷新为 VPS 的 tabs |

---

### 场景 6：Auto-Restore Last Path

| # | 验证 | 方法 |
|---|------|------|
| 6.1 | RESTORE 切换存在且默认开启 | `getRightSidebarText()` → 包含 "RESTORE" |
| 6.2 | PENGSPC: cd 到 `/tmp` → 关闭 terminal → 新 terminal 继承 `/tmp` | 新 terminal 的 cwd = `/tmp` |
| 6.3 | **【边界】关闭新 terminal → 再开一个 → 回到 home** | 第三个 terminal 的 cwd = home，不是 `/tmp` |
| 6.4 | VPS 同样验证：cd → 关闭 → 新 terminal 继承 | VPS 节点重复 6.2 |
| 6.5 | **关闭 RESTORE → cd → 关闭 → 新 terminal 应该到 home** | RESTORE=OFF 时，新 terminal 总是 home |
| 6.6 | 两个节点各自维护自己的 last-active-dir | sb-last-active-dir 按 hostname 隔离 |

**关键规则（来自用户需求）：**
- 当前机制（RESTORE ON）：
  - Terminal A 在 `/tmp` → 打开 Terminal B → B 的 cwd = `/tmp`（继承 A 的路径）
  - 关闭 Terminal B → 再打开 Terminal C → C 的 cwd = home（回到默认，**不能继续继承 `/tmp`**）
  - 关闭 Terminal C → 再打开 → cwd = home（每次从 "从 A 继承" 状态消费后就重置）
- RESTORE OFF：
  - 新 terminal 总是 home，不管之前 cd 到哪里

---

### 场景 7：书签功能

| # | 验证 | 方法 |
|---|------|------|
| 7.1 | 书签面板在右侧边栏可见 | `getRightSidebarText()` → 包含 "Bookmarks" |
| 7.2 | 文件树中目录的 "Toggle bookmark" 按钮可点击 | `button[title="Toggle bookmark"]` 存在 |
| 7.3 | 添加书签后出现在右侧面板 | 点击 toggle → 右侧面板出现该路径 |
| 7.4 | 点击书签可导航到该目录 | 点击书签 → CWD 变为书签路径 |
| 7.5 | 删除书签后从面板消失 | `button[title="Remove bookmark"]` → 路径不在面板中 |
| 7.6 | 两个节点的书签独立存储 | PENGSPC 的书签不污染 VPS 的书签 |

---

### 场景 8：【新】Input Echo Loop 检测

**问题描述：** 在设备 A 输入文字时，内容被发送到 relay，relay 转发到另一台设备，另一台设备的终端输出被捕获后又回传，导致输入过的内容在本地再次出现。形成 A→relay→B→relay→A 的 echo loop。

| # | 验证 | 方法 |
|---|------|------|
| 8.1 | **稳定状态基线**：终端无操作时，检查是否有自发输出 | 等待 3 秒，记录终端内容，再次等待 3 秒，对比无变化 |
| 8.2 | **单字符输入**：输入单个字符 `a`，检查终端只出现一个 `a` | 输入后 capture 终端文本 → 只出现一次 |
| 8.3 | **连续输入**：输入 `echo UNIQUE_MARKER_12345`，检查 output 中只出现一次该字符串 | 监控 output 流，去重检查 |
| 8.4 | **跨页面隔离**：Tab A 输入时 Tab B 的终端不应出现相同内容 | 同时监控两个页面的终端输出 |

**检测方法：**
```
// 在输入前后分别 snapshot 终端文本
const before = await getTerminalText(page);
await typeIntoTerminal(page, 'echo UNIQUE_TAG_$(date +%s)');
await page.keyboard.press('Enter');
await wait(2000);
const after = await getTerminalText(page);

// 提取 unique tag 的出现次数
const matches = after.match(/UNIQUE_TAG_/g);
const count = matches ? matches.length : 0;
// count 应该 = 1。如果 > 1 说明有 echo loop
```

---

### 场景 9：【新】Tab/Node 身份混淆检测

**问题描述：** 在 Node A 的工作区间创建 tab，同步机制错误地把这个 tab 也塞到 Node B 的工作区间。用户在 Node B 看到不应该属于 Node B 的 tab。

| # | 验证 | 方法 |
|---|------|------|
| 9.1 | **PENGSPC workspace 中只包含 PENGSPC 的 tab** | 在 PENGSPC 创建 2 个 terminal → `getWorkbenchTabTitles()` 只返回这 2 个 |
| 9.2 | 切换到 VPS workspace → tab list 完全不同 | `getWorkbenchTabTitles()` 的内容在切换前后完全不同 |
| 9.3 | **再切回 PENGSPC → 原来的 tab 还在** | 回来之后 tab list 恢复为之前的 2 个 |
| 9.4 | **【压力】快速切换 node 3 次，检查 tab list 不混乱** | 快速切换 PENGSPC→VPS→PENGSPC→VPS，每次都检查 tab list 正确 |
| 9.5 | **通过 API 验证 tab/node 映射** | GET `workbenchTabs` 在 StateBus 中，每个 nodeId 的 tab 列表不交叉 |

---

### 场景 10：【新】Output 重复检测

**问题描述：** 终端输出内容（stdout）出现重复行。可能原因：agent 的 stdout 被广播给多个 subscriber，每个 subscriber 都渲染了一次。

| # | 验证 | 方法 |
|---|------|------|
| 10.1 | 执行 `echo "LINE1" && echo "LINE2" && echo "LINE3"` → 检查仅有 3 行 | 捕获 output 后按行分割，count = 3 |
| 10.2 | 执行 `ls` → 检查没有重复文件条目 | `ls` 输出的每个文件名只出现一次 |
| 10.3 | **跨节点 output 隔离**：VPS 上的 `ls` 输出不应出现在本地终端 | 两个节点的终端输出完全隔离 |

---

## 执行顺序

```
场景 0（前置条件）
  → 场景 1（Tab A × PENGSPC）
    → 场景 8.1-8.3（在场景 1 中穿插输入 loop 检测）
  → 场景 2（Tab A × VPS）
  → 场景 3（Tab B × PENGSPC）
    → 场景 8.4（跨页面隔离检测）
  → 场景 4（Tab B × VPS）
  → 场景 5（跨页面同步验证）
    → 场景 9（tab/node 身份混淆检测）
  → 场景 6（Auto-Restore Last Path，在 PENGSPC 和 VPS 各做一次）
  → 场景 7（书签）
  → 场景 10（Output 重复检测）
```

**每个场景独立创建和关闭 page**，避免状态污染。
