# Full Working Network Scenario

> Purpose: define the target real-world workflow for SessionNode before continuing implementation.
> Date: 2026-05-20
> Scope: multi-node topology, relay/view/leaf roles, plugin management, Terminal, Claude Code, platform capability checks, install/status surfaces.

---

## 1. Scenario Goal

This scenario describes the minimum complete product shape needed for daily work:

- Two VPS nodes act as relays.
- One PC acts as a controllable leaf node.
- Two phones act as view-only clients.
- A browser or desktop client can connect through either relay and see the whole node network.
- A view client can operate any controllable node in the network, but the view client itself is not controllable because it has no Core.
- Terminal and Claude Code plugins can be inspected, enabled, disabled, checked, installed, configured, and used through System UI.
- The UI can explain what is supported, missing, unsupported, installed, running, or blocked on every target node.

The scenario is intentionally broad. It is the acceptance target for future implementation, not a claim that all capabilities already exist.

---

## 2. Actors And Nodes

| Name | Role | Has Core | Controllable | Connects To | Example Platform |
|---|---|---:|---:|---|---|
| `relay-a` | Relay node | Yes | Yes | Other nodes and views | Linux VPS |
| `relay-b` | Relay node | Yes | Yes | Other nodes and views | Linux VPS |
| `pc-leaf` | Leaf node | Yes | Yes | Relay A or Relay B | Windows desktop |
| `phone-view-a` | View client | No | No | Relay B | Mobile browser/app |
| `phone-view-b` | View client | No | No | `pc-leaf` view entry or relay | Mobile browser/app |
| `desktop-view` | View client | No | No | Relay A | PC browser/app |

Rules:

- Relay nodes are Core nodes and can execute capabilities.
- Leaf nodes are Core nodes and can execute capabilities.
- View clients have no Core and cannot be targets for `process.*`, `fs.*`, `plugin.*`, or `session.*`.
- Any authenticated view client can control any reachable Core node if permissions allow it.
- The selected target node is always explicit in UI state.

---

## 3. Network Topology

Target topology:

```text
                  +----------------+
                  |  desktop-view  |
                  |  no Core       |
                  +--------+-------+
                           |
                           v
+-------------+     mesh / relay link      +-------------+
|  relay-a    |<-------------------------->|  relay-b    |
|  Linux Core |                             |  Linux Core |
+------+------+                             +------+------+
       ^                                           ^
       |                                           |
       |                                           |
+------+------+                             +------+------+
|  pc-leaf    |                             | phone-view-a|
| Windows Core|                             | no Core     |
+------+------+                             +-------------+
       ^
       |
+------+------+
| phone-view-b |
| no Core      |
+-------------+
```

Required behavior:

- `desktop-view` connects to `relay-a` and can see `relay-a`, `relay-b`, and `pc-leaf`.
- `phone-view-a` connects to `relay-b` and can see the same network.
- `phone-view-b` may enter through a UI exposed by `pc-leaf`, but it is still only a view client.
- All views should converge on the same node inventory.
- If `relay-a` is temporarily unavailable, `relay-b` remains usable for reachable nodes.
- If `pc-leaf` disconnects, all views show it as offline/unreachable and disable actions targeting it.

---

## 4. Core Concepts

### 4.1 Node Roles

| Role | Meaning | Can Execute Capabilities | Can Relay | Can Be Controlled |
|---|---|---:|---:|---:|
| Relay | Core node that accepts views and routes to peers | Yes | Yes | Yes |
| Leaf | Core node that connects to a relay but does not act as public relay | Yes | Optional/No | Yes |
| View | UI-only client with no Core | No | No | No |

### 4.2 Capability State Model

Every action must be explained through separate states:

| Layer | Question | Example |
|---|---|---|
| Declared | Does Core know this capability and did the plugin declare it? | `process.spawn` is declared by Terminal |
| Supported | Does this target node/platform support it? | Windows PTY is partial, Linux PTY is full |
| Granted | Is this actor/plugin allowed to call it? | `terminal` has `stream.write` grant |
| Available | Are runtime dependencies present? | `claude` binary exists on `relay-a` |
| Running | Is there an active session/process/task? | Claude Code session is running on `pc-leaf` |

These must not be collapsed into one boolean.

---

## 5. First-Viewport UI Expectations

When a user opens the app from any view client, the first usable screen should show:

- Current connection target: `relay-a`, `relay-b`, or `pc-leaf`.
- Auth state.
- Node network status.
- Active target node selector.
- Plugin status summary for selected node.
- Active sessions list.
- Alerts for missing dependencies, unsupported capabilities, or permission prompts.

