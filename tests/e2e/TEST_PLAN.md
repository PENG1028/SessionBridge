# SessionBridge Cross-Machine E2E Test Plan

## Test Topology

```
┌─────────────────────────┐       SSH Tunnel        ┌──────────────────────┐
│  PENGSPC (Windows)      │   localhost:18080 ────→  │  VPS (Ubuntu)        │
│  Relay: localhost:14400 │                          │  Relay: :8080        │
│  UI:   localhost:14400  │                          │  UI:   43.160.241.180│
└─────────────────────────┘                          └──────────────────────┘
         ↑                                                    ↑
    Playwright                                           Playwright
    Page A (local)                                       Page B (VPS)
```

## Quick Start

```bash
# 1. Ensure local relay running with upstream
#    (check: tasklist | findstr node → PID 32516 with --upstream ws://localhost:18080)

# 2. Ensure SSH tunnel is up
ssh -f -N -L 18080:127.0.0.1:8080 ubuntu@43.160.241.180

# 3. Run E2E tests
npx playwright test --config=tests/e2e/playwright.config.mjs --headed

# 4. View screenshots
ls tests/e2e/screenshots/
```

## Test Cases

### T1 — Page Load & Auto-Connect
| Item | Detail |
|------|--------|
| File | `tests/e2e/cross-machine-sync.spec.mjs` → T1 |
| What | Open localhost:14400 and VPS:18080, verify pages load |
| Assert | Title = "Remote Console", WS auto-connects |
| Screenshot | `t1-local.png`, `t1-vps.png` |

### T2 — Settings Version Check + Update
| Item | Detail |
|------|--------|
| File | `tests/e2e/cross-machine-sync.spec.mjs` → T2 |
| What | Ctrl+, → Settings panel → check version → click "Check for Updates" |
| Assert | Both sides show same version, update check completes |
| Screenshot | `t2-local-settings.png`, `t2-vps-settings.png` |

### T3 — Local → VPS Tab Sync
| Item | Detail |
|------|--------|
| File | `tests/e2e/cross-machine-sync.spec.mjs` → T3 |
| What | Create terminal on local UI → verify it appears on VPS UI |
| Assert | New tab title visible on VPS after sync delay |
| Screenshot | `t3-local-terminal.png`, `t3-vps-after-sync.png` |

### T4 — VPS → Local Tab Sync
| Item | Detail |
|------|--------|
| File | `tests/e2e/cross-machine-sync.spec.mjs` → T4 |
| What | Create terminal on VPS UI → verify it appears on local UI |
| Assert | New tab title visible on local after sync delay |
| Screenshot | `t4-vps-terminal.png`, `t4-local-after-sync.png` |

### T5 — Plugin Extensions Panel
| Item | Detail |
|------|--------|
| File | `tests/e2e/cross-machine-sync.spec.mjs` → T5 |
| What | Open left sidebar (Ctrl+B), open Settings → check extension contributions |
| Assert | Extension panels visible, settings show plugin configs |
| Screenshot | `t5-sidebar.png`, `t5-settings.png` |

---

## Full Test Inventory (38 integration + 5 E2E)

### Category 01 — Surface Sync (12 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 1 | `shared-surface-terminal-replay.test.mjs` | Terminal output replay on surface subscribe |
| 2 | `shared-surface-replay-cap.test.mjs` | ReplayPolicy `latest` / `all` caps |
| 3 | `shared-surface-cross-relay.test.mjs` | Surface sync across two relay nodes |
| 4 | `shared-surface-ui-contract.test.mjs` | UI contract for surface protocol |
| 5 | `ui-terminal-existing-instance-publishes-surface.test.mjs` | Existing terminal publishes surface on subscribe |
| 6 | `ui-surface-real-path-contract.test.mjs` | Real path contract for UI surface operations |
| 7 | `surface-persistence-restore.test.mjs` | Surface restored after relay restart |
| 8 | `surface-nodeid-ownership.test.mjs` | Surface ownership by nodeId |
| 9 | `node-runtime-surface-boundary-invariants.test.mjs` | Node/runtime/surface boundary invariants |
| 10 | `cross-node-surface-discovery.test.mjs` | Surface discovery across nodes |
| 11 | `cross-node-surface-sync.test.mjs` | Cross-node surface sync (2 bridge processes) |
| 12 | `stale-surface-tab-cleanup.test.mjs` | Stale surface/tab auto-cleanup |

