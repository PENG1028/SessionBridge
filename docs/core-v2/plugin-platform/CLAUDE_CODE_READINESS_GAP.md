# SessionNode v2 — Claude Code Readiness Gap Analysis

> Analysis of the SessionNode Go Core plugin platform against Claude Code integration requirements.
> Reference: CAPABILITY_STATUS.md, PLUGIN_CORE_API_CONTRACT.md, PLUGIN_MANIFEST_SPEC.md, PLUGIN_SECURITY_MODEL.md

---

## 1. Current Architecture Summary

SessionNode's Go Core is a WebSocket-based capability executor that exposes a unified capability API (`action.request` protocol) for all plugin operations. At its foundation, it provides a permission-checked dispatch system: incoming capability requests are validated against a three-layer intersection model (Actor permissions, Plugin Grants, and target node policy). The core ships with four built-in plugin identities (`sessionnode-core`, `shell`, `file-explorer`, `session`), each declaring their capabilities in the `AllPluginsCaps` registry. A plugin manifest system (`pluginmanifest` package) enables external plugins to declare permissions, environment checks, file declarations, and adapter contributions (system UI, CLI, daemon, webhook) via `plugin.yaml`.

The process management layer (`process.Manager`) supports spawning subprocesses via both pipe-based and PTY-based execution, with stream output pushed to connected WebSocket subscribers via push callbacks. History recording captures stdout/stderr events for replay and tail operations. A permission checking layer (`permission.Checker`) enforces that every capability invocation is both declared (in `AllPluginsCaps`) and granted (in policy store), with support for `allow`, `deny`, and `ask` modes.

The system is designed around a single-tenant architecture per process. Each node runs one Core instance, and remote nodes connect via authenticated WebSocket relays. The plugin platform is in Phase 1/stage of a multi-phase rollout, with core management capabilities implemented (list, get, status, permissions, config, cache plan/execute, and plugin history) and install/uninstall/files.register lifecycle operations still as stubs.

---

## 2. Claude Code Requirements vs Current Capabilities

| # | Requirement | Current Status | Gap |
|---|---|---|---|
| 1 | Create shell/PTY session | ✅ `process.spawn` (pipe/PTY) | PTY on Windows falls back to pipe |
| 2 | Background execution | ⏳ Partial | `process.spawn` blocks on `cmd.Wait()`; needs detached/nohup mode |
| 3 | Claude CLI detection | ✅ `plugin.check` | Real detection via `exec.LookPath`, `os.Getenv`, `exec.CommandContext`, `os.Stat` for 6 check types |
| 4 | Subprocess tree tracking | ❌ Partial | `Manager` tracks `ParentSessionID`/`RootSessionID` but no parent/child PID tree |
| 5 | stdout/stderr capture + history | ✅ `stream.subscribe` / `stream.replay` | History disk mode works; memory mode default |
| 6 | stdin save + sensitive data | ✅ Implemented | Two-layer defense-in-depth: default policy skips stdin; Record() redacts `[stdin redacted]` even when explicitly configured |
| 7 | `~/.claude` cache management | ❌ Missing | No Claude-specific path awareness in `plugin.cache.clear.*` |
| 8 | Node/npm cache management | ❌ Missing | No npm awareness in cache system |
| 9 | Plugin cache clear | ⏳ `plugin.cache.clear` (bulk) is stub; `plugin.cache.clear.plan`/`.execute` implemented | Minimal — no disk space tracking or size estimation; planId only checked for non-empty |
| 10 | `process.spawn` permission | ✅ Declared | In `AllPluginsCaps` for shell plugin, requires grant |
| 11 | `fs.read`/`fs.write` permission | ✅ Declared | For file-explorer plugin with path constraints |
| 12 | `env.read` permission | ✅ Declared | For shell plugin (`env.*` capabilities) |
| 13 | Network permission | ❌ Not declared | No `network.*` capability in `AllPluginsCaps` or permission system |
| 14 | Custom React UI adapter | ⏳ Partial | `system-ui` adapter declared; host rendering works for panels/views |
| 15 | Plugin management panel | ✅ `PluginManager` / `PluginDetail` | Basic capability status, grants, cache plan/execute, and settings save work; Claude-specific remediation UI remains |
| 16 | CLI adapter | ❌ Not implemented | CLI adapter spec exists (`PLUGIN_ADAPTERS.md`) but not wired into Core |

