# 05 — Agent / Operation Layer

Agent = a node that registers with the relay and executes operations (spawn, command, stdin, etc.).
Operation = a unified protocol for remote execution across terminal, plugin, and adapter commands.

## Code Modules Exercised

| Module | Path | Role |
|--------|------|------|
| OperationRunner | `extensions/agent-core/node-runtime.ts` | agent-side operation dispatch |
| RemoteOperationManager | `src/relay-server.ts` | validate, route, track operations |
| RelayConnection | `extensions/agent-core/relay-connection.ts` | WebSocket transport for operations |
| InstanceManager | `src/instance-manager.ts` | runtime instance tracking |

## Tests

### 1. `real-agent-operation-protocol.test.mjs`
Full relay.operation.* → agent.operation.* round-trip through real agent-side code. Spawns bridge with NodeRuntime + OperationRunner.

### 2. `remote-operation-plugin-session.test.mjs`
Unified operation.start protocol for non-terminal remote execution (plugin commands, adapter commands, tasks).

### 3. `remote-routing-invariants.test.mjs`
6 global invariants enforced at RemoteOperationManager.validateTarget. Applies to terminal, plugin, adapter_command, and task operations equally.

### 4. `node-runtime-surface-boundary-invariants.test.mjs`
collectPeers() excludes runtime instances, agent.instance.spawn sets parentNodeId, runtimeKind discriminator.
