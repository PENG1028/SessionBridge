# Remote Operation — Architecture Analysis & Unified Design

## 1. Current Code Paths — Inventory

### 1.1 Terminal/Shell Path (shell.spawn / shell.input / shell.output)

```
Browser A                    Relay                      Agent B
  │                           │                           │
  │── shell.spawn ───────────>│                           │
  │   {instanceId}            │── relay.shell.spawn ────>│
  │                           │   {instanceId, dir}       │
  │                           │                           │ (agent spawns PTY)
  │                           │<── agent.stdout ──────── │
  │<── shell.output ──────────│   {data, stream}          │
  │                           │                           │
  │── shell.input ───────────>│                           │
  │   {instanceId, data}      │── agent.stdin ──────────>│
  │                           │   {instanceId, data}      │
```

**Key structures:**
- `shellSubscribers: Map<instanceId, Set<WebSocket>>` — who gets shell.output
- `shellWsMap: Map<WebSocket, Set<instanceId>>` — instance ownership tracking
- `shellLockMap: Map<instanceId, WebSocket>` — write-lock (unused in enforcement)
- `pendingShellSpawns: Map<instanceId, Promise>` — dedup in-flight spawns
- `outputBuffer: string[]` on InstanceData — replay buffer (512KB cap)
- `spawnShellForWs()` — the spawn function with remote/local branching
- `sendStdin()` — routes input to agent (remote) or local handle/process
- `broadcastShellOutput()` — scoped to shellSubscribers only
- `subscribeShellOutput()` — registers WS to shellSubscribers + auto-cleanup on close

**What's terminal-specific:**
- The entire `shell.*` message namespace
- `shellSubscribers` map — only covers shell output
- `spawnShellForWs` — hardcoded for terminal adapter/shell capability
- `sendStdin` — stdin concept, not applicable to plugins
- Replay tied to `outputBuffer` on the instance, only replayed by shell.spawn

### 1.2 Agent stdout/stderr/stdin Path

```
Relay                      Agent B
  │                           │
  │<── agent.stdout ──────── │  (raw shell output)
  │    {instanceId, data}     │
  │                           │
  │<── agent.stderr ──────── │
  │    {instanceId, data}     │
  │                           │
  │── agent.stdin ──────────>│  (shell input forwarded to agent)
  │    {instanceId, data}     │
```

**Key structures:**
- `agent.stdout` → recently fixed to use `broadcastShellOutput()` (scoped)
- `agent.stderr` → also fixed to `broadcastShellOutput()`
- `agent.stdin` → sent by `sendStdin()` for remote instances

**What's terminal-specific:**
- The entire `agent.stdin` / `agent.stdout` / `agent.stderr` namespace assumes a shell
- No equivalent for plugin output, command results, or structured events from agent

### 1.3 Instance Command Path (instance.command / extension commands)

```
Browser A                    Relay                      
  │                           │                          
  │── instance.command ─────>│                          
  │   {name, args, instanceId}│                          
  │                           │── targetInst.handle.sendCommand(cmd.id, args)
  │                           │   (LOCAL only — no remote forwarding!)
  │<── instance.command_result│                          
```

**Key structures:**
- Extension-contributed commands via `extensionPoints.findCommand(name)`
- Dispatched to `targetInst.handle.sendCommand()` — works for local instances only
- No remote equivalent: if target instance is remote, `sendCommand` is not forwarded

**What's missing:**
- Remote `instance.command` forwarding (relay → agent)
- Agent-side command execution and result reporting
- No `agent.command_result` or equivalent message type

### 1.4 Instance Manager

**Key structures:**
```typescript
InstanceData {
  id, dir, label, status, source ('local'|'remote'),
  agentConnection: WebSocket | null,
  outputBuffer: string[],    // raw text buffer (terminal-oriented)
  blockBuffer: Record[],     // structured blocks (Claude-oriented)
  adapterState: Record,      // generic state bag
  handle?: InstanceHandle,   // local adapter handle
  currentOperation: OperationState | null,
  operationHistory: OperationState[],
}
```

**Problems:**
- `outputBuffer` is raw text — no structured operation output
- `blockBuffer` is adapter-specific — not generic operation output
- `currentOperation` is instance-level — can't have multiple concurrent operations
- No notion of "operation subscribers" — only shell subscribers
- `agentConnection` is the only link to remote agent — no routing by operation kind