---

## 3. Detailed Gap Analysis

### 3.1 Create shell/PTY session

`process.spawn` supports both pipe-based (`Spawn()`) and PTY-based (`SpawnPTY()`) process creation. On Unix, `SpawnPTY` creates a proper pseudo-terminal with termios configuration. On Windows, `SpawnPTY` falls back to the pipe-based implementation because the Windows `os.Pipe` does not support PTY semantics natively. Cross-platform PTY requires a library like `github.com/creack/pty` (Unix) combined with Windows Pseudo Console (ConPTY) APIs via `github.com/microsoft/winpty` or the built-in Windows Terminal APIs. For Claude Code, which expects a proper terminal environment for CLI interactions, the pipe fallback means no `$TERM` variable, no raw mode, no signal forwarding — significantly degrading the experience on Windows.

### 3.2 Background execution

`process.Spawn()` launches an OS process via `exec.Command` and returns the session ID immediately, but the `cmd.Wait()` call runs in a separate goroutine. While the spawn itself does not block the caller, the process **cannot be detached** from the Core's lifecycle: if Core shuts down, all child processes are killed via `Cleanup()`. There is no `nohup` mode, no `detach` flag, and no way to reparent a process to init after Core exit. Long-running Claude Code tasks (e.g., `claude review --watch`) would terminate on Core restart or disconnect. A detached process mode needs: (1) a `detached: true` flag in `SpawnConfig`, (2) process reparenting or `exec.Command` with `SysProcAttr.CreationFlags` (Windows `DETACHED_PROCESS`) / `Setpgid` (Unix), and (3) a reaping mechanism to avoid zombies.

### 3.3 Claude CLI detection

`plugin.check` now performs real dependency detection. For each manifest-defined check entry, the handler dispatches to type-specific implementations:

| Check type | Method | Status values |
|---|---|---|
| `binary` | `exec.LookPath(name)` | ok, missing, skipped |
| `env` | `os.Getenv(name)` | ok, missing, skipped |
| `command` | `exec.CommandContext(cmd, args...)` with 5s timeout | ok, missing, skipped |
| `path` | `os.Stat(path)`, accepts file or directory | ok, missing, error, skipped |
| `file` | `os.Stat(path)`, rejects directory | ok, missing, error, type_mismatch, skipped |
| `directory` | `os.Stat(path)`, requires directory | ok, missing, error, type_mismatch, skipped |

The overall check status is `ok` if all required dependencies pass, or `incomplete` if any required dependency is missing. Optional missing dependencies do not affect the overall status.

**Known remaining gaps:** Version checking (`RequiredVersion` field exists in the manifest schema but is not compared at check time) and `VersionCommand` execution (field exists but is not run after the basic check). These are not P0 blockers for Claude Code integration.

### 3.4 Subprocess tree tracking

The `Manager` tracks `ParentSessionID` and `RootSessionID` for each process, and provides `DescendantIDs()` for breadth-first traversal of the tree. However, the tree is tracked at the **SessionNode process manager layer**, not at the OS PID level. If a spawned shell (`bash`) then spawns its own children (e.g., `npm run build`), those grandchildren are not individually tracked — the Manager only sees the top-level shell process. The `Signal` function supports a `tree: true` flag that signals descendants via `DescendantIDs()`, but it can only reach processes that were themselves spawned through the Manager. Claude Code needs OS-level process tree visibility for: resource tracking per session, orphan cleanup, and accurate process counting.

### 3.5 stdout/stderr capture + history

Stream output capture works through push callbacks that pipe output to WebSocket subscribers and optionally into the history store. Both memory mode and disk mode are implemented. `stream.subscribe` provides real-time output, `stream.replay` provides historical access, and `stream.tail` provides the last N lines. The history store supports mode configuration (`memory`, `disk`, `none`), per-stream event counting, and byte-accounting. This is one of the stronger areas — the main gap is the absence of size-based history truncation or rotation policies for disk mode.

### 3.6 stdin save + sensitive data

**Status: P0 ✅ DONE** — Two-layer defense-in-depth implemented.

The stdin security policy works at two levels:

**Layer 1 — Default History Policy:**
`DefaultHistoryPolicy()` returns `Streams: ["stdout", "stderr"]`. Since `"stdin"` is not in the default stream list, `Record()` in `history/store.go` skips stdin events via `trackStream()` before any data is stored. This is the primary gate.

**Layer 2 — Record-level redaction (defense-in-depth):**
Even if a caller explicitly includes `"stdin"` in `policy.Streams`, `Record()` replaces the data payload with `"[stdin redacted]"` before creating the `HistoryEvent`. This ensures:
- Event metadata is preserved (event type, stream type, timestamp, event sequence)
- Raw stdin data is never stored in memory or on disk
- BytesStored uses the redacted length (16 bytes), not the raw input size
- writeDiskLocked already skips stdin via `default: return`

**Scope:**
- `stream.write` to `stdin` on an existing process → writes to pipe directly, never calls `Record()` ✅ (already safe before this change)
- `stream.write` to `stdin` without running process (session-buffered) → calls `Record()` → data is `"[stdin redacted]"` ✅
- `stream.replay` / `stream.tail` for `streamType:"stdin"` → returns events with `data:"[stdin redacted]"` ✅
- stdout/stderr data → not affected ✅
- Terminal PTY echo (program echoes typed input to stdout) → not stdin, not in scope for this policy

**Test coverage:**
- `TestStore_StdinRedacted_StdoutStderrUnaffected` — mixed stdout/stderr/stdin: stdout/stderr retain data, stdin is redacted
- `TestStore_StdinRedacted_LargeData` — 100KB stdin payload: BytesStored = 16 (redacted), not 100000
- `TestStore_StdinRedacted_MultipleEvents` — 3 stdin events: all return `"[stdin redacted]"`
- `TestStore_StdinRedacted_Tail` — `stream.tail` returns redacted stdin data
- `TestStore_StdinSavedWhenExplicitlyConfigured` — explicit `Streams: ["stdin"]` still redacts data
- `TestStore_StdinNotSavedByDefault` — default policy skips stdin entirely (unchanged)

### 3.7 ~/.claude cache management

`plugin.cache.clear.*` operates on paths declared in the plugin manifest's `files.declarations` section with `clearable: true`. For Claude Code's `~/.claude` directory, this requires a Claude Code plugin manifest that declares its cache paths. Currently no such manifest exists. Additionally, the cache clear system provides no disk space tracking, no `du`-style size estimation before clearing, and no "days since last access" filtering. The `plan` step lists paths but does not estimate how much space would be freed — a key UX requirement for cache management.

### 3.8 Node/npm cache management

Node.js and npm cache directories (`node_modules`, `~/.npm`, `~/.cache`) are not declared in any existing manifest. The cache clear system is entirely manifest-driven — paths must be declared in a plugin's `files.declarations` for cache operations to know about them. For Claude Code, which frequently operates in Node.js projects, awareness of `node_modules` disk usage and npm cache would be a practical quality-of-life feature. This would require either (a) adding npm/node cache declarations to an existing manifest, or (b) building generic well-known-path detection into the cache system.

### 3.9 Plugin cache clear (existing)

The `plugin.cache.clear.plan` and `plugin.cache.clear.execute` capabilities work for declared paths (the bare `plugin.cache.clear` without plan is a stub returning `not_implemented`). `plugin.cache.clear.plan` lists paths and returns a `planId`, and `plugin.cache.clear.execute` requires that planId and performs the deletion. However, the system does not estimate the size of paths before clearing, does not show "last accessed" timestamps, and does not support selective clearing (per-file or per-directory within a declared path). A disk space tracking layer would transform this from "delete these paths" to "you can free N MB by clearing these caches."

### 3.10-3.12 Permissions: process.spawn, fs.read/write, env.read

These capabilities are declared in `AllPluginsCaps` for their respective plugins (`shell`, `file-explorer`) and are covered by the permission checking system. The grant store supports `allow`, `deny`, and `ask` modes with path constraints for filesystem operations. `plugin.permissions.grant` and `plugin.permissions.revoke` now write through the config manager, so ordinary grant persistence is no longer a Claude Code blocker. The remaining gap is approval integration for high-risk capabilities: `grant` can return `requires_approval`, but the full approval workflow is not yet connected end to end.

### 3.13 Network permission

