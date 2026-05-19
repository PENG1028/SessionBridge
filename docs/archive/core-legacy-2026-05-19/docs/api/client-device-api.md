# Client-Device API

WebSocket-based protocol between browser client and relay/agent. The full protocol spec is in [`docs/protocol.md`](../protocol.md); this doc covers the browser-facing contract as consumed by `lib/ws-client.ts` and `lib/use-ws.ts`.

## Connection

- **Transport**: WebSocket (`ws://` or `wss://`)
- **Handshake**: `hello`/`welcome` standard handshake with optional ECDH + AES-256-GCM encryption
- **Heartbeat**: Server sends `ping` every 30s, client must reply `pong`
- **Reconnection**: Exponential backoff (1s × 1.5^n, capped at 30s, ±500ms jitter)

## Client API (WSClient)

All client-facing public methods on `WSClient` (`lib/ws-client.ts`):

| Method | Message Type | Purpose |
|--------|-------------|---------|
| `sendInput(data, sessionId?, instanceId?)` | `instance.input` | Send user text/command |
| `sendCommand(name, args?, sessionId?, instanceId?)` | `instance.command` | Framework-level command (switch, interrupt, clear, etc.) |
| `sendResize(cols, rows)` | `shell.resize` | Terminal resize notification |
| `requestSessions()` | `session.list_req` | Request workspace session list |

### sendCommand — Known Commands

| `name` | `args` | Description |
|--------|--------|-------------|
| `switch-instance` | `{ instanceId }` | Activate a different instance |
| `list-instances` | — | List all instances |
| `interrupt` | — | Interrupt current operation |
| `clear` | `{ model? }` | Clear session, optionally switch model |
| `restart` | `{ model? }` | Same as `clear` |
| `rewind` | — | Rollback to last checkpoint |
| `rewind-all` | — | Rollback all checkpoints in current turn |
| `setMode` | `{ mode }` | Set permission mode |
| `setEffort` | `{ level }` | Set thinking effort |

## Server → Client Messages

All messages received through `WSCallback` callbacks:

### Connection

| Type | Callback | Description |
|------|----------|-------------|
| `welcome` | `onStatusChange`, `onInstanceList`, `onExtensionPoints` | Auth success, contains sessionId, instances, extension points |
| `auth_result` | `onStatusChange`, `onInstanceList` | Legacy auth result |
| `workspace_connected` | `onWorkspaceConnected`, `onStatusChange` | Legacy direct connect |

### Data

| Type | Callback | Description |
|------|----------|-------------|
| `instance.output` / `output` | `onOutput` | Raw terminal output (ANSI escape sequences) |
| `instance.block` / `block` | `onBlock` | Structured block (thinking, tool_use, text, etc.) |
| `instance.command_result` / `command_result` | `onCommandResult` | Command execution result `{ name, success, data?, error? }` |

### Queue

| Type | Callback | Description |
|------|----------|-------------|
| `queue.status` / `queue_status` | `onQueueStatus` | Queue state: `{ processing, source, queueDepth }` |

### Session Management (Workspace Mode)

| Type | Callback | Description |
|------|----------|-------------|
| `session.list` / `sessions_list` | `onSessionsList` | List of all sessions |
| `session.added` / `session_added` | `onSessionAdded` | New session created |
| `session.removed` / `session_removed` | `onSessionRemoved` | Session removed |

### Instance Management

| Type | Callback | Description |
|------|----------|-------------|
| `instance.list` / `instance_list` | `onInstanceList` | Full instance list + activeId |
| `instance.added` / `instance_added` | `onInstanceAdded` | New instance created |
| `instance.removed` / `instance_removed` | `onInstanceRemoved` | Instance deleted |
| `instance.switched` / `instance_switched` | `onInstanceSwitched` | Active instance changed |

### System

| Type | Callback | Description |
|------|----------|-------------|
| `system.notification` | `onSystemNotify` | Toast notification `{ id?, type, title, message?, scenarioId?, duration?, action? }` |
| `system.notification_dismiss` | `onSystemNotifyDismiss` | Dismiss by server-assigned id |
| `update.available` | `onSystemNotify` | Version update prompt `{ latest, current }` |
| `error` | `onError` | Error message |
| (catch-all) | `onSystemMessage` | Unhandled message types |
| (extension points) | `onExtensionPoints` | `Record<string, unknown>` with adapterViews, adapterMeta, adapterCapabilities |

## REST API (HTTP)

Used for instance lifecycle operations that don't need WebSocket semantics.

Base URL: HTTP equivalent of the WebSocket URL (inferred by replacing `ws://` with `http://`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/instances` | List all instances |
| `GET` | `/api/instances/:id` | Get single instance detail |
| `GET` | `/api/instances/:id/status` | Lightweight status |
| `POST` | `/api/instances` | Create instance `{ dir, label?, adapterId? }` |
| `POST` | `/api/instances/:id/command` | Send control command to instance |
| `DELETE` | `/api/instances/:id` | Delete instance |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/upload` | Upload file to workspace `{ path, data, encoding }` |

## Key Data Shapes

### StatusInfo
```typescript
{ authenticated: boolean; sessionId?: string; retryCount?: number }
```

### InstanceInfo
```typescript
{
  id: string; dir: string; label: string; status: string;
  source: string; adapterId?: string; model: string | null;
  blockCount: number; outputSize: number; checkpointCount: number;
  createdAt: number;
}
```

### QueueStatus
```typescript
{ processing: boolean; source: string | null; queueDepth: number }
```

### CommandResult
```typescript
{ name: string; success: boolean; data?: Record<string, any>; error?: string }
```

### ConnStatus (from useSession hook)
```typescript
{ status: 'connecting' | 'connected' | 'disconnected' | 'error'; sessionId?: string; retryCount?: number }
```

## React Hook: `useSession`

Location: `lib/use-ws.ts`

Creates a `WSClient` instance, manages connection lifecycle, and exposes reactive state:

```typescript
function useSession(
  wsUrl: string,
  token?: string,
  initialCols?: number,
  initialRows?: number,
  onChunk?: (data: string) => void,
  onSystemNotify?: (notification) => void,
  onSystemNotifyDismiss?: (id: string) => void,
): {
  connStatus, output, msgLog, serverBlocks,
  sendInput, sendCommand, sendResize, queueStatus,
  sessions, activeSessionId, activateSession, spawnSession, activeBlocks, isWorkspace,
  instances, activeInstanceId, activateInstance, createInstance, killInstance,
  extensionPointsData,
}
```

### Instance Lifecycle via Hook

| Function | Description |
|----------|-------------|
| `createInstance(dir, label?, adapterId?)` | POST `/api/instances`, adds to local state on success |
| `killInstance(id)` | Optimistic local removal, then DELETE `/api/instances/:id` |
| `activateInstance(id)` | Sets local activeInstanceId + sends `switch-instance` command |

## Extension Points Data

Received in the `onExtensionPoints` callback during welcome. Shape:

```
Record<string, unknown>  // keys: adapterViews, adapterMeta, adapterCapabilities
```

Consumed by `view-registry.ts`:
- `adapterViews`: `Record<string, string>` mapping adapter ID → view ID
- `adapterMeta`: `Record<string, { label?: string; emoji?: string }>`
- `adapterCapabilities`: `Record<string, Record<string, boolean>>`