### 1.5 Workbench Tab Sync

```
Browser A                    Relay                      Browser B
  │                           │                           │
  │── workbench.tabs ───────>│                           │
  │   {nodeId, tabs}          │── broadcastTabs() ──────>│
  │                           │   (to other subscribers)  │
```

**Key structures:**
- `workbenchTabStore: Map<nodeId, Tab[]>` — per-node tab state
- `workbenchSubscribers: Map<nodeId, Set<WebSocket>>` — per-node subscribers
- `syncTabsByLabel()` — cross-relay label-based tab mapping
- Tab format: `{id, title, viewType, instanceId}`
- `collectAllTabs()` / `buildStateFromTabs()` in workbench-state.ts

**What's terminal-specific:**
- Tab `instanceId` field is used by terminal tabs — but the mechanism is generic
- Tab `viewType` determines which view component renders

### 1.6 Agent Registration

```
Agent B                     Relay
  │                           │
  │── hello {role:agent} ──>│
  │<── welcome ─────────────│
  │── agent.register ──────>│
  │   {dir, label, adapterId}│
  │                           │── instanceManager.create(..., 'remote', adapterId)
  │                           │── remoteInst.agentConnection = ws
  │<── agent.registered ──── │
  │   {instanceId}            │
  │                           │── broadcast instance.added
```

**Key structures:**
- `ws._isAgent = true` — marks WebSocket as agent
- `ws._agentInstanceId` — links agent WS to its instance
- `agentVersionMap` — per-agent version tracking

### 1.7 Cross-Relay (Upstream/Downstream)

```
VPS Relay (hub)              Local Relay (leaf)          Agent
  │                           │                           │
  │<── upstream connection ──│                           │
  │                           │── agent.register ───────>│
  │<── workbench.tabs ────── │                           │
  │   (forwarded from leaf)   │                           │
```

**Key structures:**
- `_sendUpstream(type, body)` — send message to upstream relay
- `onUpstreamMessage(msg)` — handle messages from downstream relay
- `syncTabsByLabel()` — label-based tab ID remapping across relays

---

## 2. Terminal-Specific vs. Generalizable

| Concept | Terminal-Specific | Can Generalize |
|---|---|---|
| Instance lifecycle (create, status, kill) | tied to InstanceManager | Already generic |
| Subscriber tracking | `shellSubscribers` (per-instanceId) | Generalize to `operationSubscribers` |
| Output broadcast | `broadcastShellOutput()` | Generalize to `broadcastOperationOutput()` |
| Output buffer replay | `outputBuffer` on InstanceData | Generalize to `operationOutputBuffer` |
| Remote proxy | `relay.shell.spawn` → agent | Generalize to `relay.operation.start` |
| Input forwarding | `agent.stdin` | Generalize to `agent.operation.input` |
| Agent output → browsers | `agent.stdout` → `shell.output` | Generalize to `agent.operation.output` |
| Status lifecycle | implicit (running/stopped) | Generalize to explicit `operation.status` |
| Error routing | `INSTANCE_NOT_FOUND`, `REMOTE_AGENT_DISCONNECTED` | Same errors, shared |
| No-fallback rule | Only in shell.spawn (recent fix) | Must apply to ALL remote operations |
| workbench.tabs | Generic tab sync with instanceId | Already generic, just needs operationId field |

---

## 3. Design Problems Found

### P1: No remote command/plugin execution path
`instance.command` only dispatches to local `handle.sendCommand()`. If the target instance is remote, the command silently does nothing. There's no `relay.operation.start` equivalent for non-terminal operations.

### P2: outputBuffer is unstructured text
The output buffer stores raw strings. For a plugin operation returning JSON results, this is inadequate. There should be a structured operation output format.

### P3: shellSubscribers is shell-only
Only `shell.spawn` registers subscribers. There's no equivalent for plugin operations, commands, or tasks. If a plugin runs on agent B and produces output, only shell subscribers receive it.

### P4: No concurrent operation support
`InstanceData.currentOperation` is a single slot. An instance can only have one active operation. A node should be able to run multiple concurrent operations (terminal + plugin + task).