No `network.*` capability exists anywhere in the system: not in `AllPluginsCaps`, not in the permission registry, not in the executor handlers. Claude Code needs network access for API calls to Anthropic, package registry fetches, git operations, and other HTTP interactions. Without a declared network capability, Claude Code has no way to request or be granted network access through the permission system. This is a significant gap for the permission/audit model: the Claude CLI subprocess can technically make its own network calls as any OS process can, but without a `network.*` declaration the Core cannot enforce domain/port constraints, log outbound access, or present permission prompts. The network permission should be declared with constraints for allowed domains, protocols, and ports.

### 3.14 Custom React UI adapter

The `system-ui` adapter in the manifest system supports `custom-react` and `host-rendered` view types. The `custom-react` type allows plugins to ship their own React components that render in the System UI host. This works for basic views and panels. For Claude Code, the adapter would need to support: (1) a full Claude Chat view with streaming Markdown rendering, (2) session timeline panels, (3) a diff viewer for code changes, (4) a permission request modal. The architecture supports these as custom React entries — the gap is that the System UI host integration (component loading, sandboxing, message passing) is implementation work, not an architectural limitation.

### 3.15 Plugin management panel

The PluginManager and PluginDetail panels exist in the frontend. Tab-based navigation works, implemented vs `not_implemented` capability status is surfaced, grant state is displayed, cache clear runs through plan/execute, and settings writes call `plugin.config.set`. The remaining UI gap for Claude Code is not basic capability awareness, but the richer plugin experience: dependency remediation, approval modals, streaming session controls, and custom Claude Code views.

### 3.16 CLI adapter

The CLI adapter specification exists in `PLUGIN_ADAPTERS.md` with detailed command declaration format, argument schemas, and output formatting. However, the CLI adapter **runtime** is not implemented. There is no CLI command parser, no argument validator, and no routing from CLI commands to capability invocations. The `adapters.cli` section in manifests is parsed but not acted upon. For Claude Code, which needs CLI commands like `claude start`, `claude review`, `claude check`, the CLI adapter runtime must be built. The spec is ready; the implementation is not.

---

## 4. Implementation Priority

### P0 — Must Have Before Claude Code Integration

| Priority Item | Gap Reference | Effort Estimate | Status |
|---|---|---|---|
| **Subprocess tree tracking** | §3.4 | Medium (2-3 days) | ❌ Not implemented |
| **Stdin security policy** | §3.6 | Small (1-2 days) | ✅ Implemented — two-layer defense-in-depth: default policy excludes stdin; Record() redacts even if explicitly configured |

**Justification:** Without subprocess tree tracking, Claude Code cannot properly manage long-running child processes spawned by its commands (build tools, test runners, watchers). Stdin security policy is now implemented — sensitive data entered through Claude Code sessions is always redacted before history storage. (Claude CLI detection, plugin.check real resolution, and stdin security policy are now implemented and no longer P0 blockers.)

### P1 — Should Have

| Priority Item | Gap Reference | Effort Estimate | Dependencies |
|---|---|---|---|
| **Cache size estimation** | §3.7, §3.9 | Small (1-2 days) | `plugin.cache.clear.plan` extension |
| **Network permission** | §3.13 | Medium (2-3 days) | New capability declaration + permission constraints |
| **Background/detached execution** | §3.2 | Medium (3-5 days) | Process Manager spawn mode; OS-specific process flags |
| **Plugins with size estimation** | §3.8 | Small (1 day) | Additional manifest declarations |
| **Approval workflow integration** | §3.10-3.12 | Medium (2-3 days) | Approval request/response wiring for high-risk grants |

**Justification:** Cache management without size estimation is a poor user experience — users cannot make informed decisions about what to clear. Network permission is needed for any useful AI interaction but could be temporarily bypassed. Background execution enables long-running tasks to survive Core restart or disconnect. High-risk grants already report that approval is required, but Claude Code needs the approval flow wired through before those operations feel complete.

### P2 — Nice to Have

| Priority Item | Gap Reference | Effort Estimate | Dependencies |
|---|---|---|---|
| **Full PTY on Windows** | §3.1 | Large (1-2 weeks) | ConPTY API integration |
| **Sensitive data redaction** | §3.6 | Medium (3-5 days) | Pattern engine + configurable redaction rules |
| **History size-based rotation** | §3.5 | Small (1-2 days) | History store extension |
| **CLI adapter runtime** | §3.16 | Large (1-2 weeks) | New package for CLI command parsing/routing |
| **Capability-aware plugin panels** | §3.15 | Small (1-2 days) | Frontend-only change |