Suggested layout:

```text
+--------------------------------------------------------------------------------+
| SessionNode                                      Connected: relay-b   User: me |
+-------------------+------------------------------+-----------------------------+
| Node Network      | Main Work Area                | Inspector / Activity        |
|                   |                              |                             |
| relay-a   online  | [Terminal] [Claude Code]      | Selected node: pc-leaf      |
| relay-b   online  |                              | Platform: Windows          |
| pc-leaf   online  | Terminal/Claude panel         | Plugin status              |
|                   |                              | Permissions                |
| Views:            |                              | Tasks / install history    |
| phone-view-a      |                              |                             |
| desktop-view      |                              |                             |
+-------------------+------------------------------+-----------------------------+
```

Mobile view:

- Node selector must be one tap away.
- Active session terminal must be primary.
- Plugin/permission/install panels can be secondary tabs or drawers.
- The UI must clearly say when the phone is only a view client.

---

## 6. Node Network UI Behavior

### 6.1 Node List

Each Core node row shows:

- Name and role.
- Platform and arch.
- Online/offline/reconnecting.
- Relay/leaf role.
- Last seen.
- Supported capability summary.
- Active sessions count.
- Plugin warnings count.

Example:

| Node | Role | Platform | Status | Capabilities | Warnings |
|---|---|---|---|---|---|
| `relay-a` | relay | linux/amd64 | online | full server profile | Claude missing |
| `relay-b` | relay | linux/amd64 | online | full server profile | none |
| `pc-leaf` | leaf | windows/amd64 | online | partial PTY profile | Windows PTY fallback |

### 6.2 Selecting A Node

When the user selects `pc-leaf`:

- Main panels target `pc-leaf`.
- Plugin Manager queries plugin status on `pc-leaf`.
- Terminal sessions shown are sessions on `pc-leaf`.
- Unsupported capabilities are shown before actions are attempted.

The UI must never silently execute on the wrong node.

---

## 7. Plugin Management Scenario

### 7.1 Plugin List

For selected target node, the Plugin Manager shows:

| Plugin | Status | Platform Support | Dependencies | Permissions | Actions |
|---|---|---|---|---|---|
| Terminal | enabled | partial/full | ok | granted | Open / Disable |
| Claude Code | missing deps | partial/full | `claude` missing | needs grants | Check / Install / Configure |
| System Info | enabled | full | ok | granted | Open |

### 7.2 Plugin Detail

Each plugin detail view should have tabs:

- Overview
- Capabilities
- Platform Support
- Dependencies
- Permissions
- Configuration
- Files
- Cache
- Install / Update
- History

### 7.3 Enable / Disable

When disabling Terminal:

- UI asks for confirmation if active sessions exist.
- Core calls `plugin.disable`.
- Active sessions policy is shown: keep running / stop / deny disable.
- Plugin list updates.
- History records `plugin.disabled`.

When enabling:

- Core checks declared capabilities.
- Core checks platform support.
- Core checks dependencies.
- Core checks grants.
- If all pass, plugin becomes enabled.
- If not, UI shows a list of blockers.

---

## 8. Dependency Check And Install Scenario

> **Implementation status (2026-05-20):** The full install lifecycle is implemented as a **dry-run framework**. `plugin.install`/`plugin.install.plan` generates a structured plan with steps and risk assessment stored in an in-memory PlanStore. `plugin.install.execute` validates plan approval then dry-run completes all steps (no real system commands). `plugin.uninstall`/`plugin.files.register` operate on the PlanStore. The dispatcher's Plan-Before-Apply step (via Planner interface) gates high-risk operations on plan approval, and `notify.respond` provides the approve/deny channel. Error codes `PLAN_REQUIRED`, `APPROVAL_REQUIRED`, `APPROVAL_DENIED` are returned at appropriate stages. Real package manager integration (actual command execution via `process.spawn`) is the NEXT step.

### 8.1 Linux Relay Missing Claude Code

User selects `relay-a` and opens Claude Code plugin.

Expected UI:

```text
Claude Code
Status: Missing dependency
Target node: relay-a
Platform: linux/amd64

Checks:
  - claude binary: missing
  - node/npm: ok
  - network outbound: unsupported/not declared or pending grant
  - cache path ~/.claude: accessible

Actions:
  [Create Install Plan]
```

### 8.2 Install Plan

When user clicks Create Install Plan:

Core must return a plan, not execute immediately.

Plan includes:

- Target node.
- Plugin ID.
- Required binaries.
- Install method candidates.
- Commands or package manager steps.
- Files/directories to be created.
- Risks.
- Required approval.
- Rollback or uninstall notes.