### P5: agent.stdin/stdout/stderr is terminal-specific protocol
The agent protocol has no equivalent for non-terminal operations. There's no way for an agent to report "plugin X completed with result Y" except through ad-hoc messages.

### P6: Fallback IS the root cause of VPS Ubuntu bug
The recent fix in `spawnShellForWs` removed the local fallback, but the pattern could reappear in any new remote feature unless the rule is enforced at the infrastructure level.

---

## 4. Unified RemoteOperation Model

### 4.1 Core Types

```typescript
type OperationKind = 'terminal' | 'plugin' | 'adapter_command' | 'task';

type OperationStatus = 'pending' | 'starting' | 'running' | 'completed' | 'failed';

interface RemoteOperation {
  operationId: string;          // unique ID (op_N_timestamp)
  nodeId: string;               // target instance/node ID
  kind: OperationKind;
  status: OperationStatus;
  
  // Request context
  pluginId?: string;            // extension plugin ID
  command?: string;             // command name
  input?: Record<string, unknown>;  // structured input for plugins
  
  // Tracking
  createdBy: string;            // browser clientToken
  createdAt: number;
  completedAt?: number;
  
  // Output
  outputBuffer: OperationOutput[];
  outputSize: number;
  
  // Result
  result?: OperationResult;
  error?: string;

  // Subscribers (WebSockets receiving output)
  subscribers: Set<WebSocket>;
}

interface OperationOutput {
  seq: number;
  stream: 'stdout' | 'stderr' | 'structured';
  data: string;
  timestamp: number;
}

interface OperationResult {
  success: boolean;
  data?: Record<string, unknown>;
  exitCode?: number;
}
```

### 4.2 Protocol Messages

```
Browser → Relay:
  operation.start     { nodeId, kind, pluginId?, command?, input? }
  operation.input     { operationId, data }
  operation.cancel    { operationId }
  operation.subscribe { operationId }              // late joiner

Relay → Agent:
  relay.operation.start  { operationId, kind, pluginId?, command?, input?, dir }
  relay.operation.input  { operationId, data }
  relay.operation.cancel { operationId }

Agent → Relay:
  agent.operation.output  { operationId, seq, stream, data }
  agent.operation.status  { operationId, status, detail? }
  agent.operation.result  { operationId, success, data?, exitCode?, error? }

Relay → Browser:
  operation.status    { operationId, nodeId, kind, status, detail? }
  operation.output    { operationId, seq, stream, data }
  operation.result    { operationId, success, data?, exitCode?, error? }
  operation.error     { operationId, code, message }
```

### 4.3 Subscriber Model

```
operationSubscribers: Map<operationId, Set<WebSocket>>

subscribeOperation(operationId, ws):
  - adds ws to operationSubscribers[operationId]
  - auto-cleanup on ws close

unsubscribeOperation(operationId, ws):
  - removes ws
  - if set empty, delete key

broadcastOperationOutput(operationId, output):
  - sends to all subscribers of operationId
  - appends to operation.outputBuffer (capped at 512KB)

broadcastOperationStatus(operationId, status):
  - sends to all subscribers
  - also broadcasts to node subscribers (workbench.operation.event)
```

### 4.4 Replay for Late Joiners

When a client sends `operation.subscribe { operationId }`:
1. Relay looks up the operation
2. Sends `operation.status` with current status
3. Replays `outputBuffer` via `operation.output` messages
4. Registers the WS for future live output
5. If operation is `completed`/`failed`, also sends `operation.result`

### 4.5 Routing Rules (THE KEY INVARIANTS)

```
RULE 1: Target node MUST exist
  → if !instanceManager.get(nodeId): return TARGET_NOT_FOUND

RULE 2: Remote target agent MUST be connected
  → if instance.source === 'remote' && !agentConnection?.OPEN: return AGENT_DISCONNECTED

RULE 3: NO fallback to local execution
  → never create local instance as fallback
  → never run operation on relay instead of agent

RULE 4: Output SCOPE to subscribers only
  → never use broadcast() for operation output
  → always use broadcastOperationOutput(operationId, ...)

RULE 5: Status changes broadcast to subscribers
  → starting → running → completed/failed
  → also visible via workbench.operation.event for node subscribers

RULE 6: Late joiners get full replay
  → status + outputBuffer + result (if terminal)
```