**Justification:** These items improve quality of life but are not blockers for initial Claude Code integration. Full PTY on Windows can be deferred if pipe mode is acceptable for initial use. Sensitive data redaction can be added post-launch. The CLI adapter runtime and richer Claude-specific panels are frontend/UX work that can be layered on.

---

## 5. Current Capability API Contract

The capability API contract is defined in [PLUGIN_CORE_API_CONTRACT.md](./PLUGIN_CORE_API_CONTRACT.md).

### Key Contract Bindings

```
All capability calls through: action.request (WebSocket message type)
  → Request: { type: "action.request", requestId, capability, targetNodeId?, payload }
  → Response: { type: "action.response", requestId, ok, payload?, error? }

PluginId injected by Core at connection authentication time.
  → NOT taken from payload — prevents spoofing.

Permission model:   Effective = Actor ∩ Grant ∩ TargetNodePolicy
Dangerous ops:      Plan → Approve → Execute (3-phase)
```

### Registered Capability Namespace Summary

All handlers are registered in `executor/registry.go`. Each capability maps to an `ExecFunc` with signature `func(req *types.CapabilityRequest, deps *Deps) (interface{}, error)`. The `Deps` struct provides access to sessions, processes, config, manifests, history, and topology.

### Capability Naming Convention

```
<namespace>.<verb>
Examples: fs.read, session.create, process.spawn, plugin.list
Namespaces: session, stream, process, fs, env, plugin, node, notify, config, logs, audit
```

See [PLUGIN_CORE_API_CONTRACT.md](./PLUGIN_CORE_API_CONTRACT.md) for the full capability reference.

---

## 6. Plugin Identity Contract

Each plugin uses a **scoped CoreClient**, NOT the `sessionnode-core` identity. This is a critical architectural boundary:

| Plugin | Identity | CoreClient Scope | Declared In |
|---|---|---|---|
| `shell` | Plugin identity `"shell"` | Scoped to `shell` capabilities | Manifest (`plugins/shell/plugin.yaml`) |
| `claude-code` | Plugin identity `"claude-code"` | Scoped to `claude-code` capabilities | Manifest (not yet created) |
| `file-explorer` | Plugin identity `"file-explorer"` | Scoped to `file-explorer` capabilities | Manifest (`plugins/file-explorer/plugin.yaml`) |
| `session` | Plugin identity `"session"` | Scoped to `session` capabilities | Manifest (`plugins/session/plugin.yaml`) |
| `system-ui` | System identity `"system-ui"` | Administrative — can manage plugins | Built-in (not a manifest plugin) |
| `sessionnode-core` | Built-in core identity | Self-management + node ops | Built-in |

### Identity Assignment Flow

```
1. Plugin discovered via manifest → registered in Core Registry
2. WebSocket connection authenticates → Core assigns pluginId from token/manifest
3. CoreClient instantiated → pluginId injected (cannot be overridden by client)
4. action.request sent → Dispatcher uses connection's pluginId, not payload's
5. Permission check → Core checks Grant for that pluginId + capability
```

### External Client Identity

External clients (scripts, tools) use a Service Token instead of a plugin identity:

```
Token → Authenticator → Actor { Type: "external", ID: "script" }
No pluginId → Cannot call Plugin Management API
Capabilities limited to explicitly granted set (not manifest-driven)
```

### Implications for Claude Code

Claude Code would operate as a **feature plugin** with its own `claude-code` plugin identity. It would:
- Have its own manifest (`plugins/claude-code/plugin.yaml`)
- Declare required capabilities in `core.permissions`
- Declare UI contributions in `adapters.systemUi`
- Declare CLI commands in `adapters.cli`
- NOT have `sessionnode-core` identity (cannot self-manage)
- Be subject to the same permission model as any other plugin
- NOT be able to bypass permission checking

---

## 7. UI Adapter Surface

### What is Available