Example:

| Step | Action | Risk | Requires Approval |
|---|---|---|---|
| 1 | Detect package manager | low | no |
| 2 | Install Claude Code CLI | medium | yes |
| 3 | Run `claude --version` | low | no |
| 4 | Register cache path `~/.claude` | low | no |

### 8.3 Install Execute

After approval:

- Core executes install on selected node.
- UI shows progress as a task.
- Output is streamed.
- Install history is recorded.
- After completion, Core reruns `plugin.check`.
- Plugin status changes from `missing_dependency` to `ready` or `needs_permission`.

### 8.4 Install Visibility

The UI must show install data without plugin-specific adapters:

- Install plan.
- Install task progress.
- Installed artifacts.
- Binary version.
- Files registered.
- Cache registered.
- History events.
- Audit events.

This requires Core-level install/task/history models, not per-plugin UI hacks.

---

## 9. Terminal Scenario

Terminal must support:

- Create session on selected node.
- Select shell/profile.
- Write stdin.
- Stream stdout/stderr.
- Stop/kill process.
- Resize if supported.
- Replay history.
- Tail last output.
- Show platform limitations.

### 9.1 Terminal On Linux Relay

Expected:

- `process.spawn`: full
- PTY: full
- resize: full
- signal: full
- package manager commands can run if permissions allow

UI:

```text
Terminal - relay-a
Shell: /bin/bash
PTY: full
History: enabled
Status: running
```

### 9.2 Terminal On Windows Leaf

Expected:

- `process.spawn`: partial/full pipe mode
- PTY: partial, pipe fallback
- resize: limited/no-op
- signal: partial

UI must show:

```text
Terminal - pc-leaf
PTY: limited (Windows pipe fallback)
Resize: unsupported
Interactive TUI apps may not work
```

### 9.3 Terminal Package/Environment Management

Terminal-related management must support:

- Check available shells.
- Check package manager availability.
- Check PATH.
- Check binary availability.
- Show installed tool versions.
- Show missing tools.
- Trigger install plans where supported.

This should be Core-driven, not terminal-plugin hardcoded.

---

## 10. Claude Code Scenario

Claude Code is the complex reference plugin.

### 10.1 Required User Workflow

User selects `relay-a` or `pc-leaf`, opens Claude Code.

If ready:

- Create Claude Code session.
- Stream conversation.
- Send stdin/prompt.
- Read stdout/stderr or structured output.
- Replay prior session.
- Stop/kill.
- View files modified.
- View cache usage.
- View process tree.
- View approvals.

If not ready:

- UI shows missing dependencies, unsupported capabilities, and missing grants separately.

### 10.2 Claude Code Requirement Matrix

| Requirement | Core Capability | Current Expected State | Needed For |
|---|---|---|---|
| CLI detection | `plugin.check`, `env.which`, `env.checkBinary` | implemented | readiness |
| Process spawn | `process.spawn` | implemented, platform-dependent | run CLI |
| PTY | platform feature | Linux full, Windows partial | interactive CLI |
| Stream write/read | `stream.write`, `stream.subscribe` | implemented | conversation |
| History/replay | `stream.replay`, `stream.tail`, `session.history.*` | implemented | session recovery |
| Stdin safety | history stdin redaction | implemented | secret protection |
| Process tree | not yet implemented | missing | child process tracking |
| Network declaration | `network.*` | not declared | permission/audit |
| File access | `fs.*` | implemented, constraints weak | code work |
| Permissions | `plugin.permissions.*` | implemented, approval incomplete | safety |
| Install lifecycle | `plugin.install`, `plugin.install.plan`, `plugin.install.execute`, `plugin.uninstall`, `plugin.files.register` | implemented (dry-run framework with PlanStore, approval flow, history; real package manager execution is NEXT step) | setup |
| Cache | `plugin.cache.clear.plan/execute` | implemented (bulk clear without plan still stub) | cleanup |
| Task tracking | `task.list`, `task.info` | implemented (TaskStore in-memory; install/uninstall/check/cache_clear task types) | progress visibility |
| Multiple sessions | `session.*` | implemented | multi-conversation |
| Cross-node execution | topology + target node | partial/needs verification | remote work |
| Mobile control | view over WS | partial | phone operation |

---

## 11. Capability Gaps From This Scenario

### P0 - Required Before Claude Code Is A Real Working Plugin