### 4.6 Terminal as OperationKind='terminal'

The existing shell flow becomes a special case:

```
operation.start { nodeId, kind:'terminal' }
  → spawnShellForWs logic, but unified under RemoteOperationManager
  → creates operation with kind='terminal'
  → subscribers = shellSubscribers (backward compat)

shell.spawn → wraps operation.start (kind='terminal')   [deprecated, kept compat]
shell.input → wraps operation.input                     [deprecated]
shell.output → wraps operation.output                   [deprecated]
```

`workbench.tabs` entries gain optional `operationId` field:
```typescript
tab = { id, title, viewType, instanceId, operationId? }
```

### 4.7 Plugin as OperationKind='plugin'

```
Browser A:
  operation.start {
    nodeId: remoteInstanceId,
    kind: 'plugin',
    pluginId: 'mock-plugin',
    command: 'echo',
    input: { text: 'hello' }
  }

Relay → Agent B:
  relay.operation.start { operationId, kind:'plugin', pluginId, command, input, dir }

Agent B:
  → runs the plugin
  → sends agent.operation.output { seq:0, stream:'structured', data:'{"echo":"hello"}' }
  → sends agent.operation.status { status:'running' }
  → sends agent.operation.result { success:true, data:{echo:'hello'}, exitCode:0 }

Relay → Browser A, B:
  operation.output (to subscribers)
  operation.status (to subscribers)
  operation.result (to subscribers)
```

---

## 5. Minimal Implementation Plan

### Phase 1: RemoteOperationManager (new module)

`src/remote-operation-manager.ts`:
- `Map<operationId, RemoteOperation>`
- `createOperation(nodeId, kind, opts)` — validates rules 1-3
- `subscribeOperation(operationId, ws)`
- `broadcastOperationOutput(operationId, output)`
- `broadcastOperationStatus(operationId, status, detail)`
- `completeOperation(operationId, result)`
- `replayOperation(operationId, ws)` — full replay for late joiner

### Phase 2: New message handlers (relay-server.ts)

```
operation.start    → createOperation()
operation.subscribe → replayOperation() + subscribeOperation()
operation.input    → forward to agent via relay.operation.input
operation.cancel   → forward to agent, mark cancelled

agent.operation.output  → broadcastOperationOutput()
agent.operation.status  → broadcastOperationStatus()
agent.operation.result  → completeOperation()
```

### Phase 3: Terminal shell as operation (backward compat)

- `shell.spawn` → internally delegates to `operation.start` with kind:'terminal'
- `shell.input` → delegates to `operation.input`
- `shell.output` stays as the browser-facing message for compatibility
- `shellSubscribers` maps resolved from `operationSubscribers`

### Phase 4: Extension command forwarding

- `instance.command` for remote instances → `relay.operation.start { kind:'adapter_command' }`
- `agent.operation.result` brings back the command result

### Phase 5: Tests

1. `remote-shared-terminal-session.test.mjs` — terminal as operation kind='terminal'
2. `remote-operation-plugin-session.test.mjs` — plugin operations
3. `remote-routing-invariants.test.mjs` — global invariants (no fallback, scoped output, replay)

---

## 6. Invariant Enforcement Strategy

Rather than relying on each handler to check rules 1-6, enforce them at one choke point:

```typescript
// src/remote-operation-manager.ts
function validateRemoteTarget(nodeId: string): InstanceData {
  const instance = instanceManager.get(nodeId);
  if (!instance) {
    throw new OperationError('TARGET_NOT_FOUND', `Node ${nodeId} not found`, true);
  }
  if (instance.source === 'remote') {
    if (!instance.agentConnection || instance.agentConnection.readyState !== WebSocket.OPEN) {
      throw new OperationError('AGENT_DISCONNECTED', `Agent for ${nodeId} is not connected`, true);
    }
  }
  // local instances are allowed (for testing/local use) but remote MUST pass above checks
  return instance;
}
```

Every operation.start handler calls `validateRemoteTarget(nodeId)` first. If it throws, the error is already reported (`_reported: true`) and no fallback occurs. This single function prevents ALL fallback bugs — terminal, plugin, command, future extensions.