| Adapter Type | Capabilities | Status |
|---|---|---|
| `system-ui` views | Custom React components rendered in main surface | ✅ Working for registered plugins |
| `system-ui` panels | Custom React components rendered in panel slots (bottom, sidebar) | ✅ Working |
| `system-ui` commands | Keyboard shortcuts and command palette entries | ✅ Working |
| `system-ui` status | Status bar indicators with click handlers | ✅ Working |
| `system-ui` configuration | JSON Schema based settings form | ✅ Working |
| `system-ui` menus | Context menu contributions | ✅ Working |
| `cli` commands | CLI command declarations in manifest | ⏳ Spec only — runtime not implemented |
| `daemon` tasks | Background scheduled tasks | 🔜 Planned |
| `webhook` endpoints | External HTTP webhook handlers | 🔜 Planned |

### What Claude Code Needs for Custom React

Claude Code would require the following React UI components as `custom-react` entries:

| Component | Type | Adapter Declaration | Status |
|---|---|---|---|
| Claude Chat View | `system-ui` view | `adapters.systemUi.views[].type: custom-react` | ✅ Architecture supports; implementation pending |
| Session Timeline Panel | `system-ui` panel | `adapters.systemUi.panels[].type: custom-react` | ✅ Architecture supports |
| Permission Request Modal | Host-rendered or custom | Permission system triggers; can be system built-in | 🔜 Needs System UI integration |
| Diff Viewer | `system-ui` view | `type: custom-react` | ✅ Architecture supports |
| Plugin Cache Manager | Host-rendered | `componentId: PluginCacheTable` | ✅ Built-in component exists |
| File Explorer | `system-ui` view | `type: custom-react` | ✅ Architecture supports |

### Rendering Mode Decision

| Type | Trust Level | When to Use |
|---|---|---|
| `custom-react` (same-origin) | High | Claude Chat View, Diff Viewer — trusted first-party components |
| `custom-react` (iframe) | Low | Third-party plugin UIs only |
| `host-rendered` | Highest | Permission modals, cache tables, configuration forms — System UI built-in components |

### Gap: Component Communication Protocol

Claude Code's React components need a bidirectional message channel to: (1) send capability requests to Core, (2) receive stream data for real-time rendering, (3) receive session events for status updates. The current adapter architecture supports `action.request` via the CoreClient, but a dedicated message channel for streaming data to UI components (not just WebSocket subscribers) needs to be established. This could leverage the existing `ConnRoutes` subscription mechanism.

---

## Appendix A: Capability Coverage Summary for Claude Code

| Domain | Required Capabilities | Current Status | P0 Gap |
|---|---|---|---|
| Process execution | `process.spawn`, `process.signal`, `process.resize`, `process.list` | ✅ Implemented | Background mode (P1) |
| Session management | `session.create`, `session.destroy`, `session.list`, `session.info` | ✅ Implemented | None |
| Stream I/O | `stream.subscribe`, `stream.write`, `stream.replay`, `stream.tail`, `stream.list` | ✅ Implemented | None |
| Filesystem | `fs.read`, `fs.write`, `fs.list`, `fs.stat`, `fs.mkdir`, `fs.remove` | ✅ Implemented | None |
| Environment | `env.get`, `env.list`, `env.checkBinary`, `env.which`, `env.home`, `env.cwd` | ✅ Implemented | `plugin.check` binary/command/env detection (P0 ✅ DONE) |
| Network | `network.*` | ❌ Not declared | New capability (P1) |
| Plugin management | `plugin.list`, `plugin.status`, `plugin.cache.plan/execute`, `plugin.config.*` | ✅ Partially (cache.clear bulk is stub) | Size estimation (P1) |
| History | `session.history.*` | ✅ Implemented | Stdin redaction (P0) |
| Permissions | `plugin.permissions.*` | ✅ Partially | Grant persistence (P1) |
| Notification | `notify.*` | ✅ Implemented | None |

---

> **Last updated:** 2026-05-20
> **Related docs:** [CAPABILITY_STATUS.md](./CAPABILITY_STATUS.md) | [PLUGIN_CORE_API_CONTRACT.md](./PLUGIN_CORE_API_CONTRACT.md) | [PLUGIN_MANIFEST_SPEC.md](./PLUGIN_MANIFEST_SPEC.md) | [PLUGIN_SECURITY_MODEL.md](./PLUGIN_SECURITY_MODEL.md) | [PLUGIN_ADAPTERS.md](./PLUGIN_ADAPTERS.md) | [PLUGIN_LIFECYCLE.md](./PLUGIN_LIFECYCLE.md)