| Gap | Why It Matters |
|---|---|
| Capability support resolver | UI/Core must know full/partial/unsupported before action |
| Windows/Linux test portability | baseline must be trustworthy |
| OS-level subprocess tree tracking | Claude Code can spawn build/test/watch child processes |
| ~~Install plan/execute lifecycle~~ | ~~missing `claude` must be installable and visible~~ **Done (dry-run):** plan/approve/execute/uninstall/fils.register all implemented as dry-run framework; real package manager execution is P1 |
| ~~Approval workflow integration~~ | ~~high-risk grants and install must not bypass approval~~ **Done:** dispatcher Plan-Before-Apply gates high-risk operations; notify.respond provides approve/deny; PLAN_REQUIRED/APPROVAL_REQUIRED/APPROVAL_DENIED error codes returned |
| Platform-aware Terminal profile | Windows pipe fallback must be explicit |

### P1 - Needed For Safe Daily Use

| Gap | Why It Matters |
|---|---|
| `network.*` capability declaration | permission/audit for outbound network |
| Path constraints enforcement | file operations must be scoped |
| Background/detached process | long-running dev tasks |
| Disk plugin history | plugin history should survive restart |
| Cache size estimation | useful cleanup UX |
| Cross-node plugin.check verification | target node readiness must be trustworthy |

### P2 - Product Quality

| Gap | Why It Matters |
|---|---|
| Windows ConPTY | full Windows terminal experience |
| Shared Go/TS manifest schema | prevent UI/Core drift |
| Mobile optimized plugin manager | phone workflow quality |
| Structured Claude Code adapter | richer UI than terminal text |

---

## 12. Desired Architecture Direction

### 12.1 Capability Modules

Each capability family should have:

- Declaration.
- Platform support.
- Handler.
- Permission constraints.
- Tests.
- UI display contract.

Suggested shape:

```text
go-core/internal/capability/
  registry.go
  support.go
  resolver.go

go-core/internal/platform/
  platform.go
  windows.go
  unix.go

go-core/internal/executor/
  process_cmds.go
  stream_cmds.go
  fs_cmds.go
  env_cmds.go
  plugin_manage_cmds.go
  plugin_check_cmds.go
  plugin_install_cmds.go
  plugin_cache_cmds.go
  plugin_permission_cmds.go
```

### 12.2 Capability Resolution Flow

Before execution:

```text
1. Is capability declared by Core?
2. Is capability declared by plugin?
3. Is capability supported on target node platform?
4. Is runtime dependency available?
5. Is capability granted?
6. Does it require plan/approval?
7. Execute or return structured blockers.
```

The UI should receive blockers as a list:

```json
{
  "status": "blocked",
  "blockers": [
    {
      "kind": "unsupported",
      "capability": "pty",
      "targetNodeId": "pc-leaf",
      "reason": "windows_pipe_fallback"
    },
    {
      "kind": "missing_dependency",
      "dependency": "claude",
      "targetNodeId": "relay-a",
      "action": "install_plan_available"
    },
    {
      "kind": "missing_grant",
      "capability": "fs.write",
      "action": "request_permission"
    }
  ]
}
```

---

## 13. Recommended Execution Order

1. Fix Windows Go test portability.
2. ~~Correct the architecture audit status errors.~~ **Done:** docs updated to reflect post-Lifecycle+Approval+Task state.
3. ~~Split `plugin_cmds.go` without behavior changes.~~ **Done:** split into `plugin_install_cmds.go`, `plugin_cache_cmds.go`, `plugin_permission_cmds.go`, `plugin_files_cmds.go`, `plugin_manage_cmds.go`, `task_cmds.go`.
4. ~~Implement install plan/execute lifecycle.~~ **Done (dry-run):** plan/approve/execute/uninstall/files.register all implemented; TaskStore tracks progress. Real package manager execution is next.
5. ~~Integrate approval workflow for install/high-risk grants.~~ **Done:** dispatcher Plan-Before-Apply step via Planner interface; notify.respond approve/deny channel; error codes PLAN_REQUIRED/APPROVAL_REQUIRED/APPROVAL_DENIED.
6. Add capability support resolver and platform model.
7. Extend `plugin.check` to include capability support report.
8. Implement OS-level subprocess tree tracking.
9. Add `network.*` declaration and policy model.
10. Implement real package manager execution (wire process.spawn to install commands).
11. Start Claude Code plugin skeleton.

---

## 14. Final Verdict

The current architecture is viable but still Phase 1.

It is clean enough to continue, but not clean enough to start a complex Claude Code plugin without first adding platform/capability architecture.

The next real milestone is not "Claude Code runs once".

The next milestone is:

> A view connected through any relay can select any Core node and receive a truthful, structured answer about which plugin capabilities are declared, supported, granted, installed, missing, or blocked on that node.

Only after that milestone should Claude Code become the reference plugin.