### Category 02 — Terminal Execution (4 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 13 | `local-shared-terminal-session.test.mjs` | Local shared terminal session |
| 14 | `remote-shared-terminal-session.test.mjs` | Remote shared terminal session |
| 15 | `terminal-consistency.test.mjs` | Terminal cwd, file list, shell spawning |
| 16 | `terminal-path-e2e.test.mjs` | Terminal path E2E |

### Category 03 — Tab Workbench (4 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 17 | `tab-lifecycle-e2e.test.mjs` | Tab create/open/close lifecycle |
| 18 | `cross-relay-instanceid-remap.test.mjs` | instanceId remap across relays |
| 19 | `shell-surface-bridge.test.mjs` | Shell ↔ Surface bridge layer |
| 20 | `cross-relay-two-browser-e2e.test.mjs` | Two-browser cross-relay E2E |

### Category 04 — Cross-Machine (4 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 21 | `cross-machine-vps-e2e.test.mjs` | VPS E2E cross-machine |
| 22 | `two-node-vps-tab-sync.test.mjs` | Two-node VPS tab sync |
| 23 | `cross-machine-full-matrix.test.mjs` | Full matrix cross-machine |
| 24 | `vps-tab-sync.test.mjs` | VPS tab sync |

### Category 05 — Agent Operation (4 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 25 | `real-agent-operation-protocol.test.mjs` | Real agent operation protocol |
| 26 | `remote-routing-invariants.test.mjs` | Remote routing invariants |
| 27 | `remote-operation-plugin-session.test.mjs` | Remote operation plugin session |
| 28 | `t2-debug.test.mjs` | T2.4 debug test |

### Category 06 — Browser Session (3 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 29 | `persistence-reconnect.test.mjs` | Persistence + reconnect |
| 30 | `multi-browser-identity.test.mjs` | Multi-browser identity |
| 31 | `panel-consistency.test.mjs` | Panel consistency across browsers |

### Category 07 — CLI & Config (3 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 32 | `cli-command-existence.test.mjs` | All CLI_REFERENCE commands exist |
| 33 | `cli-config-auth.test.mjs` | Config file → auth → HTTP API |
| 34 | `cli-api-parity.test.mjs` | CLI --json output = HTTP API response |

### Category 08 — Extension Audit (1 test)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 35 | `extension-audit.test.mjs` | Manifest parse, dist completeness, dup IDs |

### Category 09 — UI Contracts (2 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 36 | `real-ui-simulation-full-pipeline.test.mjs` | Full browser simulation pipeline |
| 37 | `ui-operation-map-contract.test.mjs` | API/WS types referenced in UI are documented |

### Category 10 — Infrastructure (2 tests)
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| 38 | `statebus-diag-invariants.test.mjs` | StateBus debug endpoint invariants |

### Category 11 — E2E Browser (5 tests)  ← NEW
| # | Test File | What It Verifies |
|---|-----------|-----------------|
| E1 | `cross-machine-sync.spec.mjs::T1` | Both pages load + WS connect |
| E2 | `cross-machine-sync.spec.mjs::T2` | Settings version check + update |
| E3 | `cross-machine-sync.spec.mjs::T3` | Local → VPS tab sync |
| E4 | `cross-machine-sync.spec.mjs::T4` | VPS → Local tab sync |
| E5 | `cross-machine-sync.spec.mjs::T5` | Plugin extensions panel |

