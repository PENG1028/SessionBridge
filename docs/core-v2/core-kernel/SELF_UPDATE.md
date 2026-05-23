# SessionNode v2 — Self-Update Status & Planning Baseline

> Core self-update awareness and safety base. This implements the update checking
> and planning layer WITHOUT actual auto-update execution.
> **update.apply is intentionally never registered.**
> Related: CAPABILITY_STATUS.md, APP_UI_API_MAP.md

---

## 目录

1. [Design Principles](#1-design-principles)
2. [Data Model](#2-data-model)
3. [Capabilities](#3-capabilities)
4. [Update Check Flow](#4-update-check-flow)
5. [Update Plan Blocker System](#5-update-plan-blocker-system)
6. [Persistence](#6-persistence)
7. [Security & Constraints](#7-security--constraints)
8. [UI Integration](#8-ui-integration)

---

## 1. Design Principles

### 1.1 What's IN scope

- **update.status** — read-only snapshot of current update state
- **update.source** — configure git remote/branch/mode
- **update.policy** — configure check behavior and blockers
- **update.check** — git ls-remote + rev-parse HEAD + commit comparison (side-effect-free, never applies)
- **update.plan** — dry-run plan with blocker enumeration (side-effect-free)
- **update.ignore** — skip specific remote commits

### 1.2 What's OUT of scope (intentionally)

- `update.apply` — never registered, never implemented
- Auto git pull / auto merge
- Auto restart after update
- Plugin marketplace / plugin install / plugin update
- Binary download or replacement
- **git fetch / git pull** — Core never executes these; update.check uses read-only `git ls-remote`

### 1.3 Git-Only Source

Only `type: "git"` is supported. The GitRunner abstraction (see `go-core/internal/update/git.go`) enables a fake runner in tests without requiring a real git repository. All GitRunner methods are **side-effect-free** with respect to the working copy and remote tracking refs — no fetch, pull, merge, or push.

---

## 2. Data Model

### 2.1 UpdateSource

```go
type UpdateSource struct {
    Type    string `json:"type"`    // "git" (only supported type)
    Remote  string `json:"remote"`  // default "origin"
    Branch  string `json:"branch"`  // default "main"
    RepoURL string `json:"repoUrl"` // remote fetch URL
    Mode    string `json:"mode"`    // "manual" | "auto-check"
}
```

Validation:
- `type` must be `"git"`
- `mode` must be `"manual"` or `"auto-check"`
- `remote` and `branch` are required

### 2.2 UpdatePolicy

```go
type UpdatePolicy struct {
    AutoCheck            bool     `json:"autoCheck"`
    AutoApply            bool     `json:"autoApply"`            // MUST be false
    CheckIntervalSeconds int      `json:"checkIntervalSeconds"`  // default 86400 (24h)
    AllowDirtyWorktree   bool     `json:"allowDirtyWorktree"`
    AllowWhenRunsActive  bool     `json:"allowWhenRunsActive"`
    IgnoredVersions      []string `json:"ignoredVersions"`
}
```

Constraints:
- `autoApply` is rejected if `true` — `update.apply` does not exist
- `checkIntervalSeconds` must be >= 0
- `ignoredVersions` stores commit hashes to skip

### 2.3 UpdateStatus

```go
type UpdateStatus struct {
    Status          StatusValue  `json:"status"`
    CurrentCommit   string       `json:"currentCommit"`
    RemoteCommit    string       `json:"remoteCommit"`
    BehindBy        int          `json:"behindBy"`
    Dirty           bool         `json:"dirty"`
    Source          UpdateSource `json:"source"`
    LastCheckedAt   int64        `json:"lastCheckedAt"`
    LastCheckError  string       `json:"lastCheckError,omitempty"`
    RequiresRestart bool         `json:"requiresRestart"`
}
```

Status values: `unknown`, `checking`, `up-to-date`, `update-available`, `error`

---

## 3. Capabilities

| Capability | Handler | Notes |
|---|---|---|
| `update.status` | `updateStatus` | Returns current `UpdateStatus` snapshot |
| `update.source.get` | `updateSourceGet` | Returns current `UpdateSource` |
| `update.source.set` | `updateSourceSet` | Validates and persists new source |
| `update.policy.get` | `updatePolicyGet` | Returns current `UpdatePolicy` |
| `update.policy.set` | `updatePolicySet` | Merges and persists new policy |
| `update.check` | `updateCheck` | Git ls-remote + rev-parse HEAD + commit comparison; updates status. Side-effect-free: does NOT write .git/refs/ or FETCH_HEAD |
| `update.plan` | `updatePlan` | Enumerates blockers; returns canUpdate + steps. Side-effect-free: never calls fetch or pull |
| `update.ignore` | `updateIgnore` | Adds commit hash to `ignoredVersions` |

All capabilities are registered in `executor/registry.go`, `pluginmanifest/capabilities.go`, and `capability/support.go`.

---

## 4. Update Check Flow

```
update.check (entirely side-effect-free)
  ├── Manager.Status → "checking"
  ├── GitRunner.HeadCommit()                → currentCommit  (git rev-parse HEAD, read-only)
  ├── GitRunner.RemoteHead(remote, branch)  → remoteCommit   (git ls-remote, read-only)
  ├── GitRunner.IsDirty()                   → dirty          (git status --porcelain, read-only)
  ├── Compare currentCommit vs remoteCommit → behindBy
  ├── Check if remoteCommit is in policy.IgnoredVersions
  ├── Set status: "up-to-date" or "update-available"
  └── Manager.SetStatus(...)
```

**Critical invariant**: `update.check` does NOT write to `.git/refs/remotes/`, `FETCH_HEAD`, or any other git state. The only persistence is Core's own `update-status.json` in dataDir.

### 4.1 Git Commands Used

| Operation | git command | Side effects |
|---|---|---|
| Current HEAD | `git rev-parse --verify HEAD` | None (local read) |
| Remote HEAD | `git ls-remote <remote> refs/heads/<branch>` | None (remote read, no local writes) |
| Dirty check | `git status --porcelain` | None (local read) |

Unlike `git fetch` which writes remote tracking refs and FETCH_HEAD, `git ls-remote` only queries the remote and returns the ref tip hash — it never modifies the local repository.

### 4.2 Ignored Versions

If `remoteCommit` is in `policy.IgnoredVersions`, the status is set to `up-to-date` even when `behindBy > 0`. This allows administrators to skip specific commits without changing the update source.

---

## 5. Update Plan Blocker System

`update.plan` returns `canUpdate: false` with blocker details when any of:

| Blocker | Condition | Override |
|---|---|---|
| `dirty_worktree` | Worktree has uncommitted changes | `policy.allowDirtyWorktree: true` |
| `active_runs` | One or more runs in `running` state | `policy.allowWhenRunsActive: true` |
| `no_git_runner` | GitRunner not available | Requires git repo |

### 5.1 Plan Steps (when canUpdate)

1. `git_pull` — `git pull --ff-only <remote> <branch>` (informational only, never executed by Core)
2. `restart_core` — restart sessionBridge Core to apply (informational only, never executed by Core)

Note: All plan steps are informational only; **they are never executed by Core**.

---

## 6. Persistence

Three JSON files under `{dataDir}/`:

```
{dataDir}/update-source.json
{dataDir}/update-policy.json
{dataDir}/update-status.json
```

All writes use atomic `tmp + rename` pattern (see `go-core/internal/update/persist.go`).

The `Manager` loads from disk on creation and persists on every mutation.

---

## 7. Security & Constraints

- **No auto-apply**: `autoApply` is rejected if `true`; `update.apply` is never registered
- **No auto-restart**: plan step 3 is informational only
- **No binary download**: Only git operations; no HTTP fetch of artifacts
- **Side-effect-free check**: `update.check` uses only read-only git commands (`rev-parse`, `ls-remote`, `status --porcelain`). Never writes to `.git/` or modifies the working tree. Only persists Core metadata (`update-status.json` in dataDir)
- **Permission**: All `update.*` capabilities are granted to `sessionnode-core` (system UI only)

---

## 8. UI Integration

The Settings page (`app/console/system-pages/settings.tsx`) includes an "Update" tab with:

- **Source Section**: Type (read-only: git), Mode (manual/auto-check), Remote, Branch, Repo URL
- **Policy Section**: Auto Check toggle, Check Interval, Allow Dirty Worktree, Allow When Runs Active
- **Status Section**: Current status badge, behind-by count, dirty flag, requires-restart flag, commit hashes, last checked timestamp
- **Actions**: "Check Now" button (calls `update.check`), "Plan" button (calls `update.plan`)
- **Ignored Versions**: List of ignored commit hashes with un-ignore action
