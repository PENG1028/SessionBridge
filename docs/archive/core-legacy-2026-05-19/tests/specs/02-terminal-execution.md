# 02 — Terminal Execution Layer

Terminal = shell process spawned on a node, with stdin/stdout routed through the relay.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| InstanceManager | `src/instance-manager.ts` | create, get, list, status tracking |
| spawnShellForWs | `src/relay-server.ts` | shell.spawn handler, instance creation |
| broadcastShellOutput | `src/relay-server.ts` | agent.stdout → browser routing |
| operation.input | `src/relay-server.ts` | stdin routing to local or remote instance |
| API /api/list | `src/relay-server.ts` | directory listing for DirectoryPicker |

## Tests

### 1. `terminal-consistency.test.mjs`
**A1-A7 checklist.** cwd display, DirectoryPicker root per node, cd path change, path bookmarks, cross-node cwd independence. Requires external relays: VPS on 18080 + local on 14400.

### 2. `terminal-path-e2e.test.mjs`
Shell spawn, path correctness (homeDir vs projectCwd), output routing, state isolation, edge cases.

### 3. `local-shared-terminal-session.test.mjs`
Two browsers connected to same relay share a local shell: same instanceId, same I/O stream.

### 4. `remote-shared-terminal-session.test.mjs`
Browser A opens B-device terminal → Browser B sees same terminal tab, same shell instance, I/O proxied through agent WebSocket.