---

## Plugin Inventory

| Plugin | Path | Manifest | Status |
|--------|------|----------|--------|
| Terminal | `plugins/terminal/plugin.yaml` | adapter: shell | Core |
| System Info | `plugins/system-info/plugin.yaml` | adapter: system-info | Plugin |
| Claude Code | (planned) | adapter: claude-code | Plugin |
| Core (Host) | sessionnode-core built-in | contributes core views | Core |

---

## Update Workflow (修改代码后快速同步)

```
┌─ 1. 修改代码 (go-core/ 或 app/)
├─ 2. npx tsc --noEmit                                           ← 前端类型检查
├─ 3. npm run build                                              ← 构建前端 + Go Core
├─ 4. git add -A && git commit && git push github main          ← 推送
├─ 5. 本地: 重启 (Ctrl+C 重跑 npm run dev)                       ← 本地生效
├─ 6. VPS:  type ! ssh ubuntu@43.160.241.180 ...                 ← 手动拉取+重启
├─ 7. npx playwright test --config=tests/e2e/playwright.config.mjs --headed  ← E2E
└─ 8. 检查 tests/e2e/screenshots/ 截图确认                        ← 视觉验证
```

### 本地一键构建+重启
```bash
npm run build && pkill -f 'sessionnode' ; sleep 1 && \
  nohup npm run start:core > /tmp/bridge.log 2>&1 &
```

### VPS 一键更新 (需要你手动执行)
```bash
ssh ubuntu@43.160.241.180 "cd sessionbridge && git fetch github main && git reset --hard github/main && npm run build && pkill -f 'sessionnode' ; sleep 1 && nohup npm run start:core > /tmp/bridge.log 2>&1 &"
```

### 仅检查版本是否一致
```bash
# 本地版本
curl -s http://localhost:14400/api/status | grep -o '"version":"[^"]*"'
# VPS 版本
curl -s http://localhost:18080/api/status | grep -o '"version":"[^"]*"'
# Git HEAD
git log --oneline -1
```

---

## File Paths Reference

```
sessionBridge/
├── tests/
│   ├── integration/          ← 38 API/WS integration tests (.test.mjs)
│   ├── specs/                ← Test spec docs (01-10 + 99-test-gaps.md)
│   ├── e2e/                  ← Playwright browser E2E tests ← NEW
│   │   ├── cross-machine-sync.spec.mjs
│   │   ├── playwright.config.mjs
│   │   ├── TEST_PLAN.md      ← THIS FILE
│   │   └── screenshots/
│   └── stress/               ← (future: stress/load tests)
├── go-core/                  ← Go Core 运行时（主 Core）
│   ├── cmd/node/main.go      ← 入口点
│   └── internal/             ← server, session, process, fs, config, ...
├── app/                      ← Next.js UI source
│   ├── page.tsx              ← Main app shell
│   ├── shell-terminal.tsx    ← Xterm.js terminal component
│   └── console/
│       ├── shell/settings-panel.tsx   ← Settings + Check for Updates
│       ├── stage/workbench-state.ts   ← Tab/workbench state
│       └── actions/register-core-actions.tsx  ← Core actions (settings, terminal)
├── src/                      ← (已删除 — Go Core 是唯一运行时)
├── scripts/                  ← 构建/启动脚本
│   ├── start-core.js         ← 启动 Go Core
│   ├── build-core.js         ← 构建 Go Core 二进制
│   └── dev-all.js            ← 开发模式 (Core + Next.js)
├── plugins/                  ← Plugin declarations (plugin.yaml)
│   ├── shell/                ← Terminal adapter (core)
│   ├── claude-code/          ← Claude Code adapter
│   ├── system-info/          ← System info adapter
│   └── host/                 ← Host core views
├── dist/                     ← 构建产物 (go-core/)
└── out/                      ← Compiled UI static output
```
